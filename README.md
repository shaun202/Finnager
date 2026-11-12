# Finnager

Finnager is an offline-first personal finance tracker designed for Android as an installable Progressive Web App (PWA). The Angular app stores data in the browser's IndexedDB on the device; it has no cloud service or NestJS backend.

## Repository structure

```text
.
├── .github/
│   └── workflows/       # Build and test automation
├── docs/                 # Architecture and project documentation
└── frontend/             # Angular PWA
    ├── public/           # PWA manifest and static assets
    └── src/
        └── app/          # Application UI, finance models, and local storage
```

Finnager currently runs entirely in the browser, so there is no backend or database server to install. See [the architecture notes](docs/ARCHITECTURE.md) for the application boundaries and data flow.

## Run locally

Requirements: Node.js 20.19 or newer.

```powershell
cd frontend
npm ci
npm start
```

Open the local URL printed by Angular CLI. The app creates a default ledger the first time it starts.

## Use on Android

Deploy the production build to a static web host that serves the app over HTTPS, then open its URL in Chrome on Android and choose **Install app** (or **Add to Home screen**). The service worker caches the app shell for offline use after the first successful load. `npm run build` creates the deployable files in `frontend/dist/frontend`.

## Finance features

- Create independent ledgers, each with its own currency, starting cash balance, income, expenses, assets and liabilities.
- Add each income or expense to a selected asset; the asset balance updates automatically.
- Keep Overview focused on monthly income, expenses and recent activity. Holdings shows estimated net worth, asset/liability totals, the monthly balance summary and a six-month trend.
- Month changes happen automatically: earlier transactions remain saved and asset balances carry forward.
- Asset and liability changes are saved as dated valuations, so earlier month-end summaries use the values recorded at that time.
- Switch between light and dark themes. On Android, create and switch ledgers from the mobile ledger selector.
- Download a JSON backup from the sidebar.

Supported ledger currencies include USD, SGD, EUR, GBP, AUD, CAD, MYR, INR, JPY and NZD.

## Local data note

Ledger data stays in the browser profile on the device and is not synced or encrypted by Finnager. Clearing browser/site data can remove it. Download backups regularly and keep them somewhere safe. The PWA requires HTTPS for installation and offline service-worker features, except when running on localhost.

## Frontend commands

```powershell
cd frontend
npm run build
npm test -- --watch=false
```

## License

Finnager is available under the [MIT License](LICENSE).
