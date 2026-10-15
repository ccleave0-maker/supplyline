import { z } from 'zod';
import { idSchema } from './common';

// ---------------------------------------------------------------------------
// Network filing: copies of everything Bowron makes, in your folders
// ---------------------------------------------------------------------------
export const FILING_DOC_TYPES = [
  { key: 'ORDER_PDF', label: 'Order lists (PDF)', folder: '{company}\\Jobs\\{job}\\Order lists' },
  { key: 'ORDER_XLSX', label: 'Order lists (Excel, plain white)', folder: '{company}\\Jobs\\{job}\\Order lists' },
  { key: 'BOL_PDF', label: 'Bills of lading', folder: '{company}\\Jobs\\{job}\\BOLs' },
  { key: 'PO_PDF', label: 'Purchase orders (priced)', folder: '{company}\\Purchase orders\\{year}' },
  { key: 'PACKING_PDF', label: 'Packing lists', folder: '{company}\\Purchase orders\\{year}\\Packing lists' },
  { key: 'RECEIPT_PHOTO', label: 'Receiving photos', folder: '{company}\\Jobs\\{job}\\Receiving photos' },
  { key: 'AP_INVOICE', label: 'Approved vendor invoices', folder: '{company}\\AP\\Approved\\{year}-{month}' },
  { key: 'AR_INVOICE', label: 'Customer invoices', folder: '{company}\\AR\\{year}' },
  { key: 'QC_DOC', label: 'QC / MTRs', folder: '{company}\\Jobs\\{job}\\QC' },
  { key: 'SUBCONTRACT', label: 'Subcontract documents', folder: '{company}\\Jobs\\{job}\\Subcontracts' },
  { key: 'MEETING_PDF', label: 'Meeting minutes', folder: '{company}\\Jobs\\{job}\\Meetings' },
  { key: 'EXPORTS', label: 'Scheduled exports (e.g. Sage)', folder: '{company}\Exports\{year}' },
  { key: 'RECEIVING_REPORT', label: 'Receiving reports', folder: '{company}\\Jobs\\{job}\\Receiving reports' },
  { key: 'AR_BACKUP', label: 'Billing backup documents (tickets, timesheets…)', folder: '{company}\\AR\\{year}\\{invoice} backup' },
] as const;
export type FilingDocType = (typeof FILING_DOC_TYPES)[number]['key'];
const DOC_KEYS = FILING_DOC_TYPES.map((d) => d.key) as [FilingDocType, ...FilingDocType[]];

export const filingSettingsInput = z.object({
  enabled: z.boolean(),
  /** DIRECT = the Bowron server writes to the folder (it runs on your network);
   *  SYNC = the Bowron Sync app on a PC on your network does it (when Bowron is online) */
  mode: z.enum(['DIRECT', 'SYNC']),
  /** e.g. P:\Bowron or \\server\share\Bowron */
  root: z.string().trim().max(500),
  /** Folder for each kind of document under the root; {company} {job} {year} {month} {vendor} are filled in */
  folders: z.record(z.string(), z.string().trim().max(300)),
  types: z.array(z.enum(DOC_KEYS)),
});
export type FilingSettings = z.infer<typeof filingSettingsInput>;
export const DEFAULT_FILING: FilingSettings = {
  enabled: false,
  mode: 'DIRECT',
  root: '',
  folders: Object.fromEntries(FILING_DOC_TYPES.map((d) => [d.key, d.folder])),
  types: FILING_DOC_TYPES.map((d) => d.key),
};

