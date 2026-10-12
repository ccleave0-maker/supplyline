import type { Platform } from '@supplyline/platform';
import { createBrowserPlatform } from '@supplyline/platform/browser';

// iPhone/iPad (Capacitor). Starts from browser APIs; the native camera, Keychain
// token storage, push (APNs), files and share sheet are swapped in with Capacitor
// plugins in the Apps phase. Permission prompts are requested only when used.
const base = createBrowserPlatform({
  app: 'ios',
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
});

export const platform: Platform = {
  ...base,
};
