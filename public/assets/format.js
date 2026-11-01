/**
 * Formatting helpers.
 *
 * Money rules for this app:
 *  - Costa Rican colones only, never cents.
 *  - Always round up (Math.ceil).
 *  - Thousands separated with a comma, e.g. ₡1,234,567.
 */

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
  useGrouping: true,
});

/** Round a numeric value up to the next whole colón. */
export function roundUp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.ceil(number);
}

/** Format a number with comma thousands separators. */
export function formatNumber(value) {
  return NUMBER_FORMAT.format(roundUp(value));
}

/** Format a value as whole Costa Rican colones: ₡1,234. Negative values keep a minus sign. */
export function formatColones(value) {
  const amount = roundUp(value);
  const sign = amount < 0 ? '-' : '';
  return `${sign}₡${NUMBER_FORMAT.format(Math.abs(amount))}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat('es-CR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const TIME_FORMAT = new Intl.DateTimeFormat('es-CR', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const MONTH_FORMAT = new Intl.DateTimeFormat('es-CR', {
  month: 'short',
  year: 'numeric',
});

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('es-CR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function formatDay(date) {
  return capitalize(DAY_FORMAT.format(date));
}

export function formatTime(date) {
  return TIME_FORMAT.format(date);
}

/** Local month key, e.g. "2026-01". */
export function monthKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

/** Local day key, e.g. "2026-01-15". */
export function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "ene 2026" for a "2026-01" key. */
export function formatMonthKey(key) {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return capitalize(MONTH_FORMAT.format(new Date(year, month - 1, 1)));
}

export function formatShortDate(date) {
  return SHORT_DATE_FORMAT.format(date);
}

/** Lowercase, accent-insensitive text used for searching. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** Human friendly "hace 2 min" style timestamp. */
export function relativeTime(timestamp, now = Date.now()) {
  const seconds = Math.round((timestamp - now) / 1000);
  const absolute = Math.abs(seconds);

  if (absolute < 45) return 'hace unos segundos';
  if (absolute < 3600) return RELATIVE_FORMAT.format(Math.round(seconds / 60), 'minute');
  if (absolute < 86_400) return RELATIVE_FORMAT.format(Math.round(seconds / 3600), 'hour');
  if (absolute < 2_592_000) return RELATIVE_FORMAT.format(Math.round(seconds / 86_400), 'day');
  return relativeTimeLongAgo(timestamp);
}

function relativeTimeLongAgo(timestamp) {
  return `el ${SHORT_DATE_FORMAT.format(new Date(timestamp))}`;
}
