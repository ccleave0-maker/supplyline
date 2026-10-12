// Equipment register: units per company, where each one is, every move it
// makes (with a map position), its PST setup, and importing the company list
// from a spreadsheet.

import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import { qrPayload } from '@supplyline/core/domain';
import { renderEquipmentTags } from '../pdf/equipment-tag';
import {
  EQUIPMENT_IMPORT_FIELDS,
  type EquipmentDetail,
  type EquipmentImportField,
  type EquipmentImportInput,
  type EquipmentImportResult,
  type EquipmentInput,
  type EquipmentItem,
  type EquipmentMoveInput,
  type SheetPreview,
} from '@supplyline/core/models';
import { can } from '@supplyline/core/permissions';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { accessibleCompanyIds } from './access';
import { fileUrl, saveUpload } from './files';

const include = {
  company: { select: { name: true, themeColor: true } },
  currentLocation: { select: { id: true, businessName: true, siteId: true, lat: true, lng: true } },
  movements: { orderBy: { movedAt: 'desc' }, take: 1, select: { movedAt: true } },
} satisfies Prisma.EquipmentInclude;
type Row = Prisma.EquipmentGetPayload<{ include: typeof include }>;

function toItem(e: Row): EquipmentItem {
  return {
    id: e.id,
    companyId: e.companyId,
    companyName: e.company.name,
    themeColor: e.company.themeColor,
    unitNumber: e.unitNumber,
    description: e.description,
    make: e.make,
    model: e.model,
    year: e.year,
    serial: e.serial,
    category: e.category,
    active: e.active,
    pstExempt: e.pstExempt,
    location: e.currentLocation
      ? { id: e.currentLocation.id, name: e.currentLocation.businessName, siteId: e.currentLocation.siteId }
      : e.currentLocationText
        ? { id: null, name: e.currentLocationText, siteId: null }
        : null,
    lat: e.currentLat,
    lng: e.currentLng,
    lastMovedAt: e.movements[0]?.movedAt.toISOString() ?? null,
  };
}

async function companyGuard(auth: AuthContext, companyId: string) {
  if (!(await accessibleCompanyIds(auth)).includes(companyId)) throw notFound('Company');
}

async function load(auth: AuthContext, id: string) {
  const e = await db.equipment.findFirst({ where: { id, organizationId: auth.orgId, companyId: { in: await accessibleCompanyIds(auth) } }, include });
  if (!e) throw notFound('Equipment');
  return e;
}

