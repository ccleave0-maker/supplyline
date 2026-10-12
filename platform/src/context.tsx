'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Platform } from './index';

const PlatformContext = createContext<Platform | null>(null);

export function PlatformProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  const p = useContext(PlatformContext);
  if (!p) throw new Error('usePlatform() must be used inside <PlatformProvider>');
  return p;
}
