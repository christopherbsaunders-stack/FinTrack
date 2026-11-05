// Loan math: payoff dates, interest vs principal, and what extra payments do.
// Pure and DOM-free; the dashboard loads this same file for the what-if slider.
//
// loan details (account.loan): {
//   rate:      APR in percent (6.125)
//   payment:   what you pay each month, all of it ($2,400)
//   escrow:    the part of it that isn't the loan: taxes, insurance, PMI
//   required:  optional, the amount due on the statement ($2,220.12); what
//              you pay over it is extra principal
//   original:  optional, amount borrowed
//   termYears: optional, loan length (30)
//   firstPayment: optional, 'YYYY-MM' of the first payment
// }
// The balance comes from the bank (SimpleFIN). Interest is charged monthly on
// the balance after the previous payment, as on a standard fixed-rate mortgage.

export const MAX_MONTHS = 720;

export function monthlyRate(apr) { return Number(apr) / 100 / 12; }

// Principal and interest: the payment without escrow.
export function principalAndInterest(loan) { return round2(Number(loan.payment) - (Number(loan.escrow) || 0)); }

// The P&I a loan of `amount` at `apr` over `months` is scheduled to have.
export function scheduledPayment(amount, apr, months) {
  const r = monthlyRate(apr);
  if (!(months > 0)) return null;
  if (r === 0) return round2(amount / months);
  return round2((amount * r) / (1 - (1 + r) ** -months));
}

// Month by month from `balance` until it's paid off. `extra` is added to every
// payment; `lump` is paid once, now. Each row: the month's interest, principal,
// payment (P&I + extra) and the balance after it.
export function amortize(balance, apr, pi, { extra = 0, lump = 0, startMonth } = {}) {
  const r = monthlyRate(apr);
  let b = Math.max(0, Number(balance) - Math.max(0, Number(lump) || 0));
  const rows = [];
  let month = startMonth;
  while (b > 0.005 && rows.length < MAX_MONTHS) {
    const interest = round2(b * r);
    const due = Number(pi) + Math.max(0, Number(extra) || 0);
    let payment = round2(Math.min(due, b + interest));
    // A few cents left over from rounding the payment go into this one, as a bank does.
    if (b + interest - payment < 2) payment = round2(b + interest);
    const principal = round2(payment - interest);
    if (principal <= 0) return { rows, never: true, totalInterest: sum(rows, 'interest'), months: Infinity, lastMonth: null };
    b = round2(b - principal);
    if (b < 0.005) b = 0;
    rows.push({ month, interest, principal, payment, balance: b });
    month = month && addMonths(month, 1);
  }
  return { rows, never: b > 0.005, totalInterest: round2(sum(rows, 'interest')), months: b > 0.005 ? Infinity : rows.length, lastMonth: rows.at(-1)?.month ?? null };
}

// Payoff with the current payment against payoff with more, side by side.
export function compare(balance, loan, { extra = 0, lump = 0, startMonth } = {}) {
  const pi = principalAndInterest(loan);
  const base = amortize(balance, loan.rate, pi, { startMonth });
  const more = amortize(balance, loan.rate, pi, { extra, lump, startMonth });
  return {
    base, more,
    monthsSooner: base.never || more.never ? null : base.months - more.months,
    interestSaved: base.never || more.never ? null : round2(base.totalInterest - more.totalInterest),
  };
}

// Interest, principal and end balance per calendar year.
export function byYear(rows) {
  const out = [];
  for (const r of rows) {
    const y = Number(String(r.month).slice(0, 4));
    let cur = out.at(-1);
    if (!cur || cur.year !== y) out.push(cur = { year: y, interest: 0, principal: 0, paid: 0, endBalance: 0 });
    cur.interest += r.interest; cur.principal += r.principal; cur.paid += r.payment; cur.endBalance = r.balance;
  }
  return out.map((y) => ({ ...y, interest: round2(y.interest), principal: round2(y.principal), paid: round2(y.paid) }));
}

// The balance before each of the last `n` payments, worked backward from the
// balance now on the assumption each was exactly P&I:
// after = before × (1 + r) − pi  →  before = (after + pi) / (1 + r).
export function backward(balance, apr, pi, n) {
  const r = monthlyRate(apr);
  const out = [];
  let after = Number(balance);
  for (let i = 0; i < n; i++) {
    const before = round2((after + Number(pi)) / (1 + r));
    out.unshift({ before, after: round2(after), interest: round2(before * r), principal: round2(before - after) });
    after = before;
  }
  return out;
}

