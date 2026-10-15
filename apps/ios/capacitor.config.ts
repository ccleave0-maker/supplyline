import type { CapacitorConfig } from '@capacitor/cli';

// iPhone/iPad app. Replace the placeholder app ID with your own reverse-domain ID before publishing.
const config: CapacitorConfig = {
  appId: 'com.example.bowron',
  appName: 'Bowron',
  webDir: 'out',
  ios: {
    contentInset: 'never',
    scheme: 'Bowron',
    // No white flash while the app starts, and no link previews on long-press.
    backgroundColor: '#f3f4f6',
    allowsLinkPreview: false,
  },
};

export default config;
