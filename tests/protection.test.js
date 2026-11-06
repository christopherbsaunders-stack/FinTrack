import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProtection, validateProtection } from '../src/protection.js';

const accounts = [
  { id: 'k', name: '401(k)', org: 'Paychex', category: 'retirement' },
  { id: 'sav', name: 'Savings', org: 'Ally', category: 'cash' },
  { id: 'mtg', name: 'Mortgage', org: 'Wells Fargo', category: 'mortgage' },
];

test('nothing entered: life is a gap, the rest are prompts', () => {
  const s = summarizeProtection(null, { salary: 120000, accounts, thisYear: 2026 });
  const by = Object.fromEntries(s.checks.map((c) => [c.key, c]));
  assert.equal(by.life.status, 'attention');
  assert.equal(by.disability.status, 'watch');
  assert.equal(by.docs.status, 'attention');
  assert.equal(by.beneficiaries.status, 'attention');
  assert.deepEqual(s.beneficiaries.map((b) => b.key), ['k', 'sav'], 'a mortgage has no beneficiary');
  assert.equal(s.entered, false);
});

test('policies, documents and beneficiaries filled in', () => {
  const prot = validateProtection({
    policies: [
      { type: 'life', who: 'Me', provider: 'Work', coverage: '240,000', work: true },
      { type: 'life', who: 'Me', provider: 'Term Co', coverage: 500000, premium: 420 },
      { type: 'disability', who: 'Me', provider: 'Work', work: true },
    ],
    docs: { will: { status: 'have', reviewed: 2019, where: 'Safe' }, financialPoa: { status: 'have', reviewed: 2025 }, healthPoa: { status: 'have', reviewed: 2025 }, directive: { status: 'have', reviewed: 2025 } },
    beneficiaries: { k: { named: 'yes', checked: 2025 }, sav: { named: 'yes', checked: 2025 } },
  }, 2026);
  const pol = prot.policies[1].id;
  prot.beneficiaries[`policy:${pol}`] = { named: 'yes', checked: 2026 };
  prot.beneficiaries[`policy:${prot.policies[0].id}`] = { named: 'unsure', checked: null };
  const s = summarizeProtection(prot, { salary: 120000, accounts, thisYear: 2026 });
  const by = Object.fromEntries(s.checks.map((c) => [c.key, c]));
  assert.equal(s.lifeTotal, 740000);
  assert.equal(by.life.status, 'watch', '740k against 10x 120k = 1.2M');
  assert.equal(by.disability.status, 'good');
  assert.equal(by.umbrella.status, 'watch');
  assert.equal(by.docs.status, 'watch', 'the will was last reviewed in 2019');
  assert.equal(by.beneficiaries.status, 'attention', 'one life policy is unsure');
  assert.equal(s.premiums, 420);
  assert.equal(s.entered, true);
});

test('input checks', () => {
  assert.throws(() => validateProtection({ policies: [{ type: 'pet' }] }), /kind of insurance/);
  assert.throws(() => validateProtection({ docs: { will: { status: 'have', reviewed: 2099 } } }, 2026), /not in the future/);
  assert.deepEqual(validateProtection({}), { policies: [], docs: {}, beneficiaries: {} });
});
