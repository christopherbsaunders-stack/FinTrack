import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFees, feeDrag, validateExpenseRatio } from '../src/fees.js';

const holdings = [
  { symbol: 'FUNDA', description: 'Growth Fund A', value: 100000 },
  { symbol: 'FUNDB', description: 'Bond Fund', value: 50000 },
  { symbol: 'HAS', description: 'Hasbro', value: 240 },
  { symbol: 'VOO', description: 'Vanguard 500', value: 1000 },
];
const info = { HAS: { type: 'EQUITY' }, VOO: { type: 'ETF' }, FUNDA: { type: 'MUTUALFUND' } };

test('yearly cost in dollars, weighted by what you hold; stocks cost nothing', () => {
  const f = computeFees(holdings, { FUNDA: 1, FUNDB: 0.5 }, info);
  const by = Object.fromEntries(f.rows.map((r) => [r.symbol, r]));
  assert.equal(by.FUNDA.yearly, 1000);
  assert.equal(by.FUNDB.yearly, 250);
  assert.equal(by.HAS.kind, 'stock');
  assert.equal(by.HAS.yearly, 0);
  assert.equal(by.VOO.kind, 'unknown', 'an ETF has a fee; ask for it');
  assert.equal(f.yearly, 1250);
  assert.equal(f.unknown, 1);
  assert.equal(Math.round(f.weighted * 1000) / 1000, Math.round((1250 / 150240) * 100 * 1000) / 1000);
  assert.equal(f.longRun.length, 2);
});

test('fee drag compounds', () => {
  // 1% a year on $100,000 at 6% growth: 100,000 × (1.06^10 − 1.05^10) ≈ $16,195 over 10 years.
  const ten = feeDrag(100000, 0.01, 10);
  assert.equal(Math.round(ten), 16195);
  assert.ok(feeDrag(100000, 0.01, 20) > 2 * ten, 'more than twice as much over twice as long');
  assert.equal(feeDrag(100000, 0, 10), 0);
});

test('input checks', () => {
  assert.equal(validateExpenseRatio('0.85%'), 0.85);
  assert.equal(validateExpenseRatio(''), null);
  assert.throws(() => validateExpenseRatio('85'), /percent/);
});
