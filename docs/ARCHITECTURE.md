# Architecture

Finnager is a client-side Angular PWA. It does not currently have a backend or a remote database.

## Repository layout

- `frontend/src/app/` contains the Angular application shell, finance models, and local storage service.
- `frontend/src/styles.scss` contains global styles; app-specific markup and styles are under `frontend/src/app/`.
- `frontend/public/` contains static PWA assets, including the web app manifest and icons.
- `frontend/ngsw-config.json` configures the Angular service worker used to cache the app shell.
- `.github/workflows/ci.yml` runs the production build and frontend tests on pushes and pull requests.

## Data and offline behavior

The local storage service persists ledger data in the browser's IndexedDB. Data is scoped to the browser profile and is not synchronized or encrypted by Finnager. Users can export a JSON backup from the app. The Angular service worker caches the app shell for offline use after the first successful load; installation and service-worker behavior require HTTPS outside localhost.

## Growth guidelines

Keep finance rules and persistence separate from presentation. As the UI grows, group screen-specific components and logic under `frontend/src/app/features/<feature>/`, and put genuinely reusable UI under `frontend/src/app/shared/`. Add a backend only when remote capabilities are required; do not make local ledger storage depend on one.
