import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart, mergeHistory, chartUrl } from '../src/prices.js';
import { investDates, addBusinessDays, parsePaychexCsv, valuePriced, sharesFromValue } from '../src/priced.js';
import { emptyState } from '../src/store.js';
import { syncAll } from '../src/sync.js';
import { computeSummary } from '../src/summary.js';

// Yahoo stamps daily bars at the market open: 9:30 New York = 14:30 UTC in winter.
const open = (d) => Date.parse(`${d}T14:30:00Z`) / 1000;

function chart(ticker, closes, { dividends = {}, capitalGains = {} } = {}) {
  const days = Object.keys(closes);
  return {
    chart: {
      error: null,
      result: [{
        meta: { symbol: ticker, currency: 'USD', gmtoffset: -18000, longName: `${ticker} Fund`, regularMarketPrice: closes[days.at(-1)], regularMarketTime: open(days.at(-1)) + 23400 },
        timestamp: days.map(open),
        indicators: { quote: [{ close: days.map((d) => closes[d]) }] },
        events: {
          dividends: Object.fromEntries(Object.entries(dividends).map(([d, amount]) => [open(d), { amount, date: open(d) }])),
          capitalGains: Object.fromEntries(Object.entries(capitalGains).map(([d, amount]) => [open(d), { amount, date: open(d) }])),
        },
      }],
    },
  };
}

test('Yahoo chart replies become dated closes and payouts', () => {
  const h = parseChart('aaa', chart('AAA', { '2026-11-02': 10, '2026-11-03': 10.5 }, { capitalGains: { '2026-11-03': 1.25 } }));
  assert.equal(h.ticker, 'AAA');
  assert.deepEqual(h.closes, { '2026-11-02': 10, '2026-11-03': 10.5 });
  assert.deepEqual(h.events, [{ date: '2026-11-03', type: 'capitalGain', amount: 1.25 }]);
  assert.match(chartUrl('aaa', '2y'), /chart\/AAA\?range=2y&interval=1d&events=div%7Csplit%7CcapitalGain/);
  const prices = {};
  mergeHistory(prices, h);
  mergeHistory(prices, parseChart('AAA', chart('AAA', { '2026-11-04': 11 })));
  assert.deepEqual(Object.keys(prices.AAA.closes), ['2026-11-02', '2026-11-03', '2026-11-04']);
  assert.equal(prices.AAA.events.length, 1);
});

test('paid the last business day of the month, invested 3 business days later', () => {
  const s = { every: 'month', day: 'lastBusiness', lag: 3 };
  // Oct 31 2026 is a Saturday: paid Fri Oct 30, invested Wed Nov 4.
  assert.deepEqual(investDates(s, '2026-10-01', '2026-11-30'), ['2026-10-05', '2026-11-04']);
  // Nov 30 (Mon) -> Dec 3; Dec 31 (Thu) -> Jan 5.
  assert.deepEqual(investDates(s, '2026-11-05', '2027-01-31'), ['2026-12-03', '2027-01-05']);
  assert.equal(addBusinessDays('2026-11-06', 1), '2026-11-09');
  assert.deepEqual(investDates({ every: '2weeks', anchor: '2026-11-06', lag: 0 }, '2026-11-01', '2026-12-01'), ['2026-11-06', '2026-11-20']);
});

const CSV = `Date, Transaction, InvestmentName, Ticker, Amount, Price, Shares
11/04/2026,Employee Pre-Tax Contribution,Fund A Growth,AAA,700.00,10.00,70.0000,
11/04/2026,Employee Pre-Tax Contribution,Fund B Bonds,BBB,300.00,20.00,15.0000,
11/04/2026,Employer Match Contribution,Fund A Growth,AAA,140.00,10.00,14.0000,
11/04/2026,Employer Match Contribution,Fund B Bonds,BBB,60.00,20.00,3.0000,
`;

