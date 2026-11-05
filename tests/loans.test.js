import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledPayment, amortize, compare, byYear, backward, loanSummary, addMonths, validateLoan, principalAndInterest } from '../src/loans.js';

test('a 30-year $300,000 loan at 6% is $1,798.65 a month, 360 payments', () => {
  const pi = scheduledPayment(300000, 6, 360);
  assert.equal(pi, 1798.65);
  const a = amortize(300000, 6, pi, { startMonth: '2027-01' });
  assert.equal(a.months, 360);
  assert.equal(a.lastMonth, '2056-12');
  assert.equal(a.rows[0].interest, 1500);
  assert.equal(a.rows[0].principal, 298.65);
  assert.ok(Math.abs(a.totalInterest - 347514.57) < 5, `total interest ${a.totalInterest}`);
  assert.equal(a.rows.at(-1).balance, 0);
});

test('escrow is not part of what pays down the loan', () => {
  assert.equal(principalAndInterest({ payment: 2400, escrow: 601.35 }), 1798.65);
});

test('extra each month and a one-time payment both pay it off sooner', () => {
  const loan = { rate: 6, payment: 2400, escrow: 601.35 };
  const c = compare(300000, loan, { extra: 200, startMonth: '2027-01' });
  assert.equal(c.base.months, 360);
  assert.ok(c.more.months < 300 && c.more.months > 270, `months ${c.more.months}`);
  assert.equal(c.monthsSooner, c.base.months - c.more.months);
  assert.ok(c.interestSaved > 80000);
  const lump = compare(300000, loan, { lump: 20000, startMonth: '2027-01' });
  assert.ok(lump.monthsSooner > 0 && lump.interestSaved > 0);
  const none = compare(300000, loan, { startMonth: '2027-01' });
  assert.equal(none.monthsSooner, 0);
  assert.equal(none.interestSaved, 0);
});

test('a payment below the interest never pays off', () => {
  const a = amortize(300000, 6, 1000);
  assert.equal(a.never, true);
  assert.equal(a.months, Infinity);
});

test('years add up and backward retraces forward', () => {
  const pi = scheduledPayment(300000, 6, 360);
  const a = amortize(300000, 6, pi, { startMonth: '2027-01' });
  const y = byYear(a.rows);
  assert.equal(y.length, 30);
  assert.equal(y[0].year, 2027);
  assert.ok(Math.abs(y.reduce((s, r) => s + r.principal, 0) - 300000) < 0.05);
  const back = backward(a.rows[2].balance, 6, pi, 3);
  assert.deepEqual(back.map((b) => b.interest), a.rows.slice(0, 3).map((r) => r.interest));
  assert.equal(back[0].before, 300000);
});

test('summary: next payment split, payoff, this year so far, and the original schedule', () => {
  const loan = { rate: 6, payment: 2400, escrow: 601.35, original: 300000, termYears: 30, firstPayment: '2027-01' };
  const pi = 1798.65;
  const after3 = amortize(300000, 6, pi, { startMonth: '2027-01' }).rows[2].balance;
  const s = loanSummary(loan, after3, '2027-03-15');
  assert.equal(s.pi, 1798.65);
  assert.equal(s.nextPayment.month, '2027-04');
  assert.equal(s.nextPayment.interest, Math.round(after3 * 0.005 * 100) / 100);
  assert.equal(s.monthsLeft, 357);
  assert.equal(s.payoffMonth, '2056-12');
  assert.equal(s.ytd.estimated, true);
  assert.equal(s.ytd.payments, 3);
  assert.equal(s.ytd.interest, 1500 + 1498.51 + 1497.01);
  assert.equal(s.ytd.escrow, 1804.05);
  assert.deepEqual(s.scheduled, { pi: 1798.65, escrowGuess: 601.35, payoffMonth: '2056-12' });
  assert.deepEqual(s.warnings, []);

  // With the bank's Jan 1 balance and the payments it shows, the numbers are real.
  const real = loanSummary(loan, 299000, '2027-03-15', { startOfYear: 300000, paidThisYear: 7400, payments: 3 });
  assert.equal(real.ytd.estimated, false);
  assert.equal(real.ytd.principal, 1000);
  assert.equal(real.ytd.interest, Math.round((7400 - 601.35 * 3 - 1000) * 100) / 100);

  // Payments that can't account for the principal (some missing) fall back to the estimate.
  const short = loanSummary(loan, 299000, '2027-03-15', { startOfYear: 300000, paidThisYear: 1200, payments: 1 });
  assert.equal(short.ytd.estimated, true);
});

test('a payment that cannot cover interest is flagged', () => {
  const s = loanSummary({ rate: 6, payment: 1600, escrow: 600 }, 300000, '2027-03-15');
  assert.match(s.warnings[0], /doesn't cover a month's interest/);
});

test('months and input checks', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.deepEqual(validateLoan({ rate: '6.125%', payment: '$2,400', escrow: '650', original: '', termYears: '30', firstPayment: '2021-06' }),
    { rate: 6.125, payment: 2400, escrow: 650, original: null, termYears: 30, firstPayment: '2021-06' });
  assert.throws(() => validateLoan({ rate: '', payment: 2400 }), /rate/);
  assert.throws(() => validateLoan({ rate: 6, payment: 2400, escrow: 2500 }), /Escrow/);
});
