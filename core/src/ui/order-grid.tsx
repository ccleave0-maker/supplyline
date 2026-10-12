'use client';

import { ItemList } from './suggest';
import type { ItemSuggestion } from '../models';
import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { formatLineNo } from '../domain/numbering';
import { emptyDraftRow, isBlankRow, UOM_SUGGESTIONS, type DraftRow, type RowErrors } from '../models/order';
import { cx } from './components';
import { useWideScreen } from './hooks';

const COLS = ['description', 'quantity', 'uom', 'costCode', 'orderedByInitials', 'requiredOnSite'] as const;
type Col = (typeof COLS)[number];

export const COL_LABELS: Record<Col, string> = {
  description: 'Description',
  quantity: 'Qty',
  uom: 'Unit',
  costCode: 'Cost code',
  orderedByInitials: 'Ordered by',
  requiredOnSite: 'Required on site',
};

/** Always keep exactly one empty row at the bottom, like a spreadsheet. */
export function withTrailingBlank(rows: DraftRow[], initials: string): DraftRow[] {
  const out = [...rows];
  while (out.length > 1 && isBlankRow(out[out.length - 1]!) && isBlankRow(out[out.length - 2]!)) out.pop();
  if (out.length === 0 || !isBlankRow(out[out.length - 1]!)) out.push(emptyDraftRow(initials));
  return out;
}

