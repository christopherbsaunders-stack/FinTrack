// FinTrack server: serves the dashboard and a small JSON API, and syncs with
// SimpleFIN on a timer. No dependencies; Node 20+.
//
//   node src/server.js           your data, in data/state.json
//   node src/server.js --demo    made-up data, nothing saved

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { loadState, saveState } from './store.js';
import { claimAccessUrl } from './simplefin.js';
import { syncNow, recordSnapshot } from './sync.js';
import { computeSummary } from './summary.js';
import { CATEGORIES } from './classify.js';
import { demoState } from './demo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const DEMO = process.argv.includes('--demo') || process.env.FINTRACK_DEMO === '1';
const DATA_FILE = process.env.FINTRACK_DATA || join(ROOT, 'data', 'state.json');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4600);
const PASSWORD = process.env.FINTRACK_PASSWORD || '';
const CHECK_EVERY_MS = 10 * 60 * 1000;

let state = DEMO ? demoState() : loadState(DATA_FILE);
let syncing = null;

function persist() { if (!DEMO) saveState(DATA_FILE, state); }

async function runSync(reason) {
  if (DEMO) return { demo: true };
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const r = await syncNow(state);
      console.log(`[sync] ${reason}: ${r.accounts} accounts${r.errors.length ? `, ${r.errors.length} notice(s)` : ''}`);
      return r;
    } catch (err) {
      console.error(`[sync] ${reason} failed: ${err.message}`);
      throw err;
    } finally {
      persist();
      syncing = null;
    }
  })();
  return syncing;
}

function syncDue() {
  if (DEMO || !state.accessUrl) return false;
  const last = state.lastAttempt ? new Date(state.lastAttempt).getTime() : 0;
  return Date.now() - last >= (state.settings.syncHours || 6) * 3600000;
}

// ---------- HTTP ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw httpError(413, 'Request too large.'); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw httpError(400, 'Body is not valid JSON.'); }
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

// Only answer requests addressed to this server by name: stops other web pages
// (and DNS rebinding) from reading or changing your data through the browser.
function allowedHost(req) {
  const host = (req.headers.host || '').toLowerCase();
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') return true; // you chose to expose it; use FINTRACK_PASSWORD
  return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}`;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}

function authorized(req) {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const given = Buffer.from(Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':'));
  const want = Buffer.from(PASSWORD);
  return given.length === want.length && timingSafeEqual(given, want);
}

const routes = [
  ['GET', /^\/api\/summary$/, async () => ({ ...computeSummary(state), demo: DEMO, syncing: Boolean(syncing) })],

  ['POST', /^\/api\/setup$/, async (req) => {
    if (DEMO) throw httpError(400, 'This is the demo. Run `npm start` to connect your own accounts.');
    const { token } = await readJson(req);
    state.accessUrl = await claimAccessUrl(token);
    persist();
    await runSync('first sync').catch(() => {});
    return { ok: true };
  }],

  ['POST', /^\/api\/sync$/, async () => {
    if (DEMO) throw httpError(400, 'The demo has nothing to sync.');
    await runSync('manual');
    return { ok: true };
  }],

  ['POST', /^\/api\/disconnect$/, async () => {
    state.accessUrl = null;
    persist();
    return { ok: true };
  }],

  ['POST', /^\/api\/settings$/, async (req) => {
    const { syncHours } = await readJson(req);
    const h = Number(syncHours);
    if (!(h >= 1 && h <= 168)) throw httpError(400, 'Sync every 1 to 168 hours.');
    state.settings.syncHours = h;
    persist();
    return { ok: true };
  }],

  ['POST', /^\/api\/manual$/, async (req) => {
    const { name, category, value } = await readJson(req);
    if (!String(name || '').trim()) throw httpError(400, 'Give the account a name.');
    if (!CATEGORIES[category]) throw httpError(400, 'Unknown category.');
    const v = Number(value);
    if (!Number.isFinite(v)) throw httpError(400, 'Value must be a number.');
    const id = `manual-${randomUUID()}`;
    const now = new Date().toISOString();
    state.accounts[id] = {
      id, name: String(name).trim().slice(0, 80), org: 'Manual', currency: 'USD', balance: v, available: null,
      balanceDate: now, holdings: [], source: 'manual', category, categoryOverride: category,
      displayName: null, hidden: false, firstSeen: now, lastSeen: now,
    };
    recordSnapshot(state);
    persist();
    return { ok: true, id };
  }],

  ['PATCH', /^\/api\/accounts\/([^/]+)$/, async (req, [, rawId]) => {
    const id = decodeURIComponent(rawId);
    const a = state.accounts[id];
    if (!a) throw httpError(404, 'No such account.');
    const body = await readJson(req);
    if ('category' in body) {
      if (body.category !== null && !CATEGORIES[body.category]) throw httpError(400, 'Unknown category.');
      a.categoryOverride = body.category;
      if (body.category) a.category = body.category;
    }
    if ('hidden' in body) a.hidden = Boolean(body.hidden);
    if ('displayName' in body) a.displayName = body.displayName ? String(body.displayName).trim().slice(0, 80) : null;
    if ('balance' in body) {
      if (a.source !== 'manual') throw httpError(400, 'Only manual accounts take a typed balance; the others come from your bank.');
      const v = Number(body.balance);
      if (!Number.isFinite(v)) throw httpError(400, 'Value must be a number.');
      a.balance = v;
      a.balanceDate = new Date().toISOString();
    }
    recordSnapshot(state);
    persist();
    return { ok: true };
  }],

  ['DELETE', /^\/api\/accounts\/([^/]+)$/, async (_req, [, rawId]) => {
    const id = decodeURIComponent(rawId);
    const a = state.accounts[id];
    if (!a) throw httpError(404, 'No such account.');
    if (a.source !== 'manual') throw httpError(400, 'Bank accounts come back on the next sync; hide them instead.');
    delete state.accounts[id];
    for (const snap of Object.values(state.snapshots)) delete snap[id];
    persist();
    return { ok: true };
  }],
];

const server = createServer(async (req, res) => {
  try {
    if (!allowedHost(req)) return send(res, 421, { error: 'Wrong host.' });
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="FinTrack"' });
      return res.end('Password required.');
    }
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        if (!sameOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
        if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Send JSON.' });
      }
      for (const [method, re, handler] of routes) {
        const m = re.exec(url.pathname);
        if (m && method === req.method) return send(res, 200, await handler(req, m));
      }
      return send(res, 404, { error: 'Not found.' });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(file) || !MIME[extname(file)]) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, await readFile(join(PUBLIC, file)), MIME[extname(file)]);
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, 'Not found', 'text/plain');
    send(res, err.status || 500, { error: err.message || 'Something went wrong.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FinTrack${DEMO ? ' (demo data)' : ''} on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  if (!DEMO && !state.accessUrl) console.log('Not connected yet: open the page and paste a SimpleFIN setup token.');
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !PASSWORD) console.warn('Warning: listening beyond this computer with no FINTRACK_PASSWORD set.');
});

if (syncDue()) runSync('startup').catch(() => {});
setInterval(() => { if (syncDue()) runSync('scheduled').catch(() => {}); }, CHECK_EVERY_MS).unref?.();

