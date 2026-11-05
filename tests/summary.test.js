import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../src/store.js';
import { applyAccountSet, syncNow } from '../src/sync.js';
import { computeSummary, findTransfers, buildHistory } from '../src/summary.js';
import { demoState } from '../src/demo.js';

const now = new Date('2026-11-05T15:00:00');

function acct(id, name, org, balance, transactions = []) {
  return { id, name, org, currency: 'USD', balance, available: null, balanceDate: now.toISOString(), holdings: [], transactions };
}

test('net worth = assets - debts, by category', () => {
  const s = emptyState();
  applyAccountSet(s, { accounts: [
    acct('c', 'Checking', 'Chase', 5000),
    acct('k', '401k', 'Fidelity', 100000),
    acct('m', 'Mortgage', 'Rocket', -250000),
    acct('a', 'Auto Loan', 'Ally', 15000), // positive sign from this lender
  ] }, now);
  const r = computeSummary(s, now);
  assert.equal(r.totals.assets, 105000);
  assert.equal(r.totals.liabilities, 265000);
  assert.equal(r.totals.netWorth, -160000);
  assert.deepEqual(r.byCategory.map((c) => c.category), ['cash', 'retirement', 'mortgage', 'autoLoan']);
});

test('category overrides and hidden accounts survive a sync', () => {
  const s = emptyState();
  applyAccountSet(s, { accounts: [acct('x', 'Joint', 'Bank', 100)] }, now);
  s.accounts.x.categoryOverride = 'investments';
  s.accounts.x.category = 'investments';
  s.accounts.x.hidden = true;
  applyAccountSet(s, { accounts: [acct('x', 'Joint', 'Bank', 120)] }, now);
  assert.equal(s.accounts.x.category, 'investments');
  assert.equal(s.accounts.x.hidden, true);
  assert.equal(computeSummary(s, now).totals.netWorth, 0);
});

test('history carries values forward and gives the 30-day change', () => {
  const s = emptyState();
  s.snapshots = { '2026-09-01': { a: 100, b: -50 }, '2026-10-01': { a: 200 }, '2026-11-05': { a: 300, b: -40 } };
  s.accounts = { a: { id: 'a', name: 'A', balance: 300, category: 'cash' }, b: { id: 'b', name: 'B', balance: -40, category: 'creditCard' } };
  const h = buildHistory(s.snapshots);
  assert.deepEqual(h.map((p) => p.netWorth), [50, 150, 260]);
  const r = computeSummary(s, now);
  assert.equal(r.totals.change30, 260 - 150);
});

test('transfers between own accounts are paired and left out of cash flow', () => {
  const t = (id, accountId, amount, day) => ({ id, accountId, amount, pending: false, time: new Date(`2026-10-${day}T12:00:00`).getTime() });
  const ids = findTransfers([t('1', 'chk', -500, 10), t('2', 'card', 500, 11), t('3', 'chk', -500, 20), t('4', 'chk', 500, 21)]);
  assert.deepEqual([...ids].sort(), ['1', '2']);

  const s = emptyState();
  applyAccountSet(s, { accounts: [
    acct('chk', 'Checking', 'Chase', 1000, [
      { id: 'p', posted: '2026-10-03T12:00:00', amount: 3000, description: 'PAYROLL', pending: false },
      { id: 'x', posted: '2026-10-10T12:00:00', amount: -500, description: 'CARD PAYMENT', pending: false },
    ]),
    acct('card', 'Sapphire card', 'Chase', -200, [
      { id: 'y', posted: '2026-10-11T12:00:00', amount: 500, description: 'THANK YOU', pending: false },
      { id: 'g', posted: '2026-10-12T12:00:00', amount: -80, description: 'GROCERIES', pending: false },
    ]),
  ] }, now);
  const oct = computeSummary(s, now).cashFlow.find((m) => m.month === '2026-10');
  assert.deepEqual({ in: oct.in, out: oct.out }, { in: 3000, out: 80 });
});

