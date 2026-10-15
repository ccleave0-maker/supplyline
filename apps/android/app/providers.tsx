'use client';

import type { ReactNode } from 'react';
import { BowronRoot } from '@supplyline/core/ui';
import { platform } from '../src/platform';

export function Providers({ children }: { children: ReactNode }) {
  return <BowronRoot platform={platform}>{children}</BowronRoot>;
}