// Everything the dashboard shows for one loan. `today` is 'YYYY-MM-DD'.
// `startOfYear` is the bank's balance on Jan 1 if FinTrack has it, else null.
export function loanSummary(loan, balance, today, { startOfYear = null, paidThisYear = null, payments = null } = {}) {
  const pi = principalAndInterest(loan);
  const r = monthlyRate(loan.rate);
  const month = today.slice(0, 7);
  const next = addMonths(month, 1);
  const base = amortize(balance, loan.rate, pi, { startMonth: next });
  const nextInterest = round2(balance * r);
  const warnings = [];
  if (!(pi > nextInterest)) warnings.push(`The payment without escrow (${money(pi)}) doesn't cover a month's interest (${money(nextInterest)}): check the rate, payment and escrow.`);

  // Payments made so far this year (one a month, the current month's included).
  const n = Number(month.slice(5, 7));
  let ytd = null;
  if (startOfYear != null && paidThisYear != null && payments > 0) {
    // Real numbers: the balance drop is principal; the rest of what was paid,
    // less escrow, is interest. If that doesn't add up (a missed transaction,
    // a refund), fall back to the estimate rather than show nonsense.
    const principal = round2(startOfYear - balance);
    const escrow = round2((Number(loan.escrow) || 0) * payments);
    const interest = round2(paidThisYear - escrow - principal);
    if (principal >= 0 && interest >= 0) ytd = { principal, escrow, interest, payments, estimated: false };
  }
  if (!ytd) {
    const back = backward(balance, loan.rate, pi, n);
    ytd = { principal: round2(sum(back, 'principal')), interest: round2(sum(back, 'interest')), escrow: round2((Number(loan.escrow) || 0) * n), payments: n, estimated: true };
  }

  let scheduled = null;
  if (loan.original > 0 && loan.termYears > 0) {
    const months = Math.round(loan.termYears * 12);
    const spi = scheduledPayment(loan.original, loan.rate, months);
    scheduled = {
      pi: spi,
      escrowGuess: round2((loan.required || loan.payment) - spi),
      payoffMonth: loan.firstPayment ? addMonths(loan.firstPayment, months - 1) : null,
    };
  }

  // The required payment (from the statement) splits what you pay into the
  // minimum and extra principal, and gives the payoff at the minimum to
  // compare with.
  let required = null;
  if (loan.required > 0) {
    const rpi = round2(loan.required - (Number(loan.escrow) || 0));
    const extra = round2(pi - rpi);
    required = { payment: round2(loan.required), pi: rpi, extra };
    if (extra < -0.005) warnings.push(`You pay ${money(-extra)} less than the required payment (${money(loan.required)}).`);
    else if (extra > 0.005) {
      const min = amortize(balance, loan.rate, rpi, { startMonth: next });
      required.minimum = { payoffMonth: min.lastMonth, monthsLeft: min.months, interestLeft: min.totalInterest, never: min.never };
      if (!min.never && !base.never) {
        required.monthsSooner = min.months - base.months;
        required.interestSaved = round2(min.totalInterest - base.totalInterest);
      }
    }
  }
  const extraNow = required ? Math.max(0, required.extra) : 0;

  return {
    pi, escrow: round2(Number(loan.escrow) || 0), payment: round2(Number(loan.payment)), rate: Number(loan.rate),
    nextPayment: { month: next, interest: nextInterest, principal: round2(Math.max(0, pi - extraNow - nextInterest)), extra: round2(extraNow) },
    required,
    payoffMonth: base.lastMonth, monthsLeft: base.months, interestLeft: base.totalInterest, never: base.never,
    years: byYear(base.rows),
    ytd, scheduled, warnings,
  };
}

export function addMonths(ym, k) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function validateLoan(input) {
  const n = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[$,%\s]/g, '')));
  const loan = {
    rate: n(input.rate), payment: n(input.payment), escrow: n(input.escrow) ?? 0,
    required: n(input.required), original: n(input.original), termYears: n(input.termYears),
    firstPayment: /^\d{4}-\d{2}$/.test(input.firstPayment || '') ? input.firstPayment : null,
  };
  if (loan.rate == null || !(loan.rate >= 0 && loan.rate < 40)) throw new Error('Enter the interest rate as a percent, like 6.125.');
  if (loan.payment == null || !(loan.payment > 0)) throw new Error('Enter the monthly payment.');
  if (!(loan.escrow >= 0) || loan.escrow >= loan.payment) throw new Error('Escrow must be less than the whole payment.');
  if (loan.required != null && !(loan.required > loan.escrow)) throw new Error('The required payment must be more than the escrow.');
  if (loan.original != null && !(loan.original > 0)) throw new Error('The amount borrowed must be more than 0.');
  if (loan.termYears != null && !(loan.termYears > 0 && loan.termYears <= 50)) throw new Error('The term is in years, like 30.');
  return loan;
}

function sum(rows, k) { return rows.reduce((s, r) => s + r[k], 0); }
function round2(x) { return Math.round(x * 100) / 100; }
function money(x) { return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
