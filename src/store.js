// Everything lives in one JSON file (data/state.json by default), written
// atomically and readable only by you (mode 600). It holds the SimpleFIN access
// URL, so keep it out of git (data/ is in .gitignore) and off shared drives.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function emptyState() {
  return {
    version: 1,
    accessUrl: null,
    lastSync: null,       // ISO time of the last successful sync
    lastAttempt: null,    // ISO time of the last try, successful or not
    lastErrors: [],       // messages from SimpleFIN or from the last failed sync
    accounts: {},         // id -> account (SimpleFIN and manual)
    snapshots: {},        // 'YYYY-MM-DD' -> { accountId: signed value }
    transactions: {},     // id -> transaction (with accountId)
    prices: {},           // ticker -> { closes: { date: close }, events: [payouts, splits] }
    priceErrors: [],
    indexes: {},          // FRED series id -> { obs: { date: value }, fetchedAt }
    indexErrors: [],
    lastPriceSync: null,
    settings: { syncHours: 6 },
  };
}

export function loadState(file) {
  if (!existsSync(file)) return emptyState();
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const base = emptyState();
  return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* not supported on this filesystem */ }
}

export function dayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
