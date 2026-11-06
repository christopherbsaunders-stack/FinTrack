// Builds an online preview of FinTrack: the real dashboard and advisor
// report with made-up example accounts baked in, no server needed.
//
//   npm run preview -- <folder>      (default: dist-preview)
//
// The folder holds index.html (the dashboard), report.html and their files.
// It reads from preview-data.js instead of a server, and can't save,
// download or print; the preview says so when someone tries.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoState } from '../src/demo.js';
import { computeSummary } from '../src/summary.js';
import { validateBudget } from '../src/budget.js';
import { validateProtection } from '../src/protection.js';
import { revaluePriced } from '../src/sync.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'dist-preview');
mkdirSync(OUT, { recursive: true });

// ---------- example data: the demo, filled in so every section shows ----------

const now = new Date();
const s = demoState(now);
const ORGS = { Chase: 'Example Bank', 'Ally Bank': 'Online Savings Bank', Robinhood: 'Example Brokerage', Fidelity: 'Example 401(k) Provider', Vanguard: 'Example IRA Provider', 'Toyota Financial Services': 'Example Auto Finance', 'Rocket Mortgage': 'Example Mortgage Co.' };
for (const a of Object.values(s.accounts)) a.org = ORGS[a.org] || a.org;
const TX = [[/CHASE CARD AUTOPAY/i, 'CARD AUTOPAY'], [/TRANSFER TO ALLY SAVINGS/i, 'TRANSFER TO SAVINGS'], [/TRANSFER FROM CHASE/i, 'TRANSFER FROM CHECKING'], [/TOYOTA FINANCIAL PMT/i, 'AUTO LOAN PAYMENT'], [/ROCKET MORTGAGE PAYMENT/i, 'MORTGAGE PAYMENT'], [/STATE FARM INSURANCE/i, 'HOME INSURANCE'], [/ACME CORP PAYROLL/i, 'PAYROLL']];
for (const t of Object.values(s.transactions)) for (const [re, to] of TX) t.description = t.description.replace(re, to);

s.accounts.sav.buckets = [
  { id: 'em', name: 'Emergency fund', amount: null, goal: 25000, emergency: true, expenses: null },
  { id: 'va', name: 'Vacation', amount: 3000, goal: 5000, emergency: false },
  { id: 'an', name: 'Anniversary', amount: 1500, goal: null, emergency: false },
];
s.accounts.mtg.loan.required = 2250;
s.accounts.auto.loan = { ...s.accounts.auto.loan, payment: 500, required: 466.66 };
s.settings.budget = validateBudget({
  salary: 118000, otherIncome: 64000, otherSaving: 600,
  expenses: [
    { measured: true, amount: 1400, essential: true },
    { name: 'Joint account: mortgage, utilities, groceries', amount: 2900, essential: true },
    { name: 'Joint account: gifts, travel, extras', amount: 700, essential: false },
  ],
});
s.settings.retirement = { birthYear: now.getFullYear() - 42, retireAge: 65, income: 7000, socialSecurity: 2800, extraMonthly: 1500, includeTaxable: false, typicalReturn: null, withdrawalRate: 4 };
s.symbolInfo = { VTI: { type: 'ETF' }, AAPL: { type: 'EQUITY' }, NVDA: { type: 'EQUITY' }, MSFT: { type: 'EQUITY' }, AMZN: { type: 'EQUITY' } };
s.fees = { VTI: 0.03 };
s.assetClasses = {
  'acct:k401': { usStocks: 0.6, intlStocks: 0.2, bonds: 0.2, cash: 0 },
  'acct:roth': { usStocks: 0.7, intlStocks: 0.3, bonds: 0, cash: 0 },
  VTI: { usStocks: 1, intlStocks: 0, bonds: 0, cash: 0 }, AAPL: { usStocks: 1, intlStocks: 0, bonds: 0, cash: 0 },
  NVDA: { usStocks: 1, intlStocks: 0, bonds: 0, cash: 0 }, MSFT: { usStocks: 1, intlStocks: 0, bonds: 0, cash: 0 }, AMZN: { usStocks: 1, intlStocks: 0, bonds: 0, cash: 0 },
};
s.settings.targetMix = { usStocks: 55, intlStocks: 25, bonds: 20, cash: 0 };
const year = now.getFullYear();
s.settings.protection = validateProtection({
  policies: [
    { id: 'p1', type: 'life', who: 'Me', provider: 'Through work', coverage: 236000, work: true },
    { id: 'p2', type: 'life', who: 'Me', provider: 'Example Term Life', coverage: 750000, premium: 540 },
    { id: 'p3', type: 'disability', who: 'Me', provider: 'Through work', coverage: 70800, work: true },
  ],
  docs: { will: { status: 'have', reviewed: year - 5, where: 'Fire safe at home' }, financialPoa: { status: 'have', reviewed: year - 5 }, healthPoa: { status: 'unsure' }, directive: { status: 'no' } },
  beneficiaries: { k401: { named: 'yes', checked: year - 1 }, roth: { named: 'yes', checked: year - 1 }, rh: { named: 'no' }, 'policy:p1': { named: 'yes', checked: year }, 'policy:p2': { named: 'yes', checked: year } },
}, year);
revaluePriced(s, now);

