// Receiving from a photo.
//  - Our own BOLs carry a QR code: decoding it identifies the BOL exactly.
//  - Vendors' packing slips / waybills: the text is read (OCR) and matched
//    against your OPEN PO numbers and order numbers, so only real, expected
//    deliveries can match. Reading quantities off the paper comes with the
//    AI document scan (Phase 7).

import path from 'node:path';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import { formatListLabel, parseQr } from '@supplyline/core/domain';
import type { DocumentScanResult, ScanTarget, UniversalScanResult } from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import { db } from '../lib/db';
import { requirePermission, type AuthContext } from '../lib/auth';
import { badRequest } from '../lib/errors';
import { parseBolQr } from '../pdf/bol-pdf';
import { accessibleCompanyIds } from './access';
import { readPackingSlip } from './ai';
import { lookupBol } from './bols';

const MAX_BYTES = 15 * 1_048_576;

async function readQr(bytes: Uint8Array): Promise<string | null> {
  for (const width of [1400, 900, 2200]) {
    try {
      const { data, info } = await sharp(bytes)
        .rotate() // respect the phone's orientation
        .resize({ width, withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) return code.data;
    } catch {
      return null; // not an image sharp can read
    }
  }
  return null;
}

let workerPromise: Promise<Worker> | null = null;
function ocrWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng', undefined, { cachePath: path.resolve(process.cwd(), '.cache', 'tesseract') });
  return workerPromise;
}

