# Money Manager (Angular + Tailwind CSS + DaisyUI)

Monthly spending reports from bank export files. It runs entirely in the browser with no server or account, works offline via `@angular/service-worker`, and keeps transactions and settings locally on the device in IndexedDB.

*(The original zero-build vanilla JS + `pwa-kit` v1.0.0 checkpoint is preserved on branch `main` at tag `v1-vanilla`.)*

## Live App & Deployment

- **URL:** `https://rajeswarandhandapani.com/money-manager/`
- Every push to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which runs `npm ci`, runs `npm test`, builds with `--base-href /money-manager/`, and deploys directly via `actions/deploy-pages` (GitHub Pages **Source: GitHub Actions**, custom domain blank so it inherits `rajeswarandhandapani.com`).

## Run locally

```powershell
npm.cmd install
npm.cmd start
```

Then open `http://localhost:4182`.

## Monthly routine

1. Download a CSV from each bank and card.
2. Drop them all on the Import screen together, so card payments can be matched up.
3. Fix anything flagged, then Save. Corrections are remembered per merchant.

On first use, drop an existing `.xlsx` workbook (`MonthlyExpense.xlsx`) to load your history and categories, or restore an encrypted `.backup` file.

## Build & Test

```powershell
# Domain unit tests (CSV/XLSX parsing, categorization rules, reports, taxonomy migration, lock crypto)
npm.cmd test

# Production build (GitHub Pages subfolder base-href + service worker)
npm.cmd run build:pages

# Local production build (relative base-href) & full Playwright E2E + lock + v1 migration test
npm.cmd run build
npm.cmd run test:browser
```

Tests use made-up transactions. `.gitignore` blocks `.csv`, `.xlsx`, and `.backup` files so real financial data is not committed by accident.

## Architecture & Data Compatibility

Built with standalone, zoneless Angular (Signals, `@if`/`@for`, hash routing), **Tailwind CSS v4 + DaisyUI v5** (system-aware light/dark + user-selectable presets), and shared kit primitives synced from [`angular-pwa-kit`](../angular-pwa-kit) (`src/app/kit/`).

| Path | Purpose |
| --- | --- |
| `src/app/domain/` (`parse.ts`, `classify.ts`, `report.ts`, `workbook.ts`, `migrate.ts`, `lock-crypto.ts`, `format.ts`, `models.ts`) | CSV/XLSX parsing, transfer detection, rule learning, reporting, v1→v3 taxonomy migration, recovery hashing |
| `src/app/services/` (`money-store`, `money-state`, `lock`, `money-modals`) | IndexedDB storage, AES-GCM/PBKDF2 encrypted backups, reactive import/filter state, WebAuthn passkey lock, modal dialogs |
| `src/app/views/` (`dashboard/`, `transactions/`, `import/`, `data/`) | Monthly/yearly KPIs & SVG charts, searchable transaction ledger, CSV/XLSX import review, backups, lock & theme settings |
| `src/app/components/` (`dialogs`, `lock-screen`, `rank-row`, `tx-row`) | Native `<dialog>` modals, lock screen UI, ranked bar rows, transaction editor rows |
| `src/app/kit/` | Shared `angular-pwa-kit` theme, IndexedDB helper, shell, toast, confirm dialog, and SVG chart utilities |
| `ngsw-config.json` | Offline asset caching via `@angular/service-worker` |

- **Bank formats:** To add a bank without editing code, drop its CSV file and answer the column-mapper dialog once. To build a format in permanently, add an entry to `PROFILES` in `src/app/domain/parse.ts`.
- **Data continuity:** Preserves IndexedDB `'monthly-expense'` (v1: `tx` keyed by `id` and `kv`), automatic pre-v3 category taxonomy upgrade (`TAXONOMY = 3`, keeping `beforeTaxonomy2` snapshot), PBKDF2-SHA256 (600,000 iterations) + AES-GCM-256 `.backup` format, saved CSV profiles, and WebAuthn device passkey lock records.
- **Security:** Enforces a strict Content Security Policy with zero external network requests.
