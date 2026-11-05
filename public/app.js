// FinTrack dashboard. Fetches /api/summary and draws everything; no libraries.

import { compare, byYear, scheduledPayment, addMonths } from './loans.js';
import { STATES } from './hpi.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
let data = null;
let rangeDays = 365;
let txShown = 25;

// ---------- formatting ----------

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt = (n) => (n == null ? '–' : usd.format(n));
const fmtCents = (n) => usdCents.format(n);
function compact(n) {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${+(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${+(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k` : `${Math.round(a)}`;
  return `${n < 0 ? '−' : ''}$${s}`;
}
function signed(n) { return n == null ? '' : `${n >= 0 ? '+' : '−'}${usd.format(Math.abs(n))}`; }
function cls(n) { return n == null || Math.abs(n) < 0.5 ? '' : n > 0 ? 'up' : 'down'; }
function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const shortDate = (iso) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const longDate = (iso) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const monthName = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- API ----------

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });

async function load() {
  try {
    data = await api('/api/summary');
    render();
  } catch (err) {
    $('notices').innerHTML = `<div class="notice"><b>Can't reach the FinTrack server.</b> ${esc(err.message)}</div>`;
  }
}

// ---------- render ----------

function render() {
  const t = data.totals;
  $('demoBadge').hidden = !data.demo;
  $('setup').hidden = data.connected || data.demo;
  $('syncBtn').hidden = !data.connected && !data.hasPriced;
  $('syncStatus').textContent = data.demo ? 'Made-up accounts' : data.connected ? `Synced ${ago(data.lastSync)}` : data.hasPriced ? `Prices ${ago(data.lastPriceSync)}` : 'Not connected';

  $('notices').innerHTML = (data.errors || []).map((e) => `<div class="notice"><b>SimpleFIN:</b> ${esc(e)}</div>`).join('')
    + (data.indexErrors || []).map((e) => `<div class="notice"><b>Home prices:</b> ${esc(e)} The home keeps its last value.</div>`).join('')
    + data.accounts.filter((a) => a.indexStatus?.stale).map((a) => `<div class="notice"><b>${esc(a.name)}:</b> ${esc(a.indexStatus.stale)}</div>`).join('')
    + (data.priceErrors || []).map((e) => `<div class="notice"><b>Prices:</b> ${esc(e)} The balance uses the last price found.</div>`).join('');

  $('netWorth').textContent = fmt(t.netWorth);
  const parts = [];
  if (t.change30 != null) parts.push(`<span class="${cls(t.change30)}">${signed(t.change30)}</span> in 30 days`);
  if (t.change365 != null) parts.push(`<span class="${cls(t.change365)}">${signed(t.change365)}</span> in a year`);
  $('nwChange').innerHTML = parts.join(' · ') || '<span class="muted">History builds up with each daily sync.</span>';

  const tiles = [
    ['Assets', fmt(t.assets), ''],
    ['Debts', fmt(t.liabilities), t.debtToAsset == null ? '' : `${Math.round(t.debtToAsset * 100)}% of assets`],
    ['Cash', fmt(t.cash), 'Checking and savings'],
    ['Invested', fmt(t.invested), t.retirement ? `${fmt(t.retirement)} in retirement` : ''],
  ];
  if (t.homeEquity != null) tiles.push(['Home equity', fmt(t.homeEquity), 'Value minus mortgage']);
  $('tiles').innerHTML = tiles.map(([l, v, s]) => `<div class="tile"><div class="label">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`).join('');

  renderNetWorthChart();
  renderBars();
  renderCashFlow();
  renderAccounts();
  renderHoldings();
  renderLoans();
  renderTransactions();
}

function renderNetWorthChart() {
  const all = data.history;
  let pts = all;
  if (rangeDays) {
    const cut = new Date(Date.now() - rangeDays * 86400000).toISOString().slice(0, 10);
    pts = all.filter((p) => p.date >= cut);
  }
  $('nwLegend').innerHTML = '';
  const el = $('nwChart');
  if (pts.length < 2) {
    el.innerHTML = `<div class="empty">${all.length ? 'Not enough history in this range yet.' : 'Your net worth history starts with the first sync and grows a point a day.'}</div>`;
    return;
  }
  lineChart(el, pts.map((p) => ({ x: p.date, y: p.netWorth, row: p })), {
    color: 'var(--s1)',
    tip: (p) => `<div class="t">${longDate(p.x)}</div>
      <div class="r"><span><i style="background:var(--s1)"></i>Net worth</span><b>${fmt(p.row.netWorth)}</b></div>
      <div class="r"><span>Assets</span><b>${fmt(p.row.assets)}</b></div>
      <div class="r"><span>Debts</span><b>${fmt(p.row.liabilities)}</b></div>`,
  });
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return ticks;
}

function svg(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function lineChart(el, pts, { color, tip }) {
  el.innerHTML = '';
  const W = Math.max(320, el.clientWidth || 800), H = 260, L = 64, R = 12, T = 12, B = 28;
  const ys = pts.map((p) => p.y);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Net worth from ${fmt(pts[0].y)} to ${fmt(pts[pts.length - 1].y)}` }, el);
  for (const tv of ticks) {
    svg('line', { x1: L, x2: W - R, y1: y(tv), y2: y(tv), class: 'gridline' }, root);
    svg('text', { x: L - 8, y: y(tv) + 4, 'text-anchor': 'end' }, root).textContent = compact(tv);
  }
  const nx = Math.max(2, Math.min(6, pts.length, Math.floor((W - L) / 90)));
  for (let k = 0; k < nx; k++) {
    const i = Math.round((k / (nx - 1)) * (pts.length - 1));
    svg('text', { x: x(i), y: H - 8, 'text-anchor': k === 0 ? 'start' : k === nx - 1 ? 'end' : 'middle' }, root).textContent = shortDate(pts[i].x);
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const grad = `g${Math.random().toString(36).slice(2, 8)}`;
  const defs = svg('defs', {}, root);
  const lg = svg('linearGradient', { id: grad, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  svg('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.18 }, lg);
  svg('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }, lg);
  svg('path', { d: `${d}L${x(pts.length - 1)},${H - B}L${L},${H - B}Z`, fill: `url(#${grad})` }, root);
  svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, root);
  const last = pts.length - 1;
  svg('circle', { cx: x(last), cy: y(pts[last].y), r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }, root);

  const cross = svg('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }, root);
  const dot = svg('circle', { r: 5, fill: color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, root);
  const hit = svg('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' }, root);
  const move = (ev) => {
    const box = root.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(last, Math.round(((px - L) / (W - L - R)) * last)));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(pts[i].y));
    cross.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    showTip(tip(pts[i]), ev);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });
}

function renderBars() {
  const cats = data.byCategory;
  const draw = (list, color, totalLabel, extra = '') => {
    if (!list.length) return '<div class="empty">None yet.</div>';
    const max = Math.max(...list.map((c) => Math.abs(c.total)), 1);
    const total = list.reduce((s, c) => s + Math.abs(c.total), 0);
    return `<div class="bars">${list.map((c) => `
      <div class="bar-row" title="${esc(c.label)}: ${fmt(Math.abs(c.total))} (${Math.round((Math.abs(c.total) / total) * 100)}%)">
        <span class="name">${esc(c.label)}</span>
        <span class="track"><span class="fill" style="display:block;width:${Math.max(1, (Math.abs(c.total) / max) * 100)}%;background:${color}"></span></span>
        <span class="amt">${fmt(Math.abs(c.total))}</span>
      </div>`).join('')}</div>
      <div class="bar-total"><span>${totalLabel}</span><span>${fmt(total)}</span></div>${extra}`;
  };
  const t = data.totals;
  const eq = [];
  if (t.homeEquity != null) eq.push(`<div class="equity"><span>Home equity</span><span>${fmt(t.homeEquity)}</span></div>`);
  if (t.vehicleEquity != null) eq.push(`<div class="equity"><span>Car equity</span><span>${fmt(t.vehicleEquity)}</span></div>`);
  $('assetBars').innerHTML = draw(cats.filter((c) => c.kind === 'asset' && Math.abs(c.total) > 0.5).sort((a, b) => b.total - a.total), 'var(--s1)', 'Total assets', eq.join(''));
  $('debtBars').innerHTML = draw(cats.filter((c) => c.kind === 'liability' && Math.abs(c.total) > 0.5).sort((a, b) => a.total - b.total), 'var(--s2)', 'Total debts');
}

function renderCashFlow() {
  const el = $('cfChart');
  const months = data.cashFlow;
  $('cfLegend').innerHTML = months.length ? '<span><i class="sq" style="background:var(--s1)"></i>Money in</span><span><i class="sq" style="background:var(--s2)"></i>Money out</span>' : '';
  el.innerHTML = '';
  if (!months.length || !data.transactions.length) { $('cfLegend').innerHTML = ''; el.innerHTML = '<div class="empty">Bank and card transactions show up here after the first SimpleFIN sync.</div>'; return; }
  const W = Math.max(320, el.clientWidth || 800), H = 230, L = 56, R = 8, T = 10, B = 28;
  const max = Math.max(...months.flatMap((m) => [m.in, m.out]), 1);
  const ticks = niceTicks(0, max);
  const top = ticks[ticks.length - 1];
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Money in and out by month' }, el);
  for (const tv of ticks) {
    svg('line', { x1: L, x2: W - R, y1: y(tv), y2: y(tv), class: tv === 0 ? 'baseline' : 'gridline' }, root);
    svg('text', { x: L - 8, y: y(tv) + 4, 'text-anchor': 'end' }, root).textContent = compact(tv);
  }
  const slot = (W - L - R) / months.length;
  const bw = Math.max(4, Math.min(22, slot * 0.32));
  months.forEach((m, i) => {
    const cx = L + slot * (i + 0.5);
    const bar = (v, dx, color) => {
      const h = Math.max(0, y(0) - y(v));
      if (h < 0.5) return;
      const r = Math.min(4, bw / 2, h);
      const x0 = cx + dx, y0 = y(v);
      // Rounded top, square on the baseline.
      svg('path', { d: `M${x0},${y(0)}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${y(0)}Z`, fill: color }, root);
    };
    bar(m.in, -bw - 1, 'var(--s1)');
    bar(m.out, 1, 'var(--s2)');
    const every = Math.ceil(52 / slot);
    if (i % every === 0) svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, root).textContent = monthName(m.month);
    const hit = svg('rect', { x: L + slot * i, y: T, width: slot, height: H - T - B, fill: 'transparent' }, root);
    const tip = `<div class="t">${new Date(m.month + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
      <div class="r"><span><i style="background:var(--s1)"></i>In</span><b>${fmt(m.in)}</b></div>
      <div class="r"><span><i style="background:var(--s2)"></i>Out</span><b>${fmt(m.out)}</b></div>
      <div class="r"><span>Net</span><b class="${cls(m.net)}">${signed(m.net)}</b></div>`;
    hit.addEventListener('pointermove', (ev) => showTip(tip, ev));
    hit.addEventListener('pointerdown', (ev) => showTip(tip, ev));
    hit.addEventListener('pointerleave', hideTip);
  });
}

function categoryOptions(selected) {
  const groups = { asset: 'Assets', liability: 'Debts' };
  return Object.entries(groups).map(([kind, label]) => `<optgroup label="${label}">${data.categories.filter((c) => c.kind === kind)
    .map((c) => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
}

function renderAccounts() {
  const showHidden = $('showHidden').checked;
  const list = data.accounts.filter((a) => showHidden || !a.hidden);
  if (!list.length) { $('accounts').innerHTML = '<tr><td class="empty">No accounts yet.</td></tr>'; return; }
  let html = '<thead><tr><th>Account</th><th>Category</th><th class="num">Balance</th><th class="num">30 days</th><th>Updated</th><th></th></tr></thead><tbody>';
  let group = null;
  for (const a of list) {
    const label = data.categories.find((c) => c.id === a.category)?.label || a.category;
    if (label !== group) {
      group = label;
      const total = list.filter((b) => b.category === a.category && !b.hidden).reduce((s, b) => s + b.value, 0);
      html += `<tr class="group"><td colspan="2">${esc(label)}</td><td class="num">${fmt(total)}</td><td colspan="3"></td></tr>`;
    }
    const manual = a.source === 'manual';
    const priced = a.source === 'priced';
    html += `<tr class="${a.hidden ? 'hidden-row' : ''}" data-id="${esc(a.id)}">
      <td>${esc(a.name)}<span class="sub">${esc(a.org)}${priced ? ` · ${a.holdings.length} funds, priced daily` : ''}</span>${priced ? estimateNote(a) : ''}${a.indexStatus ? indexNote(a) : ''}</td>
      <td><select data-act="category" aria-label="Category for ${esc(a.name)}">${categoryOptions(a.category)}</select></td>
      <td class="num">${fmtCents(a.value)}</td>
      <td class="num ${cls(a.change30)}">${a.change30 == null ? '<span class="muted">–</span>' : signed(a.change30)}</td>
      <td class="small muted">${manual ? (a.indexStatus?.latestDate ? `Index ${periodLabel(a.indexStatus.latestDate, a.indexStatus)}` : 'You set it') : priced ? (a.status?.priceDate ? `Close ${shortDate(a.status.priceDate)}` : 'No price yet') : ago(a.balanceDate)}</td>
      <td class="num">
        ${manual ? '<button class="linkish" data-act="value">Update value</button> · ' : ''}
        ${manual && a.category === 'property' ? `<button class="linkish" data-act="index">${a.index ? 'Price index' : 'Follow home prices'}</button> · ` : ''}
        ${LOAN_CATS.has(a.category) ? `<button class="linkish" data-act="loan">${a.loan ? 'Loan details' : 'Add loan details'}</button> · ` : ''}
        ${priced ? '<button class="linkish" data-act="import">Import transactions</button> · <button class="linkish" data-act="editPriced">Edit holdings</button> · ' : ''}
        <button class="linkish" data-act="rename">Rename</button> ·
        <button class="linkish" data-act="hide">${a.hidden ? 'Show' : 'Hide'}</button>
        ${manual || priced ? ' · <button class="linkish" data-act="delete">Delete</button>' : ''}
      </td></tr>`;
  }
  $('accounts').innerHTML = html + '</tbody>';
}

// What part of a priced account is estimated, and how to make it exact.
function estimateNote(a) {
  const st = a.status || {};
  const est = st.estimates || [];
  const bits = [];
  const paid = est.filter((e) => e.kind === 'contribution');
  const payouts = est.filter((e) => e.kind !== 'contribution');
  if (paid.length) {
    const days = [...new Set(paid.map((e) => e.date))];
    bits.push(`${days.length} paycheck${days.length > 1 ? 's' : ''} (${fmt(paid.reduce((s, e) => s + e.amount, 0))})`);
  }
  if (payouts.length) bits.push(`${payouts.length} reinvested payout${payouts.length > 1 ? 's' : ''} (${fmt(payouts.reduce((s, e) => s + e.amount, 0))})`);
  if ((st.waiting || []).length) bits.push(`a paycheck on ${shortDate(st.waiting[0].date)} waiting for that day's price`);
  if (!bits.length) return `<span class="estimate">Exact through ${shortDate(st.estimatedSince || a.priced.asOf)}</span>`;
  return `<span class="estimate">Estimated since ${shortDate(st.estimatedSince)}: ${bits.join(', ')}</span>`;
}

function renderHoldings() {
  const h = data.holdings;
  $('holdingsCard').hidden = !h.length;
  if (!h.length) return;
  const share = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
  $('holdings').innerHTML = '<thead><tr><th>Holding</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th><th class="num">Gain</th></tr></thead><tbody>' +
    h.map((x) => `<tr><td><b>${esc(x.symbol || '')}</b> <span class="muted">${esc(x.description)}</span></td>
      <td class="num">${x.shares ? share.format(x.shares) : '<span class="muted">–</span>'}</td>
      <td class="num">${x.price ? fmtCents(x.price) : '<span class="muted">–</span>'}</td><td class="num">${fmt(x.value)}</td>
      <td class="num ${cls(x.gain)}">${x.gain == null ? '<span class="muted">–</span>' : signed(x.gain)}</td></tr>`).join('') + '</tbody>';
}

function renderTransactions() {
  const q = $('txFilter').value.trim().toLowerCase();
  const matches = data.transactions.filter((t) => !q || t.description.toLowerCase().includes(q) || t.account.toLowerCase().includes(q));
  const list = matches.slice(0, txShown);
  $('txMore').hidden = matches.length <= txShown;
  if (!list.length) { $('transactions').innerHTML = `<tr><td class="empty">${q ? 'Nothing matches.' : 'No transactions yet.'}</td></tr>`; return; }
  $('transactions').innerHTML = '<thead><tr><th>Date</th><th>Description</th><th>Account</th><th class="num">Amount</th></tr></thead><tbody>' +
    list.map((t) => `<tr><td class="small">${shortDate(t.date)}</td>
      <td>${esc(t.description)}${t.pending ? '<span class="pending">pending</span>' : ''}${t.transfer ? '<span class="pending">transfer</span>' : ''}</td>
      <td class="small muted">${esc(t.account)}</td>
      <td class="num ${t.amount > 0 ? 'up' : ''}">${t.amount > 0 ? '+' : ''}${fmtCents(t.amount)}</td></tr>`).join('') + '</tbody>';
}

// ---------- tooltip ----------

function showTip(html, ev) {
  const tip = $('tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = ev.clientX + 14, top = ev.clientY + 14;
  if (left + r.width > innerWidth - 8) left = ev.clientX - r.width - 14;
  if (top + r.height > innerHeight - 8) top = ev.clientY - r.height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
function hideTip() { $('tooltip').hidden = true; }

// ---------- actions ----------

async function act(fn) {
  try { await fn(); await load(); } catch (err) { alert(err.message); }
}

$('range').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  rangeDays = Number(b.dataset.days);
  for (const x of $('range').children) x.classList.toggle('on', x === b);
  renderNetWorthChart();
});

$('syncBtn').addEventListener('click', async () => {
  const b = $('syncBtn');
  b.disabled = true; b.textContent = 'Syncing…';
  await act(() => post('/api/sync'));
  b.disabled = false; b.textContent = 'Sync now';
});

$('setupForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const b = ev.submitter || ev.target.querySelector('button');
  b.disabled = true; b.textContent = 'Connecting…';
  await act(() => post('/api/setup', { token: $('token').value }));
  b.disabled = false; b.textContent = 'Connect';
});

// ---------- home value following a price index ----------

// "Don't adjust", the US, every state, and any other FRED series.
function indexOptions(selected, { none = "Don't adjust it" } = {}) {
  const known = selected === 'USSTHPI' || /^[A-Z]{2}STHPI$/.test(selected || '') && STATES[selected.slice(0, 2)];
  const opts = [['', none], ['USSTHPI', 'US home prices'], ...Object.entries(STATES).map(([code, name]) => [`${code}STHPI`, `${name} home prices`]), ['other', 'Another FRED series…']];
  const pick = !selected ? '' : known ? selected : 'other';
  return opts.map(([v, l]) => `<option value="${v}"${v === pick ? ' selected' : ''}>${esc(l)}</option>`).join('');
}
// An index observation's period: a quarter, or a year for a yearly (county) series.
function periodLabel(date, st) {
  const [y, m] = date.split('-').map(Number);
  return /\(yearly\)/.test(st?.label || '') ? String(y) : `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}
function indexNote(a) {
  const st = a.indexStatus;
  const pct = `${st.change >= 0 ? '+' : '−'}${Math.abs(st.change * 100).toFixed(1)}%`;
  return `<span class="index-note">Follows ${esc(st.label.replace(/ \((quarterly|yearly)\)$/, ''))}: <span class="${cls(st.change * 1000)}">${pct}</span> since you set it (${periodLabel(st.since, st)} index)</span>`;
}

function syncManualIndex() {
  const isHome = $('mCat').value === 'property';
  $('mIndex').hidden = !isHome;
  $('mIndexCustom').hidden = !isHome || $('mIndex').value !== 'other';
}

$('addManualBtn').addEventListener('click', () => {
  const f = $('manualForm');
  f.hidden = !f.hidden;
  if (!f.hidden) {
    $('mCat').innerHTML = categoryOptions('property');
    $('mIndex').innerHTML = indexOptions('', { none: "Don't follow home prices" });
    syncManualIndex();
    $('mName').focus();
  }
});
$('mCat').addEventListener('change', syncManualIndex);
$('mIndex').addEventListener('change', syncManualIndex);
$('manualForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const sel = $('mCat').value === 'property' ? $('mIndex').value : '';
  const index = sel === 'other' ? $('mIndexCustom').value.trim() : sel;
  act(async () => {
    await post('/api/manual', { name: $('mName').value, category: $('mCat').value, value: $('mValue').value, index: index || null });
    $('manualForm').reset(); $('manualForm').hidden = true;
  });
});

let indexAccount = null;
function openIndex(a) {
  indexAccount = a;
  $('indexTitle').textContent = `${a.name}: follow home prices`;
  $('ixSelect').innerHTML = indexOptions(a.index?.series || '');
  $('ixCustom').value = a.index && $('ixSelect').value === 'other' ? a.index.series : '';
  $('ixCustomWrap').hidden = $('ixSelect').value !== 'other';
  $('ixError').textContent = '';
  $('indexDlg').showModal();
}
$('ixSelect').addEventListener('change', () => { $('ixCustomWrap').hidden = $('ixSelect').value !== 'other'; });
$('ixCancel').addEventListener('click', () => $('indexDlg').close());
$('indexForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const sel = $('ixSelect').value;
  const series = sel === 'other' ? $('ixCustom').value.trim() : sel;
  if (sel === 'other' && !series) { $('ixError').textContent = 'Enter a FRED series id.'; return; }
  const btn = $('ixSave');
  btn.disabled = true; btn.textContent = 'Checking the index…';
  try {
    await api(`/api/accounts/${encodeURIComponent(indexAccount.id)}/index`, { method: 'PUT', body: JSON.stringify({ series: series || null }) });
    $('indexDlg').close();
    await load();
  } catch (err) { $('ixError').textContent = err.message; } finally { btn.disabled = false; btn.textContent = 'Save'; }
});

$('accounts').addEventListener('change', (ev) => {
  const sel = ev.target.closest('select[data-act="category"]');
  if (!sel) return;
  const id = sel.closest('tr').dataset.id;
  act(() => patch(`/api/accounts/${encodeURIComponent(id)}`, { category: sel.value }));
});
$('accounts').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('tr').dataset.id;
  const a = data.accounts.find((x) => x.id === id);
  const path = `/api/accounts/${encodeURIComponent(id)}`;
  if (b.dataset.act === 'hide') act(() => patch(path, { hidden: !a.hidden }));
  if (b.dataset.act === 'rename') {
    const name = prompt('Name to show (leave empty for the bank\'s name)', a.displayName || a.name);
    if (name !== null) act(() => patch(path, { displayName: name }));
  }
  if (b.dataset.act === 'value') {
    const v = prompt(`New value for ${a.name}`, Math.abs(a.balance));
    if (v !== null && v.trim() !== '') act(() => patch(path, { balance: Number(v.replace(/[$,\s]/g, '')) }));
  }
  if (b.dataset.act === 'loan') openLoan(a);
  if (b.dataset.act === 'index') openIndex(a);
  if (b.dataset.act === 'editPriced') openPriced(a);
  if (b.dataset.act === 'import') { importTarget = a; $('importFile').value = ''; $('importFile').click(); }
  if (b.dataset.act === 'delete' && confirm(`Delete ${a.name} and its history?`)) act(() => api(path, { method: 'DELETE' }));
});
$('showHidden').addEventListener('change', renderAccounts);
$('txFilter').addEventListener('input', () => { txShown = 25; renderTransactions(); });
$('txMore').addEventListener('click', () => { txShown += 50; renderTransactions(); });

$('settingsBtn').addEventListener('click', () => { $('syncHours').value = data?.syncHours || 6; $('settings').showModal(); });
$('settingsForm').addEventListener('submit', (ev) => {
  if (ev.submitter?.value === 'save') act(() => post('/api/settings', { syncHours: Number($('syncHours').value) }));
});
$('disconnectBtn').addEventListener('click', () => {
  if (confirm('Disconnect SimpleFIN? Syncing stops until you paste a new setup token.')) { $('settings').close(); act(() => post('/api/disconnect')); }
});

// ---------- loans: payoff, interest vs principal, extra payments ----------

const LOAN_CATS = new Set(['mortgage', 'autoLoan', 'studentLoan', 'otherDebt']);
const whatIf = loadWhatIf();   // { accountId: { extra, lump } }, remembered in this browser
const schedOpen = new Set();   // loans whose yearly schedule is open

function loadWhatIf() { try { return JSON.parse(localStorage.getItem('fintrack.whatIf') || '{}'); } catch { return {}; } }
function saveWhatIf() { try { localStorage.setItem('fintrack.whatIf', JSON.stringify(whatIf)); } catch { /* private window */ } }

const monthLabel = (ym) => (ym ? new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '–');
function span(months) {
  if (!Number.isFinite(months)) return 'never';
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || '0 months';
}

function renderLoans() {
  const el = $('loans');
  const missing = data.accounts.filter((a) => !a.hidden && a.category === 'mortgage' && !a.loan);
  el.innerHTML = missing.map((a) => `<section class="card loan-prompt" data-id="${esc(a.id)}">
      <div><h2>${esc(a.name)} <span class="muted small">${esc(a.org)}</span></h2>
      <span class="muted">Add the rate, payment and escrow to see the payoff date, interest vs principal, and what paying more would save.</span></div>
      <button type="button" data-act="loan">Add loan details</button></section>`).join('')
    + data.loans.map((l) => `<section class="card loan-card" data-id="${esc(l.id)}"></section>`).join('');
  for (const l of data.loans) drawLoan(el.querySelector(`.loan-card[data-id="${CSS.escape(l.id)}"]`), l);
}

function drawLoan(card, l) {
  const w = whatIf[l.id] || { extra: 0, lump: 0 };
  const np = l.nextPayment;
  const total = np.interest + np.principal + (np.extra || 0) || 1;
  const req = l.required;
  const extra = req && req.extra > 0.005 ? req.extra : 0;
  const maxExtra = Math.max(2000, Math.ceil(l.payment / 500) * 500);
  card.innerHTML = `
    <div class="card-head">
      <h2>${esc(l.name)} <span class="muted small">${esc(l.org)} · ${l.rate}%</span></h2>
      <button type="button" class="ghost" data-act="loan">Loan details</button>
    </div>
    ${l.warnings.map((x) => `<div class="notice loan-warn">${esc(x)}</div>`).join('')}
    <div class="loan-tiles">
      <div class="tile"><div class="label">Left to pay</div><div class="v">${fmt(l.balance)}</div><div class="s">${l.loan.original ? `${Math.round((1 - l.balance / l.loan.original) * 100)}% of ${fmt(l.loan.original)} paid off` : 'Principal, from your lender'}</div></div>
      <div class="tile"><div class="label">Monthly payment</div><div class="v">${fmtCents(l.payment)}</div><div class="s">${
        extra ? `${fmtCents(req.payment)} due + ${fmtCents(extra)} extra<br>Due: ${fmtCents(req.pi)} loan${l.escrow > 0 ? ` + ${fmtCents(l.escrow)} escrow` : ''}`
        : l.escrow > 0 ? `${fmtCents(l.pi)} loan + ${fmtCents(l.escrow)} escrow` : 'All of it goes to the loan'}</div></div>
      <div class="tile"><div class="label">Next payment (${monthLabel(np.month)})</div>
        <div class="split" role="img" aria-label="Interest ${fmtCents(np.interest)}, principal ${fmtCents(np.principal)}${np.extra ? `, extra principal ${fmtCents(np.extra)}` : ''}">
          <span style="width:${(np.interest / total) * 100}%;background:var(--s2)"></span><span style="width:${(np.principal / total) * 100}%;background:var(--s1)"></span>${np.extra ? `<span style="width:${(np.extra / total) * 100}%;background:var(--s3)"></span>` : ''}</div>
        <div class="split-key"><span><i style="background:var(--s2)"></i>Interest ${fmtCents(np.interest)}</span><span><i style="background:var(--s1)"></i>Principal ${fmtCents(np.principal)}</span>${np.extra ? `<span><i style="background:var(--s3)"></i>Extra ${fmtCents(np.extra)}</span>` : ''}</div></div>
      <div class="tile"><div class="label">Paid off</div><div class="v">${l.never ? 'Never' : monthLabel(l.payoffMonth)}</div><div class="s">${l.never ? 'The payment is too small' : `${span(l.monthsLeft)} left · ${fmt(l.interestLeft)} interest to go`}</div></div>
    </div>
    ${extra && req.minimum && !req.minimum.never && req.monthsSooner != null ? `<p class="small">Your extra ${fmtCents(extra)} a month pays it off <b class="up">${span(req.monthsSooner)} sooner</b> than the required payment alone (${monthLabel(req.minimum.payoffMonth)}), saving <b class="up">${fmt(req.interestSaved)}</b> in interest.</p>` : ''}
    ${l.scheduled?.payoffMonth ? `<p class="small muted">Original schedule: ${fmtCents(l.scheduled.pi)} principal and interest, paid off ${monthLabel(l.scheduled.payoffMonth)}.${!l.never && l.payoffMonth < l.scheduled.payoffMonth ? ` You're ahead of it by ${span(monthsBetween(l.payoffMonth, l.scheduled.payoffMonth))}.` : ''}</p>` : ''}

    <div class="whatif">
      <h3>What if you paid more?</h3>
      <div class="whatif-controls">
        <label for="x-${esc(l.id)}">More than your ${fmtCents(l.payment)} each month</label><span></span>
        <input type="range" id="x-${esc(l.id)}" class="extra-range" min="0" max="${maxExtra}" step="25" value="${w.extra}">
        <input type="number" class="extra-num" min="0" step="25" value="${w.extra}" aria-label="Extra each month in dollars">
        <label>One-time payment now</label>
        <input type="number" class="lump-num" min="0" step="100" value="${w.lump || ''}" placeholder="$0" aria-label="One-time payment in dollars">
      </div>
      <div class="whatif-result" aria-live="polite"></div>
      <div class="legend"><span><i style="background:var(--s1)"></i>Current payment</span><span class="more-key"><i style="background:var(--s3)"></i>Paying more</span></div>
      <div class="chart loan-chart"></div>
    </div>

    <div class="ytd">
      <h3>${new Date().getFullYear()} so far (${l.ytd.payments} payment${l.ytd.payments === 1 ? '' : 's'})</h3>
      <div class="ytd-row">
        <div>Interest<b>${fmtCents(l.ytd.interest)}</b></div>
        <div>Principal<b>${fmtCents(l.ytd.principal)}</b></div>
        ${l.escrow > 0 ? `<div>Escrow<b>${fmtCents(l.ytd.escrow)}</b></div>` : ''}
      </div>
      <p class="small muted">${l.ytd.estimated ? `Estimated from your rate, payment and today's balance, assuming the regular payment each month. FinTrack will use your real balances once it has tracked this loan since January 1.` : 'From your balances and the payments your lender reports.'}${l.category === 'mortgage' ? " Your lender's Form 1098 has the exact interest for taxes." : ''}</p>
    </div>

    <details class="sched"><summary>Year-by-year schedule</summary><div class="table-wrap"><table class="sched-table"></table></div></details>`;

  const update = () => {
    const extra = Math.max(0, Number(card.querySelector('.extra-num').value) || 0);
    const lump = Math.max(0, Number(card.querySelector('.lump-num').value) || 0);
    whatIf[l.id] = { extra, lump }; saveWhatIf();
    const c = compare(l.balance, l.loan, { extra, lump, startMonth: l.nextPayment.month });
    const changed = extra > 0 || lump > 0;
    const res = card.querySelector('.whatif-result');
    if (!changed) res.innerHTML = '<span class="muted">Move the slider or enter a one-time payment to see how much sooner the loan is paid off and how much interest you save.</span>';
    else if (c.more.never) res.innerHTML = '<span class="down">Even with that, the payment doesn\'t cover the interest.</span>';
    else res.innerHTML = `${extra ? `Paying <b>${fmtCents(l.payment + extra)}</b> a month` : 'With that payment'}${extra && lump ? ` and ${fmt(lump)} now` : ''}: paid off <b>${monthLabel(c.more.lastMonth)}</b>, ${c.base.never ? '' : `<b class="up">${span(c.monthsSooner)} sooner</b>, `}saving <b class="up">${fmt(c.interestSaved ?? 0)}</b> in interest.`;
    card.querySelector('.more-key').hidden = !changed;
    loanChart(card.querySelector('.loan-chart'), c, changed);
    const yrs = byYear((changed ? c.more : c.base).rows);
    card.querySelector('.sched-table').innerHTML = '<thead><tr><th>Year</th><th class="num">Paid to loan</th><th class="num">Interest</th><th class="num">Principal</th><th class="num">Balance at end</th></tr></thead><tbody>'
      + yrs.map((y) => `<tr><td>${y.year}</td><td class="num">${fmt(y.paid)}</td><td class="num">${fmt(y.interest)}</td><td class="num">${fmt(y.principal)}</td><td class="num">${fmt(y.endBalance)}</td></tr>`).join('') + '</tbody>';
    card.querySelector('.sched summary').textContent = `Year-by-year schedule${changed ? ', paying more' : ''}`;
  };
  card.redraw = update;
  const sched = card.querySelector('details.sched');
  sched.open = schedOpen.has(l.id);
  sched.addEventListener('toggle', () => { if (sched.open) schedOpen.add(l.id); else schedOpen.delete(l.id); });
  const range = card.querySelector('.extra-range'), num = card.querySelector('.extra-num');
  range.addEventListener('input', () => { num.value = range.value; update(); });
  num.addEventListener('input', () => { range.value = Math.min(Number(num.value) || 0, maxExtra); update(); });
  card.querySelector('.lump-num').addEventListener('input', update);
  update();
}

function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

// Balance over time: the current plan and, when changed, paying more.
function loanChart(el, c, showMore) {
  el.innerHTML = '';
  const base = c.base.rows, more = showMore ? c.more.rows : [];
  if (!base.length) return;
  const n = Math.max(base.length, more.length);
  const W = Math.max(320, el.clientWidth || 800), H = 220, L = 60, R = 12, T = 10, B = 26;
  const top = niceTicks(0, base[0].balance + base[0].principal).at(-1);
  const ticks = niceTicks(0, top);
  const x = (i) => L + (i / Math.max(1, n)) * (W - L - R);
  const y = (v) => T + (1 - v / ticks.at(-1)) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Loan balance until ${monthLabel(c.base.lastMonth)}` }, el);
  for (const tv of ticks) {
    svg('line', { x1: L, x2: W - R, y1: y(tv), y2: y(tv), class: tv === 0 ? 'baseline' : 'gridline' }, root);
    svg('text', { x: L - 8, y: y(tv) + 4, 'text-anchor': 'end' }, root).textContent = compact(tv);
  }
  const firstYear = Number(base[0].month.slice(0, 4));
  const lastYear = Number(base.at(-1).month.slice(0, 4));
  const stepY = Math.max(1, Math.ceil((lastYear - firstYear) / Math.max(2, Math.floor((W - L) / 70))));
  for (let yr = firstYear + 1; yr <= lastYear; yr += stepY) {
    const i = base.findIndex((r) => r.month === `${yr}-01`);
    if (i > 0) svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, root).textContent = yr;
  }
  const start = { balance: base[0].balance + base[0].principal };
  const path = (rows) => [start, ...rows].map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.balance).toFixed(1)}`).join('');
  svg('path', { d: path(base), fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, root);
  if (more.length) svg('path', { d: path(more), fill: 'none', stroke: 'var(--s3)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, root);
  const cross = svg('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }, root);
  const hit = svg('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' }, root);
  const move = (ev) => {
    const box = root.getBoundingClientRect();
    const i = Math.max(1, Math.min(n, Math.round((((ev.clientX - box.left) / box.width) * W - L) / (W - L - R) * n)));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    const b = base[i - 1], m = more[i - 1];
    const month = (b || m).month;
    showTip(`<div class="t">${monthLabel(month)}</div>
      <div class="r"><span><i style="background:var(--s1)"></i>Current payment</span><b>${b ? fmt(b.balance) : 'Paid off'}</b></div>
      ${more.length ? `<div class="r"><span><i style="background:var(--s3)"></i>Paying more</span><b>${m ? fmt(m.balance) : 'Paid off'}</b></div>` : ''}`, ev);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
}

let loanAccount = null;

function openLoan(a) {
  loanAccount = a;
  const ln = a.loan || {};
  $('loanTitle').textContent = `${a.name}: loan details`;
  $('lRate').value = ln.rate ?? '';
  $('lPayment').value = ln.payment ?? '';
  $('lRequired').value = ln.required ?? '';
  $('lEscrow').value = ln.escrow ?? '';
  // Only a mortgage has escrow (taxes and insurance paid through the lender).
  const hasEscrow = a.category === 'mortgage';
  $('lEscrowWrap').hidden = !hasEscrow;
  $('lEscrowNote').hidden = !hasEscrow;
  $('lOriginal').value = ln.original ?? '';
  $('lTerm').value = ln.termYears ?? '';
  $('lFirst').value = ln.firstPayment ?? '';
  $('lRemove').hidden = !a.loan;
  $('lError').textContent = '';
  loanHelp();
  $('loanDlg').showModal();
}

// With the original loan filled in, say what the escrow probably is.
function loanHelp() {
  const num = (id) => Number(String($(id).value).replace(/[$,%\s]/g, ''));
  // The escrow is in the required payment; anything over it is extra principal, not escrow.
  const rate = num('lRate'), original = num('lOriginal'), term = num('lTerm'), payment = num('lRequired') || num('lPayment');
  const help = $('lHelp');
  const hasEscrow = loanAccount?.category === 'mortgage';
  if (!(rate >= 0 && original > 0 && term > 0)) { help.innerHTML = `<span class="muted">With these, FinTrack shows your original payoff date${hasEscrow ? ', and can work out the escrow from your payment' : ''}.</span>`; return; }
  const pi = scheduledPayment(original, rate, Math.round(term * 12));
  if (!hasEscrow) {
    const over = payment - pi;
    help.innerHTML = `Scheduled payment: <b>${fmtCents(pi)}</b>.${over >= 1 ? ` You pay ${fmtCents(over)} more than that each month, which goes to principal.` : ''}`;
    return;
  }
  const guess = payment > pi ? Math.round((payment - pi) * 100) / 100 : null;
  help.innerHTML = `Scheduled principal and interest: <b>${fmtCents(pi)}</b>.${guess != null ? ` So escrow is probably about <b>${fmtCents(guess)}</b> <button type="button" class="linkish" id="lUseGuess">Use it</button>` : ''}`;
  $('lUseGuess')?.addEventListener('click', () => { $('lEscrow').value = guess; });
}

$('loanForm').addEventListener('input', loanHelp);
$('lCancel').addEventListener('click', () => $('loanDlg').close());
$('lRemove').addEventListener('click', async () => {
  if (!confirm('Remove the loan details? The balance keeps syncing.')) return;
  await act(() => api(`/api/accounts/${encodeURIComponent(loanAccount.id)}/loan`, { method: 'PUT', body: JSON.stringify({ loan: null }) }));
  $('loanDlg').close();
});
$('loanForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const loan = { rate: $('lRate').value, payment: $('lPayment').value, required: $('lRequired').value, escrow: loanAccount.category === 'mortgage' ? $('lEscrow').value : 0, original: $('lOriginal').value, termYears: $('lTerm').value, firstPayment: $('lFirst').value };
  try {
    await api(`/api/accounts/${encodeURIComponent(loanAccount.id)}/loan`, { method: 'PUT', body: JSON.stringify({ loan }) });
    $('loanDlg').close();
    await load();
  } catch (err) { $('lError').textContent = err.message; }
});
$('loans').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act="loan"]');
  if (!b) return;
  const a = data.accounts.find((x) => x.id === b.closest('[data-id]').dataset.id);
  if (a) openLoan(a);
});

// ---------- 401(k) by holdings ----------

let editing = null;      // the priced account being edited, or null for a new one
let importTarget = null;
let pendingCsv = null;   // { csv, filename } picked in the form, imported on save

function prevBusinessDay() {
  const d = new Date();
  do d.setDate(d.getDate() - 1); while ([0, 6].includes(d.getDay()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addRow(r = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="t" placeholder="MDFGX" value="${esc(r.ticker || '')}" aria-label="Ticker"></td>
    <td><input class="n" placeholder="Fund name (optional)" value="${esc(r.name || '')}" aria-label="Fund name"></td>
    <td class="num"><input class="a" type="number" step="any" min="0" value="${r.amount ?? ''}" aria-label="Value or shares"></td>
    <td class="num"><input class="p" type="number" step="0.1" min="0" max="100" value="${r.pct ?? ''}" aria-label="Percent of future contributions"></td>
    <td><button type="button" class="linkish" data-rm aria-label="Remove fund">Remove</button></td>`;
  $('pRows').appendChild(tr);
}

