// What investments cost: each fund's expense ratio (the yearly fee, a percent
// of what you hold) in dollars, and what that adds up to over the years.
//
// state.fees = { SYMBOL: expense ratio in percent (0.85) }, entered from the
// plan's fee disclosure or the fund's page. Single stocks have no fund fee;
// state.symbolInfo[SYMBOL].type (from the price data: EQUITY, ETF,
// MUTUALFUND) tells them apart.

export const GROWTH = 0.06;   // the growth assumed for the long-run figures, before fees

export function computeFees(holdings, fees = {}, info = {}) {
  const rows = holdings.filter((h) => h.symbol && h.value > 0).map((h) => {
    const type = info[h.symbol]?.type || null;
    const entered = fees[h.symbol];
    let er = null, kind;
    if (entered != null) { er = Number(entered); kind = 'entered'; }
    else if (type === 'EQUITY') { er = 0; kind = 'stock'; }
    else kind = 'unknown';
    return { symbol: h.symbol, name: h.description, value: h.value, type, expenseRatio: er, kind, yearly: er == null ? null : round2((h.value * er) / 100) };
  });
  const known = rows.filter((r) => r.expenseRatio != null);
  const funds = known.filter((r) => r.kind === 'entered');
  const knownValue = known.reduce((s, r) => s + r.value, 0);
  const yearly = round2(known.reduce((s, r) => s + r.yearly, 0));
  const weighted = knownValue > 0 ? (yearly / knownValue) * 100 : null;
  return {
    rows,
    yearly,
    weighted,                                  // percent, across holdings with a known cost
    knownValue: round2(knownValue),
    unknown: rows.filter((r) => r.kind === 'unknown').length,
    funds: funds.length,
    longRun: weighted ? [10, 20].map((years) => ({ years, cost: feeDrag(knownValue, weighted / 100, years) })) : [],
  };
}

// What fees take over the years from a balance growing at GROWTH before fees:
// the balance without them minus the balance with them (no new contributions).
export function feeDrag(balance, fee, years, growth = GROWTH) {
  return round2(balance * ((1 + growth) ** years - (1 + growth - fee) ** years));
}

export function validateExpenseRatio(v) {
  if (v === null || v === '') return null;
  const n = Number(String(v).replace(/[%\s]/g, ''));
  if (!(n >= 0 && n < 5)) throw new Error('Enter the expense ratio as a percent, like 0.85.');
  return n;
}

function round2(x) { return Math.round(x * 100) / 100; }
