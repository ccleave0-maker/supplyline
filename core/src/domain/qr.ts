// QR codes printed on Bowron paperwork. Scanning one opens the right screen.
// BOLs keep their original "SUPPLYLINE-BOL:<id>:<number>" form.

export type QrKind = 'BOL' | 'PO' | 'ORDER' | 'EQUIPMENT' | 'RECEIPT' | 'MEETING';

export interface QrTarget {
  kind: QrKind;
  id: string;
  /** Number / label printed beside it, e.g. "PO 1042" */
  label: string;
}

export function qrPayload(t: QrTarget): string {
  if (t.kind === 'BOL') return `SUPPLYLINE-BOL:${t.id}:${t.label.replace(/^\D+/, '')}`;
  return `SUPPLYLINE:${t.kind}:${t.id}:${t.label.replace(/[:\n]/g, ' ').slice(0, 60)}`;
}

export function parseQr(text: string): QrTarget | null {
  const t = text.trim();
  const bol = /^SUPPLYLINE-BOL:([a-z0-9]+):(\d*)$/i.exec(t);
  if (bol) return { kind: 'BOL', id: bol[1]!, label: bol[2] ? `BOL #${bol[2]}` : 'BOL' };
  const m = /^SUPPLYLINE:(BOL|PO|ORDER|EQUIPMENT|RECEIPT|MEETING):([a-z0-9]+):(.*)$/i.exec(t);
  if (!m) return null;
  return { kind: m[1]!.toUpperCase() as QrKind, id: m[2]!, label: m[3] ?? '' };
}
