'use client';

import { useState, type ReactNode } from 'react';
import { usePlatform } from '@supplyline/platform';
import { Button, cx } from './components';

/**
 * Drop files here (PC), or tap to choose / take a photo (phone). `accept` is a
 * file-picker filter like "application/pdf,image/*".
 */
export function DropZone({
  title,
  hint,
  accept = 'application/pdf,image/*',
  multiple = false,
  busy = false,
  disabled = false,
  onFiles,
  children,
}: {
  title: string;
  hint?: ReactNode;
  accept?: string;
  multiple?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onFiles: (files: { blob: Blob; name: string }[]) => void;
  children?: ReactNode;
}) {
  const platform = usePlatform();
  const [over, setOver] = useState(false);
  const rules = accept.split(',').map((a) => a.trim().toLowerCase());
  const ok = (f: File) => rules.some((r) => r === '*/*' || (r.endsWith('/*') ? f.type.startsWith(r.slice(0, -1)) : r.startsWith('.') ? f.name.toLowerCase().endsWith(r) : f.type === r));
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = [...e.dataTransfer.files].filter(ok);
        if (files.length) onFiles((multiple ? files : files.slice(0, 1)).map((f) => ({ blob: f, name: f.name })));
      }}
      className={cx('rounded-xl border-2 border-dashed p-5 text-center', over ? 'border-brand bg-surface-2' : 'border-line bg-surface', disabled && 'opacity-60')}
    >
      <p className="text-lg font-semibold text-ink">{title}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="mt-3 flex flex-wrap items-end justify-center gap-2">
        <Button
          type="button"
          busy={busy}
          disabled={disabled}
          onClick={async () => {
            const files = await platform.files.pickFiles({ accept, multiple });
            if (files.length) onFiles(files.map((f) => ({ blob: f.blob, name: f.name })));
          }}
        >
          {multiple ? 'Choose files' : 'Choose a file'}
        </Button>
        {children}
      </div>
    </div>
  );
}
