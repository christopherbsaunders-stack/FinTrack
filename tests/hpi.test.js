import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFredCsv, fetchSeries, anchor, indexedValue, staleness, seriesLabel, latest } from '../src/hpi.js';
import { emptyState } from '../src/store.js';
import { syncAll } from '../src/sync.js';
import { computeSummary } from '../src/summary.js';

// The shape of fred.stlouisfed.org/graph/fredgraph.csv?id=VASTHPI (real values).
const VA = 'observation_date,VASTHPI\n2025-07-01,757.19\n2025-10-01,762.67\n2026-01-01,767.64\n2026-04-01,780.93\n';

test('FRED CSV files: both header styles, missing values skipped', () => {
  assert.deepEqual(parseFredCsv('VASTHPI', VA), { '2025-07-01': 757.19, '2025-10-01': 762.67, '2026-01-01': 767.64, '2026-04-01': 780.93 });
  assert.deepEqual(parseFredCsv('X', 'DATE,X\r\n2024-01-01,.\r\n2024-04-01,10\r\n'), { '2024-04-01': 10 });
  assert.throws(() => parseFredCsv('X', '<!DOCTYPE html><html>'), /isn't a data file/);
});

test('an unknown series gives a clear message', async () => {
  const fake = async () => new Response('<!DOCTYPE html><html>not found</html>', { status: 404 });
  await assert.rejects(fetchSeries('NOPE123', fake), /FRED has no series "NOPE123"/);
  await assert.rejects(fetchSeries('bad id!', fake), /isn't a FRED series id/);
});

test('the value moves with the index from when you entered it', () => {
  const obs = parseFredCsv('VASTHPI', VA);
  const before = { '2025-07-01': 757.19, '2025-10-01': 762.67, '2026-01-01': 767.64 };
  const ix = anchor('VASTHPI', 600000, before);
  assert.deepEqual(ix, { series: 'VASTHPI', baseValue: 600000, anchorDate: '2026-01-01', anchorIndex: 767.64 });
  assert.equal(indexedValue(ix, before).value, 600000);
  const v = indexedValue(ix, obs);
  assert.equal(v.value, Math.round(600000 * (780.93 / 767.64) * 100) / 100);
  assert.ok(Math.abs(v.change - 0.0173) < 0.0001);
  assert.equal(v.latestDate, '2026-04-01');
});

test('a series that stopped is flagged; a current one is not', () => {
  const obs = parseFredCsv('VASTHPI', VA);
  assert.equal(staleness('VASTHPI', obs, '2026-11-05'), null);
  const stopped = { '2024-07-01': 394.52, '2024-10-01': 392.54 };
  assert.match(staleness('ATNHPIUS47894Q', stopped, '2026-11-05'), /hasn't had a new value since 2024-10-01/);
  const yearly = { '2024-01-01': 295.26, '2025-01-01': 308.04 };
  assert.equal(staleness('ATNHPIUS51107A', yearly, '2026-11-05'), null);
});

test('labels', () => {
  assert.equal(seriesLabel('VASTHPI'), 'Virginia home prices (quarterly)');
  assert.equal(seriesLabel('USSTHPI'), 'US home prices (quarterly)');
  assert.equal(seriesLabel('ATNHPIUS51107A'), 'County home prices, ATNHPIUS51107A (yearly)');
  assert.equal(latest({}), null);
});

test('syncAll fetches the index once a day and revalues the home', async () => {
  const s = emptyState();
  s.accounts.home = { id: 'home', name: 'Home', org: 'Manual', source: 'manual', category: 'property', balance: 600000, holdings: [],
    index: { series: 'VASTHPI', baseValue: 600000, anchorDate: '2026-01-01', anchorIndex: 767.64 } };
  let calls = 0;
  const fake = async (url) => { calls++; assert.match(url, /fredgraph\.csv\?id=VASTHPI/); return new Response(VA); };
  const now = new Date('2026-11-05T12:00:00');
  await syncAll(s, { now, fetchImpl: fake });
  assert.equal(calls, 1);
  assert.equal(s.accounts.home.balance, Math.round(600000 * (780.93 / 767.64) * 100) / 100);
  assert.equal(s.snapshots['2026-11-05'].home, s.accounts.home.balance);
  await syncAll(s, { now: new Date('2026-11-05T18:00:00'), fetchImpl: fake });
  assert.equal(calls, 1, 'not fetched again the same day');
  const sum = computeSummary(s, now);
  assert.equal(sum.accounts[0].indexStatus.label, 'Virginia home prices (quarterly)');
  assert.equal(sum.totals.assets, s.accounts.home.balance);
});
