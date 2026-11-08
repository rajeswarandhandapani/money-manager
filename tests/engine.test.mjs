// Uses made-up merchants in each bank's real layout. No real transactions belong in this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readExport, parseAmount, parseDate, dateOrder, parseCsv, looksFlipped, guessMapping, normalizeRows } from '../js/parse.js';
import { classifyAll, learn, suggest, merchantKey, DEFAULT_CATEGORIES as CATS } from '../js/classify.js';
import { monthSummary, yearMatrix, previousMonth, missingCards, monthChoices } from '../js/report.js';

const CHECKING = `Transaction Date,Transaction Description,Amount,Category
2026-10-30,CHASE CREDIT CRD AUTOPAY ACH DEBIT xxxxxxxxxxx0001,- $100.5,Credit Card Payments
2026-10-13,ONLINE PAYMENT TO xxxxxx1111,- $20,Transfers
2026-10-07,CORNER RENT LLC ACH WEB-RECUR 2FMPQG,- $1200.25,Services and Supplies
2026-10-05,PAYROLL DEPOSIT ACH CREDIT 9931,+ $3000,Income
`;
const CHASE = `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
10/28/2026,10/28/2026,AUTOMATIC PAYMENT - THANK,,Payment,100.50,
10/26/2026,10/28/2026,SHOE SHOP  DOWNTOWN,Shopping,Return,18.18,
10/16/2026,10/18/2026,SHOE SHOP  DOWNTOWN,Shopping,Sale,-36.36,
10/13/2026,10/14/2026,FUEL STOP 8000653202,Gas,Sale,-65.27,
10/10/2026,10/11/2026,BUS FARE,Travel,Sale,-2.75,
10/10/2026,10/11/2026,BUS FARE,Travel,Sale,-2.75,
`;
const PNC_CARD = `Date,Description,Amount
"10/24/2026","FUEL STOP 8000653202 PITTSBURGH PA","$42.5"
"10/10/2026","THANK YOU FOR YOUR PMT 10 10 XXXX1111      ","$-20"
`;

const load = () => [
  readExport(CHECKING, 'accountActivityExport.csv'),
  readExport(CHASE, 'Chase1234_Activity.csv'),
  readExport(PNC_CARD, 'CreditCardActivityExport.csv'),
];

test('amounts in every style the banks use', () => {
  assert.equal(parseAmount('- $1413.82'), -141382);
  assert.equal(parseAmount('+ $5'), 500);
  assert.equal(parseAmount('$-151.16'), -15116);
  assert.equal(parseAmount('$42.5'), 4250);
  assert.equal(parseAmount('(45.00)'), -4500);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount('-12.65'), -1265);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('n/a'), null);
});

test('dates in every style', () => {
  assert.equal(parseDate('2026-10-30'), '2026-10-30');
  assert.equal(parseDate('10/03/2026'), '2026-10-03');
  assert.equal(parseDate('1/5/26'), '2026-01-05');
  assert.equal(parseDate('Oct 3, 2026'), '2026-10-03');
  assert.equal(parseDate('46023'), '2026-01-01');
  assert.equal(parseDate('13/45/2026'), null);
  assert.equal(parseDate('02/30/2026'), null);
  assert.equal(dateOrder(['01/02/2026', '25/02/2026']), 'dmy');
  assert.equal(parseDate('03/02/2026', 'dmy'), '2026-02-03');
  assert.equal(dateOrder(['01/02/2026', '02/25/2026']), 'mdy');
});