function formRows() {
  return [...$('pRows').querySelectorAll('tr')].map((tr) => ({
    ticker: tr.querySelector('.t').value.trim().toUpperCase(),
    name: tr.querySelector('.n').value.trim(),
    amount: tr.querySelector('.a').value,
    pct: Number(tr.querySelector('.p').value) || 0,
  })).filter((r) => r.ticker);
}

function updateTotals() {
  const rows = formRows();
  const mode = $('pMode').value;
  $('pAmountHead').textContent = mode === 'shares' ? 'Shares' : 'Value';
  $('pTotal').textContent = mode === 'shares' ? '' : `Total ${fmtCents(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))}`;
  const pct = rows.reduce((s, r) => s + r.pct, 0);
  $('pPctTotal').innerHTML = `<span class="${Math.abs(pct - 100) < 0.5 || !$('pPlanOn').checked ? '' : 'down'}">${Math.round(pct * 10) / 10}%</span>`;
  const every = $('pEvery').value;
  $('pDayWrap').hidden = every !== 'monthDay';
  $('pAnchorWrap').hidden = !['2weeks', 'week'].includes(every);
  $('pPlan').querySelectorAll('input, select').forEach((el) => { el.disabled = !$('pPlanOn').checked; });
}

function openPriced(a = null) {
  editing = a;
  pendingCsv = null;
  $('pricedForm').reset();
  $('pError').textContent = '';
  $('pCsvNote').textContent = '';
  $('pCsvName').textContent = 'No file chosen';
  $('pRows').innerHTML = '';
  $('pricedTitle').textContent = a ? `Edit ${a.name}` : 'Add a 401(k) by holdings';
  if (a) {
    const pr = a.priced;
    $('pName').value = a.name; $('pOrg').value = a.org;
    // Editing starts from today's numbers: the current shares, as of the last close.
    $('pAsOf').value = a.status?.priceDate || pr.asOf;
    $('pMode').value = 'shares';
    for (const h of a.holdings) addRow({ ticker: h.symbol, name: h.description, amount: h.shares, pct: pr.plan.allocation?.[h.symbol] ?? '' });
    $('pPlanOn').checked = pr.plan.enabled;
    $('pAmount').value = pr.plan.amount || '';
    const sc = pr.plan.schedule || {};
    $('pEvery').value = sc.every === 'month' ? (sc.day === 'lastBusiness' ? 'lastBusiness' : 'monthDay') : sc.every || 'lastBusiness';
    if (sc.every === 'month' && sc.day !== 'lastBusiness') $('pDay').value = sc.day;
    if (sc.anchor) $('pAnchor').value = sc.anchor;
    $('pLag').value = sc.lag ?? 0;
  } else {
    $('pAsOf').value = prevBusinessDay();
    for (let i = 0; i < 3; i++) addRow();
  }
  updateTotals();
  $('pricedDlg').showModal();
}

