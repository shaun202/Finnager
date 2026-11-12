# Finnager

Finnager is an offline-first personal finance tracker designed for Android as an installable Progressive Web App (PWA). The Angular app stores data in the browser's IndexedDB on the device; it has no cloud service or NestJS backend.

## Repository structure

```text
.
├── .github/
│   └── workflows/       # Build and test automation
├── docs/                 # Architecture and project documentation
└── frontend/             # Angular PWA
    ├── android/          # Capacitor Android project
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

Finnager can run as an installable PWA or as a native Android app. For the PWA, deploy the production build to a static web host that serves the app over HTTPS, then open its URL in Chrome on Android and choose **Install app** (or **Add to Home screen**). The service worker caches the app shell for offline use after the first successful load.

To build a directly installable Android debug APK, install Android Studio with Android SDK Platform 35 and JDK 21. Make sure `ANDROID_HOME` points to your Android SDK directory if it is not installed in the standard location, then run:

```powershell
cd frontend
npm ci
npm run android:apk
```

The APK is created at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`. To sideload over USB with Android Debug Bridge (ADB), enable Developer options and USB debugging on the device, connect and authorize it, then run:

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Alternatively, transfer or download the APK to the phone, open it in the file manager, and allow that source to install unknown apps when Android prompts. Android's package manager installs it in the app's protected application area; there is no user-selected install folder. The debug APK is suitable for testing and direct sideloading. A public release should be built and signed with a release key that the project owner controls; keep that key safe, because updates must use the same signing key to install over an existing copy and retain its local data.

GitHub Actions also builds the Android debug APK; download the `finnager-android-debug-apk` artifact from a workflow run. Native iOS packaging is not included.

## Finance features

- Create independent ledgers, each with its own starting cash balance, income, expenses, assets and liabilities.
- Add each income or expense to a selected asset; the asset balance updates automatically.
- Keep Overview focused on monthly income, expenses and recent activity. Holdings shows estimated net worth, asset/liability totals, the monthly balance summary and a six-month trend.
- Month changes happen automatically: earlier transactions remain saved and asset balances carry forward.
- Asset and liability changes are saved as dated valuations, so earlier month-end summaries use the values recorded at that time.
- Switch between light and dark themes. On Android, create and switch ledgers from the mobile ledger selector.
- Download a JSON backup from the sidebar.

## Local data note

Ledger data is saved to IndexedDB in the browser profile on the device, so closing and reopening the app does not clear it. Finnager also asks the browser to protect this data from automatic storage cleanup; if the browser declines or does not support that request, the app displays a warning. Data is not synced or encrypted by Finnager. Clearing browser/site data, uninstalling the browser or PWA, or losing the device can still remove it, so download backups regularly and keep them somewhere safe. The PWA requires HTTPS for installation and offline service-worker features, except when running on localhost.

## Frontend commands

```powershell
cd frontend
npm run build
npm test -- --watch=false
```

## License

Finnager is available under the [MIT License](LICENSE).
