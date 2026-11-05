import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, signedValue } from '../src/classify.js';

test('guesses common account types', () => {
  const cases = [
    [{ name: '401(k) Plan', org: 'Fidelity' }, 'retirement'],
    [{ name: 'ROTH IRA', org: 'Vanguard' }, 'retirement'],
    [{ name: 'Individual', org: 'Robinhood' }, 'investments'],
    [{ name: 'Total Checking', org: 'Chase' }, 'cash'],
    [{ name: 'High Yield Savings', org: 'Ally Bank' }, 'cash'],
    [{ name: 'Sapphire Preferred', org: 'Chase', balance: -500 }, 'creditCard'],
    [{ name: 'Auto Loan', org: 'Capital One' }, 'autoLoan'],
    [{ name: 'Loan', org: 'Toyota Financial Services' }, 'autoLoan'],
    [{ name: 'Mortgage', org: 'Rocket Mortgage' }, 'mortgage'],
    [{ name: 'Direct Loans', org: 'Nelnet' }, 'studentLoan'],
    [{ name: 'Mystery', org: 'Somewhere', balance: -20 }, 'otherDebt'],
    [{ name: 'Mystery', org: 'Somewhere', balance: 20 }, 'cash'],
  ];
  for (const [acct, want] of cases) assert.equal(guessCategory(acct), want, `${acct.name} @ ${acct.org}`);
});

test('debts count against net worth whatever sign the bank uses', () => {
  assert.equal(signedValue(-1000, 'mortgage'), -1000);
  assert.equal(signedValue(1000, 'mortgage'), -1000);
  assert.equal(signedValue(250, 'cash'), 250);
});