test('a Paychex transactions file: rows, period, and the plan it implies', () => {
  const p = parsePaychexCsv(CSV, 'Transactions_2026-11-01_2026-11-05.csv');
  assert.equal(p.rows.length, 4);
  assert.deepEqual(p.rows[0], { key: '2026-11-04|Employee Pre-Tax Contribution|AAA|700|70', date: '2026-11-04', ticker: 'AAA', shares: 70, amount: 700, price: 10, kind: 'Employee Pre-Tax Contribution', description: 'Fund A Growth' });
  assert.equal(p.from, '2026-11-01');
  assert.equal(p.to, '2026-11-05');
  assert.deepEqual(p.suggestion, { date: '2026-11-04', amount: 1200, allocation: { AAA: 70, BBB: 30 }, names: { AAA: 'Fund A Growth', BBB: 'Fund B Bonds' } });
  const fee = parsePaychexCsv('Date,Transaction,InvestmentName,Ticker,Amount,Price,Shares\n12/31/2026,Plan Administration Fee,"Fund A, Growth",AAA,1.00,10.00,0.1000\n');
  assert.equal(fee.rows[0].shares, -0.1);
  assert.equal(fee.rows[0].description, 'Fund A, Growth');
  assert.throws(() => parsePaychexCsv('a,b\n1,2'), /Paychex/);
});

const PRICES = {
  AAA: { closes: { '2026-11-04': 10, '2026-11-05': 10.2, '2026-12-03': 11, '2026-12-04': 11, '2026-12-10': 9 }, events: [{ date: '2026-12-10', type: 'capitalGain', amount: 2 }] },
  BBB: { closes: { '2026-11-04': 20, '2026-11-05': 20, '2026-12-03': 20, '2026-12-04': 20, '2026-12-10': 20 }, events: [] },
};
const plan = { enabled: true, amount: 1200, allocation: { AAA: 70, BBB: 30 }, schedule: { every: 'month', day: 'lastBusiness', lag: 3 } };

test('value from shares, then estimated contributions and reinvested payouts', () => {
  const priced = { asOf: '2026-11-04', positions: [{ ticker: 'AAA', shares: 1000 }, { ticker: 'BBB', shares: 500 }], ledger: [], coveredUntil: '2026-11-05', plan };
  const nov = valuePriced(priced, PRICES, '2026-11-05');
  assert.equal(nov.value, 1000 * 10.2 + 500 * 20);
  assert.equal(nov.estimates.length, 0);
  assert.deepEqual(nov.series.map((p) => p.date), ['2026-11-04', '2026-11-05']);

  // Dec 3: 840 into AAA at 11 and 360 into BBB at 20.
  const dec4 = valuePriced(priced, PRICES, '2026-12-04');
  const aaa = 1000 + 840 / 11;
  assert.equal(dec4.holdings.find((h) => h.symbol === 'AAA').shares, Math.round(aaa * 1e4) / 1e4);
  assert.equal(dec4.value, Math.round((aaa * 11 + 518 * 20) * 100) / 100);
  assert.deepEqual(dec4.estimates.map((e) => [e.date, e.ticker, e.amount]), [['2026-12-03', 'AAA', 840], ['2026-12-03', 'BBB', 360]]);

  // Dec 10: AAA pays $2 a share and its price drops; the payout buys more shares, so value holds.
  const dec10 = valuePriced(priced, PRICES, '2026-12-10');
  const aaaAfter = aaa + (aaa * 2) / 9;
  assert.equal(dec10.holdings.find((h) => h.symbol === 'AAA').value, Math.round(aaaAfter * 9 * 100) / 100);
  assert.equal(Math.round(aaaAfter * 9), Math.round(aaa * 11));
  assert.equal(dec10.estimates.at(-1).kind, 'capitalGain');
});

test('an imported file replaces the estimates for the days it covers', () => {
  const real = [{ key: 'k1', date: '2026-12-03', ticker: 'AAA', shares: 75, amount: 825 }, { key: 'k2', date: '2026-12-03', ticker: 'BBB', shares: 18, amount: 360 }];
  const priced = { asOf: '2026-11-04', positions: [{ ticker: 'AAA', shares: 1000 }, { ticker: 'BBB', shares: 500 }], ledger: real, coveredUntil: '2026-12-05', plan };
  const v = valuePriced(priced, PRICES, '2026-12-05');
  assert.equal(v.estimates.length, 0);
  assert.deepEqual(v.holdings.map((h) => [h.symbol, h.shares]), [['AAA', 1075], ['BBB', 518]]);
});

test('a payday whose price is not out yet waits for it', () => {
  const priced = { asOf: '2026-11-04', positions: [{ ticker: 'AAA', shares: 1 }], ledger: [], coveredUntil: '2026-11-05', plan: { ...plan, allocation: { AAA: 100 } } };
  const p = { AAA: { closes: { '2026-11-04': 10, '2026-12-02': 10 }, events: [] } };
  const v = valuePriced(priced, p, '2026-12-03');
  assert.equal(v.estimates.length, 0);
  assert.deepEqual(v.waiting, [{ date: '2026-12-03', ticker: 'AAA' }]);
});

