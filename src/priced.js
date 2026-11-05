// Accounts valued from what they hold: shares of each fund × its daily price.
// For a 401(k) that no aggregator can reach (Paychex Flex).
//
// account.priced = {
//   asOf: 'YYYY-MM-DD',              shares below are as of this day's close
//   positions: [{ ticker, name, shares }],
//   ledger: [{ key, date, ticker, shares, amount, price, kind, description }],
//                                    real transactions after asOf (imported CSVs)
//   coveredUntil: 'YYYY-MM-DD',      imported history runs to here; estimates start after it
//   plan: { enabled, amount, allocation: { TICKER: percent }, schedule },
// }
// schedule: { every: 'month', day: 'lastBusiness' | 1..31, lag: business days until invested }
//         | { every: '2weeks' | 'week', anchor: 'YYYY-MM-DD', lag }
//
// Between imports the value is estimated: each payday adds `amount` split by
// `allocation` at that day's price, and fund payouts are reinvested. An
// imported CSV replaces estimates with what really happened.

import { closeOnOrAfter, closeOnOrBefore } from './prices.js';

// ---------- dates ----------

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => iso(new Date(utc(s).getTime() + n * 86400000));
const isWeekend = (s) => [0, 6].includes(utc(s).getUTCDay());
// US market holidays aren't modeled: a payday on one just prices at the next close.
export function addBusinessDays(s, n) {
  let d = s;
  while (n > 0) { d = addDays(d, 1); if (!isWeekend(d)) n--; }
  return d;
}
function lastBusinessDay(y, m) {
  let d = iso(new Date(Date.UTC(y, m + 1, 0)));
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

// Days money is invested, after `from` and up to `to` (both 'YYYY-MM-DD').
export function investDates(schedule, from, to) {
  if (!schedule) return [];
  const lag = Number(schedule.lag) || 0;
  const pays = [];
  if (schedule.every === 'month') {
    const start = utc(addDays(from, -40));
    for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m++) {
      const date = new Date(Date.UTC(y, m, 1));
      if (iso(date) > to) break;
      const yy = date.getUTCFullYear(), mm = date.getUTCMonth();
      let pay;
      if (schedule.day === 'lastBusiness') pay = lastBusinessDay(yy, mm);
      else {
        const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
        pay = iso(new Date(Date.UTC(yy, mm, Math.min(Number(schedule.day) || 1, last))));
      }
      pays.push(pay);
    }
  } else if (schedule.every === '2weeks' || schedule.every === 'week') {
    const step = schedule.every === 'week' ? 7 : 14;
    let d = schedule.anchor;
    while (d > addDays(from, -40)) d = addDays(d, -step);
    for (; d <= to; d = addDays(d, step)) pays.push(d);
  }
  return pays.map((p) => addBusinessDays(p, lag)).filter((d) => d > from && d <= to);
}

// ---------- valuation ----------

// The close on or before a day, by binary search over each ticker's sorted
// days (built once per valuation; years of daily prices make a scan slow).
function priceLookup(prices) {
  const cache = {};
  return (ticker, day) => {
    const p = prices[ticker];
    if (!p) return null;
    const keys = (cache[ticker] ||= Object.keys(p.closes).sort());
    let lo = 0, hi = keys.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (keys[mid] <= day) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    return found < 0 ? null : { date: keys[found], close: p.closes[keys[found]] };
  };
}

// How far back the imported transaction files reach without a gap up to
// asOf (file date ranges merged), or null when they don't reach asOf.
export function historyFrom(priced) {
  const ranges = (priced.ranges || []).filter((r) => r.from && r.to).sort((a, b) => a.from.localeCompare(b.from));
  let cur = null;
  const merged = [];
  for (const r of ranges) {
    if (cur && r.from <= addDays(cur.to, 1)) { if (r.to > cur.to) cur.to = r.to; }
    else merged.push(cur = { ...r });
  }
  const hit = merged.find((r) => r.from <= priced.asOf && r.to >= priced.asOf);
  return hit && hit.from < priced.asOf ? hit.from : null;
}

