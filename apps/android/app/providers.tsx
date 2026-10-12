'use client';

import type { ReactNode } from 'react';
import { SupplyLineRoot } from '@supplyline/core/ui';
import { platform } from '../src/platform';

export function Providers({ children }: { children: ReactNode }) {
  return <SupplyLineRoot platform={platform}>{children}</SupplyLineRoot>;
}
