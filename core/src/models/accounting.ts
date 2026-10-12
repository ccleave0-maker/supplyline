import { z } from 'zod';
import { emailSchema, idSchema, optionalText } from './common';
import type { StoredFile } from './project';

// ---------------------------------------------------------------------------
// Accounts payable: vendor invoices, approvals, rejections, pay runs
// ---------------------------------------------------------------------------
export const AP_STATUSES = ['RECEIVED', 'NEEDS_REVIEW', 'IN_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'ON_HOLD', 'REPLACED'] as const;
export type ApStatus = (typeof AP_STATUSES)[number];
export const AP_STATUS_LABELS: Record<ApStatus, string> = {
  RECEIVED: 'Received',
  NEEDS_REVIEW: 'Needs review',
  IN_APPROVAL: 'In approval',
  APPROVED: 'Approved — ready to pay',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  ON_HOLD: 'On hold',
  REPLACED: 'Replaced by a revised invoice / credit',
};

export const APPROVER_TYPES = ['PROCUREMENT', 'PM', 'OPS', 'ADMIN', 'USER'] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];
export const APPROVER_LABELS: Record<ApproverType, string> = {
  PROCUREMENT: 'Procurement',
  PM: "The job's project manager",
  OPS: 'Operations manager',
  ADMIN: 'An admin',
  USER: 'A named person',
};

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

/** Company AP / AR settings. */
export const accountingSettingsInput = z.object({
  /** Procurement gives the first approval (they can still "pass" on one) */
  procurementStep: z.boolean(),
  /** More approvals after procurement, in order */
  extraSteps: z.array(z.object({ type: z.enum(['PM', 'OPS', 'ADMIN', 'USER']), userId: idSchema.nullable().optional() })).max(6),
  /** Reviews alongside (don't hold up approval; can flag a concern) */
  sideReviews: z.array(z.object({ type: z.enum(['PM', 'OPS', 'USER']), userId: idSchema.nullable().optional() })).max(6),
  /** The operations manager(s) */
  opsManagerIds: z.array(idSchema).max(10),
  /** Days of the month you pay vendors (31 = month end) */
  payDays: z.array(z.number().int().min(1).max(31)).min(1).max(8),
  defaultTermsDays: z.number().int().min(0).max(180),
  /** Allowed price difference vs the PO, in % */
  priceTolerancePct: z.number().min(0).max(25),
  /** Network folders (on the server PC, or via the Sync app later) */
  folders: z.object({
    inbox: z.string().trim().max(500).default(''),
    inReview: z.string().trim().max(500).default(''),
    approved: z.string().trim().max(500).default(''),
    rejected: z.string().trim().max(500).default(''),
    held: z.string().trim().max(500).default(''),
  }),
  /** Customer invoice numbers */
  arPrefix: z.string().trim().max(12),
  arNextNumber: z.number().int().min(1).max(99_999_999),
});
export type AccountingSettings = z.infer<typeof accountingSettingsInput>;
export const DEFAULT_ACCOUNTING: AccountingSettings = {
  procurementStep: true,
  extraSteps: [],
  sideReviews: [],
  opsManagerIds: [],
  payDays: [15, 31],
  defaultTermsDays: 30,
  priceTolerancePct: 1,
  folders: { inbox: '', inReview: '', approved: '', rejected: '', held: '' },
  arPrefix: '',
  arNextNumber: 1001,
};

export interface ApApprovalView {
  id: string;
  kind: 'MAIN' | 'SIDE';
  step: number;
  approverType: ApproverType;
  /** "Procurement", "Jane Smith (PM)"… */
  who: string;
  decision: string;
  note: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** You can act on this one now */
  mine: boolean;
}

export interface ApInvoiceSummary {
  id: string;
  companyId: string;
  kind: 'INVOICE' | 'CREDIT';
  status: ApStatus;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  poNumber: string | null;
  purchaseOrderId: string | null;
  target: string | null;
  total: number | null;
  holdbackAmount: number | null;
  /** Total less holdback */
  payable: number | null;
  issueCount: number;
  /** "Procurement", "Jane (PM)"… */
  waitingOn: string | null;
  waitingOnMe: boolean;
  receivedVia: string;
  createdAt: string;
}

export interface ApInvoiceLineView {
  id: string;
  lineNo: number;
  description: string;
  qty: number | null;
  uom: string | null;
  unitPrice: number | null;
  amount: number | null;
  poLineId: string | null;
  poLineLabel: string | null;
}

