const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const androidDirectory = path.resolve(__dirname, '..', 'android');
const isWindows = process.platform === 'win32';
const defaultSdkDirectory =
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Android', 'Sdk')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Android', 'sdk')
      : path.join(os.homedir(), 'Android', 'Sdk');
const sdkDirectory =
  process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultSdkDirectory;
const command = isWindows ? process.env.ComSpec || 'cmd.exe' : 'bash';
const args = isWindows
  ? ['/d', '/s', '/c', 'gradlew.bat assembleDebug']
  : ['gradlew', 'assembleDebug'];

if (!existsSync(sdkDirectory)) {
  console.error(
    `Android SDK not found at ${sdkDirectory}. Install Android SDK Platform 35 and set ANDROID_HOME.`,
  );
  process.exit(1);
}

const result = spawnSync(command, args, {
  cwd: androidDirectory,
  stdio: 'inherit',
  env: { ...process.env, ANDROID_HOME: sdkDirectory },
});

if (result.error) {
  console.error(`Could not start the Android build: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const apk = path.join(
  androidDirectory,
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk',
);
if (!existsSync(apk)) {
  console.error(`Android build completed but the APK was not found at ${apk}`);
  process.exit(1);
}

console.log(`Installable APK created: ${apk}`);
