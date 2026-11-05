// Made-up accounts and a year of history, for trying the dashboard without
// connecting anything (npm run demo). Deterministic, so it looks the same each run.

import { emptyState, dayKey } from './store.js';
import { signedValue } from './classify.js';

const DAY = 86400000;

export function demoState(now = new Date()) {
  const rand = mulberry32(42);
  const state = emptyState();
  state.lastSync = now.toISOString();
  state.lastAttempt = now.toISOString();
  state.demo = true;

  const defs = [
    ['chk', 'Total Checking', 'Chase', 'cash', 6800, 0.25],
    ['sav', 'High Yield Savings', 'Ally Bank', 'cash', 21500, 0.02],
    ['rh', 'Individual Investing', 'Robinhood', 'investments', 18400, 1.1],
    ['k401', '401(k) Plan', 'Fidelity', 'retirement', 96500, 0.9],
    ['roth', 'Roth IRA', 'Vanguard', 'retirement', 31200, 0.9],
    ['card', 'Sapphire Preferred', 'Chase', 'creditCard', -1850, 0.4],
    ['auto', 'Auto Loan', 'Toyota Financial Services', 'autoLoan', -16900, 0],
    ['mtg', 'Mortgage', 'Rocket Mortgage', 'mortgage', -284000, 0],
    ['home', 'Home (estimated value)', 'Manual', 'property', 405000, 0.05, true],
    ['car', 'Car (estimated value)', 'Manual', 'vehicle', 24500, 0.05, true],
  ];

  // Walk each account back from today's balance so the year has a shape:
  // markets wobble and climb, loans shrink, savings grow.
  const series = {};
  for (const [id, , , cat, today, vol] of defs) {
    const vals = [today];
    let v = today;
    for (let d = 1; d <= 365; d++) {
      if (cat === 'investments' || cat === 'retirement') v = v / (1 + 0.00045 + (rand() - 0.5) * 0.02 * vol) - (cat === 'retirement' && d % 14 === 0 ? 900 : 0);
      else if (cat === 'mortgage') v = d % 30 === 0 ? v - 620 : v;
      else if (cat === 'autoLoan') v = d % 30 === 0 ? v - 410 : v;
      else if (cat === 'property') v = v * (1 - 0.00012) + (rand() - 0.5) * 300 * vol;
      else if (cat === 'vehicle') v = v * (1 + 0.0004);
      else if (id === 'sav') v = d % 30 === 0 ? v - 750 : v;
      else v = v + (rand() - 0.5) * 1400 * vol;
      vals.push(v);
    }
    series[id] = vals;
  }

  for (const [id, name, org, category, , , manual] of defs) {
    state.accounts[id] = {
      id, name, org, currency: 'USD', balance: series[id][0], available: null,
      balanceDate: now.toISOString(), holdings: [],
      source: manual ? 'manual' : 'simplefin', category, categoryOverride: null,
      displayName: null, hidden: false, firstSeen: now.toISOString(), lastSeen: now.toISOString(),
    };
  }
  state.accounts.mtg.loan = { rate: 6.25, payment: 2310, escrow: 465, original: 312000, termYears: 30, firstPayment: '2023-08' };
  state.accounts.auto.loan = { rate: 5.9, payment: 489, escrow: 0, original: 26500, termYears: 5, firstPayment: '2024-09' };
  state.accounts.rh.holdings = [
    ['VTI', 'Vanguard Total Stock Market ETF', 7200, 6100], ['AAPL', 'Apple Inc.', 3900, 2650],
    ['NVDA', 'NVIDIA Corp.', 3300, 1500], ['MSFT', 'Microsoft Corp.', 2400, 2150], ['AMZN', 'Amazon.com Inc.', 1600, 1700],
  ].map(([symbol, description, value, costBasis]) => ({ symbol, description, shares: 0, value, costBasis }));

  for (let d = 365; d >= 0; d--) {
    const key = dayKey(new Date(now.getTime() - d * DAY));
    const snap = {};
    for (const [id, , , cat] of defs) snap[id] = Math.round(signedValue(series[id][d], cat) * 100) / 100;
    state.snapshots[key] = snap;
  }

  // Transactions for the last six months.
  let n = 0;
  const tx = (accountId, daysAgo, amount, description) => {
    const id = `demo-${++n}`;
    const when = new Date(now.getTime() - daysAgo * DAY - 9 * 3600000);
    state.transactions[id] = { id, accountId, posted: when.toISOString(), transactedAt: null, amount, description, pending: daysAgo < 2 };
  };
  const shops = [['Whole Foods', 60, 180], ['Shell', 35, 70], ['Amazon', 15, 140], ['Netflix', 15.49, 15.49], ['Target', 25, 120],
    ['Chipotle', 11, 32], ['Costco', 90, 260], ['Starbucks', 5, 9], ['Uber', 12, 40], ['Home Depot', 20, 210]];
  for (let d = 182; d >= 0; d--) {
    if (d % 14 === 3) tx('chk', d, 3875.42, 'ACME CORP PAYROLL');
    if (d % 30 === 5) { tx('chk', d, -2310.0, 'ROCKET MORTGAGE PAYMENT'); tx('mtg', d, 2310.0, 'Payment received'); }
    if (d % 30 === 12) { tx('chk', d, -489.0, 'TOYOTA FINANCIAL PMT'); tx('auto', d, 489.0, 'Payment - thank you'); }
    if (d % 30 === 20) { tx('chk', d, -2400.0, 'CHASE CARD AUTOPAY'); tx('card', d, 2400.0, 'AUTOMATIC PAYMENT - THANK YOU'); }
    if (d % 30 === 8) { tx('chk', d, -750.0, 'TRANSFER TO ALLY SAVINGS'); tx('sav', d, 750.0, 'TRANSFER FROM CHASE'); }
    if (d % 30 === 15) tx('chk', d, -168.33, 'CITY UTILITIES');
    if (d % 30 === 22) tx('chk', d, -142.1, 'STATE FARM INSURANCE');
    if (d % 30 === 1) tx('sav', d, 71.6, 'Interest paid');
    const k = Math.floor(rand() * 3);
    for (let i = 0; i < k; i++) {
      const [shop, lo, hi] = shops[Math.floor(rand() * shops.length)];
      tx('card', d, -Math.round((lo + rand() * (hi - lo)) * 100) / 100, shop.toUpperCase());
    }
  }
  return state;
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
