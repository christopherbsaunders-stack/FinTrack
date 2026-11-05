import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, exportCsv, EXPORTS } from '../src/export.js';
import { computeSummary } from '../src/summary.js';
import { demoState } from '../src/demo.js';

const now = new Date('2026-11-20T12:00:00');

test('CSV quoting, and formula-looking text is defused', () => {
  assert.equal(toCsv([['a', 'b,c', 'say "hi"', 1.25, null], ['=SUM(A1)', -5, '-Savings']]), 'a,"b,c","say ""hi""",1.25,\r\n\'=SUM(A1),-5,-Savings\r\n');
});

test('every export builds from the demo, with the right totals', () => {
  const sum = computeSummary(demoState(now), now);
  for (const name of Object.keys(EXPORTS)) {
    const csv = exportCsv(name, sum);
    assert.ok(csv.split('\r\n').length > 2, `${name} has rows`);
  }
  const accounts = exportCsv('accounts', sum);
  assert.match(accounts, new RegExp(`Net worth,,,,${Math.round(sum.totals.netWorth * 100) / 100}\\r\\n`));
  assert.match(exportCsv('loans', sum), /Mortgage,Rocket Mortgage,284000,6.25/);
  assert.throws(() => exportCsv('nope', sum), /No export/);
});
