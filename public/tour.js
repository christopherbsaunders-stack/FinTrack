// The first-run tour: a welcome, then a pop-up for each part of the dashboard
// with Previous, Next and Skip. It switches tabs as it goes, points at the
// section it explains (or at its tab, when the section isn't showing yet),
// and dims the rest of the page.

const STEPS = [
  {
    title: 'Welcome to FinTrack',
    text: `<p>FinTrack keeps track of your money for you: bank accounts, investments, retirement savings, your home and your loans, all on one page that updates itself.</p>
      <p>Everything stays on this computer. Nothing is sent anywhere except the requests to your banks (through SimpleFIN) and for prices.</p>
      <p>This short tour shows where things are and what to set up first. It takes about two minutes.</p>`,
  },
  {
    tab: 'overview', target: '#setup', fallback: '#syncBtn',
    title: 'Connect your accounts',
    text: `<p>FinTrack reads your accounts through <b>SimpleFIN Bridge</b> (about $15 a year): sign up at bridge.simplefin.org, connect your banks, brokerage and loans there, then paste the setup token here.</p>
      <p>After that it syncs on its own every few hours. Banks update SimpleFIN about once a day.</p>`,
  },
  {
    target: '.tabs',
    title: 'Six tabs',
    text: `<p>Each tab answers one kind of question: <b>Overview</b> for the big picture, then <b>Investments</b>, <b>Savings &amp; budget</b>, <b>Loans</b>, <b>Accounts</b>, and <b>Insurance &amp; estate</b>.</p>
      <p>Click any card's title to fold it away; FinTrack remembers.</p>`,
  },
  {
    tab: 'overview', target: '#tab-overview .hero',
    title: 'Net worth at a glance',
    text: '<p>Everything you own minus everything you owe, and how it changed over 30 days and a year. The boxes next to it break it down.</p>',
  },
  {
    tab: 'overview', target: '#healthCard',
    title: 'Financial health',
    text: `<p>The checks advisors make first: savings rate, emergency fund, debt and housing costs, retirement, insurance. Each shows your number, the usual guide, and a status.</p>
      <p>Where a number is missing, the check links to where it goes, so this card doubles as a setup list.</p>`,
  },
  {
    tab: 'overview', target: '#nwChart', card: true,
    title: 'Net worth over time',
    text: '<p>FinTrack records every account once a day, so this chart grows a point a day from your first sync. Switch it to <b>By type</b> to see what your net worth is made of.</p>',
  },
  {
    tab: 'accounts', target: '#accounts', card: true,
    title: 'Your accounts',
    text: `<p>Every account in one list. Check each one's <b>category</b> (FinTrack guesses from the name), and hide any you don't want counted.</p>
      <p>The buttons on each row do more: <b>Add loan details</b> on a loan, <b>Split into buckets</b> on savings, <b>Follow home prices</b> on a home.</p>`,
  },
  {
    tab: 'accounts', target: '#addManualBtn',
    title: 'What the banks can\'t see',
    text: `<p><b>Add home, car or other</b> for things you own that no bank reports. A home can follow your state's house price index, so its value updates on its own.</p>
      <p><b>Add 401(k) by holdings</b> is for a retirement account SimpleFIN can't connect to: enter what it holds once, and FinTrack prices it every day.</p>`,
  },
  {
    tab: 'investments', target: '#retireCard',
    title: 'Retirement outlook',
    text: '<p>Are you on track? Enter your birth year, the income you\'ll want and your Social Security estimate, and FinTrack projects your retirement savings in poor, typical and good markets, and says what would close any gap.</p>',
  },
  {
    tab: 'investments', target: '#mixCard', fallback: '.tabs a[data-tab="investments"]',
    title: 'What you\'re invested in',
    text: `<p>The <b>investment mix</b> splits your investments into US stocks, international stocks, bonds and cash, and compares it with a target you set.</p>
      <p><b>What your investments cost</b> turns each fund's yearly fee into dollars. These appear once investment accounts are connected.</p>`,
  },
  {
    tab: 'savings', target: '#budgetCard',
    title: 'Income, expenses and savings',
    text: `<p>Enter your salary and monthly expenses here, including bills paid from accounts FinTrack doesn't track, and tick the essential ones. The emergency fund is measured against those.</p>
      <p>Savings buckets (an emergency fund, a vacation fund) and your monthly cash flow are on this tab too.</p>`,
  },
  {
    tab: 'loans', target: '#tab-loans .card:not([hidden])', fallback: '.tabs a[data-tab="loans"]',
    title: 'Loans',
    text: '<p>Add a loan\'s rate and payment (Accounts tab, <b>Add loan details</b>) to see its payoff date, how each payment splits into interest and principal, and how much sooner extra payments would pay it off.</p>',
  },
  {
    tab: 'protection', target: '#protChecksCard',
    title: 'Insurance & estate',
    text: '<p>A checklist advisors always ask about: life and disability insurance, a will and powers of attorney, and beneficiaries on every account. It\'s all typed in by you; FinTrack points out the gaps.</p>',
  },
  {
    target: '#reportBtn',
    title: 'The advisor report',
    text: '<p>A printable summary of everything, to save as a PDF and take to a financial advisor, with spreadsheets of the numbers. Each new report starts with what changed since the last one.</p>',
  },
  {
    target: '#settingsBtn',
    title: 'Settings and backups',
    text: `<p>How often to sync, and where to keep backups: FinTrack copies its data once a day, and a folder that syncs to OneDrive or Dropbox keeps a copy off this computer.</p>
      <p>You can take this tour again from here.</p>`,
  },
  {
    tab: 'overview',
    title: 'You\'re set',
    text: `<p>A good order to set things up: connect your accounts, check their categories, then fill in the cards the <b>Financial health</b> panel asks for.</p>
      <p>FinTrack fills in the rest a day at a time.</p>`,
  },
];

