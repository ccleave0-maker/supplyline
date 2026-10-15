'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { Button, Card, ErrorBanner, Notice, PageHeader, TextField } from '../ui/components';
import { useAction } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { paths } from '../routes';

/** One Scan button for every Bowron QR code: BOLs, POs / packing lists, order lists, equipment tags. */
export function ScanScreen() {
  const router = useRouter();
  const platform = usePlatform();
  const { api } = useAuthed();
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');

  const scan = useAction(async (camera: boolean) => {
    setNote('');
    const p = camera ? await platform.camera.takePhoto() : (await platform.camera.pickImages({ multiple: false }))[0];
    if (!p) return;
    const r = await api.scan(p.blob, p.name || 'scan.jpg');
    if (r.target) return router.push(r.target.link);
    setNote(
      r.textSample
        ? `No Bowron code found. It read: “${r.textSample.slice(0, 140)}…” Try again closer, or type the number below.`
        : 'No Bowron code found. Try again closer with good light, or type the number below.',
    );
  });

  // A BOL number goes to BOL receiving; anything else to yard receiving (PO # or order #).
  const open = useAction(async () => {
    const v = q.trim();
    if (/^(bol\s*#?\s*)?\d{1,6}$/i.test(v)) {
      const b = await api.bols.lookup(v);
      return router.push(paths.bolReceive(b.id));
    }
    router.push(paths.yardReceive(v));
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Scan" subtitle="Point the camera at the QR code on a BOL, PO, packing list, order list or equipment tag." />
      <Card>
        <Button className="min-h-20 w-full text-xl" busy={scan.busy} onClick={() => void scan.run(true)}>
          📷 Scan a code
        </Button>
        <Button variant="ghost" className="mt-2" onClick={() => void scan.run(false)}>
          Choose a photo instead
        </Button>
        <ErrorBanner error={scan.error} />
        {note && <Notice>{note}</Notice>}
      </Card>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void open.run();
        }}
      >
        <div className="flex-1">
          <TextField label="Or type a BOL #, PO # or order #" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="characters" />
        </div>
        <Button type="submit" variant="secondary" busy={open.busy} disabled={!q.trim()}>
          Open
        </Button>
      </form>
      <ErrorBanner error={open.error} />
    </div>
  );
}
