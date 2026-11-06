// The (i) buttons: a short explanation of a section or a term, opened beside
// the button. All the wording lives here, so it's easy to reword.

export const INFO = {
  // ---- cards ----
  networth: ['Net worth over time', 'Everything you own minus everything you owe, recorded once a day for every account. The chart grows a point a day from your first sync. <b>By type</b> shows what it is made of: home equity, retirement, cash and so on.'],
  health: ['Financial health', 'The first checks a financial advisor makes, each against a common rule of thumb. They are starting points for a conversation, not verdicts: your situation may call for different numbers. A check with a link is missing something you can fill in.'],
  assets: ['Assets', 'What you own, grouped by kind: cash, investments, retirement accounts, your home and so on. Values come from your banks, from daily prices, or from what you entered.'],
  debts: ['Debts', 'What you owe: mortgage, car loan, credit cards and other loans, as your lenders report them.'],
  retire: ['Retirement outlook', 'A projection of your retirement savings to the age you choose, compared with what you would need for the income you want. It is a guide: real markets move unevenly, so it shows a range from a poor to a good market rather than one number.'],
  growth: ['Value vs. money put in', 'The solid line is what the account is worth each day. The dashed line is what was in it at the start plus every contribution since. The gap between them is what the market did: gains when the solid line is above, losses when below.'],
  mix: ['Investment mix', 'How your investments split between US stocks, international stocks, bonds and cash. Stocks grow more over time but swing more; bonds and cash are steadier. Advisors usually suggest a target mix based on how far off you need the money.'],
  fees: ['What your investments cost', 'Every fund charges a yearly fee, its expense ratio, taken out of its returns rather than billed, so it is easy to miss. This turns each fee into dollars a year, and shows what it adds up to as your money grows.'],
  holdings: ['Top holdings', 'Each stock and fund you own across all your accounts, with its value. Gain is what it is worth minus what you paid, where that is known.'],
  buckets: ['Savings buckets', 'Your bank only reports an account total. Buckets split it into what the money is for: an emergency fund, a vacation, a down payment. Each holds a set amount except one, which holds the rest of the balance.'],
  budget: ['Income and expenses', 'Your income, and what you spend each month, including bills paid from accounts FinTrack does not track (a joint account, for example). The health checks and the emergency fund use these.'],
  cashflow: ['Cash flow', 'Money in and money out of your checking, savings and card accounts each month. Moving money between your own accounts is left out. Money that never passes through a tracked account is not seen.'],
  loan: ['Loans', 'Your loan balance comes from your lender. With the rate and payment, FinTrack works out the payoff date, how each payment splits into interest and principal, and what paying more would save.'],
  accounts: ['Accounts', 'Every account FinTrack knows about: from your banks through SimpleFIN, and the ones you added by hand. Check each one\'s category; it decides where the account counts.'],
  transactions: ['Recent transactions', 'The latest transactions from your bank and card accounts. Transfers between your own accounts are marked.'],
  protChecks: ['Where you stand', 'Rough checks on your insurance and estate planning: is there life and disability cover, a will, beneficiaries on every account. Everything here is what you entered; FinTrack only points out gaps.'],
  policies: ['Insurance', 'The policies that protect your income and what you own. Advisors look first at life insurance (if others rely on your income), disability insurance (if you could not work) and umbrella liability (if you were sued).'],
  docs: ['Estate documents', 'The papers that say what happens if you die or can\'t make decisions. Where each is kept matters: someone will need to find it.'],
  bens: ['Beneficiaries', 'Who gets an account or a policy when you die is set by its beneficiary form, and that form overrides your will. Check each one, and again after a marriage, a birth or a divorce.'],

  // ---- summary boxes and checks ----
  t_assets: ['Assets', 'The total value of everything you own: accounts, investments, your home and car.'],
  t_debts: ['Debts', 'Everything you owe. The share of assets is a quick measure of how much of what you own is borrowed.'],
  t_cash: ['Cash', 'Checking and savings: money you can use right away.'],
  t_invested: ['Invested', 'Brokerage and retirement accounts together. The part in retirement accounts usually can\'t be taken out before about 59½ without a penalty.'],
  homeEquity: ['Home equity', 'What your home is worth minus what is left on the mortgage: the part of the home you own outright.'],
  savingsRate: ['Savings rate', 'What you save each month (into the 401(k) with any employer match, plus other saving) as a share of your income before taxes. 15% or more is the usual guide for retiring comfortably.'],
  emergency: ['Emergency fund', 'Money set aside for a job loss or a big surprise bill, measured in months of essential expenses: what you would still have to pay if your income stopped. Three to six months is the usual guide; more if your income is uneven.'],
  dti: ['Debt-to-income', 'All your monthly loan payments as a share of your income before taxes. Lenders use it to decide what you can borrow; 36% or less is the usual guide.'],
  housing: ['Housing cost', 'Your mortgage payment, with property taxes and insurance, as a share of your income before taxes. 28% or less is the usual guide.'],
  multiple: ['Retirement savings vs. salary', 'Retirement savings as a multiple of your yearly salary, compared with a common rule of thumb: about 1× by 30, 3× by 40, 6× by 50, 8× by 60, 10× by 67.'],
  outlook: ['Retirement outlook', 'Whether your projected savings would pay for the income you want, in a typical market and in a poor one. Set it up at the top of the Investments tab.'],
  protection: ['Insurance and estate', 'Life and disability cover, a will and powers of attorney, and beneficiaries named on your accounts. Filled in on the Insurance & estate tab.'],

  // ---- terms ----
  escrow: ['Escrow', 'Part of a mortgage payment that the lender sets aside to pay your property taxes and homeowners insurance (and PMI if you have it). It does not pay down the loan. Your statement shows it.'],
  required: ['Required payment', 'The amount due on your statement. Anything you pay over it goes to principal as an extra payment, which shortens the loan and saves interest.'],
  principal: ['Interest and principal', 'Each loan payment first covers the interest for the month; the rest, the principal part, pays down what you owe. Early on most of it is interest; that shifts as the balance falls.'],
  payoff: ['Payoff date', 'When the loan would be paid off if you keep paying what you pay now, at the current rate.'],
  expenseRatio: ['Expense ratio', 'A fund\'s yearly fee, as a percent of what you hold in it: 0.50% on $10,000 is $50 a year. It is taken out of the fund\'s returns, so you never see a bill. For a 401(k), the plan\'s fee disclosure lists it; for other funds, the fund\'s page does.'],
  weighted: ['Weighted expense ratio', 'Your funds\' fees averaged by how much you hold in each: a big fund with a high fee counts more than a small one.'],
  feeDrag: ['Fees over the years', 'Fees come out every year from a growing balance, so they compound like growth does. This is what that yearly rate would take from today\'s balance over 10 and 20 years, at 6% growth before fees and no new money.'],
  gain: ['Gain and cost basis', 'Gain is what a holding is worth now minus what you paid (its cost basis). Some brokerages don\'t report what you paid; enter your average cost per share, shown in your brokerage\'s app, to see it.'],
  putIn: ['Money put in', 'Your balance when the chart starts plus every contribution since (yours and an employer match). Reinvested dividends count as market growth, not money put in, since they are earnings.'],
  todaysDollars: ['Today\'s dollars', 'Amounts adjusted for inflation, so $5,000 a month in 20 years means what $5,000 buys today. Growth rates are shown after inflation for the same reason.'],
  withdrawal: ['The 4% rule', 'A common rule of thumb: taking about 4% of your savings in the first year of retirement, then the same amount adjusted for inflation, has historically lasted about 30 years. So each $1,000 a month of income needs about $300,000 saved.'],
  typicalReturn: ['Typical return', 'Growth per year after inflation. Left empty, FinTrack works it out from your investment mix (stocks about 5%, bonds 1.5%, cash 0.5%) less your fund fees. Poor and good markets are 2 points lower and higher.'],
  socialSecurity: ['Social Security estimate', 'Your estimated monthly benefit at the age you plan to retire, from your account at ssa.gov. It is shown in today\'s dollars, which is what FinTrack uses.'],
  blend: ['A blend', 'A fund that holds more than one kind of investment, like a target-date fund (more stocks when you are young, more bonds later) or a balanced fund. Its fact sheet lists the split.'],
  target: ['Target mix', 'The split between stocks, bonds and cash you are aiming for. A common rule of thumb holds fewer stocks the closer you are to needing the money; an advisor can help you pick one.'],
  rest: ['Holds the rest', 'Your bank reports only the account total, so one bucket takes whatever isn\'t set aside in the others. Deposits and interest land there. Make it the one you add to most, like the emergency fund.'],
  essential: ['Essential expenses', 'What you would still have to pay if your income stopped: housing, utilities, groceries, insurance, loan payments. Gifts, travel and eating out usually are not. The emergency fund is measured against these.'],
  asOf: ['As of the close', 'Fund values are set once a day, at the market close. During the day your provider usually shows yesterday\'s values, so use the date of the last close.'],
  lag: ['Business days until invested', 'How long after payday the money is actually invested in the funds. If you are paid on a Friday and the money is invested the next Wednesday, that is 3.'],
  index: ['Following home prices', 'Your home\'s value moves with the FHFA House Price Index for your state (or county), from the Federal Reserve\'s FRED site. When you type in a new value, from an appraisal or a listing site, it starts again from that.'],
  pod: ['POD and TOD', 'Banks call a beneficiary on an account "payable on death" (POD); brokerages call it "transfer on death" (TOD). Either lets the account pass straight to the person named, without going through probate.'],
  umbrella: ['Umbrella liability', 'Extra liability cover on top of your home and auto insurance, usually $1 million or more, for when someone sues you. It is often inexpensive for what it covers.'],
  poa: ['Powers of attorney', 'A financial power of attorney names someone to handle money matters if you can\'t; a healthcare power of attorney names someone to make medical decisions. Without them a court may have to appoint someone.'],
};