export async function listEquipment(
  auth: AuthContext,
  f: { q?: string; companyId?: string; siteId?: string; category?: string; includeInactive?: boolean },
): Promise<EquipmentItem[]> {
  requirePermission(auth, 'site:view');
  const companies = await accessibleCompanyIds(auth);
  const rows = await db.equipment.findMany({
    where: {
      organizationId: auth.orgId,
      companyId: f.companyId ? (companies.includes(f.companyId) ? f.companyId : '__none__') : { in: companies },
      ...(f.includeInactive ? {} : { active: true }),
      ...(f.category ? { category: { equals: f.category, mode: 'insensitive' } } : {}),
      ...(f.siteId ? { currentLocation: { siteId: f.siteId } } : {}),
      ...(f.q
        ? {
            OR: [
              { unitNumber: { contains: f.q, mode: 'insensitive' } },
              { description: { contains: f.q, mode: 'insensitive' } },
              { make: { contains: f.q, mode: 'insensitive' } },
              { model: { contains: f.q, mode: 'insensitive' } },
              { serial: { contains: f.q, mode: 'insensitive' } },
              { currentLocationText: { contains: f.q, mode: 'insensitive' } },
              { currentLocation: { businessName: { contains: f.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include,
    orderBy: [{ companyId: 'asc' }, { unitNumber: 'asc' }],
  });
  return rows.map(toItem);
}

export async function getEquipment(auth: AuthContext, id: string): Promise<EquipmentDetail> {
  requirePermission(auth, 'site:view');
  const e = await load(auth, id);
  const full = await db.equipment.findUniqueOrThrow({
    where: { id },
    include: {
      pstExemptionFile: { select: { id: true, fileName: true } },
      movements: {
        orderBy: { movedAt: 'desc' },
        include: { from: { select: { businessName: true } }, to: { select: { businessName: true } }, recordedBy: { select: { name: true } } },
      },
    },
  });
  return {
    ...toItem(e),
    notes: full.notes,
    pstExemptNumber: full.pstExemptNumber,
    pstExemptionFile: full.pstExemptionFile ? { id: full.pstExemptionFile.id, fileName: full.pstExemptionFile.fileName, url: fileUrl(full.pstExemptionFile.id)! } : null,
    movements: full.movements.map((m) => ({
      id: m.id,
      movedAt: m.movedAt.toISOString(),
      fromName: m.from?.businessName ?? m.fromText,
      toName: m.to?.businessName ?? m.toText,
      recordedByName: m.recordedBy.name,
      bolId: m.bolId,
      notes: m.notes,
    })),
    canEdit: can(auth, 'equipment:edit'),
    canMove: can(auth, 'equipment:move'),
  };
}

function fields<T extends Partial<EquipmentInput>>(input: T): Omit<T, 'companyId'> {
  const { companyId: _c, ...rest } = input;
  return rest;
}

export async function createEquipment(auth: AuthContext, input: EquipmentInput) {
  requirePermission(auth, 'equipment:edit');
  await companyGuard(auth, input.companyId);
  const clash = await db.equipment.findFirst({ where: { companyId: input.companyId, unitNumber: { equals: input.unitNumber, mode: 'insensitive' } } });
  if (clash) throw conflict(`Unit ${input.unitNumber} already exists for this company.`);
  const e = await db.equipment.create({ data: { ...fields(input), organizationId: auth.orgId, companyId: input.companyId } });
  await audit(db, auth, 'equipment.create', 'Equipment', e.id, null, input);
  return { id: e.id };
}

export async function updateEquipment(auth: AuthContext, id: string, input: Partial<EquipmentInput>) {
  requirePermission(auth, 'equipment:edit');
  const before = await load(auth, id);
  if (input.unitNumber && input.unitNumber.toLowerCase() !== before.unitNumber.toLowerCase()) {
    const clash = await db.equipment.findFirst({ where: { companyId: before.companyId, unitNumber: { equals: input.unitNumber, mode: 'insensitive' }, id: { not: id } } });
    if (clash) throw conflict(`Unit ${input.unitNumber} already exists for this company.`);
  }
  await db.equipment.update({ where: { id }, data: fields(input) });
  await audit(db, auth, 'equipment.update', 'Equipment', id, { unitNumber: before.unitNumber }, input);
  return { id };
}

/** Where a location sits on the map: the job/yard pin, else the location's own. */
async function positionOf(locationId: string) {
  const l = await db.shippingLocation.findUnique({ where: { id: locationId }, include: { site: { select: { lat: true, lng: true } } } });
  return { lat: l?.site?.lat ?? l?.lat ?? null, lng: l?.site?.lng ?? l?.lng ?? null };
}

/** Record a move: from where it is now to a library location or a typed place. */
export async function moveEquipment(auth: AuthContext, id: string, input: EquipmentMoveInput, opts: { bolId?: string } = {}) {
  requirePermission(auth, 'equipment:move');
  const e = await load(auth, id);
  let toLocationId: string | null = null;
  if (input.toLocationId) {
    const loc = await db.shippingLocation.findFirst({ where: { id: input.toLocationId, organizationId: auth.orgId } });
    if (!loc) throw badRequest('That location is not in the locations list.');
    toLocationId = loc.id;
  }
  const pos = toLocationId ? await positionOf(toLocationId) : { lat: null, lng: null };
  const movedAt = input.movedAt ? new Date(`${input.movedAt}T12:00:00Z`) : new Date();
  await db.$transaction(async (tx) => {
    await tx.equipmentMovement.create({
      data: {
        equipmentId: id,
        fromLocationId: e.currentLocationId,
        fromText: e.currentLocationId ? null : e.currentLocationText,
        toLocationId,
        toText: toLocationId ? null : (input.toText ?? null),
        movedAt,
        recordedById: auth.userId,
        bolId: opts.bolId ?? null,
        notes: input.notes ?? null,
      },
    });
    await tx.equipment.update({
      where: { id },
      data: { currentLocationId: toLocationId, currentLocationText: toLocationId ? null : (input.toText ?? null), currentLat: pos.lat, currentLng: pos.lng },
    });
    await audit(tx, auth, 'equipment.move', 'Equipment', id, { locationId: e.currentLocationId, text: e.currentLocationText }, input);
  });
  return getEquipment(auth, id);
}

export async function setEquipmentPstForm(auth: AuthContext, id: string, file: File | null) {
  requirePermission(auth, 'equipment:edit');
  const e = await load(auth, id);
  const prev = await db.equipment.findUniqueOrThrow({ where: { id }, select: { pstExemptionFileId: true } });
  let fileId: string | null = null;
  if (file) fileId = (await saveUpload({ organizationId: auth.orgId, companyId: e.companyId, uploadedById: auth.userId, kind: 'PST_EXEMPTION', file, maxBytes: 20 * 1_048_576 })).id;
  await db.$transaction(async (tx) => {
    await tx.equipment.update({ where: { id }, data: { pstExemptionFileId: fileId } });
    if (prev.pstExemptionFileId) await tx.fileAsset.update({ where: { id: prev.pstExemptionFileId }, data: { deletedAt: new Date() } });
    await audit(tx, auth, 'equipment.pst_form', 'Equipment', id, { fileId: prev.pstExemptionFileId }, { fileId });
  });
  return { fileId, url: fileUrl(fileId) };
}

// ---------------------------------------------------------------------------
// Import from a spreadsheet (CSV or Excel)
// ---------------------------------------------------------------------------
/** Minimal CSV reader: quotes, escaped quotes, commas/semicolons/tabs, CRLF. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

export async function readXlsx(bytes: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const cells: string[] = [];
    for (let c = 1; c <= Math.min(ws.columnCount, 100); c++) {
      const v = r.getCell(c).value as unknown;
      let text = '';
      if (v == null) text = '';
      else if (v instanceof Date) text = v.toISOString().slice(0, 10);
      else if (typeof v === 'object' && v && 'text' in v) text = String((v as { text: unknown }).text);
      else if (typeof v === 'object' && v && 'result' in v) text = String((v as { result: unknown }).result ?? '');
      else if (typeof v === 'object' && v && 'richText' in v) text = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
      else text = String(v);
      cells.push(text.trim());
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.some(Boolean)) rows.push(cells);
  });
  return rows;
}

const GUESS: Record<EquipmentImportField, RegExp> = {
  unitNumber: /^(unit|unit ?#|unit ?no|unit number|equip(ment)? ?(#|no|id)|fleet ?#?|asset ?(#|no|id)?)$/i,
  description: /^(desc(ription)?|equipment|name|item)$/i,
  make: /^(make|manufacturer|mfr|brand)$/i,
  model: /^model$/i,
  year: /^(year|yr|model year)$/i,
  serial: /^(serial|serial ?#|serial ?no|s\/n|vin|pin)$/i,
  category: /^(category|type|class|group)$/i,
  location: /^(location|current location|site|job|yard)$/i,
  pstExempt: /^(pst ?exempt|exempt)$/i,
  pstExemptNumber: /^(pst ?(exemption|exempt) ?(#|no|number)|exemption ?#?)$/i,
  notes: /^(notes?|comments?)$/i,
};

export async function previewSheet(auth: AuthContext, file: File): Promise<SheetPreview> {
  requirePermission(auth, 'equipment:edit');
  if (file.size === 0 || file.size > 10 * 1_048_576) throw badRequest('Upload a CSV or Excel file up to 10 MB.');
  const name = file.name.toLowerCase();
  let all: string[][];
  if (name.endsWith('.xlsx')) all = await readXlsx(await file.arrayBuffer());
  else if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.includes('csv')) all = parseCsv(await file.text());
  else throw badRequest('Upload a .csv or .xlsx file (in Excel: File › Save As › Excel Workbook or CSV).');
  if (all.length < 2) throw badRequest('The sheet needs a header row and at least one unit.');
  const [headers, ...rows] = all as [string[], ...string[][]];
  if (rows.length > 5000) throw badRequest('That sheet has more than 5,000 rows. Split it into smaller files.');
  const suggested: SheetPreview['suggested'] = {};
  for (const f of EQUIPMENT_IMPORT_FIELDS) {
    const i = headers.findIndex((h) => GUESS[f.key].test(h.trim()));
    if (i >= 0 && !Object.values(suggested).includes(i)) suggested[f.key] = i;
  }
  return { fileName: file.name, headers, rows: rows.map((r) => headers.map((_, i) => r[i] ?? '')), suggested };
}

const yes = (v: string) => /^(y|yes|true|1|x|exempt)$/i.test(v.trim());

export async function importEquipment(auth: AuthContext, input: EquipmentImportInput): Promise<EquipmentImportResult> {
  requirePermission(auth, 'equipment:edit');
  await companyGuard(auth, input.companyId);
  const col = (f: EquipmentImportField) => input.mapping[f];
  if (col('unitNumber') == null || col('description') == null) throw badRequest('Choose which columns hold the Unit # and the Description.');
  const get = (r: string[], f: EquipmentImportField) => {
    const i = col(f);
    return i == null ? undefined : (r[i] ?? '').trim();
  };
  const locations = await db.shippingLocation.findMany({ where: { organizationId: auth.orgId, active: true }, include: { site: { select: { jobNumber: true, lat: true, lng: true } } } });
  const findLocation = (text: string) => {
    const t = text.toLowerCase();
    return locations.find((l) => l.businessName.toLowerCase() === t || (l.site && (l.site.jobNumber.toLowerCase() === t || `job#${l.site.jobNumber}`.toLowerCase() === t)));
  };
  const existing = new Map(
    (await db.equipment.findMany({ where: { companyId: input.companyId }, select: { id: true, unitNumber: true } })).map((e) => [e.unitNumber.toLowerCase(), e.id]),
  );
  const result: EquipmentImportResult = { created: 0, updated: 0, skipped: [] };
  const seen = new Set<string>();

  for (const [i, r] of input.rows.entries()) {
    const rowNo = i + 2; // header is row 1
    const unitNumber = get(r, 'unitNumber') ?? '';
    const description = get(r, 'description') ?? '';
    if (!unitNumber) {
      result.skipped.push({ row: rowNo, reason: 'No unit #' });
      continue;
    }
    if (seen.has(unitNumber.toLowerCase())) {
      result.skipped.push({ row: rowNo, reason: `Unit ${unitNumber} appears twice in the sheet` });
      continue;
    }
    seen.add(unitNumber.toLowerCase());
    if (!description) {
      result.skipped.push({ row: rowNo, reason: `Unit ${unitNumber} has no description` });
      continue;
    }
    const yearText = get(r, 'year');
    const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : null;
    const data = {
      unitNumber: unitNumber.slice(0, 40),
      description: description.slice(0, 200),
      ...(col('make') != null ? { make: get(r, 'make') || null } : {}),
      ...(col('model') != null ? { model: get(r, 'model') || null } : {}),
      ...(col('year') != null ? { year } : {}),
      ...(col('serial') != null ? { serial: get(r, 'serial') || null } : {}),
      ...(col('category') != null ? { category: get(r, 'category') || null } : {}),
      ...(col('pstExempt') != null ? { pstExempt: yes(get(r, 'pstExempt') ?? '') } : {}),
      ...(col('pstExemptNumber') != null ? { pstExemptNumber: get(r, 'pstExemptNumber') || null } : {}),
      ...(col('notes') != null ? { notes: get(r, 'notes') || null } : {}),
      importedRaw: Object.fromEntries(input.headers.map((h, j) => [h || `Column ${j + 1}`, r[j] ?? ''])),
    };
    const locText = get(r, 'location');
    const loc = locText ? findLocation(locText) : undefined;
    const place = locText
      ? loc
        ? { currentLocationId: loc.id, currentLocationText: null, currentLat: loc.site?.lat ?? loc.lat, currentLng: loc.site?.lng ?? loc.lng }
        : { currentLocationId: null, currentLocationText: locText.slice(0, 200), currentLat: null, currentLng: null }
      : {};
    const id = existing.get(unitNumber.toLowerCase());
    if (id) {
      if (!input.updateExisting) {
        result.skipped.push({ row: rowNo, reason: `Unit ${unitNumber} already exists` });
        continue;
      }
      await db.equipment.update({ where: { id }, data: { ...data, ...place } });
      result.updated++;
    } else {
      await db.equipment.create({ data: { ...data, ...place, organizationId: auth.orgId, companyId: input.companyId } });
      result.created++;
    }
  }
  await audit(db, auth, 'equipment.import', 'Company', input.companyId, null, { created: result.created, updated: result.updated, skipped: result.skipped.length });
  return result;
}

/** Printable QR tags for some units (or every active unit you can see). */
export async function equipmentTagsPdf(auth: AuthContext, ids: string[] | null) {
  requirePermission(auth, 'site:view');
  const companies = await accessibleCompanyIds(auth);
  const units = await db.equipment.findMany({
    where: { organizationId: auth.orgId, companyId: { in: companies }, ...(ids ? { id: { in: ids } } : { active: true }) },
    include: { company: { select: { name: true, themeColor: true } } },
    orderBy: [{ companyId: 'asc' }, { unitNumber: 'asc' }],
    take: 400,
  });
  if (!units.length) throw notFound('Equipment');
  const tags = await Promise.all(
    units.map(async (u) => ({
      unitNumber: u.unitNumber,
      description: u.description,
      detail: [u.year, u.make, u.model].filter(Boolean).join(' ') || null,
      companyName: u.company.name,
      themeColor: u.company.themeColor,
      qr: await QRCode.toBuffer(qrPayload({ kind: 'EQUIPMENT', id: u.id, label: `Unit ${u.unitNumber}` }), { type: 'png', margin: 1, width: 400 }),
    })),
  );
  return { bytes: await renderEquipmentTags(tags), fileName: units.length === 1 ? `Tag-${units[0]!.unitNumber}.pdf` : 'Equipment-tags.pdf' };
}