$('addPricedBtn').addEventListener('click', () => openPriced());
$('pCancel').addEventListener('click', () => $('pricedDlg').close());
$('pAddRow').addEventListener('click', () => { addRow(); updateTotals(); });
$('pRows').addEventListener('click', (ev) => { if (ev.target.closest('[data-rm]')) { ev.target.closest('tr').remove(); updateTotals(); } });
$('pricedForm').addEventListener('input', updateTotals);
$('pricedForm').addEventListener('change', updateTotals);

$('pCsv').addEventListener('change', async () => {
  const f = $('pCsv').files[0];
  $('pCsvName').textContent = f ? f.name : 'No file chosen';
  if (!f) return;
  try {
    const csv = await f.text();
    const r = await post('/api/priced/parse-csv', { csv, filename: f.name });
    pendingCsv = { csv, filename: f.name };
    const s = r.suggestion;
    if (!s) { $('pCsvNote').textContent = `Read ${r.rows.length} transactions; none were contributions, so nothing to fill in.`; return; }
    const keep = Object.fromEntries(formRows().map((x) => [x.ticker, x]));
    $('pRows').innerHTML = '';
    for (const [t, pct] of Object.entries(s.allocation)) addRow({ ticker: t, name: s.names[t] || keep[t]?.name || '', amount: keep[t]?.amount ?? '', pct });
    $('pAmount').value = s.amount;
    $('pPlanOn').checked = true;
    updateTotals();
    $('pCsvNote').innerHTML = `<span class="ok-note">Filled in ${Object.keys(s.allocation).length} funds and a ${fmtCents(s.amount)} contribution from ${shortDate(s.date)}.</span> Now enter what each fund is worth. The file's transactions are saved too.`;
  } catch (err) {
    pendingCsv = null;
    $('pCsvNote').innerHTML = `<span class="down">${esc(err.message)}</span>`;
  }
});