test('syncNow fetches, records a snapshot, and keeps errors', async () => {
  const s = emptyState();
  s.accessUrl = 'https://u:p@host/simplefin';
  const fake = async () => Response.json({ errors: ['Robinhood: login needed'], accounts: [{ id: 'r', name: 'Individual', org: { name: 'Robinhood' }, balance: '1000', 'balance-date': 1762000000, transactions: [] }] });
  const r = await syncNow(s, { now, fetchImpl: fake });
  assert.equal(r.accounts, 1);
  assert.equal(s.accounts.r.category, 'investments');
  assert.deepEqual(s.snapshots['2026-11-05'], { r: 1000 });
  assert.deepEqual(s.lastErrors, ['Robinhood: login needed']);
});

test('a failed sync keeps the data and reports why', async () => {
  const s = emptyState();
  s.accessUrl = 'https://u:p@host/simplefin';
  await assert.rejects(syncNow(s, { now, fetchImpl: async () => new Response('', { status: 403 }) }), /denied/);
  assert.match(s.lastErrors[0], /denied/);
  assert.equal(s.lastSync, null);
});

test('demo data adds up', () => {
  const r = computeSummary(demoState(now), now);
  assert.ok(r.history.length > 300);
  assert.ok(r.totals.assets > 0 && r.totals.liabilities > 0);
  assert.equal(Math.round(r.totals.netWorth), Math.round(r.history.at(-1).netWorth));
  assert.ok(r.cashFlow.length >= 6);
});

test('loan payments count as money out, not as transfers', () => {
  const s = emptyState();
  applyAccountSet(s, { accounts: [
    acct('chk', 'Checking', 'Chase', 1000, [{ id: 'x', posted: '2026-10-05T12:00:00', amount: -2310, description: 'MORTGAGE PMT', pending: false }]),
    acct('m', 'Mortgage', 'Rocket Mortgage', -280000, [{ id: 'y', posted: '2026-10-05T12:00:00', amount: 2310, description: 'Payment received', pending: false }]),
  ] }, now);
  const oct = computeSummary(s, now).cashFlow.find((m) => m.month === '2026-10');
  assert.equal(oct.out, 2310);
});

test('the first sync is fetched in pieces of at most 45 days and merged', async () => {
  const s = emptyState();
  s.accessUrl = 'https://u:p@host/simplefin';
  const ranges = [];
  const fake = async (url) => {
    const q = new URL(url).searchParams;
    const start = Number(q.get('start-date')), end = Number(q.get('end-date'));
    ranges.push([start, end]);
    const i = ranges.length;
    return Response.json({ errors: [], accounts: [{ id: 'c', name: 'Checking', org: { name: 'Bank' }, balance: String(100 * i), 'balance-date': end,
      transactions: [{ id: `t${i}`, posted: end - 3600, amount: '-1', description: `piece ${i}` }] }] });
  };
  await syncNow(s, { now, fetchImpl: fake });
  assert.equal(ranges.length, 2);
  for (const [a, b] of ranges) assert.ok(b - a <= 45 * 86400, 'piece too long');
  assert.equal(ranges[0][1], ranges[1][0]);
  assert.equal(ranges[1][1], Math.floor(now.getTime() / 1000));
  assert.equal(s.accounts.c.balance, 200, 'balance from the newest piece');
  assert.deepEqual(Object.keys(s.transactions).sort(), ['t1', 't2']);
});

test('loans with details get a payoff summary; the details survive a sync', () => {
  const s = demoState(now);
  const r = computeSummary(s, now);
  assert.deepEqual(r.loans.map((l) => l.category).sort(), ['autoLoan', 'mortgage']);
  const m = r.loans.find((l) => l.category === 'mortgage');
  assert.equal(m.balance, 284000);
  assert.equal(m.pi, 1845);
  assert.ok(m.monthsLeft > 200 && m.monthsLeft < 360, `months ${m.monthsLeft}`);
  assert.equal(r.loans[0].category, 'mortgage', 'mortgage first');
  assert.equal(m.ytd.estimated, true, 'demo transactions start mid-year, so this year is estimated');
  assert.ok(m.ytd.interest > 0);
  applyAccountSet(s, { accounts: [acct('mtg', 'Mortgage', 'Rocket Mortgage', -283500)] }, now);
  assert.equal(s.accounts.mtg.loan.rate, 6.25);
});

