// Spreadsheet (CSV) exports of the dashboard data, for an advisor or for
// your own records. Built from computeSummary's output; pure.

export const EXPORTS = {
  accounts: 'Accounts and buckets',
  holdings: 'Investment holdings',
  loans: 'Loans',
  cashflow: 'Cash flow by month',
  history: 'Net worth history',
};

export function toCsv(rows) {
  const cell = (v) => {
    if (v == null) return '';
    let s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    // Text from a bank that starts like a formula must not run as one in Excel.
    if (typeof v !== 'number' && /^[=+@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const label = (sum, cat) => sum.categories.find((c) => c.id === cat)?.label || cat;
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

export function exportCsv(name, sum) {
  if (name === 'accounts') {
    const rows = [['Account', 'Institution', 'Category', 'Asset or debt', 'Balance', 'Change in 30 days', 'As of', 'Bucket', 'Bucket amount', 'Bucket goal', 'Notes']];
    for (const a of sum.accounts.filter((x) => !x.hidden)) {
      const notes = [];
      if (a.source === 'manual') notes.push(a.indexStatus ? `Value follows ${a.indexStatus.label} since ${a.indexStatus.since}` : 'Value entered by hand');
      if (a.source === 'priced') notes.push(`Valued from fund prices${a.status?.estimates?.length ? `; includes estimates since ${a.status.estimatedSince}` : ''}`);
      rows.push([a.name, a.org, label(sum, a.category), a.kind === 'liability' ? 'Debt' : 'Asset', a.value, a.change30, day(a.balanceDate), '', '', '', notes.join('; ')]);
      for (const b of a.buckets || []) rows.push([a.name, a.org, label(sum, a.category), 'Asset', '', '', '', b.name + (b.emergency && !/emergency/i.test(b.name) ? ' (emergency fund)' : ''), b.value, b.goal, b.rest ? 'Holds the rest of the balance' : '']);
    }
    rows.push([], ['Total assets', '', '', '', sum.totals.assets], ['Total debts', '', '', '', -sum.totals.liabilities], ['Net worth', '', '', '', sum.totals.netWorth]);
    return toCsv(rows);
  }
  if (name === 'holdings') {
    const invested = sum.holdings.reduce((s, h) => s + h.value, 0) || 1;
    const rows = [['Symbol', 'Name', 'Shares', 'Price', 'Value', 'Percent of holdings', 'Cost basis', 'Gain', 'Gain percent', 'Cost from']];
    for (const h of sum.holdings) rows.push([h.symbol, h.description, h.shares, h.price, h.value, round(h.value / invested * 100, 1), h.costBasis, h.gain, h.gainPct == null ? null : round(h.gainPct * 100, 1), h.costSource === 'entered' ? 'Average cost entered by hand' : h.costSource === 'brokerage' ? 'Brokerage' : '']);
    return toCsv(rows);
  }
  if (name === 'loans') {
    const rows = [['Loan', 'Lender', 'Balance', 'Rate (%)', 'Monthly payment', 'Required payment', 'Extra per month', 'Escrow', 'Principal and interest', 'Next interest', 'Next principal', 'Payoff (month)', 'Months left', 'Interest left', 'Payoff at required payment', 'Interest saved by extra', 'Interest this year', 'Principal this year', 'This year estimated']];
    for (const l of sum.loans) {
      rows.push([l.name, l.org, l.balance, l.rate, l.payment, l.required?.payment ?? null, l.required?.extra > 0 ? l.required.extra : null, l.escrow || null, l.pi, l.nextPayment.interest, l.nextPayment.principal, l.payoffMonth, Number.isFinite(l.monthsLeft) ? l.monthsLeft : null, l.interestLeft, l.required?.minimum?.payoffMonth ?? null, l.required?.interestSaved ?? null, l.ytd.interest, l.ytd.principal, l.ytd.estimated ? 'yes' : 'no']);
    }
    return toCsv(rows);
  }
  if (name === 'cashflow') {
    const rows = [['Month', 'Money in', 'Money out', 'Net']];
    for (const m of sum.cashFlow) rows.push([m.month, m.in, m.out, m.net]);
    return toCsv(rows);
  }
  if (name === 'history') {
    const rows = [['Date', 'Assets', 'Debts', 'Net worth']];
    for (const h of sum.history) rows.push([h.date, h.assets, h.liabilities, h.netWorth]);
    return toCsv(rows);
  }
  throw new Error(`No export called "${name}".`);
}

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }
