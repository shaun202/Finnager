import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.finnager.app',
  appName: 'Finnager',
  webDir: 'dist/frontend/browser',
  server: {
    androidScheme: 'https',
  },
};

export default config;
