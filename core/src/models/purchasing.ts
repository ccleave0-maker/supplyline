import { z } from 'zod';
import { emailSchema, idSchema, optionalText } from './common';
import type { StoredFile } from './project';

// ---------------------------------------------------------------------------
// Purchase orders (against a job / project or a piece of equipment)
// ---------------------------------------------------------------------------
export const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ISSUED', 'CLOSED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
/** Pending = quiet (nothing automatic); Committed = sent, chase-ups and emails run; Complete = invoiced in full (locked). */
export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  DRAFT: 'Pending',
  PENDING_APPROVAL: 'Pending approval',
  ISSUED: 'Committed',
  CLOSED: 'Complete',
  CANCELLED: 'Cancelled',
};

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

export const poLineInput = z.object({
  /** Existing PO line (when editing a draft) */
  id: idSchema.optional(),
  /** A line from one of the job's order lists (optional) */
  orderLineId: idSchema.nullable().optional(),
  description: z.string().trim().min(1, 'Describe the item').max(300),
  qty: z.number().positive('Quantity must be more than 0').max(1e9),
  uom: z.string().trim().min(1, 'Unit is required').max(20),
  unitCost: z.number().min(0).max(1e9).nullable().optional(),
  /** For job budgets (lines from an order list use their own cost code) */
  costCode: z.string().trim().max(40).nullable().optional(),
  /** Bought off-list (not from an order list): why — shown on the order list it joins */
  offListReason: z.string().trim().max(300).nullable().optional(),
});
export type PoLineInput = z.infer<typeof poLineInput>;

export const poInput = z
  .object({
    companyId: idSchema,
    poNumber: z.string().trim().min(1, 'Enter the PO number').max(40),
    vendorName: z.string().trim().min(1, 'Enter the vendor').max(120),
    /** The vendor's contact (for the email address); links the vendor to the contact */
    vendorContactId: idSchema.nullable().optional(),
    siteId: idSchema.nullable().optional(),
    equipmentId: idSchema.nullable().optional(),
    orderedDate: dateOnly,
    expectedDate: dateOnly,
    /** Yard it's delivered to; empty = straight to the job */
    deliverToYardId: idSchema.nullable().optional(),
    shipToText: optionalText,
    /** Carrier from the Ship via list, and a ship-to location (from the job's list) */
    shipViaId: idSchema.nullable().optional(),
    shipToLocationId: idSchema.nullable().optional(),
    /** Who at our company it's for (two site contacts), and who at the vendor it was placed with */
    siteContact1Id: idSchema.nullable().optional(),
    siteContact2Id: idSchema.nullable().optional(),
    supplierContactId: idSchema.nullable().optional(),
    /** Vendor ships straight to the job: a BOL is made with the ETA and the site is told */
    shipDirect: z.boolean().optional(),
    notes: optionalText,
    emailVendor: z.boolean().optional(),
    /** The job's project documents to attach (added at the end of the PO); leave out to keep what's there */
    documentIds: z.array(idSchema).max(30).optional(),
    lines: z.array(poLineInput).min(1, 'Add at least one line').max(300),
  })
  .superRefine((v, ctx) => {
    if (!v.siteId && !v.equipmentId) ctx.addIssue({ code: 'custom', path: ['siteId'], message: 'Choose the job / project or the piece of equipment this PO is for' });
    if (v.siteId && v.equipmentId) ctx.addIssue({ code: 'custom', path: ['equipmentId'], message: 'A PO is for a job or a piece of equipment, not both' });
  });
export type PoInput = z.infer<typeof poInput>;

export interface PoTotals {
  subtotal: number;
  gst: number;
  pst: number;
  hst: number;
  total: number;
}

export interface PoSummary {
  id: string;
  poNumber: string;
  companyId: string;
  companyName: string;
  vendorName: string;
  status: PoStatus;
  /** "JOB#2249 Job A" or "Unit EX-101 · 320 excavator" */
  target: string;
  siteId: string | null;
  equipmentId: string | null;
  orderedDate: string | null;
  expectedDate: string | null;
  lineCount: number;
  /** null when you can't see prices */
  totals: PoTotals | null;
  received: 'NONE' | 'PART' | 'FULL';
  /** Expected date passed and not all received */
  overdue: boolean;
  /** You can approve it now */
  awaitingMyApproval: boolean;
}

export interface PoLineView {
  id: string;
  lineNo: number;
  orderLineId: string | null;
  /** "JOB#2249 LIST#3 L2" when it came from an order list */
  orderLabel: string | null;
  orderId: string | null;
  description: string;
  qty: number;
  uom: string;
  unitCost: number | null;
  extended: number | null;
  received: number;
  offListReason: string | null;
}

export interface PoDetail extends PoSummary {
  vendor: { id: string; name: string; contactId: string | null; contactName: string | null; email: string | null; phone: string | null };
  deliverTo: { id: string; name: string } | null;
  shipToText: string | null;
  notes: string | null;
  lines: PoLineView[];
  tax: {
    province: string | null;
    gstRate: number;
    pstRate: number;
    hstRate: number;
    pstExempt: boolean;
    exemptionNumber: string | null;
    exemptionFile: StoredFile | null;
    label: string;
  };
  approval: { limit: number | null; required: boolean; approvedByName: string | null; approvedAt: string | null; note: string | null };
  emailVendor: boolean;
  vendorSentAt: string | null;
  issuedAt: string | null;
  issuedByName: string | null;
  followUpQueuedAt: string | null;
  /** The order list made from lines typed on this PO */
  madeListId: string | null;
  shipVia: { id: string; name: string; accountNumber: string | null; phone: string | null; email: string | null } | null;
  shipTo: { id: string; name: string; address: string | null; phone: string | null } | null;
  /** Site contacts 1 and 2, and the supplier contact — with phone / email (tap to call / email) */
  contacts: { role: 'SITE_1' | 'SITE_2' | 'SUPPLIER'; id: string; name: string; businessName: string | null; phone: string | null; email: string | null }[];
  shipDirect: boolean;
  directBolId: string | null;
  showPrices: boolean;
  can: { edit: boolean; issue: boolean; approve: boolean; cancel: boolean; close: boolean; sendToVendor: boolean; reopen: boolean; changeEta: boolean };
  /** Getting it moved when the vendor isn't arranging shipping (Bowron's own load board) */
  shipping: PoShipping;
  /** Project documents attached to this PO (by link name) */
  documents: { id: string; linkName: string; url: string }[];
  /** Edits after it was committed (0 = none) */
  revision: number;
  completedAt: string | null;
}

