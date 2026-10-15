'use client';

import { useEffect, type ReactNode } from 'react';
import { BowronRoot } from '@supplyline/core/ui';
import { platform } from '../src/platform';

export function Providers({ children }: { children: ReactNode }) {
  // Installable PWA: register the service worker in production builds only.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return <BowronRoot platform={platform}>{children}</BowronRoot>;
}
