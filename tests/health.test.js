import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthChecks } from '../src/health.js';

const budget = { monthlyIncome: 10000, salary: 120000, otherIncome: null, otherSaving: 500, ratios: { retirementPerYear: 20590 } };
const emergency = { value: 17000, expenses: 2800, months: 17000 / 2800, source: 'list' };
const loans = [{ category: 'mortgage', payment: 2400 }, { category: 'autoLoan', payment: 500 }];
const retirement = { set: true, age: 45, settings: { income: 6000 }, salaryMultiple: { have: 2.1, guide: 4 }, outcomes: { poor: { gap: -543 }, typical: { gap: 460 } }, extraNeeded: null };

test('each check: value, guide, status', () => {
  const by = Object.fromEntries(healthChecks({ budget, emergency, loans, retirement }).map((c) => [c.key, c]));
  // (20,590 / 12 + 500) / 10,000 = 22%
  assert.equal(by.savings.value, '22%');
  assert.equal(by.savings.status, 'good');
  assert.equal(by.emergency.value, '6.1 months');
  assert.equal(by.emergency.status, 'good');
  assert.equal(by.dti.value, '29%');
  assert.equal(by.dti.status, 'good');
  assert.equal(by.housing.value, '24%');
  assert.equal(by.multiple.status, 'attention', '2.1x against 4x');
  assert.equal(by.outlook.status, 'watch', 'on track in a typical market, short in a poor one');
});

test('thresholds and missing data', () => {
  const tight = healthChecks({ budget: { ...budget, otherSaving: 0, ratios: { retirementPerYear: 6000 } }, emergency: { ...emergency, months: 1 }, loans: [{ category: 'mortgage', payment: 4000 }], retirement: { set: false } });
  const by = Object.fromEntries(tight.map((c) => [c.key, c]));
  assert.equal(by.savings.status, 'attention');
  assert.equal(by.emergency.status, 'attention');
  assert.equal(by.dti.status, 'watch', '40%');
  assert.equal(by.housing.status, 'attention', '40%');
  assert.equal(by.retire.status, null);
  assert.match(by.retire.missing, /Retirement outlook/);
  const none = healthChecks({ budget: null, emergency: null, loans: [], retirement: null });
  assert.ok(none.every((c) => c.status === null && c.missing));
});