let pop = null, owner = null;

export function infoButton(key, label) {
  if (!INFO[key]) return '';
  return `<button type="button" class="info" data-info="${key}" aria-label="About ${(label || INFO[key][0]).replace(/"/g, '&quot;')}" aria-expanded="false">i</button>`;
}

export function closeInfo() {
  if (!pop) return;
  pop.remove();
  owner?.setAttribute('aria-expanded', 'false');
  const o = owner;
  pop = owner = null;
  return o;
}

function openInfo(btn) {
  const same = owner === btn;
  closeInfo();
  if (same) return;
  const [title, body] = INFO[btn.dataset.info];
  owner = btn;
  pop = document.createElement('div');
  pop.className = 'info-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', title);
  pop.innerHTML = `<div class="info-title">${title}</div><div class="info-body">${body}</div>`;
  // Inside an open dialog the box must be in it too, or the dialog hides it.
  (btn.closest('dialog[open]') || document.body).appendChild(pop);
  btn.setAttribute('aria-expanded', 'true');
  place();
}

function place() {
  if (!pop || !owner) return;
  const r = owner.getBoundingClientRect();
  if (!r.width) return closeInfo();
  const w = Math.min(320, innerWidth - 24);
  pop.style.width = `${w}px`;
  const h = pop.offsetHeight;
  let y = r.bottom + 8;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 8);
  const x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
  pop.style.top = `${y}px`;
  pop.style.left = `${x}px`;
}

// One listener for every (i) on the page, now and later.
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button.info');
  if (btn) { ev.preventDefault(); ev.stopPropagation(); openInfo(btn); return; }
  if (pop && !ev.target.closest('.info-pop')) closeInfo();
}, true);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && pop) { ev.preventDefault(); ev.stopPropagation(); closeInfo()?.focus(); }
}, true);
addEventListener('resize', place);
addEventListener('scroll', place, true);
addEventListener('hashchange', closeInfo);
