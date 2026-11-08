# Money Manager

Monthly spending reports from bank export files. It runs entirely in the browser: there is no
server and no account, and transactions stay on the device.

## Run it

```bash
npm start
```

Then open http://localhost:4174. Node is the only requirement.

## Monthly routine

1. Download a CSV from each bank and card.
2. Drop them all on the Import screen together, so card payments can be matched up.
3. Fix anything flagged, then Save. Corrections are remembered per merchant.

On first use, drop `MonthlyExpense.xlsx` to load your history and categories.

## How it is built

Plain HTML, CSS and JavaScript modules, with no framework, build step or third-party runtime code.

| File | Purpose |
| --- | --- |
| `js/parse.js` | CSV reading, bank formats, dates and amounts |
| `js/classify.js` | Transfers, categories, learning from corrections |
| `js/report.js` | Monthly and yearly totals, and the numbers behind each chart |
| `js/dashboard.js` | The landing page |
| `js/charts.js` | Chart drawing |
| `js/ui.js` | Shared page helpers |
| `js/workbook.js` | Reads the existing `.xlsx` using browser built-ins |
| `js/store.js` | IndexedDB storage and encrypted backups (AES-GCM, PBKDF2) |
| `js/app.js` | Screens |
| `sw.js` | Offline support. List any new file in `FILES` |

To add a bank without code, drop its file and answer the setup screen once. To build one in,
add an entry to `PROFILES` in `js/parse.js`.

## Tests

```bash
npm test
```

```bash
npm run test:browser
```

Tests use made-up transactions. `.gitignore` blocks `.csv`, `.xlsx` and `.backup` files, so real
financial data can't be committed by accident.

## Hosting

Any static host works. All paths are relative, so it can live in a subfolder of GitHub Pages.
The page's Content Security Policy only allows requests to its own site.
