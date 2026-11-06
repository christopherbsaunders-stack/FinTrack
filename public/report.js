// The advisor report: everything on the dashboard as a printable summary.

const $ = (id) => document.getElementById(id);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdC = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt = (n) => (n == null ? '–' : usd.format(n));
const cents = (n) => (n == null ? '–' : usdC.format(n));
const pct = (x, d = 1) => (x == null ? '–' : `${(x * 100).toFixed(d)}%`);
const signed = (n) => (n == null ? '–' : `${n >= 0 ? '+' : '−'}${usd.format(Math.abs(n))}`);
const cls = (n) => (n == null || Math.abs(n) < 0.5 ? '' : n > 0 ? 'up' : 'down');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '–');
const month = (ym) => (ym ? new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '–');
function span(m) {
  if (!Number.isFinite(m)) return 'never';
  const y = Math.floor(m / 12), r = m % 12;
  return [y ? `${y} yr` : '', r ? `${r} mo` : ''].filter(Boolean).join(' ') || '0 mo';
}

const CSVS = { accounts: 'Accounts', holdings: 'Holdings', loans: 'Loans', cashflow: 'Cash flow', history: 'Net worth history' };
$('csvLinks').innerHTML = Object.entries(CSVS).map(([k, v]) => `<a href="/api/export/${k}.csv">${v}</a>`).join(' · ');

let data;
async function load() {
  const res = await fetch('/api/summary');
  data = await res.json();
  $('rName').value = data.report?.name || '';
  $('rNotes').value = data.report?.notes || '';
  render();
}

// Name and notes save as you type (and print with the report).
let saveTimer;
for (const id of ['rName', 'rNotes']) {
  $(id).addEventListener('input', () => {
    data.report = { name: $('rName').value, notes: $('rNotes').value };
    render();
    clearTimeout(saveTimer);
    $('saveState').textContent = '';
    saveTimer = setTimeout(async () => {
      try {
        const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportName: $('rName').value, reportNotes: $('rNotes').value }) });
        $('saveState').textContent = r.ok ? 'Saved.' : 'Not saved.';
      } catch { $('saveState').textContent = 'Not saved.'; }
    }, 600);
  });
}
$('printBtn').addEventListener('click', () => window.print());