export interface ApInvoiceDetail extends ApInvoiceSummary {
  /** Receiving reports for its PO (yard and site receipts) — check them before approving */
  receivingReports: { id: string; label: string; url: string; at: string }[];
  siteId: string | null;
  equipmentId: string | null;
  costCode: string | null;
  subtotal: number | null;
  gst: number | null;
  pst: number | null;
  holdbackPct: number | null;
  holdbackReleasedAt: string | null;
  issues: string[];
  refInvoiceNumber: string | null;
  replaces: { id: string; invoiceNumber: string | null } | null;
  replacedBy: { id: string; invoiceNumber: string | null } | null;
  file: StoredFile | null;
  lines: ApInvoiceLineView[];
  approvals: ApApprovalView[];
  rejectedReason: string | null;
  rejectionSentTo: string | null;
  rejectionSentAt: string | null;
  /** Who rejections go to at this vendor (from Contacts) */
  vendorApContact: { id: string; name: string; email: string | null } | null;
  holdReason: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  notes: string | null;
  folderState: string | null;
  can: { edit: boolean; sendToApproval: boolean; reject: boolean; hold: boolean; markPaid: boolean; sendRejection: boolean; releaseHoldback: boolean };
}

export const apInvoiceEditInput = z.object({
  kind: z.enum(['INVOICE', 'CREDIT']).optional(),
  vendorName: optionalText,
  invoiceNumber: optionalText,
  invoiceDate: date,
  dueDate: date,
  poNumberText: optionalText,
  siteId: idSchema.nullable().optional(),
  equipmentId: idSchema.nullable().optional(),
  costCode: optionalText,
  subtotal: z.number().nullable().optional(),
  gst: z.number().nullable().optional(),
  pst: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  refInvoiceNumber: optionalText,
  notes: optionalText,
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        qty: z.number().nullable().optional(),
        uom: z.string().trim().max(20).nullable().optional(),
        unitPrice: z.number().nullable().optional(),
        amount: z.number().nullable().optional(),
        poLineId: idSchema.nullable().optional(),
      }),
    )
    .max(300)
    .optional(),
});
export type ApInvoiceEditInput = z.infer<typeof apInvoiceEditInput>;

export const apDecisionInput = z.object({
  approvalId: idSchema,
  decision: z.enum(['APPROVED', 'PASSED', 'REJECTED', 'HOLD', 'REVIEWED', 'FLAGGED']),
  note: optionalText,
});
export type ApDecisionInput = z.infer<typeof apDecisionInput>;

export const apActionInput = z.object({
  action: z.enum(['SEND_TO_APPROVAL', 'REJECT', 'HOLD', 'RELEASE_HOLD', 'MARK_PAID', 'RELEASE_HOLDBACK', 'REMATCH']),
  note: optionalText,
  paidOn: date,
  paymentRef: optionalText,
});
export type ApActionInput = z.infer<typeof apActionInput>;

export const apRejectionSendInput = z.object({
  /** Address to send to (defaults to the vendor's AP contact) */
  to: emailSchema.nullable().optional(),
  /** Sent on paper / handled outside SupplyLine */
  handledManually: z.boolean().optional(),
});

export interface PayRunRow {
  date: string;
  /** Approved and due by this run */
  approvedDue: number;
  approvedCount: number;
  /** Still in approval / review, due by this run */
  pending: number;
  pendingCount: number;
  /** Expected from open POs not invoiced yet (expected date + terms) */
  forecast: number;
  forecastCount: number;
  total: number;
  /** Past runs: actually paid on or before */
  paid: number;
}

export interface ApDashboard {
  needsReview: number;
  inApproval: number;
  waitingOnMe: number;
  approvedUnpaid: number;
  approvedUnpaidTotal: number;
  rejected: number;
  onHold: number;
  overdue: number;
  folderProblem: string | null;
}

// ---------------------------------------------------------------------------
// Subcontractor holdback (set per project)
// ---------------------------------------------------------------------------
export const subHoldbackInput = z.object({
  /** Default % held back on every subcontractor invoice for this job (empty = none) */
  defaultPct: z.number().min(0).max(50).nullable(),
  overrides: z.array(z.object({ contactId: idSchema, pct: z.number().min(0).max(50) })).max(100),
});
export type SubHoldbackInput = z.infer<typeof subHoldbackInput>;