test('brokerage holdings: price from value and shares; a cost of 0 is unknown, not all gain', () => {
  const s = emptyState();
  const rh = acct('rh', 'Individual', 'Robinhood', 640);
  rh.holdings = [
    { symbol: 'HAS', description: 'Hasbro Inc', shares: 2.015, value: 240, costBasis: 0 },
    { symbol: 'AMD', description: '0.146 shares of AMD', shares: 0.146, value: 61, costBasis: null },
    { symbol: 'VOO', description: 'Vanguard 500 Index Fund', shares: 0.5, value: 339, costBasis: 300 },
  ];
  applyAccountSet(s, { accounts: [rh] }, now);
  const h = computeSummary(s, now).holdings;
  const by = Object.fromEntries(h.map((x) => [x.symbol, x]));
  assert.equal(by.HAS.price, 119.11);
  assert.equal(by.HAS.gain, null);
  assert.equal(by.AMD.description, '');
  assert.equal(by.VOO.gain, 39);
  assert.equal(by.VOO.price, 678);
});

test('an average cost you enter gives a gain where the brokerage sent none', () => {
  const s = emptyState();
  const rh = acct('rh', 'Individual', 'Robinhood', 579);
  rh.holdings = [
    { symbol: 'HAS', description: 'Hasbro Inc', shares: 2, value: 240, costBasis: 0 },
    { symbol: 'VOO', description: 'Vanguard 500', shares: 0.5, value: 339, costBasis: 300 },
  ];
  applyAccountSet(s, { accounts: [rh] }, now);
  s.accounts.rh.category = 'investments';
  s.costs = { HAS: 100, VOO: 1 };
  const by = Object.fromEntries(computeSummary(s, now).holdings.map((x) => [x.symbol, x]));
  assert.equal(by.HAS.gain, 40);
  assert.equal(by.HAS.gainPct, 0.2);
  assert.equal(by.HAS.costSource, 'entered');
  assert.equal(by.HAS.taxable, true);
  assert.equal(by.VOO.gain, 39, "the brokerage's own cost wins over one entered");
  assert.equal(by.VOO.costSource, 'brokerage');
});

test('a holding without a name gets one looked up, once', async () => {
  const s = emptyState();
  const rh = acct('rh', 'Individual', 'Robinhood', 61);
  rh.holdings = [{ symbol: 'AMD', description: '0.146 shares of AMD', shares: 0.146, value: 61, costBasis: null }, { symbol: 'HAS', description: 'Hasbro Inc', shares: 2, value: 240, costBasis: null }];
  applyAccountSet(s, { accounts: [rh] }, now);
  const urls = [];
  const fake = async (url) => {
    urls.push(url);
    return Response.json({ chart: { error: null, result: [{ meta: { symbol: 'AMD', longName: 'Advanced Micro Devices, Inc.', gmtoffset: -18000 }, timestamp: [], indicators: { quote: [{ close: [] }] } }] } });
  };
  const { syncAll } = await import('../src/sync.js');
  await syncAll(s, { now, fetchImpl: fake });
  await syncAll(s, { now, fetchImpl: fake });
  assert.equal(urls.length, 1, 'only AMD, and only once');
  assert.match(urls[0], /chart\/AMD/);
  const by = Object.fromEntries(computeSummary(s, now).holdings.map((x) => [x.symbol, x]));
  assert.equal(by.AMD.description, 'Advanced Micro Devices, Inc.');
  assert.equal(by.HAS.description, 'Hasbro Inc');
});
