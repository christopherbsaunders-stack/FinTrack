// Financial health: the handful of checks advisors make first, each with your
// number, the usual guide, and a status. Rules of thumb, not verdicts: the
// panel says what each is measured against.
//
// Each check: { key, label, value (display text), raw, guide, status, note, missing }
//   status: 'good' | 'watch' | 'attention' | null (not enough data; `missing` says what to add)

const pct = (x) => `${Math.round(x * 100)}%`;
const money = (x) => `$${Math.round(x).toLocaleString('en-US')}`;

export function healthChecks({ budget, emergency, loans, retirement }) {
  const checks = [];
  const income = budget?.monthlyIncome || null;

  // Savings rate: what goes to the 401(k) (with the match) and other saving, against gross income.
  {
    const into401k = (budget?.ratios?.retirementPerYear || 0) / 12;
    const other = (retirement?.settings?.extraMonthly || 0) + (budget?.otherSaving || 0);
    const saved = into401k + other;
    if (!income) checks.push({ key: 'savings', label: 'Savings rate', guide: '15% or more of income', status: null, missing: 'Add your salary under Income and expenses', tab: 'savings' });
    else {
      const r = saved / income;
      checks.push({
        key: 'savings', label: 'Savings rate', raw: r, value: pct(r), guide: '15% or more of income, the employer match included',
        status: r >= 0.15 ? 'good' : r >= 0.10 ? 'watch' : 'attention',
        note: `${money(saved)} a month${into401k && other ? `: ${money(into401k)} into the 401(k) and ${money(other)} other saving` : into401k ? ' into the 401(k)' : ''}.${budget?.otherSaving == null ? ' Add what you save outside the 401(k) under Income and expenses.' : ''}`,
      });
    }
  }

  // Emergency fund: months of essential expenses.
  if (!emergency) checks.push({ key: 'emergency', label: 'Emergency fund', guide: '3 to 6 months of essential expenses', status: null, missing: 'Mark a savings bucket as the emergency fund', tab: 'accounts' });
  else if (emergency.months == null) checks.push({ key: 'emergency', label: 'Emergency fund', guide: '3 to 6 months of essential expenses', status: null, missing: 'Add your monthly expenses under Income and expenses', tab: 'savings' });
  else {
    const m = emergency.months;
    checks.push({
      key: 'emergency', label: 'Emergency fund', raw: m, value: `${m.toFixed(1)} months`, guide: '3 to 6 months of essential expenses',
      status: m >= 3 ? 'good' : m >= 1.5 ? 'watch' : 'attention',
      note: `${money(emergency.value)} against ${money(emergency.expenses)} a month${emergency.source === 'list' ? ' of essentials' : ''}.`,
    });
  }

  // Debt payments and housing cost against gross income.
  const all = (loans || []).reduce((s, l) => s + l.payment, 0);
  const housing = (loans || []).filter((l) => l.category === 'mortgage').reduce((s, l) => s + l.payment, 0);
  if (all > 0) {
    if (!income) checks.push({ key: 'dti', label: 'Debt payments', guide: '36% of income or less', status: null, missing: 'Add your salary under Income and expenses', tab: 'savings' });
    else {
      const r = all / income;
      checks.push({ key: 'dti', label: 'Debt payments', raw: r, value: pct(r), guide: '36% of income or less', status: r <= 0.36 ? 'good' : r <= 0.43 ? 'watch' : 'attention', note: `${money(all)} a month in loan payments, escrow included.` });
    }
  }
  if (housing > 0 && income) {
    const r = housing / income;
    checks.push({ key: 'housing', label: 'Housing cost', raw: r, value: pct(r), guide: '28% of income or less', status: r <= 0.28 ? 'good' : r <= 0.35 ? 'watch' : 'attention', note: `${money(housing)} a month for the mortgage, taxes and insurance.` });
  }

  // Retirement savings against salary, and the outlook.
  const sm = retirement?.salaryMultiple;
  if (!retirement?.set) checks.push({ key: 'retire', label: 'Retirement', guide: 'On track for the income you want', status: null, missing: 'Set up the Retirement outlook', tab: 'investments' });
  else {
    if (sm) {
      const ratio = sm.guide ? sm.have / sm.guide : null;
      checks.push({ key: 'multiple', label: 'Retirement savings', raw: sm.have, value: `${sm.have.toFixed(1)}× salary`, guide: `About ${sm.guide}× salary by ${retirement.age} (a common rule of thumb)`, status: ratio >= 1 ? 'good' : ratio >= 0.75 ? 'watch' : 'attention' });
    }
    const o = retirement.outcomes;
    if (retirement.settings?.income && o) {
      const status = o.poor.gap >= 0 ? 'good' : o.typical.gap >= 0 ? 'watch' : 'attention';
      checks.push({
        key: 'outlook', label: 'Retirement outlook', value: o.typical.gap >= 0 ? 'On track' : `${money(-o.typical.gap)}/mo short`,
        guide: 'On track for the income you want, even in a poor market', status,
        note: status === 'good' ? 'On track in poor, typical and good markets.' : status === 'watch' ? `On track in a typical market; about ${money(-o.poor.gap)} a month short in a poor one.` : `Short in a typical market${retirement.extraNeeded != null ? `; about ${money(retirement.extraNeeded)} more a month would close it` : ''}.`,
      });
    } else checks.push({ key: 'outlook', label: 'Retirement outlook', guide: 'On track for the income you want', status: null, missing: 'Add the income you want to the Retirement outlook', tab: 'investments' });
  }
  return checks;
}
