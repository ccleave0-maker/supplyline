import type { Platform } from '@supplyline/platform';
import { createBrowserPlatform } from '@supplyline/platform/browser';

// PC (Windows/Mac, Tauri). Starts from browser APIs; native print dialog,
// save-to-folder and secure token storage are swapped in with Tauri plugins
// when the desktop installer is built (end of Phase 2).
const base = createBrowserPlatform({
  app: 'pc',
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
});

export const platform: Platform = {
  ...base,
};