export interface SubHoldbackView {
  defaultPct: number | null;
  overrides: { contactId: string; name: string; pct: number }[];
  /** Per subcontractor on this job */
  owing: { contactId: string | null; name: string; invoiced: number; held: number; released: number; owing: number }[];
}

// ---------------------------------------------------------------------------
// Accounts receivable: customers and billing
// ---------------------------------------------------------------------------
export const customerInput = z.object({
  companyId: idSchema,
  name: z.string().trim().min(1, 'Name the customer').max(160),
  contactName: optionalText,
  email: emailSchema.nullable().optional().or(z.literal('').transform(() => null)),
  phone: optionalText,
  address: optionalText,
  city: optionalText,
  province: optionalText,
  postalCode: optionalText,
  gstNumber: optionalText,
  termsDays: z.number().int().min(0).max(180).default(30),
  notes: optionalText,
  active: z.boolean().optional(),
});
export type CustomerInput = z.infer<typeof customerInput>;
export interface CustomerItem extends Omit<CustomerInput, 'termsDays' | 'active'> {
  id: string;
  companyName: string;
  termsDays: number;
  active: boolean;
  outstanding: number;
}

export type ArState = 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'VOID';
export const AR_STATE_LABELS: Record<ArState, string> = { DRAFT: 'Draft', SENT: 'Sent', PARTIAL: 'Part paid', PAID: 'Paid', OVERDUE: 'Overdue', VOID: 'Void' };

export const arInvoiceInput = z.object({
  companyId: idSchema,
  customerId: idSchema,
  siteId: idSchema.nullable().optional(),
  invoiceNumber: z.string().trim().min(1).max(40),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: optionalText,
  gstRate: z.number().min(0).max(0.2),
  pstRate: z.number().min(0).max(0.2),
  /** Holdback on this invoice (off unless set) */
  holdbackPct: z.number().min(0).max(50).nullable().optional(),
  lines: z
    .array(z.object({ description: z.string().trim().min(1).max(500), qty: z.number().min(0), uom: z.string().trim().min(1).max(20), unitPrice: z.number(), costCode: optionalText }))
    .min(1, 'Add at least one line')
    .max(300),
});
export type ArInvoiceInput = z.infer<typeof arInvoiceInput>;

export interface ArInvoiceSummary {
  id: string;
  companyId: string;
  invoiceNumber: string;
  customerName: string;
  customerId: string;
  siteId: string | null;
  siteLabel: string | null;
  invoiceDate: string;
  dueDate: string;
  state: ArState;
  total: number;
  holdbackAmount: number;
  amountPaid: number;
  balance: number;
}
export interface ArInvoiceDetail extends ArInvoiceSummary {
  description: string | null;
  subtotal: number;
  gstRate: number;
  pstRate: number;
  gst: number;
  pst: number;
  holdbackPct: number | null;
  lines: { description: string; qty: number; uom: string; unitPrice: number; amount: number; costCode: string | null }[];
  payments: { id: string; paidOn: string; amount: number; reference: string | null; holdbackRelease: boolean }[];
  customer: { name: string; contactName: string | null; email: string | null };
  sentAt: string | null;
  /** Backup documents (filed to the network folder set in Admin › Network filing) */
  backups: { id: string; fileName: string; url: string; sizeBytes: number }[];
  /** Where backup documents are filed, e.g. "P:\SupplyLine\FCP\AR\2026\INV-104 backup" (null when filing is off) */
  backupFolder: string | null;
}
export const arPaymentInput = z.object({
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive().max(1e10),
  reference: optionalText,
  holdbackRelease: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Job budgets
// ---------------------------------------------------------------------------
export const jobBudgetInput = z.object({ rows: z.array(z.object({ costCode: z.string().trim().min(1).max(40), amount: z.number().min(0).max(1e11), notes: optionalText })).max(500) });
export type JobBudgetInput = z.infer<typeof jobBudgetInput>;
export interface BudgetRow {
  costCode: string;
  description: string | null;
  budget: number;
  /** On issued POs */
  committed: number;
  /** On approved / paid vendor invoices */
  actual: number;
  /** Budget − committed */
  remaining: number;
  over: boolean;
}

// ---------------------------------------------------------------------------
// Exports for the accountant
// ---------------------------------------------------------------------------
export interface AccountingExportRow {
  [key: string]: string | number | null;
}
