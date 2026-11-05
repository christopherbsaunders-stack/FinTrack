// Daily fund and stock prices from Yahoo Finance's chart endpoint (no key
// needed; covers mutual funds like MDFGX). Each ticker keeps its daily closes
// and its payouts (dividends, capital gains) and splits, which a 401(k)
// reinvests, so the share count can follow them between statements.

const DAY = 86400000;

export function chartUrl(ticker, range) {
  const t = encodeURIComponent(ticker.toUpperCase());
  return `https://query1.finance.yahoo.com/v8/finance/chart/${t}?range=${range}&interval=1d&events=div%7Csplit%7CcapitalGain&includeAdjustedClose=false`;
}

export async function fetchHistory(ticker, { range = '1mo' } = {}, fetchImpl = fetch) {
  const res = await fetchImpl(chartUrl(ticker, range), { headers: { 'User-Agent': 'Mozilla/5.0 (FinTrack personal finance dashboard)', Accept: 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  const err = body?.chart?.error;
  if (res.status === 404 || err?.code === 'Not Found') throw new Error(`No prices found for ${ticker}: check the ticker symbol.`);
  if (!res.ok || err) throw new Error(`Price lookup for ${ticker} failed: ${err?.description || `HTTP ${res.status}`}`);
  return parseChart(ticker, body);
}

// Yahoo's daily timestamps are the market open in UTC; the exchange's offset
// turns them into the trading date.
export function parseChart(ticker, body) {
  const r = body?.chart?.result?.[0];
  if (!r) throw new Error(`No prices found for ${ticker}.`);
  const offset = Number(r.meta?.gmtoffset || 0);
  const day = (ts) => new Date((Number(ts) + offset) * 1000).toISOString().slice(0, 10);
  const closes = {};
  const ts = r.timestamp || [];
  const close = r.indicators?.quote?.[0]?.close || [];
  ts.forEach((t, i) => { if (close[i] != null && close[i] > 0) closes[day(t)] = round(close[i], 4); });
  const events = [];
  for (const d of Object.values(r.events?.dividends || {})) events.push({ date: day(d.date), type: 'dividend', amount: Number(d.amount) });
  for (const d of Object.values(r.events?.capitalGains || {})) events.push({ date: day(d.date), type: 'capitalGain', amount: Number(d.amount) });
  for (const s of Object.values(r.events?.splits || {})) events.push({ date: day(s.date), type: 'split', ratio: Number(s.numerator) / Number(s.denominator) });
  // The meta price is today's (or the last) close, sometimes before the bar is in.
  const metaTime = r.meta?.regularMarketTime;
  if (r.meta?.regularMarketPrice > 0 && metaTime && !closes[day(metaTime)]) closes[day(metaTime)] = round(r.meta.regularMarketPrice, 4);
  return {
    ticker: ticker.toUpperCase(),
    name: r.meta?.longName || r.meta?.shortName || null,
    currency: r.meta?.currency || 'USD',
    closes,
    events: events.filter((e) => (e.type === 'split' ? e.ratio > 0 && e.ratio !== 1 : e.amount > 0)),
  };
}

// Merge a fetch into the stored prices for a ticker (state.prices[ticker]).
export function mergeHistory(prices, h, now = new Date()) {
  const cur = prices[h.ticker] || { ticker: h.ticker, closes: {}, events: [] };
  const key = (e) => `${e.date}|${e.type}`;
  const events = new Map(cur.events.map((e) => [key(e), e]));
  for (const e of h.events) events.set(key(e), e);
  prices[h.ticker] = {
    ticker: h.ticker,
    name: h.name || cur.name || null,
    currency: h.currency || cur.currency,
    closes: { ...cur.closes, ...h.closes },
    events: [...events.values()].sort((a, b) => a.date.localeCompare(b.date)),
    fetchedAt: now.toISOString(),
    error: null,
  };
  return prices[h.ticker];
}

// Fetch every ticker in use: two years the first time, then the last month.
export async function refreshPrices(state, tickers, { now = new Date(), fetchImpl } = {}) {
  state.prices ||= {};
  const errors = [];
  for (const t of tickers) {
    const have = state.prices[t];
    const range = have && Object.keys(have.closes).length ? '1mo' : '2y';
    try {
      mergeHistory(state.prices, await fetchHistory(t, { range }, fetchImpl), now);
    } catch (err) {
      state.prices[t] = { ...(have || { ticker: t, closes: {}, events: [] }), error: err.message, failedAt: now.toISOString() };
      errors.push(err.message);
    }
  }
  return errors;
}

// The close on a date, or the last one before it.
export function closeOnOrBefore(p, date) {
  if (!p) return null;
  let best = null;
  for (const [d, c] of Object.entries(p.closes)) if (d <= date && (!best || d > best[0])) best = [d, c];
  return best ? { date: best[0], close: best[1] } : null;
}

// The first close on a date or after it (what money paid in that day buys at).
export function closeOnOrAfter(p, date) {
  if (!p) return null;
  let best = null;
  for (const [d, c] of Object.entries(p.closes)) if (d >= date && (!best || d < best[0])) best = [d, c];
  return best ? { date: best[0], close: best[1] } : null;
}

export function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / DAY); }
function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }
