// Turns the stored state into everything the dashboard shows. Pure: no I/O.

import { CATEGORIES, CATEGORY_ORDER, kindOf, signedValue } from './classify.js';
import { dayKey } from './store.js';
import { loanSummary } from './loans.js';
import { splitBuckets, averageSpending, monthsCovered } from './buckets.js';

const DAY = 86400000;
const FLOW_CATEGORIES = new Set(['cash', 'creditCard']);
// Moving money among these is a transfer. A payment to a loan is not: it is
// money spent (on principal and interest), so it stays in money out.
const TRANSFER_CATEGORIES = new Set(['cash', 'creditCard', 'investments', 'retirement']);
const TRANSFER_WINDOW_DAYS = 4;

export function computeSummary(state, now = new Date()) {
  const accounts = Object.values(state.accounts).map(({ priced, ...a }) => ({
    ...a,
    ...(priced ? { priced: { asOf: priced.asOf, coveredUntil: priced.coveredUntil, plan: priced.plan, positions: priced.positions, imported: priced.ledger.length } } : {}),
    name: a.displayName || a.name,
    value: signedValue(a.balance, a.category),
    kind: kindOf(a.category),
  }));
  const visible = accounts.filter((a) => !a.hidden);
  const visibleIds = new Set(visible.map((a) => a.id));

  const history = buildHistory(state.snapshots, visibleIds);
  const ago = (days) => valueAsOf(history, dayKey(new Date(now.getTime() - days * DAY)));

  const byCategory = CATEGORY_ORDER.map((cat) => {
    const list = visible.filter((a) => a.category === cat);
    return { category: cat, label: CATEGORIES[cat].label, kind: CATEGORIES[cat].kind, total: sum(list.map((a) => a.value)), count: list.length };
  }).filter((c) => c.count > 0);

  const assets = sum(visible.filter((a) => a.kind === 'asset').map((a) => a.value));
  const liabilities = -sum(visible.filter((a) => a.kind === 'liability').map((a) => a.value));
  const netWorth = assets - liabilities;
  const cat = (c) => sum(visible.filter((a) => a.category === c).map((a) => a.value));

  const month = ago(30);
  const year = ago(365);

  for (const a of accounts) a.change30 = accountChange(state.snapshots, a.id, a.value, dayKey(new Date(now.getTime() - 30 * DAY)));

  const flows = cashFlow(state, now);

  // Buckets: each account's balance split into named parts.
  const allBuckets = [];
  for (const a of accounts) {
    if (!a.buckets?.length) continue;
    const split = splitBuckets(a.balance, a.buckets);
    a.buckets = split.buckets;
    a.bucketWarnings = split.warnings;
    if (!a.hidden) for (const b of split.buckets) allBuckets.push({ ...b, accountId: a.id, account: a.name });
  }
  const em = allBuckets.find((b) => b.emergency);
  const thisMonth = dayKey(now).slice(0, 7);
  const measured = averageSpending(flows.months, thisMonth);
  const emergency = em ? {
    name: em.name, account: em.account, value: em.value, goal: em.goal,
    expenses: em.expenses || measured?.amount || null,
    source: em.expenses ? 'entered' : measured ? 'measured' : null,
    measured,
    months: monthsCovered(em.value, em.expenses || measured?.amount),
  } : null;
  const loans = visible.filter((a) => a.kind === 'liability' && a.loan)
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || Math.abs(b.value) - Math.abs(a.value))
    .map((a) => loanFor(state, a, now));

  return {
    generatedAt: now.toISOString(),
    connected: Boolean(state.accessUrl),
    lastSync: state.lastSync,
    lastAttempt: state.lastAttempt,
    errors: state.lastErrors || [],
    priceErrors: state.priceErrors || [],
    indexErrors: state.indexErrors || [],
    lastPriceSync: state.lastPriceSync || null,
    hasPriced: accounts.some((a) => a.source === 'priced'),
    syncHours: state.settings?.syncHours,
    totals: {
      netWorth, assets, liabilities,
      cash: cat('cash'),
      invested: cat('investments') + cat('retirement'),
      retirement: cat('retirement'),
      homeEquity: cat('property') > 0 ? cat('property') + cat('mortgage') : null,
      vehicleEquity: cat('vehicle') > 0 ? cat('vehicle') + cat('autoLoan') : null,
      debtToAsset: assets > 0 ? liabilities / assets : null,
      change30: month == null ? null : netWorth - month.netWorth,
      change365: year == null ? null : netWorth - year.netWorth,
    },
    byCategory,
    accounts: accounts.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || Math.abs(b.value) - Math.abs(a.value)),
    history,
    cashFlow: flows.months,
    transactions: flows.recent,
    holdings: topHoldings(visible),
    loans,
    buckets: allBuckets,
    emergency,
    categories: CATEGORY_ORDER.map((id) => ({ id, ...CATEGORIES[id] })),
  };
}

// Net worth, assets and debts for every day we have a snapshot, carrying each
// account's last known value forward (a sync can miss an account for a day).
export function buildHistory(snapshots, includeIds) {
  const days = Object.keys(snapshots).sort();
  const last = {};
  return days.map((date) => {
    Object.assign(last, snapshots[date]);
    let assets = 0, liabilities = 0;
    for (const [id, v] of Object.entries(last)) {
      if (includeIds && !includeIds.has(id)) continue;
      if (v >= 0) assets += v; else liabilities -= v;
    }
    return { date, assets: r2(assets), liabilities: r2(liabilities), netWorth: r2(assets - liabilities) };
  });
}

function valueAsOf(history, key) {
  let found = null;
  for (const h of history) { if (h.date <= key) found = h; else break; }
  return found;
}

