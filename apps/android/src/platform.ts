import type { Platform } from '@supplyline/platform';
import { createBrowserPlatform } from '@supplyline/platform/browser';

// Android incl. Samsung (Capacitor). Starts from browser APIs; the native camera,
// Keystore token storage, push (FCM), files and share sheet are swapped in with
// Capacitor plugins in the Apps phase. Runtime permissions are requested only when used.
const base = createBrowserPlatform({
  app: 'android',
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
});

export const platform: Platform = {
  ...base,
};