// Shares, value and a daily value series from asOf to today.
export function valuePriced(priced, prices, today) {
  const shares = {};
  for (const p of priced.positions) shares[p.ticker] = (shares[p.ticker] || 0) + Number(p.shares);
  const covered = priced.coveredUntil && priced.coveredUntil > priced.asOf ? priced.coveredUntil : priced.asOf;
  const events = [];
  const waiting = [];

  for (const t of priced.ledger || []) if (t.date > priced.asOf) events.push({ date: t.date, order: 1, flow: moneyIn(t), apply: (s) => { s[t.ticker] = (s[t.ticker] || 0) + t.shares; } });

  const estimates = [];
  const plan = priced.plan;
  if (plan?.enabled && plan.amount > 0) {
    for (const day of investDates(plan.schedule, covered, today)) {
      for (const [ticker, pct] of Object.entries(plan.allocation || {})) {
        if (!(pct > 0)) continue;
        const px = closeOnOrAfter(prices[ticker], day);
        if (!px || px.date > today) { waiting.push({ date: day, ticker }); continue; }
        const amount = (plan.amount * pct) / 100;
        const add = amount / px.close;
        events.push({ date: px.date, order: 2, flow: amount, apply: (s) => { s[ticker] = (s[ticker] || 0) + add; } });
        estimates.push({ date: px.date, ticker, amount: round(amount, 2), shares: round(add, 4), kind: 'contribution' });
      }
    }
  }

  // Payouts and splits after the covered period. Payouts buy shares at the
  // ex-date's close, from the shares held the day before.
  const tickers = new Set([...Object.keys(shares), ...Object.keys(plan?.allocation || {})]);
  for (const ticker of tickers) {
    for (const e of prices[ticker]?.events || []) {
      if (e.date <= covered || e.date > today) continue;
      if (e.type === 'split') {
        events.push({ date: e.date, order: 0, apply: (s) => { s[ticker] = (s[ticker] || 0) * e.ratio; } });
        continue;
      }
      const px = closeOnOrAfter(prices[ticker], e.date);
      if (!px) continue;
      events.push({ date: e.date, order: 0, apply: (s) => {
        const add = ((s[ticker] || 0) * e.amount) / px.close;
        s[ticker] = (s[ticker] || 0) + add;
        estimates.push({ date: e.date, ticker, amount: round(add * px.close, 2), shares: round(add, 4), kind: e.type });
      } });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  // Walk the trading days from asOf, applying events as they come.
  const priceAt = priceLookup(prices);
  const days = new Set([priced.asOf, today]);
  for (const t of tickers) for (const d of Object.keys(prices[t]?.closes || {})) if (d >= priced.asOf && d <= today) days.add(d);
  // Each day: the value, and the money put in since asOf (contributions in,
  // withdrawals out; payouts and market moves are not money put in).
  const series = [];
  const held = { ...shares };
  let i = 0, putIn = 0;
  for (const day of [...days].sort()) {
    while (i < events.length && events[i].date <= day) { putIn += events[i].flow || 0; events[i++].apply(held); }
    let value = 0, complete = true;
    for (const [t, n] of Object.entries(held)) {
      if (!n) continue;
      const px = priceAt(t, day);
      if (!px) { complete = false; continue; }
      value += n * px.close;
    }
    if (complete) series.push({ date: day, value: round(value, 2), putIn: round(putIn, 2) });
  }

  // Before asOf: work backward from asOf's shares, undoing each imported
  // transaction, as far as the files reach without a gap.
  const back = backfill(priced, prices, priceAt);
  // "Invested": what the account held where the series starts, plus the
  // money put in from then on.
  const startValue = back.series[0]?.value ?? series[0]?.value ?? 0;
  for (const p of back.series) p.invested = round(startValue + back.putInTotal - p.after, 2);
  for (const p of series) p.invested = round(startValue + back.putInTotal + p.putIn, 2);
  for (const p of back.series) { p.putIn = round(back.putInTotal - p.after, 2); delete p.after; }
  for (const p of series) p.putIn = round(back.putInTotal + p.putIn, 2);
  series.unshift(...back.series);
  while (i < events.length) events[i++].apply(held);

  const holdings = Object.entries(held).filter(([, n]) => n > 1e-9).map(([ticker, n]) => {
    const px = closeOnOrBefore(prices[ticker], today);
    const pos = priced.positions.find((p) => p.ticker === ticker);
    return { symbol: ticker, description: pos?.name || prices[ticker]?.name || ticker, shares: round(n, 4), price: px?.close ?? null, priceDate: px?.date ?? null, value: px ? round(n * px.close, 2) : 0, costBasis: null };
  }).sort((a, b) => b.value - a.value);

  const missing = [...tickers].filter((t) => held[t] > 0 && !closeOnOrBefore(prices[t], today));
  const priceDate = holdings.reduce((m, h) => (h.priceDate && (!m || h.priceDate < m) ? h.priceDate : m), null);
  return {
    value: round(holdings.reduce((s, h) => s + h.value, 0), 2),
    holdings,
    series,
    history: { requested: back.requested, from: back.series[0]?.date ?? null, stop: back.stop, filledPayouts: back.filledPayouts || [] },
    estimates: estimates.sort((a, b) => a.date.localeCompare(b.date)),
    estimatedSince: covered,
    waiting,
    missing,
    priceDate,
  };
}

// The account's value on each trading day from historyFrom up to (not
// including) asOf. Shares at the close of day d are asOf's shares minus every
// imported transaction after d up to asOf. Stops early, with a reason, where a
// fund's shares would go negative (a transaction is missing) or a fund has no
// price that far back.
function backfill(priced, prices, priceAt) {
  const from = historyFrom(priced);
  const out = { series: [], putInTotal: 0, requested: from, stop: null, filledPayouts: [] };
  if (!from) return out;
  const rows = (priced.ledger || []).filter((t) => t.date > from && t.date <= priced.asOf);
  const held = {};
  for (const p of priced.positions) held[p.ticker] = (held[p.ticker] || 0) + Number(p.shares);
  const tickers = new Set([...Object.keys(held), ...rows.map((r) => r.ticker)]);

  // Fund payouts with no reinvestment row in the files (some recordkeepers
  // don't list them): filled in from the fund's published payouts, so the
  // history doesn't drop off a cliff before each one.
  const steps = rows.map((r) => ({ date: r.date, row: r }));
  for (const t of tickers) {
    for (const e of prices[t]?.events || []) {
      if (e.type === 'split' || e.date <= from || e.date > priced.asOf) continue;
      const listed = rows.some((r) => r.ticker === t && r.shares > 0 && !/contribution|transfer|exchange|rollover/i.test(r.kind || '')
        && r.date >= addDays(e.date, -5) && r.date <= addDays(e.date, 10));
      const px = priceAt(t, e.date);
      if (listed || !px || px.date !== e.date) continue;
      steps.push({ date: e.date, payout: { ticker: t, perShare: e.amount, price: px.close } });
      out.filledPayouts.push({ ticker: t, date: e.date, perShare: e.amount });
    }
  }
  steps.sort((a, b) => b.date.localeCompare(a.date));

  const days = new Set();
  for (const t of tickers) for (const d of Object.keys(prices[t]?.closes || {})) if (d >= from && d < priced.asOf) days.add(d);
  let i = 0, after = 0;           // after: money put in after the current day, up to asOf
  const pts = [];
  for (const day of [...days].sort().reverse()) {
    while (i < steps.length && steps[i].date > day) {
      const st = steps[i++];
      if (st.row) {
        held[st.row.ticker] = (held[st.row.ticker] || 0) - st.row.shares;
        after += moneyIn(st.row);
      } else {
        // Reinvesting multiplied the shares by (1 + payout / price); undo that.
        const { ticker, perShare, price } = st.payout;
        held[ticker] = (held[ticker] || 0) / (1 + perShare / price);
      }
    }
    const short = Object.entries(held).find(([, n]) => n < -0.01);
    if (short) { out.stop = `Before ${day}, ${short[0]} would need fewer than zero shares: a transaction is probably missing from the imported files.`; break; }
    let value = 0, gap = null;
    for (const [t, n] of Object.entries(held)) {
      if (n <= 0.0001) continue;
      const px = priceAt(t, day);
      if (!px) { gap = t; break; }
      value += n * px.close;
    }
    if (gap) { out.stop = `There are no prices for ${gap} before ${day}.`; break; }
    pts.push({ date: day, value: round(value, 2), after });
  }
  out.series = pts.reverse();
  out.putInTotal = out.series.length ? out.series[0].after : 0;
  const first = out.series[0]?.date;
  if (first) out.filledPayouts = out.filledPayouts.filter((f) => f.date > first);
  return out;
}

// Money put into the account by a transaction: contributions and rollovers in,
// withdrawals and loans out. Exchanges between funds, payouts and fees aren't.
export function moneyIn(t) {
  if (/contribution|rollover|deposit/i.test(t.kind || '')) return Math.abs(t.amount || 0);
  if (/withdraw|distribution paid|loan issue/i.test(t.kind || '')) return -Math.abs(t.amount || 0);
  return 0;
}

// Shares from a value on the asOf date (what Paychex shows per fund).
export function sharesFromValue(value, prices, ticker, asOf) {
  const px = closeOnOrBefore(prices[ticker], asOf);
  if (!px) throw new Error(`No price for ${ticker} on or before ${asOf} yet.`);
  return { shares: round(Number(value) / px.close, 4), price: px.close, priceDate: px.date };
}

// ---------- Paychex transactions CSV ----------

// "Date, Transaction, InvestmentName, Ticker, Amount, Price, Shares" from
// Paychex Flex > Retirement > Transactions > Download. Returns the rows, the
// period the file covers, and a contribution plan read from its latest one.
export function parsePaychexCsv(text, filename = '') {
  const lines = parseCsv(String(text).replace(/^﻿/, ''));
  if (!lines.length) throw new Error('The file is empty.');
  const head = lines[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const col = (name) => head.indexOf(name);
  const need = ['date', 'transaction', 'ticker', 'amount', 'shares'];
  for (const n of need) if (col(n) < 0) throw new Error(`This doesn't look like a Paychex transactions file: no "${n}" column.`);
  const rows = [];
  for (const cells of lines.slice(1)) {
    if (!cells.some((c) => c.trim())) continue;
    const get = (n) => (col(n) >= 0 ? (cells[col(n)] || '').trim() : '');
    const date = usDate(get('date'));
    const ticker = get('ticker').toUpperCase();
    if (!date || !ticker) continue;
    const kind = get('transaction');
    const amount = num(get('amount'));
    let shares = num(get('shares'));
    // Money leaving a fund: trust a minus sign, else go by the description.
    const out = amount < 0 || shares < 0 || /\b(fee|withdraw|distribution paid|loan issue|transfer out|exchange out|sell|redemption|forfeit)/i.test(kind);
    shares = out ? -Math.abs(shares) : Math.abs(shares);
    rows.push({
      key: [date, kind, ticker, amount, shares].join('|'),
      date, ticker, shares, amount: out ? -Math.abs(amount) : Math.abs(amount),
      price: num(get('price')) || null,
      kind, description: get('investmentname'),
    });
  }
  if (!rows.length) throw new Error('No transactions found in the file.');
  const range = /(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/.exec(filename);
  const lastDate = rows.reduce((m, r) => (r.date > m ? r.date : m), '');
  return { rows, from: range?.[1] || rows.reduce((m, r) => (r.date < m ? r.date : m), lastDate), to: range ? (range[2] > lastDate ? range[2] : lastDate) : lastDate, suggestion: suggestPlan(rows) };
}

// The latest contribution day: its total (yours + match) and how it was split.
export function suggestPlan(rows) {
  const contrib = rows.filter((r) => /contribution/i.test(r.kind) && r.amount > 0);
  if (!contrib.length) return null;
  const last = contrib.reduce((m, r) => (r.date > m ? r.date : m), '');
  const day = contrib.filter((r) => r.date === last);
  const total = day.reduce((s, r) => s + r.amount, 0);
  const byTicker = {};
  const names = {};
  for (const r of day) { byTicker[r.ticker] = (byTicker[r.ticker] || 0) + r.amount; names[r.ticker] = r.description; }
  const allocation = {};
  for (const [t, a] of Object.entries(byTicker)) allocation[t] = Math.round((a / total) * 1000) / 10;
  return { date: last, amount: round(total, 2), allocation, names };
}

function parseCsv(text) {
  const out = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}

function usDate(s) {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function num(s) {
  const neg = /^\(.*\)$/.test(s.trim());
  const n = Number(String(s).replace(/[$,()\s]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }
