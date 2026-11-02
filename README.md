# Marvin

A small, installable BCR expense dashboard for Costa Rican colones. Vanilla JavaScript, no framework and no build step. The app reads a read-only published Google Sheet and is currently served from a local/internal Node server.

## What it does

- Shows **Disponible** in a sticky header, with Gastos, SINPE and Movimientos separated below.
- Renders a single-line transaction table grouped by month. Month dividers have no subtotals.
- Highlights credit rows in blue and labels them SINPE (negative amounts).
- Formats every amount as whole colones without a currency symbol, with comma thousands separators: `1,234,567`.
- Uses a compact table date format like `06-MAY`.
- Lets you change the CSV source from the **Ajustes** panel; the URL is stored on the device.
- Works offline: the app shell is cached by a service worker, the CSV has a cache fallback and the last successful dataset is stored in `localStorage`.
- Installable as a PWA with flat BCR-blue icons and maskable artwork.
- Flat BCR-blue palette with gold accents and no gradients.
- Follows the system light/dark theme, with a manual toggle.

## Money rules

The source is assumed to be in CRC colones. The app:

1. Parses amounts that are integers, use comma thousands (`2,252`) or decimal separators.
2. Never shows cents.
3. Always rounds **up** (`Math.ceil`) to the next colón.
4. Separates thousands with a comma, not a period.

The formatting lives in [`public/assets/format.js`](public/assets/format.js), and the parsing rules in [`public/assets/csv.js`](public/assets/csv.js).

## Data source

The default URL is configured in [`public/assets/config.js`](public/assets/config.js), and it can be replaced from the **Ajustes** button without rebuilding:

```js
export const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/.../pub?gid=462189767&single=true&output=csv';
```

Expected columns: `Fecha`, `Comercio`, `Monto`. A description column is not required and is ignored. Column order does not matter because the header is detected by name. The date format exported by Google Sheets (`01/15/2026 01:05 PM`) is supported, along with ISO and day-first dates.

Amounts may be positive or negative. Credits can be exported as negative numbers (`-15,000`) or in accounting parentheses (`(15,000)`), and both are parsed as credits and tagged SINPE. The **Disponible** figure is the net sum: gastos minus SINPE credits.

> **Privacy:** publishing a Google Sheet makes the CSV readable by anyone with the link. Do not publish data you want to keep private. The app itself only reads and never writes to the sheet.

## Local development

Requires Node.js 20 or newer.

```bash
npm start
```

Open <http://127.0.0.1:5173>. To serve it to other devices on the local network:

```bash
npm run start:lan
```

The local Node server serves only the `public/` directory. There is no build step, no dependency install and no bundler.

## Tests

```bash
npm test
```

The suite covers CSV parsing, quoted fields, header detection, date formats, amount formats, rounding and formatting.

## Deployment

Deployment is intentionally paused while the app runs from the internal server. The GitHub Pages workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml) is manual-only for now.

When it is time to deploy again, restore the `push` trigger, push to `main`, and run the workflow. All paths are relative, so it works from the `/marvin/` subpath without changes. `public/.nojekyll` keeps Jekyll out of the way.

## Project structure

```
public/                 Static site (the only folder deployed)
  index.html
  manifest.webmanifest
  sw.js                 Service worker: shell + CSV caching
  assets/
    app.js              UI, settings, fetch, install and theme logic
    csv.js              CSV, date and amount parsing
    format.js           Colones, dates and relative time
    config.js           Default CSV URL, version and storage keys
    styles.css
    icons/              BCR-blue PWA and favicon icons
test/                   Node test suite
tools/generate-icons.py Icon generator (Pillow)
server.mjs              Zero-dependency local static server
```

## PWA notes

- Service workers require HTTPS or `localhost`. GitHub Pages provides HTTPS.
- Bump `VERSION` in `public/sw.js` when the precache list changes. Regular asset changes are refreshed by the service worker's stale-while-revalidate strategy.
- Icons can be regenerated with `npm run icons` (requires Python 3 and Pillow).
