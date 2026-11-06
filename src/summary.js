// Turns the stored state into everything the dashboard shows. Pure: no I/O.

import { CATEGORIES, CATEGORY_ORDER, kindOf, signedValue } from './classify.js';
import { dayKey } from './store.js';
import { loanSummary } from './loans.js';
import { lacksName } from './prices.js';
import { splitBuckets, averageSpending, monthsCovered } from './buckets.js';
import { computeBudget, ratios } from './budget.js';
import { computeMix } from './mix.js';
import { computeFees } from './fees.js';
import { project, typicalReturn, REAL_RETURNS, SPREAD } from './retirement.js';
import { healthChecks } from './health.js';
import { summarizeProtection, emptyProtection } from './protection.js';
import { makeSnapshot, compareSnapshots, lastBefore, localDay } from './reports.js';

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
  const budget = computeBudget(state.settings?.budget, measured);
  // What the emergency fund has to cover: the essential lines of the expense
  // list once there is one; before that, the amount entered on the fund (the
  // older way), else measured spending.
  let expenses, allExpenses = null, source;
  if (budget.set && budget.essential > 0) { expenses = budget.essential; allExpenses = budget.all; source = 'list'; }
  else if (em?.expenses) { expenses = em.expenses; source = 'entered'; }
  else { expenses = measured?.amount ?? null; source = measured ? 'measured' : null; }
  const emergency = em ? {
    name: em.name, account: em.account, value: em.value, goal: em.goal,
    expenses, allExpenses, source, measured,
    months: monthsCovered(em.value, expenses),
    monthsAll: allExpenses > expenses ? monthsCovered(em.value, allExpenses) : null,
  } : null;
  const loans = visible.filter((a) => a.kind === 'liability' && a.loan)
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || Math.abs(b.value) - Math.abs(a.value))
    .map((a) => loanFor(state, a, now));
  // Yearly 401(k) money in (yours and the match) from the contribution plans.
  const PER_YEAR = { month: 12, '2weeks': 26, week: 52 };
  const plans = visible.filter((a) => a.source === 'priced' && a.priced?.plan?.enabled);
  const retirementPerYear = plans.length ? Math.round(plans.reduce((s, a) => s + a.priced.plan.amount * (PER_YEAR[a.priced.plan.schedule?.every] || 12), 0) * 100) / 100 : null;
  budget.ratios = ratios(budget, { loanPayments: loans.reduce((s, l) => s + l.payment, 0), retirementPerYear });
  const mix = computeMix(visible, state.assetClasses || {}, state.settings?.targetMix || null);
  const fees = computeFees(topHoldings(visible, state.costs || {}, state.names || {}, 1000), state.fees || {}, {
    ...Object.fromEntries(Object.entries(state.prices || {}).map(([t, p]) => [t, { type: p.type || null }])),
    ...(state.symbolInfo || {}),
  });
  const retirement = retirementOutlook(state, visible, mix, fees, retirementPerYear, budget, now);
  const protection = summarizeProtection(state.settings?.protection, { salary: budget.salary, accounts: visible, thisYear: now.getFullYear() });

  const out = {
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
    report: { name: state.settings?.reportName || '', notes: state.settings?.reportNotes || '' },
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
    composition: buildComposition(state.snapshots, Object.fromEntries(visible.map((a) => [a.id, a.category]))),
    cashFlow: flows.months,
    transactions: flows.recent,
    holdings: topHoldings(visible, state.costs || {}, state.names || {}),
    loans,
    buckets: allBuckets,
    emergency,
    budget,
    mix,
    retirement,
    health: healthChecks({ budget, emergency, loans, retirement, protection }),
    protection: { ...protection, raw: state.settings?.protection || emptyProtection() },
    fees,
    categories: CATEGORY_ORDER.map((id) => ({ id, ...CATEGORIES[id] })),
  };
  // What changed since the last advisor report (one printed before today).
  const prev = lastBefore(state.reportSnapshots, localDay(now));
  out.sinceLastReport = prev ? compareSnapshots(prev, makeSnapshot(out, now)) : null;
  out.reportHistory = (state.reportSnapshots || []).map((x) => x);
  return out;
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

