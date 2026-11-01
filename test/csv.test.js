import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAmount,
  parseCsv,
  parseDate,
  parseTransactions,
} from '../public/assets/csv.js';
import {
  formatColones,
  formatNumber,
  monthKey,
  normalizeText,
  roundUp,
} from '../public/assets/format.js';

const SAMPLE_CSV = `,,,
Fecha,Comercio,Descripcion,Monto
01/15/2026 01:05 PM,Pali,PALI MIRAFLORES HEREDIA HEREDIA CR,2252
01/16/2026 09:30 AM,Automercado,"AUTOMERCADO, ESCAZU",15340
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
Fecha,Comercio,Descripcion,Monto
01/15/2026 01:05 PM,Pali,PALI MIRAFLORES HEREDIA HEREDIA CR,2252
01/16/2026 09:30 AM,Automercado,"AUTOMERCADO, ESCAZU",15340.25
,,,,,

Fecha,Comercio,Descripcion,Monto
`;
  const transactions = parseTransactions(csv);

  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].merchant, 'Pali');
  assert.equal(transactions[0].amount, 2252);
  assert.equal(transactions[1].description, 'AUTOMERCADO, ESCAZU');
  assert.equal(transactions[1].amount, 15341);
  assert.ok(transactions[0].date instanceof Date);
});

test('parseTransactions maps by header name, not position', () => {
  const csv = `Monto,Descripcion,Fecha,Comercio
1234,Cafe,01/20/2026 08:00 AM,Cafeteria
`;
  const [transaction] = parseTransactions(csv);
  assert.equal(transaction.merchant, 'Cafeteria');
  assert.equal(transaction.description, 'Cafe');
  assert.equal(transaction.amount, 1234);
});

test('parseTransactions accepts a sheet without a header', () => {
  const [transaction] = parseTransactions('01/15/2026 01:05 PM,Pali,Compra,2252\n');
  assert.equal(transaction.merchant, 'Pali');
  assert.equal(transaction.amount, 2252);
});

test('parseTransactions parses the live sample', () => {
  const transactions = parseTransactions(SAMPLE_CSV);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[1].amount, 15340);
});

test('money is always rounded up and grouped with commas', () => {
  assert.equal(roundUp(1.01), 2);
  assert.equal(roundUp(2252), 2252);
  assert.equal(roundUp(-1.01), -1);
  assert.equal(formatColones(2252), '₡2,252');
  assert.equal(formatColones(1234567), '₡1,234,567');
  assert.equal(formatColones(2252.1), '₡2,253');
  assert.equal(formatColones(-1250), '-₡1,250');
  assert.equal(formatColones(0), '₡0');
  assert.equal(formatNumber(9876543), '9,876,543');
});

test('dates produce local month keys', () => {
  assert.equal(monthKey(new Date(2026, 0, 15)), '2026-01');
  assert.equal(monthKey(new Date(2026, 11, 31)), '2026-12');
});

test('normalizeText ignores accents and case', () => {
  assert.equal(normalizeText('Café  Central'), 'cafe central');
  assert.equal(normalizeText('Descripción'), 'descripcion');
});
