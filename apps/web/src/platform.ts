import { createBrowserPlatform } from '@supplyline/platform/browser';

// Web: plain browser APIs for camera (file input with capture), files, print, share and location.
export const platform = createBrowserPlatform({
  app: 'web',
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
});
