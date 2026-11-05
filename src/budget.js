// Income and monthly expenses: what the emergency fund has to cover and the
// ratios an advisor asks about. FinTrack can't see money that never reaches a
// tracked account (part of a paycheck sent straight to a joint account), so
// income and the expenses outside the tracked accounts are entered here.
//
// settings.budget = {
//   salary:      yearly salary before taxes
//   otherIncome: optional, other yearly household income (a spouse's salary, ...)
//   expenses: [{ id, name, amount, essential, measured }]
//     measured: the line for spending in the tracked accounts; its amount is
//               FinTrack's measured average unless you set one (amount != null)
// }

export const MEASURED_NAME = 'My spending in tracked accounts';

export function defaultBudget() {
  return { salary: null, otherIncome: null, expenses: [{ id: 'measured', name: MEASURED_NAME, amount: null, essential: false, measured: true }] };
}

// The lines with their amounts, the essential and full totals, and income.
export function computeBudget(budget, measured) {
  const b = budget || defaultBudget();
  const lines = (b.expenses || []).map((e) => {
    const value = e.measured && e.amount == null ? (measured?.amount ?? null) : e.amount;
    return { ...e, value, source: e.measured ? (e.amount == null ? 'measured' : 'entered') : 'entered' };
  });
  const sum = (list) => round2(list.reduce((s, e) => s + (e.value || 0), 0));
  const yearly = (Number(b.salary) || 0) + (Number(b.otherIncome) || 0);
  const any = lines.some((e) => e.value > 0);
  return {
    salary: b.salary ?? null,
    otherIncome: b.otherIncome ?? null,
    monthlyIncome: yearly > 0 ? round2(yearly / 12) : null,
    lines,
    essential: any ? sum(lines.filter((e) => e.essential)) : null,
    all: any ? sum(lines) : null,
    measured: measured || null,
    set: Boolean(budget),
  };
}

// Advisor ratios, all against gross (before-tax) income.
export function ratios(budget, { loanPayments = 0, retirementPerYear = null } = {}) {
  const monthly = budget.monthlyIncome;
  return {
    debtToIncome: monthly > 0 && loanPayments > 0 ? loanPayments / monthly : null,
    retirementRate: budget.salary > 0 && retirementPerYear > 0 ? retirementPerYear / budget.salary : null,
    retirementPerYear,
    loanPayments: loanPayments || null,
  };
}

export function validateBudget(input) {
  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[$,\s]/g, '')));
  const salary = num(input?.salary);
  const otherIncome = num(input?.otherIncome);
  if (salary != null && !(salary >= 0)) throw new Error('Enter your yearly salary as a number.');
  if (otherIncome != null && !(otherIncome >= 0)) throw new Error('Enter other income as a number.');
  const list = Array.isArray(input?.expenses) ? input.expenses : [];
  if (list.length > 40) throw new Error('Up to 40 expense lines.');
  let measuredSeen = false;
  const expenses = [];
  list.forEach((e, i) => {
    const measured = Boolean(e.measured) && !measuredSeen;
    if (measured) measuredSeen = true;
    const name = measured ? MEASURED_NAME : String(e.name || '').trim().slice(0, 80);
    const amount = num(e.amount);
    if (!measured && !name && amount == null) return;      // an empty row
    if (!name) throw new Error(`Expense line ${i + 1} needs a name.`);
    if (!measured && amount == null) throw new Error(`Enter a monthly amount for ${name}.`);
    if (amount != null && !(amount >= 0)) throw new Error(`${name}: the amount must be a number.`);
    const id = /^[\w-]{1,40}$/.test(e.id || '') ? e.id : `x${Date.now().toString(36)}${i}`;
    expenses.push({ id: measured ? 'measured' : id, name, amount, essential: Boolean(e.essential), measured });
  });
  if (!measuredSeen) expenses.unshift({ id: 'measured', name: MEASURED_NAME, amount: null, essential: false, measured: true });
  return { salary, otherIncome, expenses };
}

function round2(x) { return Math.round(x * 100) / 100; }
