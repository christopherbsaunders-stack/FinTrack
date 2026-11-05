// Buckets: one account's balance split into named parts, e.g. a savings
// account holding an emergency fund, vacation money and anniversary money.
// The bank only knows the total, so every bucket holds a set amount except
// one, which holds the rest: deposits and interest land there.
//
// account.buckets = [{
//   id, name,
//   amount:    dollars set aside, or null for the bucket that holds the rest
//   goal:      optional target
//   emergency: true for the emergency fund (at most one in all accounts)
//   expenses:  optional, the emergency fund's monthly expenses to cover
// }]

export function splitBuckets(balance, buckets) {
  const set = buckets.filter((b) => b.amount != null).reduce((s, b) => s + Number(b.amount), 0);
  const rest = round2(Number(balance) - set);
  const out = buckets.map((b) => {
    const value = b.amount == null ? rest : round2(Number(b.amount));
    return { ...b, value, rest: b.amount == null, progress: b.goal > 0 ? value / b.goal : null };
  });
  const warnings = [];
  if (rest < -0.005) warnings.push(`The set amounts add up to ${money(set)}, more than the account holds (${money(balance)}). Lower one of them.`);
  return { buckets: out, warnings };
}

// Months of spending an emergency fund covers.
export function monthsCovered(value, monthlyExpenses) {
  return monthlyExpenses > 0 ? value / monthlyExpenses : null;
}

// Average money out per month over the last `n` full months (cash flow rows
// are oldest first; the current, partial month is left out).
export function averageSpending(months, currentMonth, n = 3) {
  const full = months.filter((m) => m.month < currentMonth && m.out > 0).slice(-n);
  if (!full.length) return null;
  return { amount: round2(full.reduce((s, m) => s + m.out, 0) / full.length), months: full.length };
}

export function validateBuckets(input) {
  if (!Array.isArray(input)) throw new Error('Buckets must be a list.');
  if (input.length > 20) throw new Error('Up to 20 buckets.');
  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[$,\s]/g, '')));
  const seen = new Set();
  const buckets = input.map((b, i) => {
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) throw new Error(`Bucket ${i + 1} needs a name.`);
    if (seen.has(name.toLowerCase())) throw new Error(`Two buckets are called "${name}".`);
    seen.add(name.toLowerCase());
    const amount = b.rest ? null : num(b.amount);
    if (!b.rest && !(amount >= 0)) throw new Error(`Enter an amount for ${name}.`);
    const goal = num(b.goal);
    if (goal != null && !(goal > 0)) throw new Error(`${name}'s goal must be more than $0.`);
    const expenses = num(b.expenses);
    if (expenses != null && !(expenses > 0)) throw new Error('Monthly expenses must be more than $0.');
    const id = /^[\w-]{1,40}$/.test(b.id || '') ? b.id : `b${Date.now().toString(36)}${i}`;
    return { id, name, amount, goal, emergency: Boolean(b.emergency), expenses: b.emergency ? expenses : null };
  });
  if (buckets.length && buckets.filter((b) => b.amount == null).length !== 1) throw new Error('Pick one bucket to hold the rest of the balance.');
  if (buckets.filter((b) => b.emergency).length > 1) throw new Error('Only one bucket can be the emergency fund.');
  return buckets;
}

function round2(x) { return Math.round(x * 100) / 100; }
function money(x) { return `$${Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
