import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBudget, validateBudget, defaultBudget, ratios, MEASURED_NAME } from '../src/budget.js';
import { emptyState } from '../src/store.js';
import { applyAccountSet } from '../src/sync.js';
import { computeSummary } from '../src/summary.js';

const measured = { amount: 1500, months: 3 };

test('lines, essentials and income', () => {
  const b = validateBudget({
    salary: '$120,000', otherIncome: '',
    expenses: [
      { measured: true, amount: '900', essential: true },
      { name: 'Joint: mortgage, utilities, groceries', amount: '1,900', essential: true },
      { name: 'Joint: gifts, gardening', amount: 600, essential: false },
      { name: '', amount: '' },
    ],
  });
  assert.equal(b.salary, 120000);
  assert.equal(b.expenses.length, 3);
  assert.equal(b.expenses[0].name, MEASURED_NAME);
  const c = computeBudget(b, measured);
  assert.equal(c.monthlyIncome, 10000);
  assert.equal(c.essential, 2800);
  assert.equal(c.all, 3400);
  assert.equal(c.lines[0].source, 'entered');
});

test('the measured line follows measured spending until you set it', () => {
  const c = computeBudget(defaultBudget(), measured);
  assert.equal(c.lines[0].value, 1500);
  assert.equal(c.lines[0].source, 'measured');
  assert.equal(c.essential, 0);
  assert.equal(c.all, 1500);
  // Validation always keeps exactly one measured line.
  assert.equal(validateBudget({ expenses: [{ name: 'Rent', amount: 1 }] }).expenses[0].measured, true);
  assert.equal(validateBudget({ otherSaving: '$500' }).otherSaving, 500);
  assert.throws(() => validateBudget({ expenses: [{ name: 'Rent', amount: '' }] }), /monthly amount for Rent/);
  assert.throws(() => validateBudget({ salary: 'lots' }), /salary/);
});

test('ratios against gross income', () => {
  const c = computeBudget({ salary: 120000, otherIncome: 60000, expenses: [] }, null);
  const r = ratios(c, { loanPayments: 2900, retirementPerYear: 20590 });
  assert.equal(r.debtToIncome, 2900 / 15000);
  assert.equal(r.retirementRate, 20590 / 120000);
  assert.equal(ratios(computeBudget(null, null), { loanPayments: 100 }).debtToIncome, null);
});

test('the emergency fund uses the essential lines, and shows everything too', () => {
  const now = new Date('2026-11-20T12:00:00');
  const s = emptyState();
  applyAccountSet(s, { accounts: [{ id: 'sav', name: 'Savings', org: 'Bank', currency: 'USD', balance: 17000, available: null, balanceDate: now.toISOString(), holdings: [], transactions: [] }] }, now);
  s.accounts.sav.buckets = [{ id: 'e', name: 'Emergency fund', amount: null, emergency: true, expenses: 6000 }];
  // Before a list: the amount entered on the fund.
  assert.equal(computeSummary(s, now).emergency.source, 'entered');
  s.settings.budget = validateBudget({ salary: 120000, expenses: [{ measured: true, amount: 900, essential: true }, { name: 'Joint bills', amount: 1900, essential: true }, { name: 'Gifts', amount: 600 }] });
  const e = computeSummary(s, now).emergency;
  assert.equal(e.source, 'list');
  assert.equal(e.expenses, 2800);
  assert.equal(e.months, 17000 / 2800);
  assert.equal(e.monthsAll, 17000 / 3400);
});
