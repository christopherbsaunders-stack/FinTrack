// Turns the stored state into everything the dashboard shows. Pure: no I/O.

import { CATEGORIES, CATEGORY_ORDER, kindOf, signedValue } from './classify.js';
import { dayKey } from './store.js';

const DAY = 86400000;
const FLOW_CATEGORIES = new Set(['cash', 'creditCard']);
// Moving money among these is a transfer. A payment to a loan is not: it is
// money spent (on principal and interest), so it stays in money out.
const TRANSFER_CATEGORIES = new Set(['cash', 'creditCard', 'investments', 'retirement']);
const TRANSFER_WINDOW_DAYS = 4;

export function computeSummary(state, now = new Date()) {
  const accounts = Object.values(state.accounts).map((a) => ({
    ...a,
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

  return {
    generatedAt: now.toISOString(),
    connected: Boolean(state.accessUrl),
    lastSync: state.lastSync,
    lastAttempt: state.lastAttempt,
    errors: state.lastErrors || [],
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
      const cur = map.get(key) || { symbol: h.symbol, description: h.description, value: 0, costBasis: 0, hasBasis: true };
      cur.value += h.value;
      if (h.costBasis == null) cur.hasBasis = false; else cur.costBasis += h.costBasis;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 25)
    .map((h) => ({ ...h, value: r2(h.value), gain: h.hasBasis ? r2(h.value - h.costBasis) : null }));
}

function sum(list) { return r2(list.reduce((s, v) => s + v, 0)); }
function r2(n) { return Math.round(n * 100) / 100; }
