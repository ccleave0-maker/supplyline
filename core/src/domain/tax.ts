// Sales tax by the province a job is in. GST is tracked separately on every
// purchase; PST only where the province charges it (BC today). HST provinces
// are shown for completeness. Rates are defaults; Phase 6 POs read them from here.

export const PROVINCES = [
  { code: 'BC', name: 'British Columbia' },
  { code: 'AB', name: 'Alberta' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'ON', name: 'Ontario' },
  { code: 'QC', name: 'Quebec' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'YT', name: 'Yukon' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
] as const;
export type ProvinceCode = (typeof PROVINCES)[number]['code'];

/** "BC", "B.C.", "british columbia" → "BC" (null if unknown). */
export function provinceCode(p: string | null | undefined): ProvinceCode | null {
  if (!p) return null;
  const t = p.trim().toUpperCase().replace(/\./g, '');
  const hit = PROVINCES.find((x) => x.code === t || x.name.toUpperCase() === t);
  return hit?.code ?? null;
}

export interface TaxProfile {
  province: ProvinceCode | null;
  gstRate: number;
  /** Provincial sales tax charged on purchases for this job (0 = none) */
  pstRate: number;
  /** HST replaces GST + PST in these provinces */
  hstRate: number;
  /** Plain words for the job page */
  label: string;
}

const PST: Partial<Record<ProvinceCode, number>> = { BC: 0.07, SK: 0.06, MB: 0.07 };
const HST: Partial<Record<ProvinceCode, number>> = { ON: 0.13, NB: 0.15, NS: 0.14, PE: 0.15, NL: 0.15 };

export function taxProfile(province: string | null | undefined, pstExempt = false): TaxProfile {
  const code = provinceCode(province);
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
  if (!code) return { province: null, gstRate: 0.05, pstRate: 0, hstRate: 0, label: 'Set the province to work out PST.' };
  if (HST[code]) return { province: code, gstRate: 0, pstRate: 0, hstRate: HST[code]!, label: `HST ${pct(HST[code]!)} (${code})` };
  if (code === 'QC') return { province: code, gstRate: 0.05, pstRate: 0, hstRate: 0, label: 'GST 5% (QST not handled yet)' };
  const pst = PST[code] ?? 0;
  if (!pst) return { province: code, gstRate: 0.05, pstRate: 0, hstRate: 0, label: `GST 5% · no PST in ${code}` };
  if (pstExempt) return { province: code, gstRate: 0.05, pstRate: 0, hstRate: 0, label: `GST 5% · PST exempt (${code})` };
  return { province: code, gstRate: 0.05, pstRate: pst, hstRate: 0, label: `GST 5% · PST ${pct(pst)} (${code})` };
}

/** Money to the cent. */
export const cents = (n: number) => Math.round(n * 100) / 100;

/** PO totals: subtotal, then GST / PST / HST on it. */
export function poTotals(lines: { qty: number; unitCost: number | null }[], rates: { gstRate: number; pstRate: number; hstRate: number }) {
  const subtotal = cents(lines.reduce((a, l) => a + (l.unitCost == null ? 0 : l.qty * l.unitCost), 0));
  const gst = cents(subtotal * rates.gstRate);
  const pst = cents(subtotal * rates.pstRate);
  const hst = cents(subtotal * rates.hstRate);
  return { subtotal, gst, pst, hst, total: cents(subtotal + gst + pst + hst) };
}
