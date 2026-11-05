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