export interface FilingJobView {
  id: string;
  docType: string;
  relativePath: string;
  mode: string;
  status: 'PENDING' | 'DONE' | 'FAILED';
  attempts: number;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface SyncDeviceView {
  id: string;
  name: string;
  lastSeenAt: string | null;
  lastVersion: string | null;
  createdAt: string;
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// Export mappings (Sage Intacct and any other system: pick columns, names, order)
// ---------------------------------------------------------------------------
export const EXPORT_DATASETS = {
  ORDER_LINES: {
    label: 'Order list lines',
    fields: [
      ['company', 'Company'],
      ['jobNumber', 'Job #'],
      ['jobName', 'Job name'],
      ['orderLabel', 'Order list'],
      ['companySeq', 'Company order #'],
      ['lineNo', 'Line #'],
      ['description', 'Description'],
      ['quantity', 'Quantity'],
      ['uom', 'Unit'],
      ['costCode', 'Cost code'],
      ['orderedBy', 'Ordered by'],
      ['requiredOnSite', 'Required on site'],
      ['submittedAt', 'Submitted'],
      ['status', 'Status'],
      ['poNumbers', 'PO #'],
      ['vendors', 'Vendor'],
      ['unitCost', 'Unit cost'],
      ['extendedCost', 'Extended cost'],
    ],
  },
  PO_LINES: {
    label: 'Purchase order lines',
    fields: [
      ['company', 'Company'],
      ['poNumber', 'PO #'],
      ['vendor', 'Vendor'],
      ['status', 'PO status'],
      ['orderedDate', 'Date ordered'],
      ['expectedDate', 'Expected'],
      ['jobNumber', 'Job #'],
      ['unit', 'Equipment unit'],
      ['lineNo', 'Line #'],
      ['description', 'Description'],
      ['qty', 'Quantity'],
      ['uom', 'Unit'],
      ['unitCost', 'Unit cost'],
      ['amount', 'Amount'],
      ['costCode', 'Cost code'],
      ['pstExempt', 'PST exempt'],
      ['received', 'Received'],
    ],
  },
  AP_INVOICES: {
    label: 'Vendor invoices',
    fields: [
      ['company', 'Company'],
      ['vendor', 'Vendor'],
      ['invoiceNumber', 'Invoice #'],
      ['type', 'Type'],
      ['invoiceDate', 'Invoice date'],
      ['dueDate', 'Due date'],
      ['poNumber', 'PO #'],
      ['jobNumber', 'Job #'],
      ['costCode', 'Cost code'],
      ['subtotal', 'Subtotal'],
      ['gst', 'GST'],
      ['pst', 'PST'],
      ['total', 'Total'],
      ['holdback', 'Holdback'],
      ['status', 'Status'],
      ['paidDate', 'Paid date'],
      ['paymentRef', 'Payment ref'],
    ],
  },
  AR_INVOICES: {
    label: 'Customer invoices',
    fields: [
      ['company', 'Company'],
      ['customer', 'Customer'],
      ['invoiceNumber', 'Invoice #'],
      ['invoiceDate', 'Invoice date'],
      ['dueDate', 'Due date'],
      ['jobNumber', 'Job #'],
      ['subtotal', 'Subtotal'],
      ['gst', 'GST'],
      ['pst', 'PST'],
      ['total', 'Total'],
      ['holdback', 'Holdback'],
      ['paid', 'Paid'],
      ['balance', 'Balance'],
      ['status', 'Status'],
    ],
  },
  /** Sage: POs issued in the period, one row per line — imported as commitments. */
  SAGE_COMMITMENTS: {
    label: 'Sage – commitments (POs issued)',
    fields: [
      ['company', 'Company'],
      ['poNumber', 'PO #'],
      ['orderedDate', 'Date'],
      ['vendor', 'Vendor'],
      ['vendorId', 'Vendor ID (accounting)'],
      ['jobNumber', 'Job #'],
      ['costCode', 'Cost code'],
      ['lineNo', 'Line #'],
      ['description', 'Description'],
      ['qty', 'Quantity'],
      ['uom', 'Unit'],
      ['unitCost', 'Unit cost'],
      ['amount', 'Amount'],
      ['currency', 'Currency'],
    ],
  },
  /** Sage: invoice lines matched to PO lines, as negative amounts that draw the commitment down. */
  SAGE_DRAWDOWN: {
    label: 'Sage – invoices against commitments (negative)',
    fields: [
      ['company', 'Company'],
      ['poNumber', 'PO #'],
      ['poLineNo', 'PO line #'],
      ['invoiceNumber', 'Invoice #'],
      ['invoiceDate', 'Invoice date'],
      ['vendor', 'Vendor'],
      ['vendorId', 'Vendor ID (accounting)'],
      ['jobNumber', 'Job #'],
      ['costCode', 'Cost code'],
      ['description', 'Description'],
      ['qty', 'Quantity (negative)'],
      ['amount', 'Amount (negative)'],
      ['currency', 'Currency'],
    ],
  },
} as const;
export type ExportDataset = keyof typeof EXPORT_DATASETS;
const DATASETS = Object.keys(EXPORT_DATASETS) as [ExportDataset, ...ExportDataset[]];

export const exportMappingInput = z.object({
  name: z.string().trim().min(1, 'Name it').max(120),
  /** e.g. "sage-intacct", "generic" */
  target: z.string().trim().min(1).max(60),
  dataset: z.enum(DATASETS),
  companyId: idSchema.nullable().optional(),
  format: z.enum(['xlsx', 'csv']),
  dateFormat: z.enum(['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY']),
  columns: z.array(z.object({ field: z.string().min(1).max(60), header: z.string().trim().min(1).max(80), fixed: z.string().max(200).optional() })).min(1).max(80),
  /** Run it on its own (last week / last month) and email it and/or file it to the network folder */
  schedule: z
    .object({ frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']), weekday: z.number().int().min(0).max(6).default(1), monthDay: z.number().int().min(1).max(28).default(1), hour: z.number().int().min(0).max(23).default(7) })
    .nullable()
    .optional(),
  recipients: z.array(z.string().trim().toLowerCase().email('Enter a valid email')).max(30).default([]),
  fileToNetwork: z.boolean().default(false),
});
export type ExportMappingInput = z.infer<typeof exportMappingInput>;
export interface ExportMappingView extends ExportMappingInput {
  id: string;
  updatedAt: string;
  lastSentAt: string | null;
}

// ---------------------------------------------------------------------------
// Import tools (spreadsheet → jobs, contacts, cost codes, customers, people)
// ---------------------------------------------------------------------------
export const IMPORT_DATASETS = {
  jobs: {
    label: 'Jobs / projects',
    fields: [
      { key: 'jobNumber', label: 'Job #', required: true },
      { key: 'name', label: 'Name', required: true },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'province', label: 'Province' },
      { key: 'postalCode', label: 'Postal code' },
      { key: 'clientName', label: 'Client / owner' },
      { key: 'startDate', label: 'Start date' },
      { key: 'pstExempt', label: 'PST exempt (yes/no)' },
      { key: 'notes', label: 'Notes' },
    ],
  },
  contacts: {
    label: 'Contacts / vendors / subcontractors',
    fields: [
      { key: 'businessName', label: 'Business name' },
      { key: 'name', label: 'Contact name', required: true },
      { key: 'type', label: 'Type (vendor, subcontractor, trucking, rental…)' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'cell', label: 'Cell' },
      { key: 'notes', label: 'Notes' },
    ],
  },
  costCodes: {
    label: 'Cost codes',
    fields: [
      { key: 'code', label: 'Code', required: true },
      { key: 'description', label: 'Description' },
    ],
  },
  customers: {
    label: 'Customers',
    fields: [
      { key: 'name', label: 'Customer', required: true },
      { key: 'contactName', label: 'Contact' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'province', label: 'Province' },
      { key: 'postalCode', label: 'Postal code' },
      { key: 'termsDays', label: 'Terms (days)' },
    ],
  },
  people: {
    label: 'People (sends invitations)',
    fields: [
      { key: 'email', label: 'Email', required: true },
      { key: 'name', label: 'Name' },
      { key: 'roles', label: 'Roles (site, yard, procurement, ap, admin)' },
    ],
  },
} as const;
export type ImportDataset = keyof typeof IMPORT_DATASETS;
const IMPORTS = Object.keys(IMPORT_DATASETS) as [ImportDataset, ...ImportDataset[]];

export const importInput = z.object({
  dataset: z.enum(IMPORTS),
  companyId: idSchema,
  headers: z.array(z.string().max(200)).max(100),
  rows: z.array(z.array(z.string().max(2000)).max(100)).min(1).max(5000),
  mapping: z.record(z.string(), z.number().int().min(0).max(99)),
  updateExisting: z.boolean().default(true),
});
export type ImportInput = z.infer<typeof importInput>;
export interface ImportResult {
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}
export interface GenericSheetPreview {
  fileName: string;
  headers: string[];
  rows: string[][];
  suggested: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Supplier list import (e.g. exported from Sage)
// ---------------------------------------------------------------------------
export interface SupplierRow {
  name: string;
  vendorId: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  cell: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  terms: string | null;
}
export interface SupplierImportPreview {
  /** Which heading was used for each field */
  columns: Partial<Record<keyof SupplierRow, string>>;
  total: number;
  /** Not in Bowron yet */
  newCount: number;
  rows: SupplierRow[];
}
export interface SupplierImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}
