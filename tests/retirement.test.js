import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grow, project, typicalReturn, validateRetirement } from '../src/retirement.js';

test('growth with monthly additions', () => {
  assert.equal(grow(1000, 0, 0, 12), 1000);
  assert.equal(grow(0, 100, 0, 12), 1200);
  // 6% a year for 10 years on $10,000: $17,908.
  assert.equal(Math.round(grow(10000, 0, 6, 120)), 17908);
  // $100 a month for 30 years at 0% vs 5%: compounding more than doubles it.
  assert.ok(grow(0, 100, 5, 360) > 2 * 36000);
});

test('typical return from the mix, less fees', () => {
  const mix = { total: 100, parts: [{ key: 'usStocks', value: 60 }, { key: 'intlStocks', value: 20 }, { key: 'bonds', value: 20 }] };
  assert.equal(typicalReturn(mix, 0), 4.3);
  assert.equal(typicalReturn(mix, 0.8), 3.5);
  assert.equal(typicalReturn(null), 4);
});

test('on track, or what closes the gap', () => {
  const base = { start: 260000, monthly: 1716, age: 45, retireAge: 65, income: 6000, socialSecurity: 2500, typical: 4 };
  const p = project(base);
  assert.equal(p.years, 20);
  assert.equal(p.needed, Math.round((3500 * 12) / 0.04));
  assert.ok(p.outcomes.poor.balance < p.outcomes.typical.balance && p.outcomes.typical.balance < p.outcomes.good.balance);
  assert.equal(p.path.length, 21);
  assert.equal(p.path[0].typical, 260000);
  assert.equal(p.path.at(-1).typical, p.outcomes.typical.balance);
  // Typical supports balance × 4% / 12 + Social Security.
  assert.equal(p.outcomes.typical.supports, Math.round(p.outcomes.typical.balance * 0.04 / 12 + 2500));

  const short = project({ ...base, income: 9000 });
  assert.equal(short.onTrack, false);
  // Saving the extra it names gets the typical outcome to what's needed.
  const fixed = project({ ...base, income: 9000, monthly: 1716 + short.extraNeeded });
  assert.ok(Math.abs(fixed.outcomes.typical.balance - short.needed) < 200, `${fixed.outcomes.typical.balance} vs ${short.needed}`);
  assert.ok(short.retireAt > 65);
  assert.ok(project({ ...base, income: 9000, retireAge: short.retireAt }).outcomes.typical.balance >= short.needed);

  const easy = project({ ...base, income: 3000 });
  assert.equal(easy.onTrack, true);
  assert.equal(easy.extraNeeded, null);
});

test('input checks', () => {
  const ok = validateRetirement({ birthYear: '1981', retireAge: '65', income: '$6,000', socialSecurity: '2,500' }, 2026);
  assert.equal(ok.income, 6000);
  assert.equal(ok.withdrawalRate, 4);
  assert.throws(() => validateRetirement({ birthYear: '81' }, 2026), /birth year/);
  assert.throws(() => validateRetirement({ birthYear: 1950, retireAge: 65 }, 2026), /already passed/);
});

import { emptyState } from '../src/store.js';
import { computeSummary } from '../src/summary.js';
import { demoState } from '../src/demo.js';

test('the outlook uses retirement accounts, the plan, the mix and fees', () => {
  const now = new Date('2026-11-20T12:00:00');
  const s = demoState(now);
  assert.equal(computeSummary(s, now).retirement.set, false);
  s.settings.retirement = validateRetirement({ birthYear: 1981, retireAge: 65, income: 6000, socialSecurity: 2500, extraMonthly: 500 }, 2026);
  s.settings.budget = { salary: 120000, otherIncome: null, expenses: [] };
  const r = computeSummary(s, now).retirement;
  assert.equal(r.age, 45);
  assert.equal(r.start, 127700, 'the 401(k) and Roth; Robinhood only if chosen');
  assert.equal(r.monthly, 500, 'the demo has no 401(k) plan; the extra counts');
  assert.equal(r.years, 20);
  assert.ok(r.rates.typical > 0);
  assert.equal(Math.round(r.salaryMultiple.have * 100) / 100, Math.round((127700 / 120000) * 100) / 100);
  assert.equal(r.salaryMultiple.guide, 4);
  s.settings.retirement.includeTaxable = true;
  assert.equal(computeSummary(s, now).retirement.start, 127700 + 18400);
});
