// FinTrack dashboard. Fetches /api/summary and draws everything; no libraries.

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
  $('syncBtn').hidden = !data.connected;
  $('syncStatus').textContent = data.demo ? 'Made-up accounts' : data.connected ? `Synced ${ago(data.lastSync)}` : 'Not connected';

  $('notices').innerHTML = (data.errors || []).map((e) => `<div class="notice"><b>SimpleFIN:</b> ${esc(e)}</div>`).join('');

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
  if (!months.length) { el.innerHTML = '<div class="empty">Transactions appear after the first sync.</div>'; return; }
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
    html += `<tr class="${a.hidden ? 'hidden-row' : ''}" data-id="${esc(a.id)}">
      <td>${esc(a.name)}<span class="sub">${esc(a.org)}</span></td>
      <td><select data-act="category" aria-label="Category for ${esc(a.name)}">${categoryOptions(a.category)}</select></td>
      <td class="num">${fmtCents(a.value)}</td>
      <td class="num ${cls(a.change30)}">${a.change30 == null ? '<span class="muted">–</span>' : signed(a.change30)}</td>
      <td class="small muted">${manual ? 'You set it' : ago(a.balanceDate)}</td>
      <td class="num">
        ${manual ? '<button class="linkish" data-act="value">Update value</button> · ' : ''}
        <button class="linkish" data-act="rename">Rename</button> ·
        <button class="linkish" data-act="hide">${a.hidden ? 'Show' : 'Hide'}</button>
        ${manual ? ' · <button class="linkish" data-act="delete">Delete</button>' : ''}
      </td></tr>`;
  }
  $('accounts').innerHTML = html + '</tbody>';
}

function renderHoldings() {
  const h = data.holdings;
  $('holdingsCard').hidden = !h.length;
  if (!h.length) return;
  $('holdings').innerHTML = '<thead><tr><th>Holding</th><th class="num">Value</th><th class="num">Gain</th></tr></thead><tbody>' +
    h.map((x) => `<tr><td><b>${esc(x.symbol || '')}</b> <span class="muted">${esc(x.description)}</span></td><td class="num">${fmt(x.value)}</td>
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

$('addManualBtn').addEventListener('click', () => {
  const f = $('manualForm');
  f.hidden = !f.hidden;
  if (!f.hidden) { $('mCat').innerHTML = categoryOptions('property'); $('mName').focus(); }
});
$('manualForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  act(async () => {
    await post('/api/manual', { name: $('mName').value, category: $('mCat').value, value: $('mValue').value });
    $('manualForm').reset(); $('manualForm').hidden = true;
  });
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

let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => data && (renderNetWorthChart(), renderCashFlow()), 150); });
setInterval(load, 5 * 60 * 1000);
load();
