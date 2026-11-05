// Investment mix: how the money in investment and retirement accounts splits
// into US stocks, international stocks, bonds and cash, against a target.
//
// state.assetClasses = { key: { usStocks, intlStocks, bonds, cash } }  (fractions adding to 1)
//   key: a holding's symbol, or 'acct:<id>' for an account with no holdings
//   data (a Roth IRA FinTrack sees only as a balance). Uninvested cash in a
//   brokerage account (balance minus holdings) is always cash.
// settings.targetMix = { usStocks, intlStocks, bonds, cash }  (percents, optional)

export const CLASSES = [
  ['usStocks', 'US stocks'],
  ['intlStocks', 'International stocks'],
  ['bonds', 'Bonds'],
  ['cash', 'Cash'],
];
const KEYS = CLASSES.map(([k]) => k);

// A first guess from the fund's name, for you to correct.
export function guessClass(name = '') {
  const n = String(name);
  if (/money market|cash reserve|treasury (bill|money)|t-bill|\bsweep\b|government money/i.test(n)) return one('cash');
  if (/target|retirement 20\d\d|lifecycle|balanced|allocation|moderate|conservative growth/i.test(n)) return null;   // a blend: ask
  if (/bond|fixed income|total return|income fund|treasury|municipal|aggregate|corporate|high yield|tips|govt|government/i.test(n)) return one('bonds');
  if (/international|intl|global ex|ex[- ]us|emerging|developed markets|europe|pacific|asia|world ex|foreign/i.test(n)) return one('intlStocks');
  return one('usStocks');
}
function one(k) { return Object.fromEntries(KEYS.map((x) => [x, x === k ? 1 : 0])); }

export function computeMix(accounts, classes = {}, target = null) {
  const items = new Map();
  const add = (key, entry, value) => {
    const cur = items.get(key) || { key, ...entry, value: 0, accounts: [] };
    cur.value += value;
    if (!cur.accounts.includes(entry.account)) cur.accounts.push(entry.account);
    items.set(key, cur);
  };
  for (const a of accounts) {
    if (!['investments', 'retirement'].includes(a.category) || a.hidden) continue;
    const holdings = (a.holdings || []).filter((h) => h.value > 0);
    if (holdings.length) {
      for (const h of holdings) {
        const key = h.symbol || `name:${h.description}`;
        add(key, { symbol: h.symbol, name: h.description, account: a.name }, h.value);
      }
      const cash = Math.round((a.value - holdings.reduce((s, h) => s + h.value, 0)) * 100) / 100;
      if (cash > 1) add(`cash:${a.id}`, { symbol: null, name: `Uninvested cash in ${a.name}`, account: a.name, fixed: 'cash' }, cash);
    } else if (a.value > 0) {
      add(`acct:${a.id}`, { symbol: null, name: `${a.name} (no holdings data)`, account: a.name, wholeAccount: true }, a.value);
    }
  }
  const list = [...items.values()].map((it) => {
    let split = it.fixed ? one(it.fixed) : classes[it.key] || null, guessed = false;
    if (!split && !it.wholeAccount) { split = guessClass(it.name); guessed = Boolean(split); }
    return { ...it, value: round2(it.value), split, guessed };
  }).sort((a, b) => b.value - a.value);

  const total = round2(list.reduce((s, it) => s + it.value, 0));
  const sums = Object.fromEntries(KEYS.map((k) => [k, 0]));
  let unclassified = 0;
  for (const it of list) {
    if (!it.split) { unclassified += it.value; continue; }
    for (const k of KEYS) sums[k] += it.value * (it.split[k] || 0);
  }
  const parts = CLASSES.map(([k, label]) => ({ key: k, label, value: round2(sums[k]), pct: total ? sums[k] / total : 0 }));
  if (unclassified > 0.5) parts.push({ key: 'unclassified', label: 'Not sorted yet', value: round2(unclassified), pct: unclassified / total });

  let vsTarget = null;
  if (target && KEYS.some((k) => target[k] > 0)) {
    vsTarget = CLASSES.map(([k, label]) => {
      const have = total ? sums[k] / total : 0;
      const want = (Number(target[k]) || 0) / 100;
      return { key: k, label, have, want, diff: have - want, dollars: round2((have - want) * total) };
    });
  }
  const stocks = total ? (sums.usStocks + sums.intlStocks) / total : 0;
  return { total, parts, items: list, stocks, vsTarget, guessed: list.filter((i) => i.guessed).length };
}

export function validateSplit(input) {
  if (input == null) return null;
  if (typeof input === 'string') {
    if (!KEYS.includes(input)) throw new Error('Unknown kind of investment.');
    return one(input);
  }
  const split = Object.fromEntries(KEYS.map((k) => [k, Number(input[k]) || 0]));
  if (KEYS.some((k) => split[k] < 0)) throw new Error('Percents must be 0 or more.');
  const sum = KEYS.reduce((s, k) => s + split[k], 0);
  if (Math.abs(sum - 100) > 0.5 && Math.abs(sum - 1) > 0.005) throw new Error(`The split adds up to ${Math.round(sum * 10) / 10}%, not 100%.`);
  const scale = sum > 1.5 ? 100 : 1;
  return Object.fromEntries(KEYS.map((k) => [k, split[k] / scale]));
}

export function validateTarget(input) {
  if (input == null) return null;
  const t = Object.fromEntries(KEYS.map((k) => [k, Number(input[k]) || 0]));
  const sum = KEYS.reduce((s, k) => s + t[k], 0);
  if (sum === 0) return null;
  if (KEYS.some((k) => t[k] < 0) || Math.abs(sum - 100) > 0.5) throw new Error(`The target adds up to ${Math.round(sum * 10) / 10}%, not 100%.`);
  return t;
}

function round2(x) { return Math.round(x * 100) / 100; }
