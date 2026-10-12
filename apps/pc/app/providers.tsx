'use client';

import type { ReactNode } from 'react';
import { SupplyLineRoot } from '@supplyline/core/ui';
import { platform } from '../src/platform';
import { UpdateChecker } from '../src/updater';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SupplyLineRoot platform={platform}>
      <UpdateChecker />
      {children}
    </SupplyLineRoot>
  );
}