/** Accepts 2026-10-15, 10/15/2026 or 15/10/2026-style input from pasted spreadsheets. */
function normalizeDate(v: string): string {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return s;
  let [a, b] = [Number(m[1]), Number(m[2])];
  if (a > 12) [a, b] = [b, a]; // day/month order
  return `${m[3]}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
}

function clean(col: Col, value: string): string {
  if (col === 'uom' || col === 'orderedByInitials') return value.toUpperCase();
  if (col === 'requiredOnSite') return normalizeDate(value);
  return value;
}

interface GridProps {
  rows: DraftRow[];
  onChange: (rows: DraftRow[]) => void;
  errors: RowErrors;
  costCodes: { code: string; description: string | null }[];
  initials: string;
  /** Items ordered before that match what's being typed */
  items?: ItemSuggestion[];
  onTyping?: (description: string) => void;
}

export function DraftGrid(props: GridProps) {
  const wide = useWideScreen(900);
  return wide ? <GridTable {...props} /> : <GridCards {...props} />;
}

function useGridEditing({ rows, onChange, initials, items, onTyping }: GridProps) {
  const setCell = (r: number, col: Col, value: string) => {
    if (col === 'description') onTyping?.(value);
    // Picked a suggestion: fill its unit and cost code when they're empty.
    const hit = col === 'description' ? items?.find((s) => s.description === value) : undefined;
    const next = rows.map((row, i) => (i === r ? { ...row, [col]: clean(col, value), ...(hit && !row.uom.trim() && hit.uom ? { uom: hit.uom } : {}), ...(hit && !row.costCode.trim() && hit.costCode ? { costCode: hit.costCode } : {}) } : row));
    onChange(withTrailingBlank(next, initials));
  };
  const removeRow = (r: number) => onChange(withTrailingBlank(rows.filter((_, i) => i !== r), initials));
  /** Paste a block copied from Excel/Sheets: fills cells starting at (r, c). */
  const pasteBlock = (r: number, c: number, text: string): boolean => {
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return false;
    const lines = text.replace(/\r/g, '').split('\n');
    if (lines.at(-1) === '') lines.pop();
    const next = [...rows];
    lines.forEach((line, i) => {
      const target = r + i;
      while (next.length <= target) next.push(emptyDraftRow(initials));
      const row = { ...next[target]! };
      line.split('\t').forEach((cell, j) => {
        const col = COLS[c + j];
        if (col) row[col] = clean(col, cell.trim());
      });
      if (!row.orderedByInitials) row.orderedByInitials = initials;
      next[target] = row;
    });
    onChange(withTrailingBlank(next, initials));
    return true;
  };
  return { setCell, removeRow, pasteBlock };
}

function CodeList({ id, costCodes }: { id: string; costCodes: GridProps['costCodes'] }) {
  return (
    <datalist id={id}>
      {costCodes.map((c) => (
        <option key={c.code} value={c.code}>
          {c.description ?? ''}
        </option>
      ))}
    </datalist>
  );
}

function UomList({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {UOM_SUGGESTIONS.map((u) => (
        <option key={u} value={u} />
      ))}
    </datalist>
  );
}

function GridTable(props: GridProps) {
  const { rows, errors, costCodes } = props;
  const { setCell, removeRow, pasteBlock } = useGridEditing(props);
  const tableRef = useRef<HTMLTableElement>(null);
  const uid = useId();

  const focusCell = (r: number, c: number) => {
    requestAnimationFrame(() => {
      tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const isDate = COLS[c] === 'requiredOnSite';
    if (e.key === 'Enter') {
      e.preventDefault();
      focusCell(e.shiftKey ? Math.max(0, r - 1) : r + 1, c);
    } else if (e.key === 'ArrowDown' && !isDate) {
      e.preventDefault();
      focusCell(Math.min(rows.length - 1, r + 1), c);
    } else if (e.key === 'ArrowUp' && !isDate) {
      e.preventDefault();
      focusCell(Math.max(0, r - 1), c);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (pasteBlock(r, c, e.clipboardData.getData('text/plain'))) e.preventDefault();
  };

  const widths: Record<Col, string> = {
    description: 'min-w-72',
    quantity: 'w-24',
    uom: 'w-24',
    costCode: 'w-32',
    orderedByInitials: 'w-24',
    requiredOnSite: 'w-40',
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <UomList id={`${uid}-uom`} />
      <CodeList id={`${uid}-codes`} costCodes={costCodes} />
      <ItemList id={`${uid}-items`} items={props.items ?? []} />
      <table ref={tableRef} className="w-full border-collapse text-base">
        <thead className="sticky top-0 bg-surface-2 text-left text-sm text-muted">
          <tr>
            <th scope="col" className="w-14 px-2 py-2">L#</th>
            {COLS.map((c) => (
              <th key={c} scope="col" className={cx('px-2 py-2 font-semibold', widths[c])}>
                {COL_LABELS[c]}
              </th>
            ))}
            <th scope="col" className="w-12">
              <span className="sr-only">Delete</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const last = r === rows.length - 1;
            const rowErr = errors[r + 1] ?? {};
            return (
              <tr key={r} className="border-t border-line">
                <th scope="row" className="px-2 text-left font-mono text-sm text-muted">
                  {last ? '+' : formatLineNo(r + 1)}
                </th>
                {COLS.map((col, c) => {
                  const err = rowErr[col];
                  return (
                    <td key={col} className="p-0.5">
                      <input
                        data-cell={`${r}-${c}`}
                        aria-label={`${last ? 'New line' : formatLineNo(r + 1)} ${COL_LABELS[col]}`}
                        aria-invalid={!!err}
                        title={err}
                        value={row[col]}
                        onChange={(e) => setCell(r, col, e.target.value)}
                        onKeyDown={(e) => onKeyDown(e, r, c)}
                        onPaste={(e) => onPaste(e, r, c)}
                        type={col === 'requiredOnSite' ? 'date' : 'text'}
                        inputMode={col === 'quantity' ? 'decimal' : undefined}
                        list={col === 'uom' ? `${uid}-uom` : col === 'costCode' && costCodes.length ? `${uid}-codes` : col === 'description' ? `${uid}-items` : undefined}
                        maxLength={col === 'orderedByInitials' ? 4 : undefined}
                        placeholder={last && col === 'description' ? 'Type or paste from Excel…' : undefined}
                        className={cx(
                          'min-h-11 w-full rounded-md border bg-transparent px-2 text-ink focus:bg-surface',
                          err ? 'border-danger bg-danger/5' : 'border-transparent hover:border-line',
                          col === 'quantity' && 'text-right',
                        )}
                      />
                    </td>
                  );
                })}
                <td className="text-center">
                  {!last && (
                    <button
                      type="button"
                      onClick={() => removeRow(r)}
                      aria-label={`Delete ${formatLineNo(r + 1)}`}
                      className="h-11 w-11 rounded-md text-muted hover:bg-surface-2 hover:text-danger"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-3 py-2 text-sm text-muted">
        Enter moves down · ↑ ↓ move between lines · paste rows straight from Excel (Description, Qty, Unit, Cost code, By, Date)
      </p>
    </div>
  );
}

/** Phone layout: one card per line with large fields. */
function GridCards(props: GridProps) {
  const { rows, errors, costCodes } = props;
  const { setCell, removeRow } = useGridEditing(props);
  const uid = useId();

  return (
    <div className="flex flex-col gap-3">
      <UomList id={`${uid}-uom`} />
      <CodeList id={`${uid}-codes`} costCodes={costCodes} />
      <ItemList id={`${uid}-items`} items={props.items ?? []} />
      {rows.map((row, r) => {
        const last = r === rows.length - 1;
        const err = errors[r + 1] ?? {};
        const field = (col: Col, extra: Record<string, unknown> = {}) => (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">{COL_LABELS[col]}</span>
            <input
              aria-invalid={!!err[col]}
              value={row[col]}
              onChange={(e) => setCell(r, col, e.target.value)}
              className={cx('min-h-12 w-full rounded-lg border bg-surface px-3 text-base text-ink', err[col] ? 'border-danger' : 'border-line')}
              {...extra}
            />
            {err[col] && <span className="text-sm text-danger">{err[col]}</span>}
          </label>
        );
        return (
          <fieldset key={r} className={cx('rounded-xl border bg-surface p-3', last ? 'border-dashed border-line' : 'border-line')}>
            <legend className="px-1 font-bold text-ink">{last ? 'New line' : formatLineNo(r + 1)}</legend>
            <div className="flex flex-col gap-3">
              {field('description', { placeholder: last ? 'What do you need?' : undefined, list: `${uid}-items` })}
              <div className="grid grid-cols-2 gap-3">
                {field('quantity', { inputMode: 'decimal' })}
                {field('uom', { list: `${uid}-uom`, autoCapitalize: 'characters' })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {field('costCode', { list: costCodes.length ? `${uid}-codes` : undefined })}
                {field('orderedByInitials', { maxLength: 4, autoCapitalize: 'characters' })}
              </div>
              {field('requiredOnSite', { type: 'date' })}
              {!last && (
                <button type="button" onClick={() => removeRow(r)} className="min-h-12 self-start rounded-lg px-3 font-semibold text-danger">
                  Delete {formatLineNo(r + 1)}
                </button>
              )}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