$('pricedForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const rows = formRows();
  const every = $('pEvery').value;
  const body = {
    name: $('pName').value, org: $('pOrg').value, category: 'retirement',
    asOf: $('pAsOf').value, mode: $('pMode').value,
    rows: rows.map((r) => ({ ticker: r.ticker, name: r.name, amount: r.amount })),
    plan: {
      enabled: $('pPlanOn').checked,
      amount: Number($('pAmount').value) || 0,
      allocation: Object.fromEntries(rows.filter((r) => r.pct > 0).map((r) => [r.ticker, r.pct])),
      schedule: every === 'lastBusiness' ? { every: 'month', day: 'lastBusiness', lag: Number($('pLag').value) }
        : every === 'monthDay' ? { every: 'month', day: Number($('pDay').value), lag: Number($('pLag').value) }
        : { every, anchor: $('pAnchor').value, lag: Number($('pLag').value) },
    },
    ...(pendingCsv && !editing ? pendingCsv : {}),
  };
  const btn = $('pSave');
  btn.disabled = true; btn.textContent = 'Looking up prices…';
  $('pError').textContent = '';
  try {
    if (editing) {
      await api(`/api/priced/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: JSON.stringify(body) });
      if (pendingCsv) await post(`/api/priced/${encodeURIComponent(editing.id)}/import`, pendingCsv);
    } else await post('/api/priced', body);
    $('pricedDlg').close();
    await load();
  } catch (err) {
    $('pError').textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
});

$('importFile').addEventListener('change', async () => {
  const f = $('importFile').files[0];
  if (!f || !importTarget) return;
  try {
    const r = await post(`/api/priced/${encodeURIComponent(importTarget.id)}/import`, { csv: await f.text(), filename: f.name });
    alert(`Added ${r.added} transaction${r.added === 1 ? '' : 's'}${r.alreadyCounted ? ` (${r.alreadyCounted} dated ${shortDate(importTarget.priced.asOf)} or earlier were already in your share counts)` : ''}. Exact through ${shortDate(r.coveredUntil)}.`);
    await load();
  } catch (err) { alert(err.message); }
});

let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => data && (renderNetWorthChart(), renderCashFlow(), document.querySelectorAll('.loan-card').forEach((c) => c.redraw?.())), 150); });
setInterval(load, 5 * 60 * 1000);
load();
