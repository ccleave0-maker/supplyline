import { isBlankRow, type DraftRow, type OrderLineInput, type RowErrors } from '../models/order';
import { parseQty } from './inventory';

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface DraftCheck {
  /** Clean lines in grid order (blank rows skipped). */
  lines: OrderLineInput[];
  /** Keyed by grid row number (1-based, counting blank rows). */
  errors: RowErrors;
  ok: boolean;
  message: string | null;
}

/**
 * Checks grid rows before submit. Used by the apps (to highlight cells) and by
 * the server (which never trusts the apps).
 * @param costCodes valid codes for this job; empty list = any code allowed
 */
export function checkDraftRows(rows: DraftRow[], costCodes: string[]): DraftCheck {
  const lines: OrderLineInput[] = [];
  const errors: RowErrors = {};
  const codeMap = new Map(costCodes.map((c) => [c.toLowerCase(), c]));

  rows.forEach((r, i) => {
    if (isBlankRow(r)) return;
    const e: Partial<Record<keyof DraftRow, string>> = {};
    const qty = parseQty(r.quantity);
    if (!r.description.trim()) e.description = 'Description is required';
    if (qty === null) e.quantity = r.quantity.trim() ? 'Quantity must be a number above 0' : 'Quantity is required';
    if (!r.uom.trim()) e.uom = 'Unit is required';
    const initials = r.orderedByInitials.trim().toUpperCase();
    if (!/^[A-Z]{1,4}$/.test(initials)) e.orderedByInitials = 'Initials are 1–4 letters';
    const date = r.requiredOnSite.trim();
    if (date && !validDate(date)) e.requiredOnSite = 'Use a real date';
    let code: string | null = r.costCode.trim() || null;
    if (code && codeMap.size > 0) {
      const match = codeMap.get(code.toLowerCase());
      if (!match) e.costCode = 'Not on the cost code list';
      else code = match;
    }
    if (Object.keys(e).length) {
      errors[i + 1] = e;
      return;
    }
    lines.push({
      description: r.description.trim(),
      quantity: qty!,
      uom: r.uom.trim().toUpperCase(),
      costCode: code,
      orderedByInitials: initials,
      requiredOnSite: date || null,
    });
  });

  const errorRows = Object.keys(errors).length;
  let message: string | null = null;
  if (errorRows) message = `Fix ${errorRows} line${errorRows === 1 ? '' : 's'} highlighted in red before submitting.`;
  else if (lines.length === 0) message = 'Add at least one line before submitting.';
  return { lines, errors, ok: !message, message };
}
