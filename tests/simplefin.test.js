import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSetupToken, splitAccessUrl, claimAccessUrl, fetchAccounts, normalizeAccountSet } from '../src/simplefin.js';

const b64 = (s) => Buffer.from(s).toString('base64');

test('setup token decodes to the claim URL', () => {
  assert.equal(decodeSetupToken(b64('https://bridge.simplefin.org/simplefin/claim/abc')), 'https://bridge.simplefin.org/simplefin/claim/abc');
  assert.throws(() => decodeSetupToken(''), /empty/);
  assert.throws(() => decodeSetupToken(b64('not a url')), /https/);
});

test('access URL credentials move into a Basic header', () => {
  const { base, auth } = splitAccessUrl('https://us%40r:p%3Ass@bridge.example.com/simplefin/');
  assert.equal(base, 'https://bridge.example.com/simplefin');
  assert.equal(auth, 'Basic ' + Buffer.from('us@r:p:ss').toString('base64'));
});

test('claim POSTs to the token URL and returns the access URL', async () => {
  let called;
  const fake = async (url, opts) => { called = { url, opts }; return new Response('https://u:p@host/simplefin\n'); };
  const access = await claimAccessUrl(b64('https://host/claim/xyz'), fake);
  assert.equal(access, 'https://u:p@host/simplefin');
  assert.equal(called.url, 'https://host/claim/xyz');
  assert.equal(called.opts.method, 'POST');
});

test('a used token gives a clear message', async () => {
  await assert.rejects(claimAccessUrl(b64('https://host/claim/xyz'), async () => new Response('', { status: 403 })), /already used/);
});

test('fetchAccounts sends auth and dates, and normalizes the reply', async () => {
  let seen;
  const fake = async (url, opts) => {
    seen = { url, opts };
    return Response.json({
      errors: ['Connection to Chase may need attention'],
      accounts: [{
        org: { name: 'Chase' }, id: 'A1', name: 'Checking', currency: 'USD', balance: '1,234.56', 'available-balance': '1200.00', 'balance-date': 1760000000,
        transactions: [{ id: 'T1', posted: 1759900000, amount: '-12.34', description: 'Coffee' }, { id: 'T2', posted: 0, amount: '-5', description: 'Pending' }],
        holdings: [{ symbol: 'VTI', description: 'VTI', shares: '3', market_value: '900.10', cost_basis: '800' }],
      }],
    });
  };
  const r = await fetchAccounts('https://u:p@host/simplefin', { startDate: new Date(1750000000000) }, fake);
  assert.match(seen.url, /^https:\/\/host\/simplefin\/accounts\?start-date=1750000000/);
  assert.equal(seen.opts.headers.Authorization, 'Basic ' + Buffer.from('u:p').toString('base64'));
  assert.deepEqual(r.errors, ['Connection to Chase may need attention']);
  const a = r.accounts[0];
  assert.equal(a.balance, 1234.56);
  assert.equal(a.org, 'Chase');
  assert.equal(a.transactions[0].amount, -12.34);
  assert.equal(a.transactions[0].pending, false);
  assert.equal(a.transactions[1].pending, true);
  assert.equal(a.holdings[0].value, 900.1);
});

test('normalize copes with an empty reply', () => {
  assert.deepEqual(normalizeAccountSet({}), { errors: [], accounts: [] });
});
