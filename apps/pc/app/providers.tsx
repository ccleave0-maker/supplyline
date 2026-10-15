'use client';

import type { ReactNode } from 'react';
import { BowronRoot } from '@supplyline/core/ui';
import { platform } from '../src/platform';
import { UpdateChecker } from '../src/updater';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <BowronRoot platform={platform}>
      <UpdateChecker />
      {children}
    </BowronRoot>
  );
}
