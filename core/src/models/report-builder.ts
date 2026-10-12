import { z } from 'zod';
import { idSchema } from './common';
import { EXPORT_DATASETS } from './integrations';

// ---------------------------------------------------------------------------
// Custom report builder: any data, one job or all, pick the fields
// ---------------------------------------------------------------------------
type Src = { label: string; fields: readonly (readonly [string, string])[] };

/** Everything a report can be built from (the export datasets plus more). */
export const REPORT_SOURCES = {
  ...EXPORT_DATASETS,
  JOB_MATERIALS: {
    label: 'Job material status (where everything is)',
    fields: [
      ['jobNumber', 'Job #'],
      ['jobName', 'Job'],
      ['ref', 'Order / line'],
      ['description', 'Item'],
      ['uom', 'Unit'],
      ['ordered', 'Ordered'],
      ['outstanding', 'Not arrived yet'],
      ['inYard', 'In yard'],
      ['stagedToShip', 'Staged / planned'],
      ['inTransit', 'On the way'],
      ['receivedAtSite', 'Received on site'],
      ['requiredOnSite', 'Needed on site'],
      ['eta', 'Arriving (next load / vendor ETA)'],
      ['poNumbers', 'PO #'],
    ],
  },
  LOADS: {
    label: 'Loads / BOLs',
    fields: [
      ['company', 'Company'],
      ['label', 'BOL'],
      ['title', 'Load'],
      ['status', 'Status'],
      ['priority', 'Urgency'],
      ['jobNumber', 'Job #'],
      ['pickup', 'Pick up'],
      ['drop', 'Drop off'],
      ['pickupDate', 'Pickup date'],
      ['deliveryDate', 'Delivery date'],
      ['carrier', 'Carrier'],
      ['trailer', 'Trailer'],
      ['items', 'Items'],
    ],
  },
  RECEIPTS: {
    label: 'Deliveries received (yard)',
    fields: [
      ['company', 'Company'],
      ['receivedAt', 'Received'],
      ['yard', 'Yard'],
      ['poNumber', 'PO #'],
      ['vendor', 'Vendor'],
      ['jobNumber', 'Job #'],
      ['description', 'Item'],
      ['expected', 'Expected'],
      ['received', 'Received qty'],
      ['problem', 'Problem'],
      ['receivedBy', 'Received by'],
    ],
  },
  EQUIPMENT: {
    label: 'Equipment',
    fields: [
      ['company', 'Company'],
      ['unitNumber', 'Unit #'],
      ['description', 'Description'],
      ['category', 'Category'],
      ['make', 'Make'],
      ['model', 'Model'],
      ['year', 'Year'],
      ['location', 'Location'],
      ['pstExempt', 'PST exempt'],
    ],
  },
  ACTION_ITEMS: {
    label: 'Meeting action items',
    fields: [
      ['jobNumber', 'Job #'],
      ['meeting', 'Meeting'],
      ['text', 'Action'],
      ['who', 'Who'],
      ['dueDate', 'Due'],
      ['status', 'Status'],
      ['overdue', 'Overdue'],
    ],
  },
  JOBS: {
    label: 'Jobs / projects',
    fields: [
      ['company', 'Company'],
      ['jobNumber', 'Job #'],
      ['name', 'Name'],
      ['client', 'Client'],
      ['city', 'City'],
      ['province', 'Province'],
      ['startDate', 'Start'],
      ['pm', 'Project manager'],
      ['active', 'Active'],
    ],
  },
} as const satisfies Record<string, Src>;
export type ReportSource = keyof typeof REPORT_SOURCES;
const SOURCES = Object.keys(REPORT_SOURCES) as [ReportSource, ...ReportSource[]];

export const REPORT_PERIODS = [
  { key: 'THIS_WEEK', label: 'This week' },
  { key: 'LAST_WEEK', label: 'Last week' },
  { key: 'LAST_7', label: 'Last 7 days' },
  { key: 'THIS_MONTH', label: 'This month' },
  { key: 'LAST_MONTH', label: 'Last month' },
  { key: 'LAST_30', label: 'Last 30 days' },
  { key: 'NEXT_14', label: 'Next 14 days' },
  { key: 'ALL', label: 'All time' },
  { key: 'CUSTOM', label: 'Dates I pick' },
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number]['key'];