// An earlier report, four months ago, from the history at that date.
const summary0 = computeSummary(s, now);
const then = summary0.composition.days.at(-121) || summary0.composition.days[0];
const h = summary0.history.find((x) => x.date === then.date) || summary0.history[0];
s.reportSnapshots = [{
  date: then.date,
  totals: { netWorth: h.netWorth, assets: h.assets, liabilities: h.liabilities, cash: then.cash, invested: then.retirement + then.investments, retirement: then.retirement, homeEquity: then.homeEquity, investments: then.investments },
  loans: summary0.loans.map((l) => ({ id: l.id, name: l.name, balance: Math.round(l.balance + l.nextPayment.principal * 4) })),
  emergencyMonths: (summary0.emergency?.months ?? 0) - 0.7,
  health: { emergency: { label: 'Emergency fund', status: 'watch', value: `${((summary0.emergency?.months ?? 0) - 0.7).toFixed(1)} months` } },
}];

const summary = { ...computeSummary(s, now), demo: true, preview: true, syncing: false, backups: { dir: null } };
writeFileSync(join(OUT, 'preview-data.js'), `// Made-up example accounts for the FinTrack preview, built ${now.toISOString().slice(0, 10)}.\nwindow.PREVIEW_SUMMARY = ${JSON.stringify(summary)};\n`);

// ---------- files ----------

for (const f of ['app.js', 'style.css', 'info.js', 'tour.js', 'report.js']) copyFileSync(join(ROOT, 'public', f), join(OUT, f));
for (const f of ['loans.js', 'hpi.js', 'reports.js']) copyFileSync(join(ROOT, 'src', f), join(OUT, f));
copyFileSync(join(ROOT, 'scripts', 'preview-shim.js'), join(OUT, 'preview-shim.js'));
writeFileSync(join(OUT, 'preview.css'), `.preview-toast { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 60; width: min(560px, calc(100% - 32px)); background: var(--text); color: var(--surface, var(--paper)); border-radius: 10px; padding: 11px 14px; font-size: 13px; line-height: 1.45; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25); }\n`);

// The dashboard page, as content for the artifact's own page skeleton.
const index = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const body = index.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace('<script type="module" src="app.js"></script>', '<script src="preview-data.js"></script>\n  <script src="preview-shim.js"></script>\n  <script type="module" src="app.js"></script>')
  .replace(/href="report\.html" target="_blank" rel="noopener"/, 'href="report.html"');
writeFileSync(join(OUT, 'index.html'), `<title>FinTrack</title>\n<link rel="stylesheet" href="style.css">\n<link rel="stylesheet" href="preview.css">\n${body.trim()}\n`);

// The report page, a full page of its own.
let report = readFileSync(join(ROOT, 'public', 'report.html'), 'utf8');
report = report
  .replace('<script type="module" src="report.js"></script>', '<script src="preview-data.js"></script>\n  <script src="preview-shim.js"></script>\n  <script type="module" src="report.js"></script>')
  .replace('<a class="btn ghost" href="/">Back to dashboard</a>', '<a class="btn ghost" href="#" data-preview-back="./">Back to dashboard</a>')
  .replace('</head>', '  <link rel="stylesheet" href="preview.css">\n</head>');
writeFileSync(join(OUT, 'report.html'), report);

console.log(`Preview built in ${OUT}`);
