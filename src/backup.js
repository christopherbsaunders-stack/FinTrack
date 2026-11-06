// Daily backups of the data file. FinTrack's history (a value per account per
// day) can't be rebuilt from the banks, so it's copied once a day.
//
// Kept: the last 14 days, and the first backup of each month for 24 months.
// The SimpleFIN access link is left out of every backup, so a copy kept in a
// cloud folder can't be used to read bank data; after a restore, paste a new
// setup token once.

import { readdirSync, writeFileSync, renameSync, mkdirSync, unlinkSync, statSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const KEEP_DAYS = 14;
export const KEEP_MONTHS = 24;
const NAME = /^fintrack-(\d{4}-\d{2}-\d{2})\.json$/;

const day = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// What goes into a backup: everything but the bank access link.
export function backupCopy(state) {
  const { accessUrl, ...rest } = state;
  return { ...rest, accessUrl: null, backedUpWithoutAccess: Boolean(accessUrl) };
}

// Today's backup, if there isn't one yet. Returns the file written, or null.
export function backupToday(dir, state, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `fintrack-${day(now)}.json`);
  if (existsSync(file)) return null;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(backupCopy(state)), { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* not supported here */ }
  prune(dir, now);
  return file;
}

// Which backup dates to keep: the last KEEP_DAYS days, and the earliest of
// each of the last KEEP_MONTHS months.
export function keepDates(dates, now = new Date()) {
  const sorted = [...dates].sort();
  const cutoffDay = day(new Date(now.getTime() - (KEEP_DAYS - 1) * 86400000));
  const first = new Date(now.getFullYear(), now.getMonth() - (KEEP_MONTHS - 1), 1);
  const cutoffMonth = day(first).slice(0, 7);
  const keep = new Set(sorted.filter((d) => d >= cutoffDay));
  const seen = new Set();
  for (const d of sorted) {
    const m = d.slice(0, 7);
    if (m >= cutoffMonth && !seen.has(m)) { seen.add(m); keep.add(d); }
  }
  return keep;
}

export function prune(dir, now = new Date()) {
  const files = listBackups(dir);
  const keep = keepDates(files.map((f) => f.date), now);
  for (const f of files) if (!keep.has(f.date)) { try { unlinkSync(f.path); } catch { /* already gone */ } }
}

export function listBackups(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((n) => NAME.exec(n)).filter(Boolean)
    .map((m) => ({ date: m[1], path: join(dir, m[0]), bytes: statSync(join(dir, m[0])).size }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
