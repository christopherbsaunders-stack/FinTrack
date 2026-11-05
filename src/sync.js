// Pulls the latest balances and transactions from SimpleFIN into the state
// and records today's value of every account, so the history builds itself.

import { fetchAccounts, MAX_RANGE_DAYS } from './simplefin.js';
import { guessCategory, signedValue } from './classify.js';
import { dayKey } from './store.js';
import { refreshPrices } from './prices.js';
import { valuePriced } from './priced.js';
import { fetchSeries, indexedValue, seriesLabel, staleness } from './hpi.js';

const DAY = 86400000;
const FIRST_SYNC_DAYS = 89;    // fetched in MAX_RANGE_DAYS pieces
const OVERLAP_DAYS = 10;       // re-read recent days: pending transactions settle late
const KEEP_TRANSACTIONS_DAYS = 3 * 365;

// Everything a scheduled sync does: SimpleFIN (when connected), then fund
// prices (when there are priced accounts), then today's values.
export async function syncAll(state, { now = new Date(), fetchImpl } = {}) {
  const out = { accounts: 0, errors: [], priceErrors: [] };
  if (state.accessUrl) {
    try { Object.assign(out, await syncNow(state, { now, fetchImpl })); } catch (err) { out.errors = [err.message]; }
  }
  const tickers = pricedTickers(state);
  if (tickers.length) {
    out.priceErrors = await refreshPrices(state, tickers, { now, fetchImpl });
    state.priceErrors = out.priceErrors;
    state.lastPriceSync = now.toISOString();
  }
  const series = indexSeries(state);
  if (series.length) out.indexErrors = state.indexErrors = await refreshIndexes(state, series, { now, fetchImpl });
  state.lastAttempt = now.toISOString();
  revaluePriced(state, now);
  return out;
}

export async function syncNow(state, { now = new Date(), fetchImpl } = {}) {
  if (!state.accessUrl) throw new Error('Not connected: add a SimpleFIN setup token first.');
  state.lastAttempt = now.toISOString();
  const since = state.lastSync
    ? new Date(Math.max(new Date(state.lastSync).getTime() - OVERLAP_DAYS * DAY, now.getTime() - FIRST_SYNC_DAYS * DAY))
    : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY);
  let result;
  try {
    result = await fetchInWindows(state.accessUrl, since, now, fetchImpl);
  } catch (err) {
    state.lastErrors = [err.message];
    throw err;
  }
  applyAccountSet(state, result, now);
  state.lastSync = now.toISOString();
  state.lastErrors = result.errors;
  return { accounts: result.accounts.length, errors: result.errors };
}

// One request per MAX_RANGE_DAYS, oldest first. Transactions from every piece
// are kept; balances come from the newest piece (the last one read).
export async function fetchInWindows(accessUrl, since, now, fetchImpl) {
  const step = MAX_RANGE_DAYS * DAY;
  const byId = new Map();
  const errors = new Set();
  for (let start = since.getTime(); start < now.getTime(); start += step) {
    const end = new Date(Math.min(start + step, now.getTime()));
    const part = await fetchAccounts(accessUrl, { startDate: new Date(start), endDate: end }, fetchImpl);
    for (const e of part.errors) errors.add(e);
    for (const a of part.accounts) {
      const prev = byId.get(a.id);
      const txs = new Map((prev?.transactions || []).map((t) => [t.id, t]));
      for (const t of a.transactions) txs.set(t.id, t);
      byId.set(a.id, { ...a, transactions: [...txs.values()] });
    }
  }
  return { errors: [...errors], accounts: [...byId.values()] };
}

export function applyAccountSet(state, { accounts }, now = new Date()) {
  for (const a of accounts) {
    const prev = state.accounts[a.id];
    const { transactions, ...rest } = a;
    state.accounts[a.id] = {
      ...rest,
      source: 'simplefin',
      category: prev?.categoryOverride || prev?.category || guessCategory(a),
      categoryOverride: prev?.categoryOverride || null,
      displayName: prev?.displayName || null,
      hidden: prev?.hidden || false,
      loan: prev?.loan || null,
      firstSeen: prev?.firstSeen || now.toISOString(),
      lastSeen: now.toISOString(),
    };
    for (const t of transactions) {
      // A pending transaction often gets a new id once it posts; drop old
      // pending rows of this account that no longer come back from the bank.
      state.transactions[t.id] = { ...t, accountId: a.id };
    }
    const fresh = new Set(transactions.map((t) => t.id));
    for (const [id, t] of Object.entries(state.transactions)) {
      if (t.accountId === a.id && t.pending && !fresh.has(id)) delete state.transactions[id];
    }
  }
  pruneTransactions(state, now);
  recordSnapshot(state, now);
}

