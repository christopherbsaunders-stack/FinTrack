import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBuckets, validateBuckets, averageSpending, monthsCovered } from '../src/buckets.js';
import { emptyState } from '../src/store.js';
import { applyAccountSet } from '../src/sync.js';
import { computeSummary } from '../src/summary.js';

const B = [
  { id: 'e', name: 'Emergency fund', amount: null, goal: 30000, emergency: true, expenses: 6000 },
  { id: 'v', name: 'Vacation', amount: 3000, goal: 5000, emergency: false },
  { id: 'a', name: 'Anniversary', amount: 1500, goal: null, emergency: false },
];

test('set amounts, and the rest in one bucket', () => {
  const { buckets, warnings } = splitBuckets(25000, B);
  assert.deepEqual(buckets.map((b) => b.value), [20500, 3000, 1500]);
  assert.equal(buckets[0].rest, true);
  assert.equal(buckets[1].progress, 0.6);
  assert.equal(buckets[2].progress, null);
  assert.deepEqual(warnings, []);
  // Interest lands in the rest.
  assert.equal(splitBuckets(25012.5, B).buckets[0].value, 20512.5);
});

test('set amounts over the balance are flagged', () => {
  const { buckets, warnings } = splitBuckets(4000, B);
  assert.equal(buckets[0].value, -500);
  assert.match(warnings[0], /more than the account holds/);
});

test('input checks', () => {
  const ok = validateBuckets([{ name: 'Emergency', rest: true, emergency: true, expenses: '$6,000' }, { name: 'Vacation', amount: '3,000', goal: '5000' }]);
  assert.equal(ok[0].amount, null);
  assert.equal(ok[0].expenses, 6000);
  assert.equal(ok[1].amount, 3000);
  assert.equal(ok[1].goal, 5000);
  assert.deepEqual(validateBuckets([]), []);
  assert.throws(() => validateBuckets([{ name: 'A', amount: 1 }]), /one bucket to hold the rest/);
  assert.throws(() => validateBuckets([{ name: 'A', rest: true }, { name: 'B', rest: true }]), /one bucket to hold the rest/);
  assert.throws(() => validateBuckets([{ name: 'A', rest: true }, { name: 'a', amount: 1 }]), /Two buckets/);
  assert.throws(() => validateBuckets([{ name: 'A', rest: true, emergency: true }, { name: 'B', amount: 1, emergency: true }]), /Only one/);
  assert.throws(() => validateBuckets([{ name: '', rest: true }]), /needs a name/);
});

test('spending average leaves out the current month', () => {
  const months = [{ month: '2026-07', out: 0 }, { month: '2026-08', out: 3000 }, { month: '2026-09', out: 4000 }, { month: '2026-10', out: 5000 }, { month: '2026-11', out: 100 }];
  assert.deepEqual(averageSpending(months, '2026-11'), { amount: 4000, months: 3, monthsUsed: ['2026-08', '2026-09', '2026-10'] });
  assert.equal(averageSpending([], '2026-11'), null);
  assert.equal(monthsCovered(12000, 4000), 3);
  assert.equal(monthsCovered(12000, 0), null);
});

test('buckets survive a sync and show in the summary; net worth is unchanged', () => {
  const now = new Date('2026-11-20T12:00:00');
  const s = emptyState();
  const acct = (balance) => ({ id: 'sav', name: 'Savings', org: 'Bank', currency: 'USD', balance, available: null, balanceDate: now.toISOString(), holdings: [], transactions: [] });
  applyAccountSet(s, { accounts: [acct(25000)] }, now);
  s.accounts.sav.buckets = B;
  applyAccountSet(s, { accounts: [acct(26000)] }, now);
  assert.equal(s.accounts.sav.buckets.length, 3);
  const r = computeSummary(s, now);
  assert.equal(r.totals.netWorth, 26000);
  const sav = r.accounts.find((a) => a.id === 'sav');
  assert.deepEqual(sav.buckets.map((b) => b.value), [21500, 3000, 1500]);
  assert.equal(r.buckets.length, 3);
  assert.equal(r.emergency.value, 21500);
  assert.equal(r.emergency.expenses, 6000);
  assert.equal(r.emergency.source, 'entered');
  assert.equal(r.emergency.months, 21500 / 6000);
});
