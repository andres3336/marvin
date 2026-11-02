import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAmount,
  parseCsv,
  parseDate,
  parseTransactions,
} from '../public/assets/csv.js';
import {
  formatAmount,
  formatNumber,
  formatTableDate,
  monthKey,
  normalizeText,
  roundUp,
} from '../public/assets/format.js';

const SAMPLE_CSV = `Fecha,Comercio,Monto
11/01/2026 05:39 PM,JUNIOR ANDRES,"(15,000)"
09/20/2026 11:40 AM,PALI CASTELLANA,"5,222"
`;

test('parseCsv handles quotes, escaped quotes, commas and CRLF', () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1', 'x, y', 'say "hi"'],
  ]);
});

test('parseCsv removes a UTF-8 BOM', () => {
  assert.deepEqual(parseCsv('\uFEFFFecha,Monto\n'), [['Fecha', 'Monto']]);
});

test('parseAmount reads plain colones', () => {
  assert.equal(parseAmount('2252'), 2252);
  assert.equal(parseAmount('2,252'), 2252);
  assert.equal(parseAmount('1.234.567'), 1234567);
  assert.equal(parseAmount('CRC 2,252.00'), 2252);
  assert.equal(parseAmount('₡ 2 252'), 2252);
});

test('parseAmount reads decimal and accounting formats', () => {
  assert.equal(parseAmount('2.252,50'), 2252.5);
  assert.equal(parseAmount('2,252.50'), 2252.5);
  assert.equal(parseAmount('12,34'), 12.34);
  assert.equal(parseAmount('(1,250)'), -1250);
  assert.equal(parseAmount('-15,000'), -15000);
  assert.ok(Number.isNaN(parseAmount('')));
  assert.ok(Number.isNaN(parseAmount('n/a')));
});

test('parseDate understands the published sheet format', () => {
  assert.equal(parseDate('01/15/2026 01:05 PM').getTime(), new Date(2026, 0, 15, 13, 5).getTime());
  assert.equal(parseDate('01/15/2026 12:05 AM').getTime(), new Date(2026, 0, 15, 0, 5).getTime());
  assert.equal(parseDate('01/15/2026 12:05 PM').getTime(), new Date(2026, 0, 15, 12, 5).getTime());
  assert.equal(parseDate('15/01/2026 13:05').getTime(), new Date(2026, 0, 15, 13, 5).getTime());
  assert.equal(parseDate('2026-01-15T13:05:00').getTime(), new Date(2026, 0, 15, 13, 5).getTime());
  assert.equal(parseDate('02/30/2026'), null);
  assert.equal(parseDate(''), null);
});

test('parseTransactions skips empty and header rows and rounds up', () => {
  const csv = `,,,
Fecha,Comercio,Monto
01/15/2026 01:05 PM,Pali,"2,252"
01/16/2026 09:30 AM,"Automercado, Escazu",15340.25
,,,

Fecha,Comercio,Monto
`;
  const transactions = parseTransactions(csv);

  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].merchant, 'Pali');
  assert.equal(transactions[0].amount, 2252);
  assert.equal(transactions[1].merchant, 'Automercado, Escazu');
  assert.equal(transactions[1].amount, 15341);
  assert.ok(transactions[0].date instanceof Date);
});

test('parseTransactions works without a description column', () => {
  const [transaction] = parseTransactions(SAMPLE_CSV);
  assert.equal(transaction.merchant, 'JUNIOR ANDRES');
  assert.equal(transaction.amount, -15000);
  assert.equal(transaction.description, undefined);
});

test('parseTransactions ignores an extra description column', () => {
  const csv = `Fecha,Comercio,Descripcion,Monto
01/15/2026 01:05 PM,Pali,PALI MIRAFLORES,"2,252"
`;
  const [transaction] = parseTransactions(csv);
  assert.equal(transaction.merchant, 'Pali');
  assert.equal(transaction.amount, 2252);
  assert.equal(transaction.description, undefined);
});

test('parseTransactions maps by header name, not position', () => {
  const csv = `Monto,Fecha,Comercio
1234,01/20/2026 08:00 AM,Cafeteria
`;
  const [transaction] = parseTransactions(csv);
  assert.equal(transaction.merchant, 'Cafeteria');
  assert.equal(transaction.amount, 1234);
});

test('parseTransactions accepts a sheet without a header', () => {
  const [transaction] = parseTransactions('01/15/2026 01:05 PM,Pali,2252\n');
  assert.equal(transaction.merchant, 'Pali');
  assert.equal(transaction.amount, 2252);
});

test('parseTransactions keeps SINPE credits as negative amounts', () => {
  const csv = `Fecha,Comercio,Monto
11/01/2026 05:39 PM,JUNIOR ANDRES,"(15,000)"
11/02/2026 10:00 AM,PALI,-5222
`;
  const transactions = parseTransactions(csv);
  assert.deepEqual(
    transactions.map((transaction) => transaction.amount),
    [-15000, -5222],
  );
  assert.equal(formatAmount(transactions[0].amount), '-15,000');
});

test('parseTransactions parses the live sample', () => {
  const transactions = parseTransactions(SAMPLE_CSV);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[1].amount, 5222);
});

test('money is always rounded up and grouped with commas', () => {
  assert.equal(roundUp(1.01), 2);
  assert.equal(roundUp(2252), 2252);
  assert.equal(roundUp(-1.01), -1);
  assert.equal(formatAmount(2252), '2,252');
  assert.equal(formatAmount(1234567), '1,234,567');
  assert.equal(formatAmount(2252.1), '2,253');
  assert.equal(formatAmount(-1250), '-1,250');
  assert.equal(formatAmount(0), '0');
  assert.equal(formatNumber(9876543), '9,876,543');
});

test('dates produce local month keys', () => {
  assert.equal(monthKey(new Date(2026, 0, 15)), '2026-01');
  assert.equal(monthKey(new Date(2026, 11, 31)), '2026-12');
  assert.equal(formatTableDate(new Date(2026, 4, 6)), '06-MAY');
  assert.equal(formatTableDate(new Date(2026, 8, 20)), '20-SEP');
  assert.equal(formatTableDate(new Date(2026, 0, 5)), '05-ENE');
});

test('normalizeText ignores accents and case', () => {
  assert.equal(normalizeText('Café  Central'), 'cafe central');
  assert.equal(normalizeText('Descripción'), 'descripcion');
});
