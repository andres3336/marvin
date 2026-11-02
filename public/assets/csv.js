import { normalizeText, roundUp } from './format.js';

/**
 * Read-only CSV from the published Google Sheet.
 * Columns: Fecha, Comercio, Descripcion, Monto.
 */

const COLUMN_ALIASES = {
  date: ['fecha', 'date', 'fecha transaccion', 'fecha de transaccion'],
  merchant: ['comercio', 'merchant', 'establecimiento', 'negocio'],
  amount: ['monto', 'amount', 'importe', 'total', 'monto crc'],
};

/** Parse a CSV document into rows. Handles quotes, escaped quotes and CRLF. */
export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      if (source[index + 1] === '\n') continue;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Parse an amount into a number. Commas and dots may be thousands or decimals. */
export function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;

  let text = String(raw ?? '').trim();
  if (!text) return NaN;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text
    .replace(/[₡$€]/g, '')
    .replace(/\b(?:CRC|USD|EUR)\b/gi, '')
    .replace(/[\s\u00a0]/g, '')
    .replace(/[^\d.,-]/g, '');

  if (!/\d/.test(text)) return NaN;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    // "2,252" is thousands; "12,34" is a decimal comma.
    text = /,\d{1,2}$/.test(text)
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (lastDot > -1) {
    // "1.234.567" and "1.234" are thousands; anything else is a decimal dot.
    text = /^-?\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text;
  }

  const number = Number(text);
  if (!Number.isFinite(number)) return NaN;
  return negative ? -number : number;
}

/** Parse the sheet date format "01/15/2026 01:05 PM". */
export function parseDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const iso = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );

  if (iso) {
    return buildDate({
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      hour: Number(iso[4] ?? 0),
      minute: Number(iso[5] ?? 0),
      second: Number(iso[6] ?? 0),
    });
  }

  const local = text.match(
    /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s*m\.?)?)?/i,
  );

  if (!local) return null;

  const first = Number(local[1]);
  const second = Number(local[2]);
  const shortYear = Number(local[3]);
  const year = shortYear < 100 ? 2000 + shortYear : shortYear;

  // The sheet exports US-style dates, but tolerate day-first dates too.
  let month = first;
  let day = second;
  if (first > 12 && second <= 12) {
    month = second;
    day = first;
  }

  let hour = Number(local[4] ?? 0);
  const minute = Number(local[5] ?? 0);
  const secondPart = Number(local[6] ?? 0);
  const meridiem = local[7]?.toLowerCase();

  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;

  return buildDate({ year, month, day, hour, minute, second: secondPart });
}

function buildDate({ year, month, day, hour, minute, second }) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function resolveColumns(row) {
  const cells = row.map((cell) => normalizeText(cell));
  const find = (aliases) => cells.findIndex((cell) => aliases.includes(cell));

  const columns = {
    date: find(COLUMN_ALIASES.date),
    merchant: find(COLUMN_ALIASES.merchant),
    amount: find(COLUMN_ALIASES.amount),
  };

  return columns.date > -1 && columns.amount > -1 ? columns : null;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Turn the CSV document into transaction objects.
 * Invalid, empty and header rows are skipped.
 */
export function parseTransactions(text) {
  const rows = parseCsv(text);
  let columns = null;
  let start = 0;

  // Find the header row, skipping the sheet's leading empty rows.
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const found = resolveColumns(rows[index]);
    if (found) {
      columns = found;
      start = index + 1;
      break;
    }
  }

  if (!columns) {
    // No header: assume Fecha, Comercio, ..., Monto (amount is the last cell).
    columns = { date: 0, merchant: 1, amount: -1 };
  }

  const transactions = [];

  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.every((cell) => !String(cell).trim())) continue;

    const amountIndex = columns.amount < 0 ? row.length + columns.amount : columns.amount;
    const date = parseDate(row[columns.date]);
    const rawAmount = parseAmount(row[amountIndex]);
    if (!date || !Number.isFinite(rawAmount)) continue;

    const merchant = clean(row[columns.merchant]) || 'Sin comercio';

    // The sheet now uses positive amounts only. SINPE rows are credits;
    // everything else is spending. A negative amount is treated as a legacy
    // credit, so existing sheets keep working.
    const isCredit = rawAmount < 0 || normalizeText(merchant).includes('sinpe');
    const magnitude = roundUp(Math.abs(rawAmount));
    const amount = isCredit ? magnitude : -magnitude;

    transactions.push({
      id: `${date.getTime()}-${index}`,
      index,
      date,
      merchant,
      amount,
      isCredit,
    });
  }

  return transactions;
}