test('quoted commas and BOM', () => {
  assert.deepEqual(parseCsv('﻿a,b\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('each export is recognized and spend comes out positive', () => {
  const [checking, chase, card] = load();
  assert.equal(checking.map.id, 'pnc-checking');
  assert.equal(chase.map.id, 'chase-card');
  assert.equal(chase.map.account, 'Chase Credit Card 1234');
  assert.equal(card.map.id, 'pnc-card');
  assert.equal(checking.rows[2].cents, 120025);
  assert.equal(checking.rows[3].cents, -300000);
  assert.equal(chase.rows[2].cents, 3636);
  assert.equal(chase.rows[1].cents, -1818);
  assert.equal(card.rows[0].cents, 4250);
});

test('identical same-day rows both stay, and a re-import gives the same ids', () => {
  const a = readExport(CHASE, 'Chase1234.csv').rows;
  const b = readExport(CHASE, 'Chase1234.csv').rows;
  const fares = a.filter(r => r.desc === 'BUS FARE');
  assert.equal(fares.length, 2);
  assert.notEqual(fares[0].id, fares[1].id);
  assert.deepEqual(a.map(r => r.id), b.map(r => r.id));
});

test('summary lines above the header are skipped', () => {
  const r = readExport(`Account summary,,,\nBalance,,,\n${CHECKING}`, 'x.csv');
  assert.equal(r.map.id, 'pnc-checking');
  assert.equal(r.rows.length, 4);
});

test('card payments never count as spending, on either side', () => {
  const rows = classifyAll(load().flatMap(f => f.rows), {}, CATS);
  const transfers = rows.filter(r => r.kind === 'transfer').map(r => r.desc);
  assert.equal(transfers.length, 4);
  assert.ok(transfers.some(d => d.startsWith('ONLINE PAYMENT TO')), 'matched by pairing');
  assert.ok(transfers.some(d => d.startsWith('THANK YOU')));
});

test('without its matching card file, an unknown transfer waits for review', () => {
  const rows = classifyAll(readExport(CHECKING, 'x.csv').rows, {}, CATS);
  const r = rows.find(x => x.desc.startsWith('ONLINE PAYMENT TO'));
  assert.equal(r.kind, 'expense');
  assert.equal(r.needsReview, true);
});

test('checking deposit is income, card return reduces spending', () => {
  const rows = classifyAll(load().flatMap(f => f.rows), {}, CATS);
  assert.equal(rows.find(r => r.desc.startsWith('PAYROLL')).kind, 'income');
  const ret = rows.find(r => r.bankType === 'Return');
  assert.equal(ret.kind, 'expense');
  assert.equal(ret.cents, -1818);
});

test('merchant names ignore store numbers and reference codes', () => {
  assert.equal(merchantKey('COSTCO WHSE #0649'), 'COSTCO WHSE');
  assert.equal(merchantKey('COSTCO GAS #0649'), 'COSTCO GAS');
  assert.equal(merchantKey('AMAZON MKTPL*H25XO65P3'), 'AMAZON MKTPL');
  assert.equal(merchantKey("RITA'S # 247"), 'RITAS');
  assert.equal(merchantKey('LIBERTY MUTUAL PAYMENT ACH DEBIT AOVxxxxxxx0795'), 'LIBERTY MUTUAL PAYMENT');
});

test('learning: history suggests, and a manual change beats history', () => {
  const rules = {};
  learn(rules, { desc: 'COSTCO WHSE #0332', kind: 'expense', cat: 'Food', sub: 'Groceries' });
  learn(rules, { desc: 'COSTCO GAS #0332', kind: 'expense', cat: 'Automobile', sub: 'Fuel' });
  assert.equal(suggest(rules, 'COSTCO WHSE #0649').sub, 'Groceries');
  assert.equal(suggest(rules, 'COSTCO GAS #0649 PITTSBURGH PA').sub, 'Fuel');
  assert.equal(suggest(rules, 'COSTCO GAS #0649 PITTSBURGH PA').sure, true);

  learn(rules, { desc: 'COSTCO WHSE #1', kind: 'expense', cat: 'Family', sub: 'Consumables' }, { manual: true });
  assert.equal(suggest(rules, 'COSTCO WHSE #0649').cat, 'Family');
});

test('a merchant split across categories is flagged rather than guessed silently', () => {
  const rules = {};
  learn(rules, { desc: 'BIG STORE', kind: 'expense', cat: 'Food', sub: 'A' });
  learn(rules, { desc: 'BIG STORE', kind: 'expense', cat: 'Family', sub: 'B' });
  assert.equal(suggest(rules, 'BIG STORE').sure, false);
});

test('marking a merchant as a transfer sticks', () => {
  const rules = {};
  learn(rules, { desc: 'ZELLE TO A FRIEND', kind: 'transfer' }, { manual: true });
  const [r] = classifyAll([{ desc: 'ZELLE TO A FRIEND', cents: 500, accountType: 'checking' }], rules, CATS);
  assert.equal(r.kind, 'transfer');
  assert.equal(r.needsReview, false);
});

test('unknown format: first guess covers debit and credit columns', () => {
  const headers = ['Status', 'Date', 'Description', 'Debit', 'Credit'];
  const map = { ...guessMapping(headers), account: 'Other Card' };
  assert.equal(map.amountMode, 'debitCredit');
  const { rows } = normalizeRows([['Cleared', '10/02/2026', 'SHOP', '12.50', ''], ['Cleared', '10/03/2026', 'REFUND', '', '-5.00']], headers, map);
  assert.deepEqual(rows.map(r => r.cents), [1250, -500]);
});

test('a backwards card file is detected', () => {
  assert.equal(looksFlipped([{ cents: -1 }, { cents: -2 }, { cents: 3 }], 'card'), true);
  assert.equal(looksFlipped([{ cents: 1 }, { cents: 2 }, { cents: -3 }], 'card'), false);
});

test('a merchant given different categories on different rows stays flagged', () => {
  const rules = {};
  learn(rules, { id: 'a', desc: 'AMAZON MKTPL*1', kind: 'expense', cat: 'Family', sub: 'Consumables' }, { manual: true });
  assert.equal(suggest(rules, 'AMAZON MKTPL*2').sure, true);
  learn(rules, { id: 'b', desc: 'AMAZON MKTPL*3', kind: 'expense', cat: 'Children', sub: 'Toys' }, { manual: true });
  assert.equal(suggest(rules, 'AMAZON MKTPL*4').sure, false);
});

test('picking a category then a subcategory on one row is not a conflict', () => {
  const rules = {};
  learn(rules, { id: 'a', desc: 'SHOP', kind: 'expense', cat: 'Family', sub: '' }, { manual: true });
  learn(rules, { id: 'a', desc: 'SHOP', kind: 'expense', cat: 'Family', sub: 'Storage' }, { manual: true });
  assert.equal(suggest(rules, 'SHOP').sure, true);
});

test('payments to people are always flagged unless you pinned that person', () => {
  const rules = {};
  learn(rules, { desc: 'ZELLE TO PERSON A', kind: 'expense', cat: 'Entertainment', sub: 'Movies' });
  assert.equal(suggest(rules, 'ZELLE TO PERSON A').sure, false);
  assert.equal(suggest(rules, 'ZELLE TO PERSON B'), null);
  learn(rules, { id: 'x', desc: 'ZELLE TO PERSON A', kind: 'expense', cat: 'Gifts', sub: 'GeneralGifting' }, { manual: true });
  assert.equal(suggest(rules, 'ZELLE TO PERSON A').sure, true);
});

test('month choices include months with no data', () => {
  const months = monthChoices([{ date: '2026-03-05' }], '2026-11-08');
  assert.equal(months[0], '2026-11');
  assert.equal(months[months.length - 1], '2026-01');
  assert.equal(months.length, 11);
  assert.deepEqual(monthChoices([], '2026-02-01'), ['2026-02', '2026-01']);
  assert.equal(monthChoices([{ date: '2025-11-05' }], '2026-02-01').pop(), '2025-01');
});

test('warns when a card you paid has no export that month', () => {
  const rows = [
    { date: '2026-10-13', kind: 'transfer', cents: 100, desc: 'CITI AUTOPAY PAYMENT', account: 'PNC Checking' },
    { date: '2026-10-30', kind: 'transfer', cents: 100, desc: 'CHASE CREDIT CRD AUTOPAY', account: 'PNC Checking' },
    { date: '2026-10-28', kind: 'expense', cents: 100, desc: 'SHOP', account: 'Chase Credit Card 1234' },
  ];
  assert.deepEqual(missingCards(rows, '2026-10'), ['Citi']);
});

test('report totals exclude transfers and keep years apart', () => {
  const rows = [
    { date: '2026-10-02', kind: 'expense', cents: 1000, cat: 'Food', sub: 'A', account: 'X' },
    { date: '2026-10-03', kind: 'expense', cents: -250, cat: 'Food', sub: 'A', account: 'X' },
    { date: '2026-10-04', kind: 'transfer', cents: 9999, cat: '', sub: '', account: 'X' },
    { date: '2026-10-05', kind: 'income', cents: -5000, cat: 'Income', sub: 'Salary', account: 'X' },
    { date: '2027-10-05', kind: 'expense', cents: 700, cat: 'Food', sub: 'A', account: 'X' },
  ];
  const s = monthSummary(rows, '2026-10');
  assert.equal(s.spent, 750);
  assert.equal(s.earned, 5000);
  assert.equal(s.saved, 4250);
  const y = yearMatrix(rows, '2026', { Food: [] });
  assert.equal(y.table[0].months[9], 750);
  assert.equal(y.spent, 750);
  assert.equal(previousMonth('2026-01'), '2025-12');
});
