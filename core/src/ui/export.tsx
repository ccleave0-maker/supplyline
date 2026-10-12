'use client';

import { usePlatform } from '@supplyline/platform';
import type { ExportColumn } from '../models';
import { Button, ErrorBanner } from './components';
import { useAction } from './hooks';
import { useAuthed } from './session';

export type ExportRow = Record<string, string | number | null | undefined>;

/**
 * Excel / PDF / Print for whatever list is on screen. Pass the columns and the
 * rows you are showing (already filtered); the server builds the file.
 */
export function ExportButtons({
  title,
  subtitle,
  companyId,
  columns,
  rows,
  className,
}: {
  title: string;
  subtitle?: string | null;
  companyId?: string | null;
  columns: ExportColumn[];
  rows: ExportRow[];
  className?: string;
}) {
  const { api } = useAuthed();
  const platform = usePlatform();
  const clean = () => rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? null])) as Record<string, string | number | null>);
  const file = useAction(async (format: 'xlsx' | 'pdf', print: boolean) => {
    const blob = await api.exports.table({ format, title, subtitle: subtitle ?? null, companyId: companyId ?? null, columns, rows: clean() });
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${title.replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '-')}-${stamp}.${format}`;
    if (print) await platform.print.printPdf(blob, title);
    else await platform.files.saveFile(name, blob);
  });
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" busy={file.busy} disabled={!rows.length} onClick={() => void file.run('xlsx', false)} aria-label={`Download ${title} as Excel`}>
          ⬇ Excel
        </Button>
        <Button variant="secondary" busy={file.busy} disabled={!rows.length} onClick={() => void file.run('pdf', false)} aria-label={`Download ${title} as PDF`}>
          ⬇ PDF
        </Button>
        <Button variant="secondary" busy={file.busy} disabled={!rows.length} onClick={() => void file.run('pdf', true)}>
          🖨 Print
        </Button>
      </div>
      <ErrorBanner error={file.error} />
    </div>
  );
}

/** Save / print buttons for a document the server already makes as a PDF (BOL, PO, packing list…). */
export function PdfButtons({ fileName, load, label = 'PDF', title }: { fileName: string; load: () => Promise<Blob>; label?: string; title: string }) {
  const platform = usePlatform();
  const save = useAction(async () => platform.files.saveFile(fileName, await load()));
  const print = useAction(async () => platform.print.printPdf(await load(), title));
  return (
    <>
      <Button variant="secondary" busy={save.busy} onClick={() => void save.run()}>
        ⬇ {label}
      </Button>
      <Button variant="secondary" busy={print.busy} onClick={() => void print.run()}>
        🖨 Print {label === 'PDF' ? '' : label}
      </Button>
      <ErrorBanner error={save.error || print.error} />
    </>
  );
}
