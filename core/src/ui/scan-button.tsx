'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { paths } from '../routes';
import { Button, cx, ErrorBanner } from './components';
import { useAction } from './hooks';
import { useSession } from './session';

/**
 * Scan from anywhere: takes a photo of any SupplyLine QR code (BOL, PO, packing
 * list, order list, equipment tag, meeting minutes) and opens the right screen.
 * "icon" = the camera button in the top bar; "big" = a large button on a page.
 */
export function ScanButton({ variant = 'big', className }: { variant?: 'icon' | 'big'; className?: string }) {
  const router = useRouter();
  const platform = usePlatform();
  const { api } = useSession();
  const [note, setNote] = useState('');
  const scan = useAction(async () => {
    setNote('');
    const p = await platform.camera.takePhoto();
    if (!p) return;
    const r = await api.scan(p.blob, p.name || 'scan.jpg');
    if (r.target) return router.push(r.target.link);
    // Nothing recognised: the scan page lets them try again or type the number.
    if (variant === 'icon') return router.push(paths.scan());
    setNote('No SupplyLine code found. Try again closer with good light, or type the number on the Scan page.');
  });
  if (variant === 'icon')
    return (
      <button type="button" onClick={() => void scan.run()} disabled={scan.busy} aria-label="Scan a QR code" className={cx('sl-icon-btn flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl text-ink hover:bg-surface-2 disabled:opacity-50', className)}>
        <span aria-hidden="true">📷</span>
      </button>
    );
  return (
    <div className={className}>
      <Button className="min-h-14 w-full text-lg" busy={scan.busy} onClick={() => void scan.run()}>
        📷 Scan a code
      </Button>
      <ErrorBanner error={scan.error} />
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
    </div>
  );
}
