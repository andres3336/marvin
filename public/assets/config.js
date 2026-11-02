/**
 * Marvin configuration.
 *
 * The data source is a read-only, published Google Sheet. To point the app at
 * another sheet, publish it as CSV (File → Share → Publish to web) and replace
 * the URL below. Keep `output=csv` in the query string.
 */
export const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXr2sUXxZ5Hl2ghnpGnU4w5JkpfNbakYYrsXpUPtgyung_zUN3uzZnShI0qnnICYlvzWvYMIQtB3h2/pub?gid=462189767&single=true&output=csv';

export const CSV_URL_KEY = 'marvin.csv-url.v1';
export const CACHE_KEY = 'marvin.data.v3';
export const THEME_KEY = 'marvin.theme.v1';
export const APP_NAME = 'Marvin';
export const APP_VERSION = '1.4.0';
