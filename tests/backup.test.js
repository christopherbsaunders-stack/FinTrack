import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupToday, keepDates, listBackups, backupCopy } from '../src/backup.js';
import { makeSnapshot, compareSnapshots, lastBefore } from '../src/reports.js';
import { computeSummary } from '../src/summary.js';
import { demoState } from '../src/demo.js';

test('one backup a day, without the bank access link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fintrack-backup-'));
  try {
    const state = { accessUrl: 'https://u:p@host/simplefin', accounts: { a: { balance: 1 } } };
    const now = new Date('2026-11-06T09:00:00');
    const file = backupToday(dir, state, now);
    assert.match(file, /fintrack-2026-11-06\.json$/);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.accessUrl, null);
    assert.equal(saved.backedUpWithoutAccess, true);
    assert.deepEqual(saved.accounts, state.accounts);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(backupToday(dir, state, new Date('2026-11-06T18:00:00')), null, 'not twice in a day');
    assert.equal(state.accessUrl, 'https://u:p@host/simplefin', 'the live state is untouched');
    assert.equal(backupCopy({ accessUrl: null }).backedUpWithoutAccess, false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('keeps 14 days and the first of each month for 24 months', () => {
  const dates = [];
  for (let d = new Date('2024-01-01T12:00:00'); d <= new Date('2026-11-06T12:00:00'); d = new Date(d.getTime() + 86400000)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  const keep = keepDates(dates, new Date('2026-11-06T12:00:00'));
  assert.ok(keep.has('2026-11-06') && keep.has('2026-10-24'), 'the last 14 days');
  assert.ok(!keep.has('2026-10-23'));
  assert.ok(keep.has('2026-10-01') && keep.has('2024-12-01'), 'month starts within 24 months');
  assert.ok(!keep.has('2024-11-01'), 'older months go');
  assert.equal(keep.size, 14 + 23);

  const dir = mkdtempSync(join(tmpdir(), 'fintrack-backup-'));
  try {
    for (const d of ['2026-01-01', '2026-01-15', '2026-11-01']) writeFileSync(join(dir, `fintrack-${d}.json`), '{}');
    backupToday(dir, {}, new Date('2026-11-06T09:00:00'));
    assert.deepEqual(listBackups(dir).map((b) => b.date), ['2026-01-01', '2026-11-01', '2026-11-06']);
  } finally { rmSync(dir, { recursive: true }); }
});

test('what changed since the last report', () => {
  const now = new Date('2026-11-06T12:00:00');
  const s = demoState(now);
  s.settings.retirement = null;
  const before = makeSnapshot(computeSummary(s, now), new Date('2026-05-03T12:00:00'));
  // Six months later: the savings grew, the mortgage went down.
  s.accounts.sav.balance += 5000;
  s.accounts.mtg.balance += 4000;
  const after = makeSnapshot(computeSummary(s, now), now);
  const c = compareSnapshots(before, after);
  assert.equal(c.since, '2026-05-03');
  assert.equal(c.days, 187);
  const by = Object.fromEntries(c.rows.map((r) => [r.key, r]));
  assert.equal(by.cash.change, 5000);
  assert.equal(by.netWorth.change, 9000);
  assert.equal(c.loans.find((l) => l.name === 'Mortgage').paidDown, 4000);
  assert.equal(lastBefore([{ date: '2026-05-03' }, { date: '2026-11-06' }, { date: '2026-08-01' }], '2026-11-06').date, '2026-08-01');
  assert.equal(lastBefore([{ date: '2026-11-06' }], '2026-11-06'), null);
});
