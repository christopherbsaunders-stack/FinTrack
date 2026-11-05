// FinTrack server: serves the dashboard and a small JSON API, and syncs with
// SimpleFIN and refreshes fund prices on a timer. No dependencies; Node 20+.
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
import { syncAll, recordSnapshot, revaluePriced, pricedTickers } from './sync.js';
import { refreshPrices } from './prices.js';
import { parsePaychexCsv, sharesFromValue } from './priced.js';
import { computeSummary } from './summary.js';
import { CATEGORIES, kindOf } from './classify.js';
import { validateLoan } from './loans.js';
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
      const r = await syncAll(state);
      const parts = [];
      if (state.accessUrl) parts.push(`${r.accounts} accounts`);
      if (pricedTickers(state).length) parts.push(`${pricedTickers(state).length} fund prices`);
      console.log(`[sync] ${reason}: ${parts.join(', ') || 'nothing to sync'}`);
      for (const e of [...r.errors, ...r.priceErrors]) console.error(`[sync]   ${e}`);
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
  if (DEMO || (!state.accessUrl && !pricedTickers(state).length)) return false;
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
  for await (const chunk of req) { raw += chunk; if (raw.length > 5e6) throw httpError(413, 'Request too large.'); }
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
    return runSync('manual');
  }],

  // ----- accounts valued from their holdings (a 401(k) no aggregator reaches) -----

  ['POST', /^\/api\/priced\/parse-csv$/, async (req) => {
    const { csv, filename } = await readJson(req);
    try { return parsePaychexCsv(csv, filename); } catch (err) { throw httpError(400, err.message); }
  }],

  ['POST', /^\/api\/priced$/, async (req) => {
    const body = await readJson(req);
    const id = `priced-${randomUUID()}`;
    const priced = await pricedFromForm(body, null);
    const now = new Date().toISOString();
    state.accounts[id] = {
      id, name: cleanName(body.name, '401(k)'), org: cleanName(body.org, 'Manual'), currency: 'USD', balance: 0, available: null,
      balanceDate: now, holdings: [], source: 'priced', category: CATEGORIES[body.category] ? body.category : 'retirement',
      categoryOverride: null, displayName: null, hidden: false, firstSeen: now, lastSeen: now, priced,
    };
    if (body.csv) importCsv(state.accounts[id], body.csv, body.filename);
    revaluePriced(state);
    persist();
    return { ok: true, id };
  }],

  ['PUT', /^\/api\/priced\/([^/]+)$/, async (req, [, rawId]) => {
    const a = pricedAccount(rawId);
    const body = await readJson(req);
    a.priced = await pricedFromForm(body, a.priced);
    if (body.name) a.name = cleanName(body.name, a.name);
    if (body.org) a.org = cleanName(body.org, a.org);
    revaluePriced(state);
    persist();
    return { ok: true };
  }],

  ['POST', /^\/api\/priced\/([^/]+)\/import$/, async (req, [, rawId]) => {
    const a = pricedAccount(rawId);
    const { csv, filename } = await readJson(req);
    const r = importCsv(a, csv, filename);
    revaluePriced(state);
    persist();
    return { ok: true, ...r };
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

  // Loan details (rate, payment, escrow, ...) for a debt; null clears them.
  ['PUT', /^\/api\/accounts\/([^/]+)\/loan$/, async (req, [, rawId]) => {
    const a = state.accounts[decodeURIComponent(rawId)];
    if (!a) throw httpError(404, 'No such account.');
    if (kindOf(a.category) !== 'liability') throw httpError(400, 'Loan details are for debts.');
    const { loan } = await readJson(req);
    if (loan === null) a.loan = null;
    else { try { a.loan = validateLoan(loan || {}); } catch (err) { throw httpError(400, err.message); } }
    persist();
    return { ok: true };
  }],

  ['DELETE', /^\/api\/accounts\/([^/]+)$/, async (_req, [, rawId]) => {
    const id = decodeURIComponent(rawId);
    const a = state.accounts[id];
    if (!a) throw httpError(404, 'No such account.');
    // Only accounts you made here can go; SimpleFIN ones come back on the next sync.
    if (a.source === 'simplefin') throw httpError(400, 'Bank accounts come back on the next sync; hide them instead.');
    delete state.accounts[id];
    for (const snap of Object.values(state.snapshots)) delete snap[id];
    // Drop prices no other account uses.
    const inUse = new Set(pricedTickers(state));
    for (const t of Object.keys(state.prices || {})) if (!inUse.has(t)) delete state.prices[t];
    persist();
    return { ok: true };
  }],
];

function cleanName(s, fallback) { return String(s || '').trim().slice(0, 80) || fallback; }

function pricedAccount(rawId) {
  const a = state.accounts[decodeURIComponent(rawId)];
  if (!a || a.source !== 'priced') throw httpError(404, 'No such account.');
  return a;
}

// The form: { asOf, mode: 'value' | 'shares', rows: [{ ticker, name, amount }],
// plan: { enabled, amount, allocation, schedule } }. Values become shares at
// the asOf close, so prices are fetched first.
async function pricedFromForm(body, prev) {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(body.asOf || '') ? body.asOf : null;
  if (!asOf) throw httpError(400, 'Give the date the values are from.');
  if (asOf > new Date().toISOString().slice(0, 10)) throw httpError(400, 'That date is in the future.');
  const rows = (body.rows || []).map((r) => ({ ticker: String(r.ticker || '').trim().toUpperCase(), name: String(r.name || '').trim().slice(0, 80), amount: Number(String(r.amount ?? '').replace(/[$,\s]/g, '')) }))
    .filter((r) => r.ticker);
  if (!rows.length) throw httpError(400, 'Add at least one fund.');
  for (const r of rows) {
    if (!/^[A-Z0-9.^-]{1,12}$/.test(r.ticker)) throw httpError(400, `"${r.ticker}" isn't a ticker symbol.`);
    if (!(r.amount >= 0)) throw httpError(400, `Enter a ${body.mode === 'shares' ? 'share count' : 'value'} for ${r.ticker}.`);
  }
  const plan = body.plan || {};
  const allocation = {};
  for (const [t, pct] of Object.entries(plan.allocation || {})) if (Number(pct) > 0) allocation[t.toUpperCase()] = Number(pct);
  const pctTotal = Object.values(allocation).reduce((s, v) => s + v, 0);
  if (plan.enabled && Math.abs(pctTotal - 100) > 0.5) throw httpError(400, `The contribution split adds up to ${pctTotal}%, not 100%.`);

  const tickers = [...new Set([...rows.map((r) => r.ticker), ...Object.keys(allocation)])];
  const errors = await refreshPrices(state, tickers);
  if (errors.length) throw httpError(400, errors.join(' '));
  state.lastPriceSync = new Date().toISOString();

  const positions = rows.map((r) => {
    if (body.mode === 'shares') return { ticker: r.ticker, name: r.name || state.prices[r.ticker]?.name || r.ticker, shares: r.amount };
    try {
      const s = sharesFromValue(r.amount, state.prices, r.ticker, asOf);
      return { ticker: r.ticker, name: r.name || state.prices[r.ticker]?.name || r.ticker, shares: s.shares };
    } catch (err) { throw httpError(400, err.message); }
  });
  const schedule = plan.schedule?.every === 'month'
    ? { every: 'month', day: plan.schedule.day === 'lastBusiness' ? 'lastBusiness' : Math.min(31, Math.max(1, Number(plan.schedule.day) || 1)), lag: Math.min(10, Math.max(0, Number(plan.schedule.lag) || 0)) }
    : { every: plan.schedule?.every === 'week' ? 'week' : '2weeks', anchor: /^\d{4}-\d{2}-\d{2}$/.test(plan.schedule?.anchor || '') ? plan.schedule.anchor : asOf, lag: Math.min(10, Math.max(0, Number(plan.schedule?.lag) || 0)) };
  return {
    asOf,
    positions,
    // Real transactions after the new date still count; older ones are in the new shares.
    ledger: (prev?.ledger || []).filter((t) => t.date > asOf),
    coveredUntil: prev?.coveredUntil && prev.coveredUntil > asOf ? prev.coveredUntil : asOf,
    plan: { enabled: Boolean(plan.enabled), amount: Math.max(0, Number(plan.amount) || 0), allocation, schedule },
  };
}

function importCsv(account, csv, filename) {
  let parsed;
  try { parsed = parsePaychexCsv(csv, filename); } catch (err) { throw httpError(400, err.message); }
  const p = account.priced;
  const have = new Set(p.ledger.map((t) => t.key));
  let added = 0, before = 0;
  for (const r of parsed.rows) {
    if (r.date <= p.asOf) { before++; continue; }
    if (have.has(r.key)) continue;
    p.ledger.push(r);
    have.add(r.key);
    added++;
  }
  p.ledger.sort((a, b) => a.date.localeCompare(b.date));
  if (parsed.to > p.coveredUntil) p.coveredUntil = parsed.to;
  return { added, alreadyCounted: before, coveredUntil: p.coveredUntil };
}

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
    // The dashboard uses the same loan math as the server.
    if (url.pathname === '/loans.js') return send(res, 200, await readFile(join(ROOT, 'src', 'loans.js')), MIME['.js']);
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

