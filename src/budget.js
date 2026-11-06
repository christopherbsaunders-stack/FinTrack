// Income and monthly expenses: what the emergency fund has to cover and the
// ratios an advisor asks about. FinTrack can't see money that never reaches a
// tracked account (part of a paycheck sent straight to a joint account), so
// income and the expenses outside the tracked accounts are entered here.
//
// settings.budget = {
//   salary:      yearly salary before taxes
//   otherIncome: optional, other yearly household income (a spouse's salary, ...)
//   otherSaving: optional, monthly saving outside the 401(k) (to savings, a brokerage, an IRA)
//   expenses: [{ id, name, amount, essential, measured }]
//     measured: the line for spending in the tracked accounts; its amount is
//               FinTrack's measured average unless you set one (amount != null)
//   essentialPayees: payees in the measured spending marked essential
//               (keys from payeeKey), which count toward the essentials
// }

export const MEASURED_NAME = 'My spending in tracked accounts';

export function defaultBudget() {
  return { salary: null, otherIncome: null, otherSaving: null, expenses: [{ id: 'measured', name: MEASURED_NAME, amount: null, essential: false, measured: true }] };
}

// Group a bank description to a payee: "NETFLIX.COM 866-579 CA" and
// "NETFLIX.COM 866-111 CA" are the same one. Card and processor prefixes go.
const NOISE = new Set(['POS', 'DEBIT', 'PURCHASE', 'ACH', 'CHECKCARD', 'CHECK', 'CARD', 'VISA', 'SQ', 'TST', 'SP', 'PP', 'WWW', 'COM', 'INC', 'LLC', 'THE', 'RECURRING', 'ONLINE', 'WEB', 'PMT', 'ID', 'REF', 'XX', 'XXX']);
export function payeeKey(description) {
  const words = String(description || '').toUpperCase().replace(/[^A-Z&' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !NOISE.has(w));   // two-letter bits are mostly state codes
  return words.slice(0, 3).join(' ') || 'OTHER';
}

// The measured spending by payee, as a monthly average over the same months
// the measured figure uses, biggest first: what's inside that one number.
export function spendingByPayee(spent, monthsUsed) {
  const months = new Set(monthsUsed || []);
  if (!months.size) return [];
  const groups = new Map();
  for (const t of spent || []) {
    if (!months.has(t.month)) continue;
    const key = payeeKey(t.description);
    // name: how it's shown, for a payment named after one of your loans.
    const g = groups.get(key) || { key, name: t.label && t.label !== t.description ? t.description : null, label: t.label || t.description, total: 0, times: 0 };
    g.total += t.amount; g.times += 1;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ key: g.key, name: g.name, label: g.label, times: g.times, perMonth: round2(g.total / months.size) }))
    .sort((a, b) => b.perMonth - a.perMonth);
}

// A line you entered that also shows up in the measured spending, by name:
// "Netflix" and NETFLIX.COM. Short and generic words don't count.
const GENERIC = new Set(['joint', 'account', 'payment', 'monthly', 'bill', 'bills', 'other', 'home', 'my', 'the', 'and']);
function alsoMeasured(name, payees) {
  const words = String(name || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
  if (!words.length) return null;
  return payees.find((p) => words.some((w) => p.key.toLowerCase().split(' ').some((k) => k.startsWith(w) || w.startsWith(k) && k.length >= 4))) || null;
}

// The lines with their amounts, the essential and full totals, and income.
export function computeBudget(budget, measured, payees = []) {
  const b = budget || defaultBudget();
  const marked = new Set(b.essentialPayees || []);
  const detail = payees.map((p) => ({ ...p, essential: marked.has(p.key) }));
  const lines = (b.expenses || []).map((e) => {
    const value = e.measured && e.amount == null ? (measured?.amount ?? null) : e.amount;
    const line = { ...e, value, source: e.measured ? (e.amount == null ? 'measured' : 'entered') : 'entered' };
    if (e.measured) {
      line.payees = detail;
      // With payees marked, the essential part of the measured spending is
      // theirs; with your own figure for the line, its checkbox decides.
      line.essentialValue = e.amount == null && marked.size
        ? round2(detail.filter((p) => p.essential).reduce((s, p) => s + p.perMonth, 0))
        : e.essential ? value : 0;
    } else {
      line.essentialValue = e.essential ? value : 0;
      line.alsoMeasured = alsoMeasured(e.name, detail);
    }
    return line;
  });
  const sum = (list, k = 'value') => round2(list.reduce((s, e) => s + (e[k] || 0), 0));
  const yearly = (Number(b.salary) || 0) + (Number(b.otherIncome) || 0);
  const any = lines.some((e) => e.value > 0);
  return {
    essentialPayees: [...marked],
    salary: b.salary ?? null,
    otherIncome: b.otherIncome ?? null,
    otherSaving: b.otherSaving ?? null,
    monthlyIncome: yearly > 0 ? round2(yearly / 12) : null,
    lines,
    essential: any ? sum(lines, 'essentialValue') : null,
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
  const otherSaving = num(input?.otherSaving);
  if (otherSaving != null && !(otherSaving >= 0)) throw new Error('Enter monthly saving as a number.');
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
  const essentialPayees = [...new Set((Array.isArray(input?.essentialPayees) ? input.essentialPayees : []).map((k) => String(k).slice(0, 80)))].slice(0, 300);
  return { salary, otherIncome, otherSaving, expenses, essentialPayees };
}

function round2(x) { return Math.round(x * 100) / 100; }
