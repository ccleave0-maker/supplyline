// Checking a vendor invoice against its PO: vendor, PO number, line items,
// values and taxes (exempt vs not, from the job / equipment). Clean invoices go
// to approval; anything else is flagged with the reason, in plain words.

export interface InvoiceForMatch {
  vendorName: string | null;
  invoiceNumber: string | null;
  poNumber: string | null;
  subtotal: number | null;
  gst: number | null;
  pst: number | null;
  total: number | null;
  lines: { description: string; qty: number | null; unitPrice: number | null; amount: number | null }[];
}

export interface PoForMatch {
  poNumber: string;
  vendorName: string;
  status: string;
  pstExempt: boolean;
  gstRate: number;
  pstRate: number;
  hstRate: number;
  lines: { id: string; description: string; qty: number; unitCost: number | null; alreadyInvoiced: number }[];
}

export interface MatchResult {
  issues: string[];
  /** For each invoice line: the PO line it matched (or null) */
  lineMatches: (string | null)[];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1);

/** How alike two descriptions are (0–1), by shared words. */
export function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

/** "Coastal Steel Ltd." ≈ "COASTAL STEEL" */
export function sameVendor(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\b(ltd|limited|inc|incorporated|corp|corporation|co|company|llc|ulc)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
const close = (a: number, b: number, pct: number, abs = 0.02) => Math.abs(a - b) <= Math.max(abs, (Math.abs(b) * pct) / 100);

export function matchInvoice(inv: InvoiceForMatch, po: PoForMatch | null, opts: { tolerancePct?: number; duplicate?: boolean } = {}): MatchResult {
  const tol = opts.tolerancePct ?? 1;
  const issues: string[] = [];
  if (opts.duplicate) issues.push(`Invoice ${inv.invoiceNumber} from this vendor has already been entered (possible duplicate).`);
  if (!inv.invoiceNumber) issues.push('No invoice number.');
  if (inv.total == null) issues.push('No invoice total.');
  if (!inv.poNumber) issues.push('No PO number on the invoice.');
  if (!po) {
    if (inv.poNumber) issues.push(`PO ${inv.poNumber} wasn't found.`);
    return { issues, lineMatches: inv.lines.map(() => null) };
  }
  if (po.status !== 'ISSUED' && po.status !== 'CLOSED') issues.push(`PO ${po.poNumber} is ${po.status.toLowerCase().replace('_', ' ')}, not issued.`);
  if (inv.vendorName && !sameVendor(inv.vendorName, po.vendorName)) issues.push(`The invoice is from “${inv.vendorName}” but PO ${po.poNumber} is with “${po.vendorName}”.`);

  // Lines: best description match on the PO, then price and quantity.
  const used = new Map<string, number>();
  const lineMatches = inv.lines.map((l, i) => {
    let best: { id: string; score: number } | null = null;
    for (const pl of po.lines) {
      const score = similarity(l.description, pl.description);
      if (score >= 0.5 && (!best || score > best.score)) best = { id: pl.id, score };
    }
    if (!best) {
      issues.push(`Line ${i + 1} (“${l.description}”) isn't on PO ${po.poNumber}.`);
      return null;
    }
    const pl = po.lines.find((x) => x.id === best!.id)!;
    if (l.unitPrice != null && pl.unitCost != null && !close(l.unitPrice, pl.unitCost, tol)) {
      issues.push(`Line ${i + 1} (“${l.description}”): price ${money(l.unitPrice)} vs ${money(pl.unitCost)} on the PO.`);
    }
    if (l.qty != null) {
      const billed = (used.get(pl.id) ?? 0) + l.qty;
      used.set(pl.id, billed);
      if (billed + pl.alreadyInvoiced > pl.qty + 1e-6) issues.push(`Line ${i + 1} (“${l.description}”): billing ${billed + pl.alreadyInvoiced} but the PO is for ${pl.qty}.`);
    }
    return pl.id;
  });

  // Values
  const lineSum = inv.lines.reduce((a, l) => a + (l.amount ?? (l.qty != null && l.unitPrice != null ? l.qty * l.unitPrice : 0)), 0);
  if (inv.subtotal != null && inv.lines.length && !close(inv.subtotal, lineSum, 0.5, 1)) issues.push(`The lines add up to ${money(lineSum)} but the subtotal says ${money(inv.subtotal)}.`);
  const sub = inv.subtotal ?? lineSum;
  if (inv.total != null && sub && !close(inv.total, sub + (inv.gst ?? 0) + (inv.pst ?? 0), 0.5, 1)) issues.push(`Subtotal + tax doesn't equal the total (${money(inv.total)}).`);

  // Taxes: exempt vs not, per the job / equipment on the PO
  if (po.pstExempt && (inv.pst ?? 0) > 0.009) issues.push(`PST of ${money(inv.pst!)} was charged, but this PO is PST exempt.`);
  if (!po.pstExempt && po.pstRate > 0 && sub > 0 && !inv.pst) issues.push('No PST on the invoice, but PST applies to this PO.');
  if (!po.pstExempt && po.pstRate > 0 && inv.pst && sub > 0 && !close(inv.pst, sub * po.pstRate, 2, 0.05)) issues.push(`PST should be about ${money(sub * po.pstRate)} (${po.pstRate * 100}%), the invoice says ${money(inv.pst)}.`);
  const gstRate = po.hstRate || po.gstRate;
  if (gstRate > 0 && inv.gst != null && sub > 0 && !close(inv.gst, sub * gstRate, 2, 0.05)) issues.push(`${po.hstRate ? 'HST' : 'GST'} should be about ${money(sub * gstRate)}, the invoice says ${money(inv.gst)}.`);
  return { issues, lineMatches };
}