let i = 0, root = null, ring = null, onDone = null, lastFocus = null;

export function startTour({ done } = {}) {
  onDone = done;
  lastFocus = document.activeElement;
  i = 0;
  root?.remove(); ring?.remove();
  ring = document.createElement('div');
  ring.className = 'tour-ring';
  root = document.createElement('div');
  root.className = 'tour-pop';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'tourTitle');
  document.body.append(ring, root);
  addEventListener('keydown', keys, true);
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  show();
}

function finish() {
  removeEventListener('keydown', keys, true);
  removeEventListener('resize', place);
  removeEventListener('scroll', place, true);
  root?.remove(); ring?.remove();
  root = ring = null;
  lastFocus?.focus?.();
  onDone?.();
}

function keys(ev) {
  if (!root) return;
  if (ev.key === 'Escape') { ev.preventDefault(); finish(); }
  else if (ev.key === 'ArrowRight' && !ev.target.closest?.('input, textarea, select')) { ev.preventDefault(); go(1); }
  else if (ev.key === 'ArrowLeft' && !ev.target.closest?.('input, textarea, select')) { ev.preventDefault(); go(-1); }
  else if (ev.key === 'Tab') {
    // Keep keyboard focus inside the pop-up.
    const f = [...root.querySelectorAll('button')];
    const at = f.indexOf(document.activeElement);
    if (ev.shiftKey && at <= 0) { ev.preventDefault(); f.at(-1).focus(); }
    else if (!ev.shiftKey && at === f.length - 1) { ev.preventDefault(); f[0].focus(); }
  }
}

function go(d) {
  const n = i + d;
  if (n < 0) return;
  if (n >= STEPS.length) return finish();
  i = n;
  show();
}

function visible(sel) {
  if (!sel) return null;
  const el = document.querySelector(sel);
  return el && el.offsetParent !== null && el.getClientRects().length ? el : null;
}

// The element a step points at: its section, or the fallback (usually the
// section's tab) when the section isn't showing yet.
function target(step) {
  let el = visible(step.target);
  if (el && step.card) el = el.closest('.card') || el;
  if (!step.target) return null;          // the welcome and the last step sit in the middle
  return el || visible(step.fallback) || (step.tab ? visible(`.tabs a[data-tab="${step.tab}"]`) : null);
}

function show() {
  const step = STEPS[i];
  if (step.tab && location.hash !== `#${step.tab}`) location.hash = step.tab;
  const first = i === 0, last = i === STEPS.length - 1;
  root.innerHTML = `
    <div class="tour-count">${first ? 'Getting started' : `${i} of ${STEPS.length - 1}`}</div>
    <h2 id="tourTitle">${step.title}</h2>
    <div class="tour-text">${step.text}</div>
    <div class="tour-btns">
      ${last ? '' : '<button type="button" class="linkish tour-skip">Skip tutorial</button>'}
      <span class="tour-gap"></span>
      ${first ? '' : '<button type="button" class="ghost tour-prev">Previous</button>'}
      <button type="button" class="tour-next">${first ? 'Start the tour' : last ? 'Done' : 'Next'}</button>
    </div>`;
  root.querySelector('.tour-skip')?.addEventListener('click', finish);
  root.querySelector('.tour-prev')?.addEventListener('click', () => go(-1));
  root.querySelector('.tour-next').addEventListener('click', () => go(1));
  // Let the tab switch draw before measuring.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = target(step);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    place();
    root.querySelector('.tour-next').focus();
  }));
}

function place() {
  if (!root) return;
  const el = target(STEPS[i]);
  const narrow = innerWidth < 640;
  root.classList.toggle('centered', !el);
  root.classList.toggle('sheet', narrow && Boolean(el));
  if (!el) {
    ring.style.cssText = 'top:50%;left:50%;width:0;height:0;';
    root.style.cssText = '';
    return;
  }
  const r = el.getBoundingClientRect();
  const pad = 6;
  const top = Math.max(r.top - pad, 4), left = Math.max(r.left - pad, 4);
  const height = Math.min(r.height + pad * 2, innerHeight - top - 4);
  ring.style.cssText = `top:${top}px;left:${left}px;width:${Math.min(r.width + pad * 2, innerWidth - left - 4)}px;height:${height}px;`;
  if (narrow) { root.style.cssText = ''; return; }
  const w = Math.min(380, innerWidth - 32);
  const h = root.offsetHeight;
  let y = r.bottom + 14;
  if (y + h > innerHeight - 12) y = r.top - h - 14;            // above, if there's no room below
  if (y < 12) y = Math.min(Math.max(12, r.top + 12), innerHeight - h - 12);   // over a tall section
  const x = Math.min(Math.max(16, r.left + r.width / 2 - w / 2), innerWidth - w - 16);
  root.style.cssText = `top:${y}px;left:${x}px;width:${w}px;`;
}