export const poEtaInput = z.object({ expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });

export const poIssueInput = z.object({ emailVendor: z.boolean().optional() });
export const poApprovalInput = z.object({ approve: z.boolean(), note: optionalText });
export type PoApprovalInput = z.infer<typeof poApprovalInput>;

export interface PoDashboard {
  overdue: number;
  dueThisWeek: number;
  waitingApproval: number;
  awaitingMyApproval: number;
  drafts: number;
  emailsToReview: number;
}

// Company purchasing settings ------------------------------------------------
export const purchasingSettingsInput = z.object({
  /** e.g. "FCP-" → FCP-1001, FCP-1002… */
  poPrefix: z.string().trim().max(12).default(''),
  /** The next number to suggest */
  poNextNumber: z.number().int().min(1).max(99_999_999),
  /** POs with a subtotal over this need an admin's or the PM's approval (empty = no limit) */
  approvalLimit: z.number().min(0).max(1e9).nullable(),
  /** Tick "Email the PO to the vendor" by default on new POs */
  emailVendorDefault: z.boolean(),
  /** Send the shipping-status request this many days before the expected date */
  followUpDaysBefore: z.number().int().min(0).max(60),
  /** Also send the priced PO copy to these people (the job's PM always gets it) */
  pricedCopyEmails: z.array(emailSchema).max(20),
});
export type PurchasingSettings = z.infer<typeof purchasingSettingsInput>;
export const DEFAULT_PURCHASING: PurchasingSettings = {
  poPrefix: '',
  poNextNumber: 1001,
  approvalLimit: null,
  emailVendorDefault: false,
  followUpDaysBefore: 2,
  pricedCopyEmails: [],
};

// Email templates and the review queue ------------------------------------------
export interface EmailTemplateView {
  key: string;
  label: string;
  audience: string;
  vars: string[];
  subject: string;
  body: string;
  mode: 'AUTO' | 'REVIEW';
  customized: boolean;
}

export const emailTemplateInput = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(300),
  body: z.string().trim().min(1, 'Write the message').max(10000),
  mode: z.enum(['AUTO', 'REVIEW']),
});
export type EmailTemplateInput = z.infer<typeof emailTemplateInput>;

export type OutboxStatus = 'QUEUED' | 'REVIEW' | 'SENT' | 'FAILED' | 'DISCARDED';
export interface OutboxItem {
  id: string;
  status: OutboxStatus;
  companyName: string | null;
  templateLabel: string | null;
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  body: string;
  attachments: StoredFile[];
  relatedType: string | null;
  relatedId: string | null;
  /** Link to the thing it's about, e.g. the PO */
  relatedLink: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

export const outboxEditInput = z.object({
  to: z.array(emailSchema).min(1, 'Add at least one recipient').max(30),
  cc: z.array(emailSchema).max(30).default([]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
});
export type OutboxEditInput = z.infer<typeof outboxEditInput>;

// Ship via: the carriers we ship with, and our account number with each
export const shipViaInput = z.object({
  name: z.string().trim().min(1, 'Name the carrier').max(120),
  accountNumber: optionalText,
  phone: optionalText,
  email: z.string().trim().toLowerCase().max(200).nullable().optional(),
  contactId: idSchema.nullable().optional(),
  companyId: idSchema.nullable().optional(),
  notes: optionalText,
  active: z.boolean().optional(),
});
export type ShipViaInput = z.infer<typeof shipViaInput>;
export interface ShipViaView extends Omit<ShipViaInput, 'active'> {
  id: string;
  active: boolean;
}

/** A document attached to a project, picked per PO (shown by its link name). */
export interface ProjectDocumentView {
  id: string;
  linkName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  /** How many POs it's attached to */
  onPos: number;
  createdAt: string;
}

/** Where the PO's material is in getting moved (from the BOLs made for it). */
export interface PoShipping {
  state: 'NONE' | 'POSTED' | 'SHIPPED' | 'DELIVERED';
  /** Loads made for this PO */
  loads: { id: string; label: string; status: string; priority: string; pickupDate: string | null; deliveryDate: string | null }[];
  /** It can be posted to the load board now (committed, the vendor isn't shipping, something left to move) */
  canPost: boolean;
  /** Where it would go */
  destination: string | null;
}
export const PO_SHIPPING_LABELS: Record<PoShipping['state'], string> = { NONE: 'Not shipped', POSTED: 'On the load board', SHIPPED: 'Shipped', DELIVERED: 'Delivered' };
export const postPoLoadInput = z.object({
  priority: z.enum(['EMERGENCY', 'HIGH', 'NORMAL', 'ANYTIME']).default('NORMAL'),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type PostPoLoadInput = z.infer<typeof postPoLoadInput>;
