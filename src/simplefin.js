// SimpleFIN Bridge client (https://www.simplefin.org/protocol.html).
//
// Setup:   the user gets a one-time Setup Token from bridge.simplefin.org.
//          It is base64 of a claim URL. POSTing to it returns an Access URL
//          (https://user:pass@host/path) that we keep and use from then on.
// Fetch:   GET <access>/accounts?start-date=<unix>&end-date=<unix>
//
// Node's fetch refuses URLs with credentials in them, so the user:pass part is
// moved into an Authorization header.

export function decodeSetupToken(token) {
  const clean = String(token || '').trim();
  if (!clean) throw new Error('The setup token is empty.');
  let url;
  try {
    url = Buffer.from(clean, 'base64').toString('utf8').trim();
  } catch {
    throw new Error('The setup token is not valid base64.');
  }
  if (!/^https:\/\//.test(url)) throw new Error('The setup token does not decode to an https URL. Copy the whole token from SimpleFIN Bridge.');
  return url;
}

export async function claimAccessUrl(setupToken, fetchImpl = fetch) {
  const claimUrl = decodeSetupToken(setupToken);
  const res = await fetchImpl(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (res.status === 403) throw new Error('SimpleFIN refused the token: it was already used or has expired. Make a new one at bridge.simplefin.org.');
  if (!res.ok) throw new Error(`SimpleFIN claim failed: HTTP ${res.status}`);
  const accessUrl = (await res.text()).trim();
  splitAccessUrl(accessUrl); // validates
  return accessUrl;
}

export function splitAccessUrl(accessUrl) {
  let u;
  try { u = new URL(accessUrl); } catch { throw new Error('The SimpleFIN access URL is not a valid URL.'); }
  if (u.protocol !== 'https:') throw new Error('The SimpleFIN access URL must use https.');
  const username = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  u.username = '';
  u.password = '';
  const base = u.toString().replace(/\/+$/, '');
  const auth = username || password ? 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') : null;
  return { base, auth };
}

// SimpleFIN Bridge limits how many days one request may cover (reports say
// 45, older docs 90), so longer ranges are fetched in pieces (see sync.js).
export const MAX_RANGE_DAYS = 45;

export async function fetchAccounts(accessUrl, { startDate, endDate, balancesOnly = false } = {}, fetchImpl = fetch) {
  const { base, auth } = splitAccessUrl(accessUrl);
  const headers = auth ? { Authorization: auth } : {};
  const query = (withPending) => {
    const q = new URLSearchParams();
    if (startDate) q.set('start-date', String(Math.floor(startDate.getTime() / 1000)));
    if (endDate) q.set('end-date', String(Math.floor(endDate.getTime() / 1000)));
    if (balancesOnly) q.set('balances-only', '1');
    if (withPending) q.set('pending', '1');
    return q;
  };
  let res = await fetchImpl(`${base}/accounts?${query(true)}`, { headers });
  // `pending` is optional in the protocol; if the server objects to the
  // request, try once more without it before giving up.
  if (res.status === 400) res = await fetchImpl(`${base}/accounts?${query(false)}`, { headers });
  if (res.status === 403) throw new Error('SimpleFIN denied access. The connection may have been revoked: set it up again with a new token.');
  if (res.status === 402) throw new Error('SimpleFIN says payment is required: check your SimpleFIN Bridge subscription.');
  if (!res.ok) {
    // SimpleFIN explains a refusal in the body; pass that on.
    const why = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error(`SimpleFIN request failed: HTTP ${res.status}${why ? ` (${why})` : ''}`);
  }
  return normalizeAccountSet(await res.json());
}

// SimpleFIN sends amounts as strings and dates as unix seconds. Turn it into
// plain numbers and Dates' ISO strings, and keep only what we use.
export function normalizeAccountSet(raw) {
  const errors = Array.isArray(raw?.errors) ? raw.errors.map(String) : [];
  const accounts = (raw?.accounts || []).map((a) => ({
    id: String(a.id),
    name: String(a.name || 'Account'),
    org: String(a.org?.name || a.org?.domain || 'Unknown institution'),
    currency: String(a.currency || 'USD'),
    balance: toNumber(a.balance),
    available: a['available-balance'] == null ? null : toNumber(a['available-balance']),
    balanceDate: a['balance-date'] ? new Date(Number(a['balance-date']) * 1000).toISOString() : new Date().toISOString(),
    holdings: (a.holdings || []).map((h) => ({
      symbol: h.symbol ? String(h.symbol) : null,
      description: String(h.description || h.symbol || ''),
      shares: toNumber(h.shares),
      value: toNumber(h.market_value),
      costBasis: h.cost_basis == null ? null : toNumber(h.cost_basis),
    })),
    transactions: (a.transactions || []).map((t) => ({
      id: String(t.id),
      posted: t.posted ? new Date(Number(t.posted) * 1000).toISOString() : null,
      transactedAt: t.transacted_at ? new Date(Number(t.transacted_at) * 1000).toISOString() : null,
      amount: toNumber(t.amount),
      description: String(t.description || t.payee || ''),
      pending: Boolean(t.pending) || !t.posted || Number(t.posted) === 0,
    })),
  }));
  return { errors, accounts };
}

function toNumber(v) {
  const n = Number(String(v ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
