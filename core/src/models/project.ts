import { z } from 'zod';
import { idSchema, optionalText } from './common';

// ---------------------------------------------------------------------------
// Job / project areas: rentals, QC documents (MTRs, certs), subcontracts,
// and vendor / subcontractor compliance (WCB, insurance).
// ---------------------------------------------------------------------------
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

export type StoredFile = { id: string; url: string; fileName: string };

// Rentals --------------------------------------------------------------------
export const RENTAL_RATE_PER = ['HOUR', 'DAY', 'WEEK', 'MONTH'] as const;
export type RentalRatePer = (typeof RENTAL_RATE_PER)[number];
export const RENTAL_RATE_LABELS: Record<RentalRatePer, string> = { HOUR: '/ hour', DAY: '/ day', WEEK: '/ week', MONTH: '/ month' };

export const rentalInput = z.object({
  contactId: idSchema.nullable().optional(),
  description: z.string().trim().min(1, 'What is rented?').max(200),
  unitNumber: optionalText,
  onRentDate: dateOnly,
  expectedOffDate: dateOnly,
  offRentDate: dateOnly,
  rate: z.number().min(0).max(1e9).nullable().optional(),
  ratePer: z.enum(RENTAL_RATE_PER).nullable().optional(),
  poNumber: optionalText,
  insured: z.boolean().optional(),
  insuranceNotes: optionalText,
  maintenanceNotes: optionalText,
  notes: optionalText,
});
export type RentalInput = z.infer<typeof rentalInput>;

export interface RentalItem {
  id: string;
  siteId: string;
  description: string;
  unitNumber: string | null;
  company: { id: string; name: string; businessName: string | null; phone: string | null; cell: string | null; email: string | null } | null;
  onRentDate: string | null;
  expectedOffDate: string | null;
  offRentDate: string | null;
  /** On rent now (no off-rent date yet) */
  onRent: boolean;
  /** Past the expected off-rent date and still on rent */
  overdue: boolean;
  rate: number | null;
  ratePer: RentalRatePer | null;
  poNumber: string | null;
  insured: boolean;
  insuranceNotes: string | null;
  maintenanceNotes: string | null;
  notes: string | null;
  files: StoredFile[];
}

// QC documents (MTRs, certs) ---------------------------------------------------
export const QC_DOC_TYPES = ['MTR', 'CERT', 'OTHER'] as const;
export type QcDocType = (typeof QC_DOC_TYPES)[number];
export const QC_DOC_TYPE_LABELS: Record<QcDocType, string> = { MTR: 'Mill test report (MTR)', CERT: 'Certificate', OTHER: 'Other QC document' };

/** Sent as form fields next to the file. */
export const qcDocInput = z.object({
  type: z.enum(QC_DOC_TYPES),
  title: z.string().trim().min(1, 'Give it a title').max(200),
  heatNumber: optionalText,
  poNumber: optionalText,
  vendorName: optionalText,
  /** Order lines this document covers */
  orderLineIds: z.array(idSchema).max(200).default([]),
});
export type QcDocInput = z.infer<typeof qcDocInput>;

export interface QcDocItem {
  id: string;
  type: QcDocType;
  title: string;
  heatNumber: string | null;
  poNumber: string | null;
  vendorName: string | null;
  lines: { orderLineId: string; label: string; description: string }[];
  file: StoredFile;
  uploadedByName: string | null;
  createdAt: string;
}

// Subcontracts -----------------------------------------------------------------
export const SUBCONTRACT_DOC_TYPES = ['Subcontract agreement', 'Change order', 'Scope / drawings', 'Insurance', 'WCB clearance', 'Safety', 'Invoice / progress claim', 'Other'] as const;

export const subcontractDocInput = z.object({
  subcontractor: z.string().trim().min(1, 'Name the subcontractor').max(160),
  contactId: idSchema.nullable().optional(),
  docType: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1, 'Give it a title').max(200),
  effectiveDate: dateOnly,
});
export type SubcontractDocInput = z.infer<typeof subcontractDocInput>;

