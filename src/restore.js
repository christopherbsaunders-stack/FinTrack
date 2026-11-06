// Put a backup back:  npm run restore -- <backup file>
// Stop FinTrack first. The current data is saved next to the backups before
// it's replaced, so a restore can itself be undone. Backups have no bank
// access link: the current one is kept if there is one; otherwise paste a
// new SimpleFIN setup token after restoring.

import { readFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveState } from './store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = process.env.FINTRACK_DATA || join(ROOT, 'data', 'state.json');
const file = process.argv[2];

if (!file) {
  console.error('Which backup? For example:\n  npm run restore -- data/backups/fintrack-2026-11-01.json');
  process.exit(1);
}
const path = resolve(file);
if (!existsSync(path)) { console.error(`No file at ${path}`); process.exit(1); }
let backup;
try { backup = JSON.parse(readFileSync(path, 'utf8')); } catch { console.error(`${path} isn't a FinTrack backup.`); process.exit(1); }
if (!backup || typeof backup !== 'object' || !backup.accounts || !backup.snapshots) { console.error(`${path} isn't a FinTrack backup.`); process.exit(1); }

let accessUrl = null;
if (existsSync(DATA_FILE)) {
  const keepDir = join(dirname(DATA_FILE), 'backups');
  mkdirSync(keepDir, { recursive: true });
  const before = join(keepDir, `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  copyFileSync(DATA_FILE, before);
  console.log(`Current data saved as ${before}`);
  try { accessUrl = JSON.parse(readFileSync(DATA_FILE, 'utf8')).accessUrl || null; } catch { /* unreadable: start without it */ }
}
delete backup.backedUpWithoutAccess;
backup.accessUrl = accessUrl;
saveState(DATA_FILE, backup);
console.log(`Restored ${path}.`);
console.log(accessUrl ? 'Kept the current SimpleFIN connection.' : 'Start FinTrack and paste a new SimpleFIN setup token to reconnect your banks.');