test('shares from a value use that day\'s close', () => {
  assert.deepEqual(sharesFromValue(1020, PRICES, 'AAA', '2026-11-05'), { shares: 100, price: 10.2, priceDate: '2026-11-05' });
  assert.throws(() => sharesFromValue(1, PRICES, 'AAA', '2026-01-01'), /No price/);
});

test('syncAll prices a 401(k) without SimpleFIN and records it', async () => {
  const s = emptyState();
  s.snapshots['2026-11-04'] = {};
  s.accounts.k = {
    id: 'k', name: '401(k)', org: 'Paychex Flex', balance: 0, category: 'retirement', source: 'priced', holdings: [],
    priced: { asOf: '2026-11-04', positions: [{ ticker: 'AAA', shares: 1000 }, { ticker: 'BBB', shares: 500 }], ledger: [], coveredUntil: '2026-11-05', plan },
  };
  const urls = [];
  const fake = async (url) => {
    urls.push(url);
    const t = /chart\/(\w+)/.exec(url)[1];
    return Response.json(chart(t, { '2026-11-04': t === 'AAA' ? 10 : 20, '2026-11-05': t === 'AAA' ? 10.2 : 20 }));
  };
  const now = new Date('2026-11-05T23:00:00');
  const r = await syncAll(s, { now, fetchImpl: fake });
  assert.deepEqual(r.priceErrors, []);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /range=2y/);
  assert.equal(s.accounts.k.balance, 20200);
  assert.equal(s.snapshots['2026-11-05'].k, 20200);
  assert.equal(s.snapshots['2026-11-04'].k, 20000, 'past day filled from the price history');
  const sum = computeSummary(s, now);
  assert.equal(sum.totals.retirement, 20200);
  assert.equal(sum.accounts[0].priced.ledger, undefined);
  assert.equal(sum.holdings.length, 2);

  await syncAll(s, { now, fetchImpl: fake });
  assert.match(urls[2], /range=1mo/);
});

test('an unknown ticker is reported, not fatal', async () => {
  const s = emptyState();
  s.accounts.k = { id: 'k', name: '401(k)', balance: 0, category: 'retirement', source: 'priced', holdings: [],
    priced: { asOf: '2026-11-04', positions: [{ ticker: 'ZZZZX', shares: 1 }], ledger: [], coveredUntil: '2026-11-04', plan: { enabled: false } } };
  const fake = async () => Response.json({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }, { status: 404 });
  const r = await syncAll(s, { now: new Date('2026-11-05T12:00:00'), fetchImpl: fake });
  assert.match(r.priceErrors[0], /No prices found for ZZZZX/);
});

test('value vs money put in: contributions count, payouts and price moves are market', () => {
  const priced = { asOf: '2026-11-04', positions: [{ ticker: 'AAA', shares: 1000 }, { ticker: 'BBB', shares: 500 }], ledger: [], coveredUntil: '2026-11-05', plan };
  const v = valuePriced(priced, PRICES, '2026-12-10');
  const first = v.series[0], last = v.series.at(-1);
  assert.equal(first.date, '2026-11-04');
  assert.equal(first.invested, first.value);
  assert.equal(last.putIn, 1200, 'the Dec 3 paycheck; the Dec 10 payout is not money put in');
  assert.equal(last.invested, first.value + 1200);
  const dec3 = v.series.find((p) => p.date === '2026-12-03');
  assert.equal(dec3.putIn, 1200);
  // An imported contribution counts; an exchange between funds doesn't.
  const ledger = [
    { key: 'a', date: '2026-11-05', ticker: 'AAA', shares: 10, amount: 102, kind: 'Employee Pre-Tax Contribution' },
    { key: 'b', date: '2026-11-05', ticker: 'BBB', shares: 5, amount: 100, kind: 'Fund Transfer In' },
    { key: 'c', date: '2026-11-05', ticker: 'AAA', shares: -9.8, amount: -100, kind: 'Fund Transfer Out' },
  ];
  const w = valuePriced({ ...priced, ledger, plan: { enabled: false } }, PRICES, '2026-11-05');
  assert.equal(w.series.at(-1).putIn, 102);
});