export interface SubcontractDocItem {
  id: string;
  subcontractor: string;
  contactId: string | null;
  docType: string;
  title: string;
  effectiveDate: string | null;
  file: StoredFile;
  createdAt: string;
}

// Compliance (WCB, insurance) ---------------------------------------------------
export const COMPLIANCE_KINDS = ['WCB', 'INSURANCE', 'OTHER'] as const;
export type ComplianceKind = (typeof COMPLIANCE_KINDS)[number];
export const COMPLIANCE_KIND_LABELS: Record<ComplianceKind, string> = {
  WCB: 'WCB / WorkSafeBC clearance',
  INSURANCE: 'Certificate of insurance',
  OTHER: 'Other',
};

export const complianceInput = z.object({
  kind: z.enum(COMPLIANCE_KINDS),
  reference: optionalText,
  provider: optionalText,
  coverage: optionalText,
  expiresOn: dateOnly,
  notes: optionalText,
});
export type ComplianceInput = z.infer<typeof complianceInput>;

export type ComplianceState = 'OK' | 'EXPIRING' | 'EXPIRED' | 'MISSING';
export const COMPLIANCE_STATE_LABELS: Record<ComplianceState, string> = { OK: 'Up to date', EXPIRING: 'Expiring soon', EXPIRED: 'Expired', MISSING: 'Missing' };

export interface ComplianceRecordView {
  id: string;
  contactId: string;
  kind: ComplianceKind;
  reference: string | null;
  provider: string | null;
  coverage: string | null;
  expiresOn: string | null;
  notes: string | null;
  state: ComplianceState;
  file: StoredFile | null;
}

/** Overall standing of a vendor / subcontractor: both WCB and insurance on file and in date. */
export interface ComplianceSummary {
  contactId: string;
  name: string;
  businessName: string | null;
  type: string;
  wcb: ComplianceState;
  insurance: ComplianceState;
  state: ComplianceState;
  /** e.g. "WCB expired Oct 1", "No insurance certificate on file" */
  problems: string[];
}

/** Within this many days of expiry counts as "expiring soon". */
export const COMPLIANCE_WARN_DAYS = 30;

export function complianceState(expiresOn: string | null, today: string): ComplianceState {
  if (!expiresOn) return 'OK';
  if (expiresOn < today) return 'EXPIRED';
  const warn = new Date(`${today}T00:00:00Z`);
  warn.setUTCDate(warn.getUTCDate() + COMPLIANCE_WARN_DAYS);
  return expiresOn <= warn.toISOString().slice(0, 10) ? 'EXPIRING' : 'OK';
}

/** Worst state wins. */
export function worstState(states: ComplianceState[]): ComplianceState {
  const order: ComplianceState[] = ['EXPIRED', 'MISSING', 'EXPIRING', 'OK'];
  return order.find((s) => states.includes(s)) ?? 'OK';
}

// Job notifications ------------------------------------------------------------
export interface NotifyRuleView {
  /** A person in Bowron (job member or added), or null for an email-only row */
  userId: string | null;
  email: string;
  name: string;
  isMember: boolean;
  events: string[];
}
export interface NotifySetup {
  /** No rules saved yet: the job's people get the default delivery notices */
  usingDefaults: boolean;
  rows: NotifyRuleView[];
  canEdit: boolean;
}
export const notifyRulesInput = z.object({
  rows: z
    .array(
      z.object({
        userId: idSchema.nullable().optional(),
        email: z.string().trim().toLowerCase().email('Enter a valid email').nullable().optional(),
        name: z.string().trim().max(120).nullable().optional(),
        events: z.array(z.string().max(40)).max(20),
      }),
    )
    .max(100),
});
export type NotifyRulesInput = z.infer<typeof notifyRulesInput>;
