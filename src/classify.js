// Account categories and a best guess from the account's name and institution.
// The guess is only a default: the dashboard lets you change any account's category.

export const CATEGORIES = {
  cash:        { label: 'Cash',               kind: 'asset' },
  investments: { label: 'Investments',        kind: 'asset' },
  retirement:  { label: 'Retirement',         kind: 'asset' },
  property:    { label: 'Real estate',        kind: 'asset' },
  vehicle:     { label: 'Vehicles',           kind: 'asset' },
  otherAsset:  { label: 'Other assets',       kind: 'asset' },
  creditCard:  { label: 'Credit cards',       kind: 'liability' },
  mortgage:    { label: 'Mortgage',           kind: 'liability' },
  autoLoan:    { label: 'Car loan',           kind: 'liability' },
  studentLoan: { label: 'Student loans',      kind: 'liability' },
  otherDebt:   { label: 'Other debts',        kind: 'liability' },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES);

const RULES = [
  // Order matters: specific before general.
  [/\b(401\s?\(?k\)?|403\s?\(?b\)?|457|ira|roth|retire|pension|tsp|thrift savings|sep\b|simple ira|hsa)\b/i, 'retirement'],
  [/\b(mortgage|home loan|heloc|home equity)\b/i, 'mortgage'],
  [/\b(auto|car|vehicle|motor)\b.*\b(loan|finance|financing)\b|\b(auto loan|car loan|ally auto|toyota financial|honda financial|ford credit|gm financial|tesla finance)\b/i, 'autoLoan'],
  [/\b(student|navient|nelnet|sallie mae|mohela|great lakes|fedloan|aidvantage)\b/i, 'studentLoan'],
  [/\b(credit card|visa|mastercard|amex|american express|discover card|sapphire|freedom|venture|quicksilver|card)\b/i, 'creditCard'],
  [/\b(loan|line of credit|personal loan|lending)\b/i, 'otherDebt'],
  [/\b(brokerage|individual|robinhood|stock|invest|trading|etf|crypto|coinbase|schwab one|webull|e\*?trade|wealthfront|betterment|fidelity account|joint)\b/i, 'investments'],
  [/\b(checking|savings|money market|mmda|cash|spend|deposit|cd\b|certificate)\b/i, 'cash'],
];

export function guessCategory({ name = '', org = '', balance = 0, holdings = [] } = {}) {
  const text = `${name} ${org}`;
  for (const [re, cat] of RULES) if (re.test(text)) return cat;
  if (holdings.length) return 'investments';
  return balance < 0 ? 'otherDebt' : 'cash';
}

export function kindOf(category) {
  return CATEGORIES[category]?.kind || 'asset';
}

// The value an account adds to net worth: assets count up, debts count down,
// whatever sign the bank used for the balance (most send loans as negatives,
// some as positives).
export function signedValue(balance, category) {
  const n = Number(balance) || 0;
  if (kindOf(category) === 'liability') return -Math.abs(n);
  return n;
}