async function readText(bytes: Uint8Array): Promise<string> {
  const prepared = await sharp(bytes).rotate().resize({ width: 1800, withoutEnlargement: true }).greyscale().normalize().png().toBuffer();
  const worker = await ocrWorker();
  const { data } = await worker.recognize(prepared);
  return data.text ?? '';
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Does the OCR text contain this PO number as its own "word" (allowing a PO/# prefix stuck to it)? */
export function textHasPo(text: string, poNumber: string): boolean {
  const target = norm(poNumber);
  if (target.length < 3) return false;
  const tokens = text.toUpperCase().split(/[\s,;:()]+/).map(norm).filter(Boolean);
  return tokens.some((t) => t === target || ((t.startsWith('PO') || t.startsWith('NO')) && t.slice(2) === target) || t === `PO${target}`);
}

function sample(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function scanDocument(auth: AuthContext, file: File, mode: 'yard' | 'site'): Promise<DocumentScanResult> {
  const r = await scanDocumentInner(auth, file, mode);
  // Yard + a PO found: let the AI read the quantities off the slip (when AI is on).
  if (mode === 'yard' && r.match?.kind === 'PO') {
    const companies = await accessibleCompanyIds(auth);
    const po = await db.purchaseOrder.findFirst({
      where: { organizationId: auth.orgId, companyId: { in: companies }, poNumber: { equals: r.match.query, mode: 'insensitive' } },
      include: { lines: { include: { orderLine: { select: { description: true, uom: true } }, yardReceiptLines: { select: { qtyReceived: true } } } } },
    });
    if (po) {
      const lines = po.lines.map((l) => ({
        id: l.id,
        description: l.orderLine?.description ?? l.description ?? '',
        uom: l.orderLine?.uom ?? l.uom ?? 'EA',
        remaining: Math.max(0, Number(l.qty) - l.yardReceiptLines.reduce((a, x) => a + Number(x.qtyReceived), 0)),
      }));
      const slip = await readPackingSlip(auth, { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }, { companyId: po.companyId, poNumber: po.poNumber, lines });
      return { ...r, slip };
    }
  }
  return r;
}

async function scanDocumentInner(auth: AuthContext, file: File, mode: 'yard' | 'site'): Promise<DocumentScanResult> {
  requirePermission(auth, mode === 'yard' ? 'yard:work' : 'bol:receive');
  if (file.size === 0 || file.size > MAX_BYTES) throw badRequest('Take the photo again (the file was empty or too big).');
  const bytes = new Uint8Array(await file.arrayBuffer());

  // 1. Our own BOL? The QR code says exactly which one.
  const qr = await readQr(bytes);
  const qrBol = qr ? parseBolQr(qr) : null;
  if (qrBol) {
    try {
      const b = await lookupBol(auth, qr!);
      return { match: { kind: 'BOL', query: b.label, label: b.label, bolId: b.id }, method: 'qr', textSample: '' };
    } catch {
      return { match: null, method: 'qr', textSample: 'This BOL belongs to a company or job you can’t see.' };
    }
  }

  // Our PO / packing list / order list QR codes.
  const ours = qr ? parseQr(qr) : null;
  if (ours && mode === 'yard' && (ours.kind === 'PO' || ours.kind === 'ORDER')) {
    const companies = await accessibleCompanyIds(auth);
    if (ours.kind === 'PO') {
      const po = await db.purchaseOrder.findFirst({ where: { id: ours.id, organizationId: auth.orgId, companyId: { in: companies } } });
      if (po) return { match: { kind: 'PO', query: po.poNumber, label: `PO ${po.poNumber}` }, method: 'qr', textSample: '' };
    } else {
      const o = await db.orderForm.findFirst({ where: { id: ours.id, organizationId: auth.orgId, companyId: { in: companies } }, include: { site: { select: { jobNumber: true } } } });
      if (o) {
        const label = formatListLabel(o.site.jobNumber, o.listNo);
        return { match: { kind: 'ORDER', query: label, label }, method: 'qr', textSample: '' };
      }
    }
  }

  // 2. Read the text.
  let text = '';
  try {
    text = await readText(bytes);
  } catch (e) {
    console.error('[scan] OCR failed', e);
    return { match: null, method: null, textSample: '' };
  }

  // A BOL number printed on our own BOL (if the QR was out of shot).
  const bolNo = /\b(?:RETURN\s+)?B\s*O\s*L\s*[#:NO.\s]*\s*(\d{1,7})\b/i.exec(text);
  if (bolNo) {
    try {
      const b = await lookupBol(auth, bolNo[1]!);
      return { match: { kind: 'BOL', query: b.label, label: b.label, bolId: b.id }, method: 'text', textSample: sample(text) };
    } catch {
      /* not one of ours: keep looking */
    }
  }
  if (mode === 'site') return { match: null, method: null, textSample: sample(text) };

  // 3. Vendor paperwork: match against POs that are still expecting something.
  const companies = await accessibleCompanyIds(auth);
  const pos = await db.purchaseOrder.findMany({
    where: { organizationId: auth.orgId, companyId: { in: companies } },
    select: { poNumber: true, lines: { select: { qty: true, yardReceiptLines: { select: { qtyReceived: true } } } } },
  });
  const open = pos.filter((p) => p.lines.some((l) => Number(l.qty) > l.yardReceiptLines.reduce((a, r) => a + Number(r.qtyReceived), 0) + 1e-6));
  const hits = open.filter((p) => textHasPo(text, p.poNumber)).sort((a, b) => norm(b.poNumber).length - norm(a.poNumber).length);
  if (hits[0]) return { match: { kind: 'PO', query: hits[0].poNumber, label: `PO ${hits[0].poNumber}` }, method: 'text', textSample: sample(text) };

  // 4. Our order number written on the paperwork ("JOB#2249 LIST#1").
  const list = /JOB\s*#?\s*([A-Z0-9-]{2,})\s+LIST\s*#?\s*(\d{1,4})/i.exec(text);
  if (list) {
    const label = formatListLabel(list[1]!, Number(list[2]));
    return { match: { kind: 'ORDER', query: label, label }, method: 'text', textSample: sample(text) };
  }
  return { match: null, method: null, textSample: sample(text) };
}

// ---------------------------------------------------------------------------
// One Scan button for everything: any Bowron QR (or a printed BOL / PO number)
// ---------------------------------------------------------------------------
async function resolveTarget(auth: AuthContext, kind: ScanTarget['kind'], id: string): Promise<ScanTarget | null> {
  const companies = await accessibleCompanyIds(auth);
  if (kind === 'BOL') {
    try {
      const b = await lookupBol(auth, `SUPPLYLINE-BOL:${id}:`);
      const receivable = can(auth, 'bol:receive');
      return { kind, id: b.id, label: b.label, link: receivable ? `/bols/receive/?id=${b.id}` : `/bols/view/?id=${b.id}` };
    } catch {
      return null;
    }
  }
  if (kind === 'PO') {
    const po = await db.purchaseOrder.findFirst({ where: { id, organizationId: auth.orgId, OR: [{ companyId: { in: companies } }, { site: { projectManagerId: auth.userId } }] } });
    if (!po) return null;
    const receive = can(auth, 'yard:work') && po.status === 'ISSUED';
    return { kind, id, label: `PO ${po.poNumber}`, link: receive ? `/yard/receive/?q=${encodeURIComponent(po.poNumber)}` : `/purchase-orders/view/?id=${id}` };
  }
  if (kind === 'ORDER') {
    const o = await db.orderForm.findFirst({ where: { id, organizationId: auth.orgId }, include: { site: { select: { jobNumber: true } } } });
    if (!o) return null;
    return { kind, id, label: formatListLabel(o.site.jobNumber, o.listNo), link: `/orders/view/?id=${id}` };
  }
  if (kind === 'EQUIPMENT') {
    const e = await db.equipment.findFirst({ where: { id, organizationId: auth.orgId, companyId: { in: companies } } });
    if (!e) return null;
    return { kind, id, label: `Unit ${e.unitNumber}`, link: `/equipment/view/?id=${id}` };
  }
  if (kind === 'MEETING') {
    const m = await db.meeting.findFirst({ where: { id, organizationId: auth.orgId, companyId: { in: companies } } });
    if (!m) return null;
    return { kind, id, label: m.title, link: `/meetings/run/?id=${id}` };
  }
  return null;
}

export async function scanAnything(auth: AuthContext, file: File): Promise<UniversalScanResult> {
  if (file.size === 0 || file.size > MAX_BYTES) throw badRequest('Take the photo again (the file was empty or too big).');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const qr = await readQr(bytes);
  const ours = qr ? parseQr(qr) : null;
  if (ours) {
    const target = await resolveTarget(auth, ours.kind, ours.id);
    return target ? { target, method: 'qr', textSample: '' } : { target: null, method: 'qr', textSample: 'That code is for something you don’t have access to.' };
  }
  // No QR: read the printed BOL / PO number.
  if (!can(auth, 'yard:work') && !can(auth, 'bol:receive')) return { target: null, method: null, textSample: '' };
  const r = await scanDocument(auth, file, can(auth, 'yard:work') ? 'yard' : 'site');
  if (r.match?.kind === 'BOL' && r.match.bolId) return { target: await resolveTarget(auth, 'BOL', r.match.bolId), method: r.method, textSample: r.textSample };
  if (r.match?.kind === 'PO') {
    const po = await db.purchaseOrder.findFirst({ where: { organizationId: auth.orgId, poNumber: { equals: r.match.query, mode: 'insensitive' } } });
    if (po) return { target: await resolveTarget(auth, 'PO', po.id), method: r.method, textSample: r.textSample };
  }
  if (r.match?.kind === 'ORDER') return { target: { kind: 'ORDER', id: '', label: r.match.label, link: `/yard/receive/?q=${encodeURIComponent(r.match.query)}` }, method: r.method, textSample: r.textSample };
  return { target: null, method: r.method, textSample: r.textSample };
}