function accountChange(snapshots, id, current, key) {
  let past = null;
  for (const date of Object.keys(snapshots).sort()) {
    if (date > key) break;
    if (id in snapshots[date]) past = snapshots[date][id];
  }
  return past == null ? null : r2(current - past);
}

// Money in and out of checking, savings and cards, by month, leaving out
// transfers between your own accounts (a payment to your card shows up twice:
// out of checking and into the card). Loan payments count as money out.
export function cashFlow(state, now = new Date(), months = 12) {
  const txs = Object.values(state.transactions)
    .filter((t) => state.accounts[t.accountId] && !state.accounts[t.accountId].hidden)
    .map((t) => ({ ...t, time: new Date(t.posted || t.transactedAt || now).getTime() }))
    .sort((a, b) => b.time - a.time);

  const transfers = findTransfers(txs.filter((t) => TRANSFER_CATEGORIES.has(state.accounts[t.accountId].category)));

  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const buckets = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, in: 0, out: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.month, i]));
  for (const t of txs) {
    if (t.pending || transfers.has(t.id)) continue;
    if (!FLOW_CATEGORIES.has(state.accounts[t.accountId].category)) continue;
    const d = new Date(t.time);
    const i = index.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    if (i == null) continue;
    if (t.amount >= 0) buckets[i].in += t.amount; else buckets[i].out -= t.amount;
  }
  for (const b of buckets) { b.in = r2(b.in); b.out = r2(b.out); b.net = r2(b.in - b.out); }

  // The months before the first transaction we have would read as zero; trim them.
  const firstTx = txs.length ? new Date(txs[txs.length - 1].time) : now;
  const firstMonth = `${firstTx.getFullYear()}-${String(firstTx.getMonth() + 1).padStart(2, '0')}`;

  const recent = txs.slice(0, 150).map((t) => ({
    id: t.id,
    date: new Date(t.time).toISOString(),
    description: t.description,
    amount: t.amount,
    pending: t.pending,
    transfer: transfers.has(t.id),
    account: state.accounts[t.accountId].displayName || state.accounts[t.accountId].name,
  }));
  return { months: buckets.filter((b) => b.month >= firstMonth), recent };
}

// A loan's numbers. This year's interest and principal are real when FinTrack
// has the balance from Jan 1 (and so the payments since); else estimated.
function loanFor(state, a, now) {
  const today = dayKey(now);
  const jan1 = `${today.slice(0, 4)}-01-01`;
  let startOfYear = null;
  for (const date of Object.keys(state.snapshots).sort()) {
    if (date > jan1) break;
    if (a.id in state.snapshots[date]) startOfYear = Math.abs(state.snapshots[date][a.id]);
  }
  // The payments only count if FinTrack holds this account's transactions
  // from the start of the year (SimpleFIN's first sync reaches back 90 days).
  const txs = Object.values(state.transactions).filter((t) => t.accountId === a.id && !t.pending);
  const earliest = txs.reduce((m, t) => ((t.posted || '9') < m ? t.posted : m), '9');
  let paidThisYear = null, payments = null;
  if (startOfYear != null && earliest.slice(0, 10) <= `${today.slice(0, 4)}-01-15`) {
    const thisYear = txs.filter((t) => t.amount > 0 && (t.posted || '').slice(0, 10) >= jan1);
    paidThisYear = thisYear.reduce((s, t) => s + t.amount, 0);
    payments = thisYear.length;
  }
  const balance = Math.abs(a.value);
  return { id: a.id, name: a.name, org: a.org, category: a.category, balance, loan: a.loan, ...loanSummary(a.loan, balance, today, { startOfYear, paidThisYear, payments }) };
}

export function findTransfers(txs) {
  const ids = new Set();
  const byAmount = new Map();
  for (const t of txs) {
    if (t.pending) continue;
    const key = Math.round(Math.abs(t.amount) * 100);
    if (!key) continue;
    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key).push(t);
  }
  for (const list of byAmount.values()) {
    for (const out of list) {
      if (out.amount >= 0 || ids.has(out.id)) continue;
      const match = list.find((t) => t.amount > 0 && !ids.has(t.id) && t.accountId !== out.accountId
        && Math.abs(t.time - out.time) <= TRANSFER_WINDOW_DAYS * DAY);
      if (match) { ids.add(out.id); ids.add(match.id); }
    }
  }
  return ids;
}

function topHoldings(accounts) {
  const map = new Map();
  for (const a of accounts) {
    for (const h of a.holdings || []) {
      const key = h.symbol || h.description;
      if (!key) continue;
      // SimpleFIN fills a missing name with "0.146 shares of AMD"; that says nothing the columns don't.
      const description = /^[\d.,]+ shares? of /i.test(h.description || '') ? '' : h.description;
      const cur = map.get(key) || { symbol: h.symbol, description, value: 0, costBasis: 0, hasBasis: true, shares: 0, price: null };
      if (!cur.description && description) cur.description = description;
      cur.value += h.value;
      cur.shares += Number(h.shares) || 0;
      if (h.price) cur.price = h.price;
      // A cost of 0 means the brokerage didn't say (saved before that was handled on sync).
      if (h.costBasis == null || (h.costBasis === 0 && h.value > 0)) cur.hasBasis = false; else cur.costBasis += h.costBasis;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 25)
    .map((h) => ({
      ...h, value: r2(h.value), shares: Math.round(h.shares * 1e4) / 1e4,
      // Brokerages send shares and market value; the price is the one they valued it at.
      price: h.price ?? (h.shares > 0 ? Math.round((h.value / h.shares) * 100) / 100 : null),
      gain: h.hasBasis ? r2(h.value - h.costBasis) : null,
    }));
}

function sum(list) { return r2(list.reduce((s, v) => s + v, 0)); }
function r2(n) { return Math.round(n * 100) / 100; }