export function pricedTickers(state) {
  const set = new Set();
  for (const a of Object.values(state.accounts)) {
    if (a.source !== 'priced') continue;
    for (const p of a.priced.positions) set.add(p.ticker);
    for (const t of Object.keys(a.priced.plan?.allocation || {})) set.add(t);
  }
  return [...set].sort();
}

// Value every priced account from its shares and the latest prices, fill in
// its past days since asOf (from the price history), and record today.
export function indexSeries(state) {
  return [...new Set(Object.values(state.accounts).map((a) => a.index?.series).filter(Boolean))].sort();
}

// House price indexes change once a quarter (or year): one fetch a day is plenty.
export async function refreshIndexes(state, series, { now = new Date(), fetchImpl, force = false } = {}) {
  state.indexes ||= {};
  const errors = [];
  for (const id of series) {
    const have = state.indexes[id];
    if (!force && have?.fetchedAt && now - new Date(have.fetchedAt) < 20 * 3600000 && !have.error) continue;
    try {
      state.indexes[id] = { obs: await fetchSeries(id, fetchImpl), fetchedAt: now.toISOString(), error: null };
    } catch (err) {
      state.indexes[id] = { ...(have || { obs: {} }), error: err.message, failedAt: now.toISOString() };
      errors.push(`${seriesLabel(id)}: ${err.message}`);
    }
  }
  return errors;
}

// Accounts whose value follows a house price index.
export function revalueIndexed(state, now = new Date()) {
  for (const a of Object.values(state.accounts)) {
    if (!a.index) continue;
    const obs = state.indexes?.[a.index.series]?.obs || {};
    const v = indexedValue(a.index, obs);
    a.balance = v.value;
    a.indexStatus = { label: seriesLabel(a.index.series), change: v.change, latestDate: v.latestDate, since: a.index.anchorDate, stale: staleness(a.index.series, obs, dayKey(now)) };
  }
}

export function revaluePriced(state, now = new Date()) {
  revalueIndexed(state, now);
  const today = dayKey(now);
  const firstDay = Object.keys(state.snapshots).sort()[0] || today;
  for (const a of Object.values(state.accounts)) {
    if (a.source !== 'priced') continue;
    const v = valuePriced(a.priced, state.prices || {}, today);
    a.balance = v.value;
    a.holdings = v.holdings;
    a.balanceDate = v.priceDate ? `${v.priceDate}T21:00:00.000Z` : a.balanceDate;
    a.status = { estimates: v.estimates, estimatedSince: v.estimatedSince, waiting: v.waiting, missing: v.missing, priceDate: v.priceDate };
    for (const p of v.series) {
      // Only from the first day anything was recorded: earlier, the other
      // accounts have no values and net worth would read as just this one.
      if (p.date < firstDay || p.date >= today) continue;
      (state.snapshots[p.date] ||= {})[a.id] = round2(signedValue(p.value, a.category));
    }
  }
  recordSnapshot(state, now);
}

export function recordSnapshot(state, now = new Date()) {
  const key = dayKey(now);
  const snap = {};
  for (const [id, a] of Object.entries(state.accounts)) snap[id] = round2(signedValue(a.balance, a.category));
  state.snapshots[key] = snap;
}

function pruneTransactions(state, now) {
  const cutoff = now.getTime() - KEEP_TRANSACTIONS_DAYS * DAY;
  for (const [id, t] of Object.entries(state.transactions)) {
    const when = new Date(t.posted || t.transactedAt || now).getTime();
    if (when < cutoff) delete state.transactions[id];
  }
}

function round2(n) { return Math.round(n * 100) / 100; }
