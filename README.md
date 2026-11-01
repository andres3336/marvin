# Marvin

A small, installable expense dashboard for Costa Rican colones. Vanilla JavaScript, no framework and no build step. The app reads a read-only published Google Sheet and deploys as a static site to GitHub Pages.

## What it does

- Fetches the published CSV and shows total spending, monthly totals and transactions.
- Filters by month (tap a bar), merchant and free-text search.
- Formats every amount as whole colones with comma thousands separators, rounding up: `₡1,234,567`.
- Works offline: the app shell is cached by a service worker, the CSV has a cache fallback and the last successful dataset is stored in `localStorage`.
- Installable as a PWA with an offline-ready manifest and maskable icons.
- Follows the system light/dark theme, with a manual toggle.

## Money rules

The source is assumed to be in CRC colones. The app:

1. Parses amounts that are integers, use comma thousands (`2,252`) or decimal separators.
2. Never shows cents.
3. Always rounds **up** (`Math.ceil`) to the next colón.
4. Separates thousands with a comma, not a period.

The formatting lives in [`public/assets/format.js`](public/assets/format.js), and the parsing rules in [`public/assets/csv.js`](public/assets/csv.js).

## Data source

The published CSV URL is configured in [`public/assets/config.js`](public/assets/config.js):

```js
export const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/.../pub?gid=0&single=true&output=csv';
```

Expected columns: `Fecha`, `Comercio`, `Descripcion`, `Monto`. Column order does not matter because the header is detected by name. The date format exported by Google Sheets (`01/15/2026 01:05 PM`) is supported, along with ISO and day-first dates.

> **Privacy:** publishing a Google Sheet makes the CSV readable by anyone with the link. Do not publish data you want to keep private. The app itself only reads and never writes to the sheet.

## Local development

Requires Node.js 20 or newer.

```bash
npm start
```

Open <http://127.0.0.1:5173>. To test from a phone on the same network:

```bash
HOST=0.0.0.0 npm start
```

The local Node server serves only the `public/` directory. There is no build step, no dependency install and no bundler.

## Tests

```bash
npm test
```

The suite covers CSV parsing, quoted fields, header detection, date formats, amount formats, rounding, formatting and search normalization.

## Deploying to GitHub Pages

The workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes `public/` on every push to `main`:

1. In the repository, open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually).
4. The site will be available at `https://andres3336.github.io/marvin/`.

All paths in the app are relative, so it works from the `/marvin/` subpath without changes. `public/.nojekyll` keeps Jekyll out of the way.

## Project structure

```
public/                 Static site (the only folder deployed)
  index.html
  manifest.webmanifest
  sw.js                 Service worker: shell + CSV caching
  assets/
    app.js              UI, state, fetch, install and theme logic
    csv.js              CSV, date and amount parsing
    format.js           Colones, dates and relative time
    config.js           CSV URL and storage keys
    styles.css
    icons/              PWA and favicon icons
test/                   Node test suite
tools/generate-icons.py Icon generator (Pillow)
server.mjs              Zero-dependency local static server
```

## PWA notes

- Service workers require HTTPS or `localhost`. GitHub Pages provides HTTPS.
- Bump `VERSION` in `public/sw.js` when the precache list changes. Regular asset changes are refreshed by the service worker's stale-while-revalidate strategy.
- Icons can be regenerated with `npm run icons` (requires Python 3 and Pillow).
