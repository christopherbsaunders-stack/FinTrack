// Are we on track for retirement? A projection in today's dollars: growth is
// after inflation, and contributions are assumed to rise with pay. Three
// outcomes (poor, typical, good) rather than one number, compared with the
// savings needed to draw the income you want at a set withdrawal rate.
//
// settings.retirement = {
//   birthYear, retireAge (65),
//   income:          monthly income wanted in retirement, before taxes, today's dollars
//   socialSecurity:  monthly Social Security (or pension) expected, today's dollars
//   extraMonthly:    other monthly saving toward retirement (an IRA), beyond the 401(k) plan
//   includeTaxable:  count brokerage investments too
//   typicalReturn:   optional override of the typical yearly return after inflation, percent
//   withdrawalRate:  percent of savings drawn the first year (4)
// }

// Yearly returns after inflation by kind of investment: long-run rough
// figures, stated on the card so they can be judged and changed.
export const REAL_RETURNS = { usStocks: 5, intlStocks: 5, bonds: 1.5, cash: 0.5, unclassified: 4 };
export const SPREAD = 2;   // poor and good outcomes: typical minus and plus this

export function typicalReturn(mix, feePct) {
  if (!mix?.total) return 4;
  let r = 0;
  for (const p of mix.parts) r += (p.value / mix.total) * (REAL_RETURNS[p.key] ?? 4);
  return Math.round((r - (feePct || 0)) * 100) / 100;
}

// Balance after `months` of growth at yearly rate `pct`, adding `monthly` at each month's end.
export function grow(balance, monthly, pct, months) {
  const i = (1 + pct / 100) ** (1 / 12) - 1;
  if (i === 0) return balance + monthly * months;
  const g = (1 + i) ** months;
  return balance * g + monthly * ((g - 1) / i);
}

export function project(input) {
  const { start, monthly, age, retireAge, income, socialSecurity = 0, typical, withdrawalRate = 4 } = input;
  const years = Math.max(0, retireAge - age);
  const months = Math.round(years * 12);
  const rates = { poor: typical - SPREAD, typical, good: typical + SPREAD };
  const fromSavings = Math.max(0, (income || 0) - (socialSecurity || 0));
  const needed = fromSavings > 0 ? (fromSavings * 12) / (withdrawalRate / 100) : 0;

  // Balance by year of age, for the chart.
  const path = [];
  for (let y = 0; y <= years; y++) {
    const row = { age: Math.round((age + y) * 10) / 10 };
    for (const [k, r] of Object.entries(rates)) row[k] = round0(grow(start, monthly, r, y * 12));
    path.push(row);
  }
  const outcomes = Object.fromEntries(Object.entries(rates).map(([k, r]) => {
    const balance = round0(grow(start, monthly, r, months));
    const supports = round0((balance * (withdrawalRate / 100)) / 12 + (socialSecurity || 0));
    return [k, { rate: r, balance, supports, gap: income ? round0(supports - income) : null }];
  }));

  // What closes the gap in the typical outcome.
  let extraNeeded = null, retireAt = null;
  if (needed > 0 && outcomes.typical.balance < needed) {
    const i = (1 + typical / 100) ** (1 / 12) - 1;
    const g = (1 + i) ** months;
    const annuity = i === 0 ? months : (g - 1) / i;
    extraNeeded = months > 0 ? round0((needed - grow(start, monthly, typical, months)) / annuity) : null;
    for (let a = retireAge + 1; a <= 75; a++) {
      if (grow(start, monthly, typical, Math.round((a - age) * 12)) >= needed) { retireAt = a; break; }
    }
  }
  return { years, rates, needed: round0(needed), fromSavings, outcomes, path, extraNeeded, retireAt, onTrack: needed > 0 ? outcomes.typical.balance >= needed : null };
}

export function validateRetirement(input, thisYear = new Date().getFullYear()) {
  const n = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[$,%\s]/g, '')));
  const r = {
    birthYear: n(input.birthYear), retireAge: n(input.retireAge) ?? 65,
    income: n(input.income), socialSecurity: n(input.socialSecurity), extraMonthly: n(input.extraMonthly),
    includeTaxable: Boolean(input.includeTaxable), typicalReturn: n(input.typicalReturn), withdrawalRate: n(input.withdrawalRate) ?? 4,
  };
  if (!(r.birthYear > thisYear - 100 && r.birthYear < thisYear - 15)) throw new Error('Enter your birth year, like 1985.');
  if (!(r.retireAge >= 40 && r.retireAge <= 80)) throw new Error('Retirement age between 40 and 80.');
  if (r.retireAge <= thisYear - r.birthYear) throw new Error('That retirement age has already passed.');
  for (const [k, label] of [['income', 'The income you want'], ['socialSecurity', 'Social Security'], ['extraMonthly', 'Other saving']]) {
    if (r[k] != null && !(r[k] >= 0)) throw new Error(`${label} must be a number of dollars a month.`);
  }
  if (r.typicalReturn != null && !(r.typicalReturn > -5 && r.typicalReturn < 12)) throw new Error('The typical return is a yearly percent after inflation, like 4.');
  if (!(r.withdrawalRate >= 2 && r.withdrawalRate <= 8)) throw new Error('The withdrawal rate is a yearly percent, like 4.');
  return r;
}

function round0(x) { return Math.round(x); }