function render() {
  const t = data.totals;
  const visible = data.accounts.filter((a) => !a.hidden);
  const caveats = [];
  const parts = [];

  parts.push(`<header class="doc">
    <div><h1>Financial summary</h1>${data.report?.name ? `<div style="font-size:15px;margin-top:4px">${esc(data.report.name)}</div>` : ''}</div>
    <div class="small muted" style="text-align:right">As of ${date(data.generatedAt)}<br>Bank data last synced ${date(data.lastSync)}</div>
  </header>`);

  // ----- at a glance -----
  const figs = [
    ['Net worth', fmt(t.netWorth), [t.change30 != null ? `${signed(t.change30)} in 30 days` : '', t.change365 != null ? `${signed(t.change365)} in a year` : ''].filter(Boolean).join(' · '), true],
    ['Total assets', fmt(t.assets), ''],
    ['Total debts', fmt(t.liabilities), t.debtToAsset != null ? `${pct(t.debtToAsset, 0)} of assets` : ''],
    ['Cash', fmt(t.cash), 'Checking and savings'],
    ['Invested', fmt(t.invested), `${fmt(t.retirement)} in retirement accounts`],
  ];
  if (t.homeEquity != null) figs.push(['Home equity', fmt(t.homeEquity), 'Home value minus mortgage']);
  const g = data.budget || {};
  if (g.monthlyIncome) figs.push(['Income before taxes', `${fmt(g.monthlyIncome)}/mo`, g.ratios?.debtToIncome != null ? `Loan payments ${pct(g.ratios.debtToIncome, 0)} of it` : `${fmt(g.monthlyIncome * 12)} a year`]);
  if (data.emergency?.months != null) figs.push(['Emergency fund', `${data.emergency.months.toFixed(1)} months`, `${fmt(data.emergency.value)} set aside${data.emergency.source === 'list' ? ', essentials' : ''}`]);
  const monthlyDebt = data.loans.reduce((s, l) => s + l.payment, 0);
  if (monthlyDebt) figs.push(['Loan payments', `${fmt(monthlyDebt)}/mo`, `${data.loans.length} loan${data.loans.length > 1 ? 's' : ''}, escrow included`]);
  parts.push(`<section><h2>At a glance</h2><div class="figures">${figs.map(([l, v, s, main]) => `<div class="fig${main ? ' main' : ''}"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`).join('')}</div></section>`);

  // ----- net worth over time -----
  if (data.history.length >= 2) {
    const h = data.history;
    parts.push(`<section><h2>Net worth over time</h2><div class="chart">${lineSvg(h)}</div>
      <p class="note">From ${fmt(h[0].netWorth)} on ${date(h[0].date)} to ${fmt(h.at(-1).netWorth)} on ${date(h.at(-1).date)} (${signed(h.at(-1).netWorth - h[0].netWorth)}). FinTrack records each account's value daily from the day it was added.</p>
      ${compositionTable()}</section>`);
  }

  // ----- balance sheet -----
  const side = (kind) => {
    const cats = data.byCategory.filter((c) => c.kind === kind && Math.abs(c.total) > 0.5);
    const total = Math.abs(cats.reduce((s, c) => s + c.total, 0)) || 1;
    let rows = '';
    for (const c of cats) {
      rows += `<tr class="cat"><td>${esc(c.label)}</td><td class="n">${fmt(Math.abs(c.total))}</td><td class="n">${pct(Math.abs(c.total) / total, 0)}</td></tr>`;
      for (const a of visible.filter((x) => x.category === c.category)) {
        rows += `<tr class="sub"><td>${esc(a.name)} <span class="muted">· ${esc(a.org)}</span></td><td class="n">${fmt(Math.abs(a.value))}</td><td></td></tr>`;
        for (const b of a.buckets || []) rows += `<tr class="sub"><td style="padding-left:40px">↳ ${esc(bucketName(b))}</td><td class="n">${fmt(b.value)}</td><td></td></tr>`;
      }
    }
    return `<table><thead><tr><th>${kind === 'asset' ? 'Assets' : 'Debts'}</th><th class="n">Amount</th><th class="n">Share</th></tr></thead><tbody>${rows}
      <tr class="total"><td>Total ${kind === 'asset' ? 'assets' : 'debts'}</td><td class="n">${fmt(total)}</td><td></td></tr></tbody></table>`;
  };
  parts.push(`<section><h2>Balance sheet</h2><div class="two"><div>${side('asset')}</div><div>${side('liability')}</div></div>
    <p class="note"><b>Net worth: ${fmt(t.netWorth)}</b>${t.vehicleEquity != null ? ` · Car equity ${fmt(t.vehicleEquity)}` : ''}</p></section>`);

  // ----- investments -----
  const priced = visible.filter((a) => a.source === 'priced');
  if (data.holdings.length || priced.length) {
    const invested = data.holdings.reduce((s, h) => s + h.value, 0) || 1;
    let html = `<section><h2>Investments</h2>`;
    for (const a of priced) {
      const plan = a.priced?.plan;
      const funds = a.holdings || [];
      const tot = funds.reduce((s, f) => s + f.value, 0) || 1;
      html += `<h3>${esc(a.name)} · ${esc(a.org)} · ${fmt(a.value)}</h3>`;
      if (plan?.enabled) html += `<p class="note">Contributions: ${cents(plan.amount)} per paycheck (employee and employer together), ${scheduleText(plan.schedule)}.</p>`;
      const since = a.status?.since;
      if (since && a.status.series.length > 1) html += `<p class="note">Since ${date(since.date)} (when tracking began): ${signed(since.putIn)} put in, ${signed(since.market)} from the market (fund price changes and reinvested payouts).</p>`;
      html += `<table><thead><tr><th>Fund</th><th class="n">Shares</th><th class="n">Price</th><th class="n">Value</th><th class="n">Now</th><th class="n">Future contributions</th></tr></thead><tbody>
        ${funds.map((f) => `<tr><td><b>${esc(f.symbol)}</b> ${esc(f.description)}</td><td class="n">${f.shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td><td class="n">${cents(f.price)}</td><td class="n">${fmt(f.value)}</td><td class="n">${pct(f.value / tot, 1)}</td><td class="n">${plan?.allocation?.[f.symbol] != null ? `${plan.allocation[f.symbol]}%` : '–'}</td></tr>`).join('')}
      </tbody></table>`;
      if (a.status?.estimates?.length) caveats.push(`${a.name}: valued from fund prices; contributions and fund payouts since ${date(a.status.estimatedSince)} are estimated until the next transactions file from ${a.org} is imported.`);
      else caveats.push(`${a.name}: valued from its funds' daily prices and the share counts from ${a.org}.`);
    }
    const others = data.holdings.filter((h) => !priced.some((a) => (a.holdings || []).some((f) => f.symbol === h.symbol)));
    if (others.length) {
      html += `<h3>Brokerage holdings</h3><table><thead><tr><th>Holding</th><th class="n">Shares</th><th class="n">Price</th><th class="n">Value</th><th class="n">Cost</th><th class="n">Gain</th></tr></thead><tbody>
        ${others.map((h) => `<tr><td><b>${esc(h.symbol)}</b> ${esc(h.description)}</td><td class="n">${h.shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}</td><td class="n">${cents(h.price)}</td><td class="n">${fmt(h.value)}</td><td class="n">${fmt(h.costBasis)}</td>
          <td class="n ${cls(h.gain)}">${h.gain == null ? '–' : `${signed(h.gain)}${h.gainPct != null ? ` (${pct(h.gainPct)})` : ''}`}</td></tr>`).join('')}
      </tbody></table>`;
      if (others.some((h) => h.costSource === 'entered')) caveats.push('Brokerage gains: the cost basis for some holdings is an average cost per share entered by hand (the brokerage doesn\'t report it).');
    }
    html += `<p class="note">All holdings together: ${fmt(invested)}.</p>`;
    // Investment mix: stocks, bonds and cash across investment and retirement accounts.
    const m = data.mix;
    if (m?.total) {
      const COL = { usStocks: '#2a78d6', intlStocks: '#eb6834', bonds: '#1baf7a', cash: '#eda100', unclassified: '#9b9993' };
      const parts = m.parts.filter((p) => p.value > 0.5);
      html += `<h3>Investment mix</h3>
        <div style="display:flex;gap:2px;height:16px;margin:6px 0">${parts.map((p) => `<span style="flex:${p.pct} 1 0;background:${COL[p.key]};-webkit-print-color-adjust:exact;print-color-adjust:exact"></span>`).join('')}</div>
        <table><thead><tr><th>Kind</th><th class="n">Amount</th><th class="n">Share</th>${m.vsTarget ? '<th class="n">Target</th><th class="n">Difference</th>' : ''}</tr></thead><tbody>
        ${parts.map((p) => { const t = m.vsTarget?.find((x) => x.key === p.key); return `<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${COL[p.key]};-webkit-print-color-adjust:exact;print-color-adjust:exact"></span>${esc(p.label)}</td><td class="n">${fmt(p.value)}</td><td class="n">${pct(p.pct, 0)}</td>${m.vsTarget ? `<td class="n">${t ? pct(t.want, 0) : '–'}</td><td class="n">${t ? `${signed(t.dollars)}` : ''}</td>` : ''}</tr>`; }).join('')}
        </tbody></table>
        <p class="note">${pct(m.stocks, 0)} in stocks across investment and retirement accounts.${m.guessed ? ` ${m.guessed} holding${m.guessed > 1 ? 's are' : ' is'} sorted by a guess from the fund's name.` : ''}${parts.some((p) => p.key === 'unclassified') ? ' Some holdings aren\'t sorted yet.' : ''}</p>`;
    }
    // What the funds cost.
    const f = data.fees;
    if (f?.funds && f.weighted != null) {
      html += `<h3>Fund fees</h3>
        <p class="note">About <b>${fmt(f.yearly)} a year</b> in fund expenses (a weighted ${f.weighted.toFixed(2)}% of ${fmt(f.knownValue)}). At 6% growth before fees and no new contributions, that rate would take about ${f.longRun.map((l) => `${fmt(l.cost)} over ${l.years} years`).join(' and ')}.${f.unknown ? ` These figures cover only the funds with an expense ratio entered; ${f.unknown} ${f.unknown > 1 ? 'have' : 'has'} none yet.` : ''}</p>
        <table><thead><tr><th>Holding</th><th class="n">Value</th><th class="n">Expense ratio</th><th class="n">Per year</th></tr></thead><tbody>
        ${f.rows.filter((r) => r.kind !== 'stock').map((r) => `<tr><td><b>${esc(r.symbol)}</b> ${esc(r.name || '')}</td><td class="n">${fmt(r.value)}</td><td class="n">${r.expenseRatio == null ? '–' : `${r.expenseRatio.toFixed(2)}%`}</td><td class="n">${r.yearly == null ? '–' : cents(r.yearly)}</td></tr>`).join('')}
        </tbody></table>`;
    }
    html += '</section>';
    parts.push(html);
  }

  // ----- retirement outlook -----
  const rt = data.retirement;
  if (rt?.set) {
    const o = rt.outcomes, st = rt.settings;
    parts.push(`<section><h2>Retirement outlook</h2>
      <p>Retiring at <b>${st.retireAge}</b> (age ${rt.age} now) with ${fmt(rt.start)} in retirement savings today and ${fmt(rt.monthly)} a month going in.${st.income ? ` Income wanted: <b>${fmt(st.income)} a month</b> before taxes, ${fmt(st.socialSecurity || 0)} of it from Social Security; the rest needs about <b>${fmt(rt.needed)}</b> saved at a ${st.withdrawalRate}% withdrawal rate.` : ''}</p>
      <table><thead><tr><th>Market</th><th class="n">Yearly growth after inflation</th><th class="n">Savings at ${st.retireAge}</th><th class="n">Monthly income</th>${st.income ? '<th class="n">Against the goal</th>' : ''}</tr></thead><tbody>
      ${['poor', 'typical', 'good'].map((k) => `<tr><td>${k[0].toUpperCase() + k.slice(1)}</td><td class="n">${o[k].rate.toFixed(1)}%</td><td class="n">${fmt(o[k].balance)}</td><td class="n">${fmt(o[k].supports)}</td>${st.income ? `<td class="n ${cls(o[k].gap)}">${signed(o[k].gap)}</td>` : ''}</tr>`).join('')}
      </tbody></table>
      ${rt.extraNeeded != null || rt.retireAt ? `<p class="note">To close the gap in a typical market: ${[rt.extraNeeded != null ? `save about ${fmt(rt.extraNeeded)} more a month` : '', rt.retireAt ? `retire at ${rt.retireAt}` : ''].filter(Boolean).join(', or ')}.</p>` : ''}
      ${rt.salaryMultiple ? `<p class="note">Retirement savings are ${rt.salaryMultiple.have.toFixed(1)}× salary; a common rule of thumb at ${rt.age} is about ${rt.salaryMultiple.guide}×.</p>` : ''}
      <p class="note">All in today's dollars. Typical growth ${rt.typicalFrom === 'entered' ? 'as given by the owner' : `from the investment mix${rt.assumptions.fee ? `, less fund fees of ${rt.assumptions.fee.toFixed(2)}%` : ''}`}; poor and good are ${rt.assumptions.spread} points lower and higher. Contributions assumed to keep pace with pay. A smooth projection, not a forecast: real returns vary year to year.</p></section>`);
  }

  // ----- cash and savings -----
  if (data.buckets.length) {
    const em = data.emergency;
    parts.push(`<section><h2>Cash and savings goals</h2>
      ${em ? `<p>Emergency fund: <b>${fmt(em.value)}</b>${em.months == null ? '' : em.source === 'list'
        ? `, about <b>${em.months.toFixed(1)} months</b> of essential expenses (${fmt(em.expenses)} a month)${em.monthsAll != null ? ` or ${em.monthsAll.toFixed(1)} months of all expenses (${fmt(em.allExpenses)} a month); see Income and expenses` : ''}`
        : `, about <b>${em.months.toFixed(1)} months</b> of expenses at ${fmt(em.expenses)} a month (${em.source === 'entered' ? 'monthly expenses as given by the owner' : 'average spending measured from the tracked accounts only'})`}.</p>` : ''}
      <table><thead><tr><th>Bucket</th><th>Account</th><th class="n">Amount</th><th class="n">Goal</th><th class="n">Progress</th></tr></thead><tbody>
      ${data.buckets.map((b) => `<tr><td>${esc(bucketName(b))}</td><td>${esc(b.account)}</td><td class="n">${fmt(b.value)}</td><td class="n">${b.goal ? fmt(b.goal) : '–'}</td><td class="n">${b.goal ? pct(b.progress, 0) : '–'}</td></tr>`).join('')}
      </tbody></table></section>`);
  }

  // ----- income and expenses -----
  if (g.set || g.salary) {
    const r = g.ratios || {};
    const lines = (g.lines || []).filter((e) => e.value != null);
    parts.push(`<section><h2>Income and expenses</h2>
      ${g.monthlyIncome ? `<div class="loan-grid" style="margin-bottom:8px">
        ${kv('Salary, before taxes', `${fmt(g.salary)} a year`)}${g.otherIncome ? kv('Other household income', `${fmt(g.otherIncome)} a year`) : ''}${kv('Monthly income, before taxes', fmt(g.monthlyIncome))}
        ${r.debtToIncome != null ? kv('Loan payments to income', `${pct(r.debtToIncome, 0)} (${fmt(r.loanPayments)} a month, escrow included)`) : ''}
        ${r.retirementRate != null ? kv('401(k) contributions', `${pct(r.retirementRate, 0)} of salary (${fmt(r.retirementPerYear)} a year with the employer match)`) : ''}
      </div>` : ''}
      ${lines.length ? `<table><thead><tr><th>Monthly expense</th><th class="n">Amount</th><th class="n">Essential</th></tr></thead><tbody>
        ${lines.map((e) => `<tr><td>${esc(e.name)}${e.measured ? ` <span class="muted small">(${e.source === 'measured' ? `measured average, last ${g.measured?.months ?? 0} months` : "owner's figure"})</span>` : ''}</td><td class="n">${fmt(e.value)}</td><td class="n">${e.essential ? 'Yes' : ''}</td></tr>`).join('')}
        <tr class="total"><td>Essential expenses</td><td class="n">${fmt(g.essential)}</td><td></td></tr>
        <tr><td><b>All expenses</b></td><td class="n"><b>${fmt(g.all)}</b></td><td></td></tr></tbody></table>` : ''}
      <p class="note">Income and the expenses outside the tracked accounts are the owner's figures. "Essential" means it would still have to be paid if income stopped; the emergency fund is measured against those.</p></section>`);
  }

  // ----- debts -----
  if (data.loans.length) {
    let html = '<section><h2>Loans</h2>';
    for (const l of data.loans) {
      const r = l.required;
      const extra = r && r.extra > 0.005 ? r.extra : 0;
      html += `<div class="loan"><b>${esc(l.name)}</b> <span class="muted">· ${esc(l.org)}</span>
        <div class="loan-grid">
          ${kv('Balance', fmt(l.balance))}${kv('Interest rate', `${l.rate}%`)}${kv('Paid off', l.never ? 'Never at this payment' : `${month(l.payoffMonth)} (${span(l.monthsLeft)})`)}
          ${kv('Monthly payment', cents(l.payment))}${kv(extra ? 'Required payment' : 'Principal and interest', extra ? cents(r.payment) : cents(l.pi))}${kv(l.escrow > 0 ? 'Escrow' : 'Extra each month', l.escrow > 0 ? cents(l.escrow) : extra ? cents(extra) : 'None')}
          ${kv('Next payment', `${cents(l.nextPayment.interest)} interest, ${cents(l.nextPayment.principal)} principal${l.nextPayment.extra ? `, ${cents(l.nextPayment.extra)} extra` : ''}`)}${kv('Interest left to pay', fmt(l.interestLeft))}${kv(`Interest so far in ${new Date().getFullYear()}`, `${cents(l.ytd.interest)}${l.ytd.estimated ? ' (est.)' : ''}`)}
        </div>
        ${extra && r.minimum && r.monthsSooner != null ? `<p class="note">Paying ${cents(extra)} a month over the required payment${l.escrow > 0 ? ' (escrow aside)' : ''} pays it off ${span(r.monthsSooner)} sooner than the required payment alone (${month(r.minimum.payoffMonth)}), saving ${fmt(r.interestSaved)} in interest.</p>` : ''}
        ${l.scheduled?.payoffMonth ? `<p class="note">Original schedule: ${cents(l.scheduled.pi)} principal and interest, paid off ${month(l.scheduled.payoffMonth)}.</p>` : ''}
      </div>`;
      if (l.ytd.estimated) caveats.push(`${l.name}: interest so far this year is estimated from the rate and balance${l.category === 'mortgage' ? "; the lender's Form 1098 has the exact figure" : "; the lender's statements have the exact figure"}.`);
    }
    html += `<p class="note">Loan balances come from the lenders; rates and payments as entered by the owner. Payoff dates assume the current payment every month and a fixed rate.</p></section>`;
    parts.push(html);
  }

  // ----- cash flow -----
  const months = data.cashFlow.filter((m) => m.in || m.out);
  if (months.length) {
    const avgIn = months.reduce((s, m) => s + m.in, 0) / months.length, avgOut = months.reduce((s, m) => s + m.out, 0) / months.length;
    parts.push(`<section><h2>Cash flow</h2>
      <table><thead><tr><th>Month</th><th class="n">Money in</th><th class="n">Money out</th><th class="n">Net</th></tr></thead><tbody>
      ${months.map((m) => `<tr><td>${month(m.month)}</td><td class="n">${fmt(m.in)}</td><td class="n">${fmt(m.out)}</td><td class="n ${cls(m.net)}">${signed(m.net)}</td></tr>`).join('')}
      <tr class="total"><td>Monthly average</td><td class="n">${fmt(avgIn)}</td><td class="n">${fmt(avgOut)}</td><td class="n ${cls(avgIn - avgOut)}">${signed(avgIn - avgOut)}</td></tr></tbody></table>
      <p class="note">Checking, savings and credit card accounts tracked here only; transfers between them are left out, loan payments count as money out. Money sent from these accounts to one that isn't tracked counts as money out as one amount. Money that never passes through them, such as part of a paycheck deposited straight into a joint account for household bills, isn't seen as income or as spending, and neither are the bills paid from that account. The first and current months may be partial.</p></section>`);
  }

  // ----- home -----
  for (const a of visible.filter((x) => x.indexStatus)) caveats.push(`${a.name}: ${fmt(a.value)}, the owner's estimate adjusted by the ${a.indexStatus.label.replace(/ \((quarterly|yearly)\)$/, '')} index since ${date(a.indexStatus.since)} (${a.indexStatus.change >= 0 ? '+' : '−'}${Math.abs(a.indexStatus.change * 100).toFixed(1)}%).`);
  for (const a of visible.filter((x) => x.source === 'manual' && !x.indexStatus)) caveats.push(`${a.name}: value entered by the owner.`);
  if ((data.errors || []).length) caveats.push(`At the last sync the bank connection reported: ${data.errors.join(' ')}`);

  // ----- notes -----
  if (data.report?.notes?.trim()) parts.push(`<section><h2>Notes and questions</h2><div class="notes-text">${esc(data.report.notes)}</div></section>`);
  parts.push(`<section><h2>About these numbers</h2><ul class="caveats">
    <li>Bank, brokerage and loan balances come from the institutions through SimpleFIN, synced daily (last ${date(data.lastSync)}).</li>
    ${caveats.map((c) => `<li>${esc(c)}</li>`).join('')}
  </ul></section>`);

  $('report').innerHTML = parts.join('');
}

// "Emergency fund" needs no "(emergency fund)" after it; "Rainy day" does.
function bucketName(b) { return b.emergency && !/emergency/i.test(b.name) ? `${b.name} (emergency fund)` : b.name; }

// Net worth by type, where tracking began and now: which parts grew.
function compositionTable() {
  const c = data.composition;
  if (!c?.days?.length || c.days.length < 2) return '';
  const a = c.days[0], b = c.days.at(-1);
  return `<table style="margin-top:10px"><thead><tr><th>By type</th><th class="n">${date(a.date)}</th><th class="n">${date(b.date)}</th><th class="n">Change</th></tr></thead><tbody>
    ${c.layers.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${fmt(a[l.key])}</td><td class="n">${fmt(b[l.key])}</td><td class="n ${cls(b[l.key] - a[l.key])}">${signed(b[l.key] - a[l.key])}</td></tr>`).join('')}
    <tr class="total"><td>Net worth</td><td class="n">${fmt(a.netWorth)}</td><td class="n">${fmt(b.netWorth)}</td><td class="n ${cls(b.netWorth - a.netWorth)}">${signed(b.netWorth - a.netWorth)}</td></tr></tbody></table>
    <p class="note">Home equity is the home's value minus the mortgage; car and other is the car's value minus its loan, plus other assets.</p>`;
}

function kv(k, v) { return `<div class="kv"><div class="k">${k}</div><div class="v">${v}</div></div>`; }

function scheduleText(s) {
  if (!s) return '';
  const lag = s.lag ? `, invested ${s.lag} business day${s.lag > 1 ? 's' : ''} later` : '';
  if (s.every === 'month') return `${s.day === 'lastBusiness' ? 'paid the last business day of each month' : `paid on day ${s.day} of each month`}${lag}`;
  return `paid every ${s.every === 'week' ? 'week' : 'two weeks'}${lag}`;
}

function lineSvg(h) {
  const W = 760, H = 170, L = 56, R = 8, T = 8, B = 22;
  const ys = h.map((p) => p.netWorth);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = (i) => L + (i / (h.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const compact = (v) => `$${Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v / 1000) + 'k'}`;
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const d = h.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join('');
  const lab = [0, Math.floor((h.length - 1) / 2), h.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth over time">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#ebeae6"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${compact(v)}</text>`).join('')}
    <path d="${d}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round"/>
    ${lab.map((i, k) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${date(h[i].date)}</text>`).join('')}
  </svg>`;
}

load().catch((err) => { $('report').innerHTML = `<p>Couldn't load the data: ${esc(err.message)}</p>`; });