// Net worth by type for every day, as layers that add up to net worth:
// equity layers (home value minus mortgage, car value minus car loan) so a
// big asset and its loan don't show as two huge layers that cancel out.
export const LAYERS = [
  ['retirement', 'Retirement', ['retirement']],
  ['investments', 'Investments', ['investments']],
  ['cash', 'Cash', ['cash']],
  ['homeEquity', 'Home equity', ['property', 'mortgage']],
  ['carOther', 'Car and other', ['vehicle', 'autoLoan', 'otherAsset']],
  ['debts', 'Other debts', ['creditCard', 'studentLoan', 'otherDebt']],
];
export function buildComposition(snapshots, categoryOf) {
  const layerOf = {};
  for (const [key, , cats] of LAYERS) for (const c of cats) layerOf[c] = key;
  const last = {};
  const used = new Set();
  const days = Object.keys(snapshots).sort().map((date) => {
    Object.assign(last, snapshots[date]);
    const row = { date };
    for (const [key] of LAYERS) row[key] = 0;
    for (const [id, v] of Object.entries(last)) {
      const layer = layerOf[categoryOf[id]];
      if (!layer) continue;
      row[layer] += v;
      used.add(layer);
    }
    let total = 0;
    for (const [key] of LAYERS) { row[key] = r2(row[key]); total += row[key]; }
    row.netWorth = r2(total);
    return row;
  });
  return { layers: LAYERS.filter(([k]) => used.has(k)).map(([key, label]) => ({ key, label })), days };
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

// The retirement projection, from the settings and what FinTrack knows:
// retirement accounts (and brokerage, if chosen), the 401(k) contribution
// plans plus other saving, the investment mix and fund fees.
const SALARY_GUIDE = [[30, 1], [35, 2], [40, 3], [45, 4], [50, 6], [55, 7], [60, 8], [67, 10]];
function retirementOutlook(state, visible, mix, fees, perYear, budget, now) {
  const set = state.settings?.retirement || null;
  const cats = set?.includeTaxable ? ['retirement', 'investments'] : ['retirement'];
  const start = Math.round(visible.filter((a) => cats.includes(a.category)).reduce((s, a) => s + a.value, 0));
  const planMonthly = Math.round(((perYear || 0) / 12) * 100) / 100;
  const out = { set: Boolean(set), settings: set, start, planMonthly, assumptions: { returns: REAL_RETURNS, spread: SPREAD, fee: fees?.weighted ?? null } };
  if (!set) return out;
  const age = now.getFullYear() - set.birthYear;
  const typical = set.typicalReturn ?? typicalReturn(mix, fees?.weighted);
  out.age = age;
  out.monthly = Math.round((planMonthly + (set.extraMonthly || 0)) * 100) / 100;
  out.typicalFrom = set.typicalReturn != null ? 'entered' : 'mix';
  Object.assign(out, project({ start, monthly: out.monthly, age, retireAge: set.retireAge, income: set.income, socialSecurity: set.socialSecurity, typical, withdrawalRate: set.withdrawalRate }));
  // Retirement savings as a multiple of salary, against a common rule of thumb for this age.
  if (budget?.salary > 0) {
    let guide = null;
    for (let i = 0; i < SALARY_GUIDE.length; i++) {
      const [a, m] = SALARY_GUIDE[i], next = SALARY_GUIDE[i + 1];
      if (age <= a) { guide = i === 0 ? m : SALARY_GUIDE[i - 1][1] + (m - SALARY_GUIDE[i - 1][1]) * ((age - SALARY_GUIDE[i - 1][0]) / (a - SALARY_GUIDE[i - 1][0])); break; }
      if (!next) guide = m;
    }
    out.salaryMultiple = { have: start / budget.salary, guide: Math.round(guide * 10) / 10 };
  }
  return out;
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

// Holdings across accounts, by symbol. Where the brokerage doesn't send what
// you paid, the average cost per share you entered (`costs`) fills it in.
function topHoldings(accounts, costs = {}, names = {}, limit = 25) {
  const map = new Map();
  for (const a of accounts) {
    for (const h of a.holdings || []) {
      const key = h.symbol || h.description;
      if (!key) continue;
      // SimpleFIN fills a missing name with "0.146 shares of AMD"; use the name looked up instead.
      const description = lacksName(h.description) ? names[h.symbol] || '' : h.description;
      const cur = map.get(key) || { symbol: h.symbol, description, value: 0, costBasis: 0, hasBasis: true, shares: 0, price: null, taxable: false, costSource: null };
      if (a.category === 'investments') cur.taxable = true;
      if (!cur.description && description) cur.description = description;
      cur.value += h.value;
      cur.shares += Number(h.shares) || 0;
      if (h.price) cur.price = h.price;
      // A cost of 0 means the brokerage didn't say (saved before that was handled on sync).
      let basis = h.costBasis == null || (h.costBasis === 0 && h.value > 0) ? null : h.costBasis;
      let source = basis == null ? null : 'brokerage';
      const entered = h.symbol ? costs[h.symbol] : null;
      if (basis == null && entered > 0 && Number(h.shares) > 0) { basis = entered * Number(h.shares); source = 'entered'; }
      if (basis == null) cur.hasBasis = false; else cur.costBasis += basis;
      cur.costSource = cur.costSource && cur.costSource !== source ? 'mixed' : source;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, limit)
    .map((h) => ({
      ...h, value: r2(h.value), shares: Math.round(h.shares * 1e4) / 1e4,
      // Brokerages send shares and market value; the price is the one they valued it at.
      price: h.price ?? (h.shares > 0 ? Math.round((h.value / h.shares) * 100) / 100 : null),
      gain: h.hasBasis ? r2(h.value - h.costBasis) : null,
      gainPct: h.hasBasis && h.costBasis > 0 ? (h.value - h.costBasis) / h.costBasis : null,
      costBasis: h.hasBasis ? r2(h.costBasis) : null,
      avgCost: h.symbol && costs[h.symbol] ? costs[h.symbol] : null,
    }));
}

function sum(list) { return r2(list.reduce((s, v) => s + v, 0)); }
function r2(n) { return Math.round(n * 100) / 100; }
