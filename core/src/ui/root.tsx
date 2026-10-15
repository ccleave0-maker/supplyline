'use client';

import type { ReactNode } from 'react';
import { PlatformProvider, type Platform } from '@supplyline/platform';
import { AppShell } from './app-shell';
import { ColorModeProvider } from './color-mode';
import { SessionProvider } from './session';

/** The whole app, given a platform implementation. Every app in apps/ renders this. */
export function BowronRoot({ platform, children }: { platform: Platform; children: ReactNode }) {
  return (
    <PlatformProvider platform={platform}>
      <ColorModeProvider>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </ColorModeProvider>
    </PlatformProvider>
  );
}
