// Report snapshots: a few numbers saved each time the advisor report is
// printed, so the next report can open with what changed since. Pure; the
// report page loads this file too.

export function makeSnapshot(sum, now = new Date()) {
  const t = sum.totals;
  const cat = Object.fromEntries((sum.byCategory || []).map((c) => [c.category, c.total]));
  return {
    date: localDay(now),
    totals: {
      netWorth: t.netWorth, assets: t.assets, liabilities: t.liabilities, cash: t.cash,
      invested: t.invested, retirement: t.retirement, homeEquity: t.homeEquity ?? null,
      investments: cat.investments ?? 0,
    },
    loans: (sum.loans || []).map((l) => ({ id: l.id, name: l.name, balance: l.balance })),
    emergencyMonths: sum.emergency?.months ?? null,
    health: Object.fromEntries((sum.health || []).filter((c) => c.status).map((c) => [c.key, { label: c.label, status: c.status, value: c.value }])),
  };
}

// The changes from an earlier snapshot to now (another snapshot).
export function compareSnapshots(then, now) {
  const rows = [
    ['netWorth', 'Net worth'], ['assets', 'Total assets'], ['liabilities', 'Total debts'], ['cash', 'Cash'],
    ['invested', 'Invested'], ['retirement', 'of which retirement'], ['investments', 'of which brokerage'], ['homeEquity', 'Home equity'],
  ].filter(([k]) => then.totals[k] != null && now.totals[k] != null && (then.totals[k] || now.totals[k]))
    .map(([k, label]) => ({ key: k, label, then: then.totals[k], now: now.totals[k], change: round2(now.totals[k] - then.totals[k]) }));
  const loans = now.loans.map((l) => {
    const old = then.loans.find((x) => x.id === l.id);
    return old ? { name: l.name, then: old.balance, now: l.balance, paidDown: round2(old.balance - l.balance) } : null;
  }).filter(Boolean);
  const order = { attention: 0, watch: 1, good: 2 };
  const health = Object.entries(now.health).map(([k, c]) => {
    const old = then.health[k];
    if (!old || old.status === c.status) return null;
    return { label: c.label, from: old.status, to: c.status, better: order[c.status] > order[old.status], then: old.value, now: c.value };
  }).filter(Boolean);
  const days = Math.round((Date.parse(now.date) - Date.parse(then.date)) / 86400000);
  return { since: then.date, days, rows, loans, health, emergency: then.emergencyMonths != null && now.emergencyMonths != null ? { then: then.emergencyMonths, now: now.emergencyMonths } : null };
}

// The most recent snapshot from before today (a report printed today
// compares with the one before it).
export function lastBefore(snapshots, today) {
  return [...(snapshots || [])].filter((s) => s.date < today).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

export function localDay(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function round2(x) { return Math.round(x * 100) / 100; }
