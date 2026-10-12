// Bring your own order lists in from Excel / CSV — any version or layout. We look
// for the header row (Description, Qty, Unit, Cost code, Required…) anywhere near
// the top, skip titles / totals / blank rows, and split "10 ea" into qty + unit.
// When the layout can't be worked out and AI is on, the AI reads the sheet instead.
// The rows go into the draft grid for the person to check — nothing is submitted.

import type { DraftRow } from '@supplyline/core/models';
import { requirePermission, type AuthContext } from '../lib/auth';
import { badRequest } from '../lib/errors';
import { assertSiteVisible } from './access';
import { parseCsv, readXlsx } from './equipment';

type Field = 'description' | 'quantity' | 'uom' | 'costCode' | 'requiredOnSite' | 'partNumber';
const HEAD: Record<Field, RegExp> = {
  description: /^(desc(ription)?|item( description)?|material(s)?|product|what|details?)$/i,
  quantity: /^(qty|quantity|qnty|q'?ty|amount|count|no\.?|#|qty req(uired|'d)?|order qty)$/i,
  uom: /^(unit|units|uom|u\/m|um|measure|unit of measure)$/i,
  costCode: /^(cost ?code|cc|code|phase( code)?|account)$/i,
  requiredOnSite: /^(req(uired)?( on site| date| by)?|req'?d( date)?|need(ed)? by|date (required|needed)|delivery( date)?|on site( by)?)$/i,
  partNumber: /^(part ?(#|no\.?|number)|item ?(#|no\.?)|sku|cat(alog(ue)?)? ?(#|no\.?))$/i,
};
const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

function findHeader(rows: string[][]) {
  let best: { row: number; map: Partial<Record<Field, number>>; score: number } | null = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const map: Partial<Record<Field, number>> = {};
    rows[r]!.forEach((cell, c) => {
      const t = clean(cell).replace(/[:*]+$/, '');
      for (const f of Object.keys(HEAD) as Field[]) if (map[f] == null && HEAD[f].test(t)) map[f] = c;
    });
    const score = Object.keys(map).length + (map.description != null ? 2 : 0) + (map.quantity != null ? 1 : 0);
    if (map.description != null && score >= 3 && (!best || score > best.score)) best = { row: r, map, score };
  }
  return best;
}

/** "10 ea", "10ea", "1,200 LF" → qty + unit. */
function splitQty(raw: string): { qty: string; uom: string } {
  const m = clean(raw).match(/^([\d.,]+)\s*([a-z][a-z./]{0,8})?$/i);
  if (!m) return { qty: clean(raw), uom: '' };
  return { qty: m[1]!.replace(/,/g, ''), uom: (m[2] ?? '').toUpperCase() };
}

function isoDate(v: string): string {
  const s = clean(v);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return `${m[3]!.length === 2 ? `20${m[3]}` : m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

const JUNK = /^(total|sub-?total|grand total|page \d|notes?:?|signature|approved by|ordered by|job( #| no| number)?:?)\b/i;

export function rowsFromSheet(all: string[][], initials: string): { rows: DraftRow[]; header: boolean } {
  const h = findHeader(all);
  const out: DraftRow[] = [];
  if (h) {
    for (const r of all.slice(h.row + 1)) {
      const get = (f: Field) => (h.map[f] == null ? '' : clean(r[h.map[f]!]));
      let description = get('description');
      if (!description || JUNK.test(description)) continue;
      const part = get('partNumber');
      if (part && !description.includes(part)) description = `${description} — Part# ${part}`;
      let qty = get('quantity');
      let uom = get('uom');
      if (qty && !uom) ({ qty, uom } = splitQty(qty));
      out.push({ description: description.slice(0, 500), quantity: qty.slice(0, 30), uom: uom.toUpperCase().slice(0, 20), costCode: get('costCode').slice(0, 40), orderedByInitials: initials, requiredOnSite: isoDate(get('requiredOnSite')) });
    }
    return { rows: out, header: true };
  }
  // No header: the longest text is the description, the first number the quantity, a short word the unit.
  for (const r of all) {
    const cells = r.map(clean).filter(Boolean);
    if (cells.length < 2) continue;
    const desc = [...cells].sort((a, b) => b.length - a.length)[0]!;
    if (JUNK.test(desc) || /^\d+([.,]\d+)?$/.test(desc)) continue;
    const num = cells.find((c) => c !== desc && /^\d+([.,]\d+)?(\s*[a-z]{1,6})?$/i.test(c));
    if (!num) continue;
    const { qty, uom } = splitQty(num);
    const unit = uom || cells.find((c) => c !== desc && c !== num && /^[a-z]{1,6}$/i.test(c)) || '';
    out.push({ description: desc.slice(0, 500), quantity: qty, uom: unit.toUpperCase().slice(0, 20), costCode: '', orderedByInitials: initials, requiredOnSite: '' });
  }
  return { rows: out, header: false };
}

export async function importOrderSheet(auth: AuthContext, siteId: string, file: File): Promise<{ rows: DraftRow[]; how: 'columns' | 'guessed' | 'ai'; note: string | null }> {
  requirePermission(auth, 'order:create');
  const site = await assertSiteVisible(auth, siteId);
  if (file.size === 0 || file.size > 10 * 1_048_576) throw badRequest('Upload an Excel or CSV file up to 10 MB.');
  const name = file.name.toLowerCase();
  let all: string[][];
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) all = await readXlsx(await file.arrayBuffer());
  else if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.includes('csv')) all = parseCsv(await file.text());
  else throw badRequest('Upload a .xlsx or .csv file (older .xls: open it in Excel and Save As .xlsx).');
  const initials = auth.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const r = rowsFromSheet(all, initials);
  if (r.rows.length && r.header) return { rows: r.rows, how: 'columns', note: null };
  // Couldn't find the columns: let the AI read it (if it's on), otherwise use the best guess.
  try {
    const { readOrderSheet } = await import('./ai');
    const text = all.slice(0, 400).map((row) => row.map(clean).join(' | ')).join('\n');
    const ai = await readOrderSheet(auth, text, site.companyId);
    if (ai.length) return { rows: ai.map((l) => ({ ...l, orderedByInitials: initials })), how: 'ai', note: 'The layout wasn’t clear, so the AI read it — check every line.' };
  } catch {
    // AI off or failed: fall through to the guess.
  }
  if (!r.rows.length) throw badRequest('No order lines could be found in that sheet. Make sure it has a Description and a Qty column.');
  return { rows: r.rows, how: 'guessed', note: 'No header row was found, so the columns were guessed — check every line.' };
}
