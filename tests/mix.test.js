import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessClass, computeMix, validateSplit, validateTarget } from '../src/mix.js';

test('first guesses from fund names', () => {
  const k = (n) => Object.entries(guessClass(n) || {}).find(([, v]) => v === 1)?.[0] ?? null;
  assert.equal(k('Blackrock Total Return Portfolio A'), 'bonds');
  assert.equal(k('Blackrock International A'), 'intlStocks');
  assert.equal(k('Blackrock Capital Appreciation Portfolio A'), 'usStocks');
  assert.equal(k('Hasbro Inc'), 'usStocks');
  assert.equal(k('Vanguard Federal Money Market Fund'), 'cash');
  assert.equal(k('Vanguard Target Retirement 2050 Fund'), null, 'a blend: ask');
});

const accounts = [
  { id: 'k', name: '401(k)', category: 'retirement', value: 1000, holdings: [
    { symbol: 'AAA', description: 'Growth Fund', value: 700 },
    { symbol: 'BBB', description: 'Total Return Bond', value: 200 },
    { symbol: 'CCC', description: 'International Fund', value: 100 },
  ] },
  { id: 'rh', name: 'Robinhood', category: 'investments', value: 500, holdings: [{ symbol: 'AAA', description: 'Growth Fund', value: 300 }, { symbol: 'TDF', description: 'Target Retirement 2050', value: 100 }] },
  { id: 'roth', name: 'Roth IRA', category: 'retirement', value: 500, holdings: [] },
  { id: 'chk', name: 'Checking', category: 'cash', value: 9999, holdings: [] },
];

test('the mix: guesses, uninvested cash, accounts without holdings, blends', () => {
  const m = computeMix(accounts, {});
  assert.equal(m.total, 2000, 'checking is not an investment');
  const v = Object.fromEntries(m.parts.map((p) => [p.key, p.value]));
  assert.deepEqual(v, { usStocks: 1000, intlStocks: 100, bonds: 200, cash: 100, unclassified: 600 });
  const aaa = m.items.find((i) => i.key === 'AAA');
  assert.equal(aaa.value, 1000, 'the same fund in two accounts is one line');
  assert.deepEqual(aaa.accounts, ['401(k)', 'Robinhood']);
  assert.equal(aaa.guessed, true);
  assert.equal(m.items.find((i) => i.key === 'cash:rh').split.cash, 1);
  assert.equal(m.items.find((i) => i.key === 'acct:roth').split, null);
  assert.equal(m.items.find((i) => i.key === 'TDF').split, null);
});

test('your choices and splits, and the gap to a target', () => {
  const classes = { TDF: { usStocks: 0.5, intlStocks: 0.3, bonds: 0.2, cash: 0 }, 'acct:roth': { usStocks: 1, intlStocks: 0, bonds: 0, cash: 0 } };
  const m = computeMix(accounts, classes, { usStocks: 60, intlStocks: 20, bonds: 20, cash: 0 });
  const v = Object.fromEntries(m.parts.map((p) => [p.key, p.value]));
  assert.deepEqual(v, { usStocks: 1550, intlStocks: 130, bonds: 220, cash: 100 });
  assert.equal(m.stocks, 1680 / 2000);
  const us = m.vsTarget.find((t) => t.key === 'usStocks');
  assert.equal(us.have, 0.775);
  assert.equal(Math.round(us.diff * 1000) / 1000, 0.175);
  assert.equal(us.dollars, 350);
  assert.equal(m.items.find((i) => i.key === 'TDF').guessed, false);
});

test('input checks', () => {
  assert.deepEqual(validateSplit('bonds'), { usStocks: 0, intlStocks: 0, bonds: 1, cash: 0 });
  assert.deepEqual(validateSplit({ usStocks: 50, intlStocks: 30, bonds: 20, cash: 0 }), { usStocks: 0.5, intlStocks: 0.3, bonds: 0.2, cash: 0 });
  assert.throws(() => validateSplit({ usStocks: 50, bonds: 20 }), /adds up to 70%/);
  assert.throws(() => validateSplit('gold'), /Unknown/);
  assert.equal(validateTarget({}), null);
  assert.throws(() => validateTarget({ usStocks: 60, bonds: 30 }), /adds up to 90%/);
});
