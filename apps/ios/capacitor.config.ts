import type { CapacitorConfig } from '@capacitor/cli';

// iPhone/iPad app. Replace the placeholder app ID with your own reverse-domain ID before publishing.
const config: CapacitorConfig = {
  appId: 'com.example.supplyline',
  appName: 'SupplyLine',
  webDir: 'out',
  ios: {
    contentInset: 'never',
    scheme: 'SupplyLine',
  },
};

export default config;