export const reportScheduleInput = z.object({
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  /** 0 = Sunday … 6 = Saturday (weekly) */
  weekday: z.number().int().min(0).max(6).default(1),
  /** 1–28 (monthly) */
  monthDay: z.number().int().min(1).max(28).default(1),
  /** Local hour, 0–23 */
  hour: z.number().int().min(0).max(23).default(7),
});
export type ReportSchedule = z.infer<typeof reportScheduleInput>;

export const savedReportInput = z.object({
  name: z.string().trim().min(1, 'Name the report').max(120),
  sections: z
    .array(z.object({ dataset: z.enum(SOURCES), title: z.string().trim().max(120).optional(), columns: z.array(z.string().max(60)).min(1, 'Pick at least one field').max(40) }))
    .min(1, 'Add at least one section')
    .max(10),
  filters: z.object({
    period: z.enum(REPORT_PERIODS.map((p) => p.key) as [ReportPeriod, ...ReportPeriod[]]).default('LAST_30'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    /** Empty = all jobs you can see */
    siteIds: z.array(idSchema).max(200).default([]),
    companyId: idSchema.nullable().optional(),
  }),
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
  schedule: reportScheduleInput.nullable().optional(),
  recipients: z.array(z.string().trim().toLowerCase().email('Enter a valid email')).max(30).default([]),
});
export type SavedReportInput = z.infer<typeof savedReportInput>;
export interface SavedReportView extends SavedReportInput {
  id: string;
  createdByName: string | null;
  lastSentAt: string | null;
  canEdit: boolean;
}

/** Built-in starting points. */
export const REPORT_PRESETS: { key: string; label: string; help: string; report: SavedReportInput }[] = [
  {
    key: 'job-update',
    label: 'Job update list',
    help: 'For one job (or all): what’s still outstanding, when it’s arriving, and the order lists.',
    report: {
      name: 'Job update list',
      sections: [
        { dataset: 'JOB_MATERIALS', title: 'Outstanding and arriving', columns: ['jobNumber', 'ref', 'description', 'ordered', 'outstanding', 'inYard', 'inTransit', 'receivedAtSite', 'requiredOnSite', 'eta', 'poNumbers'] },
        { dataset: 'LOADS', title: 'Loads coming', columns: ['label', 'title', 'drop', 'deliveryDate', 'carrier', 'items', 'status'] },
      ],
      filters: { period: 'NEXT_14', siteIds: [] },
      format: 'xlsx',
      recipients: [],
    },
  },
  {
    key: 'sage-weekly',
    label: 'Sage weekly (commitments + drawdown)',
    help: 'POs issued last week as commitments, and invoices against them as negative lines.',
    report: {
      name: 'Sage weekly',
      sections: [
        { dataset: 'SAGE_COMMITMENTS', title: 'Commitments (POs issued)', columns: ['poNumber', 'orderedDate', 'vendor', 'vendorId', 'jobNumber', 'costCode', 'lineNo', 'description', 'qty', 'uom', 'unitCost', 'amount', 'currency'] },
        { dataset: 'SAGE_DRAWDOWN', title: 'Invoices against commitments', columns: ['poNumber', 'poLineNo', 'invoiceNumber', 'invoiceDate', 'vendor', 'vendorId', 'jobNumber', 'costCode', 'description', 'qty', 'amount', 'currency'] },
      ],
      filters: { period: 'LAST_WEEK', siteIds: [] },
      format: 'xlsx',
      schedule: { frequency: 'WEEKLY', weekday: 1, monthDay: 1, hour: 7 },
      recipients: [],
    },
  },
];

/** Sunday-afternoon update to each job's project manager (Admin › Reports). */
export const pmWeeklyInput = z.object({ enabled: z.boolean(), weekday: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23) });
export type PmWeeklySettings = z.infer<typeof pmWeeklyInput>;
export interface BuiltReportPreview {
  name: string;
  period: { from: string; to: string };
  sections: { title: string; total: number; columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[] }[];
}

export const DEFAULT_PM_WEEKLY: PmWeeklySettings = { enabled: true, weekday: 0, hour: 15 };
