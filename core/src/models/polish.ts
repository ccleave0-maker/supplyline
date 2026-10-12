import { z } from 'zod';

// ---------------------------------------------------------------------------
// Notification centre
// ---------------------------------------------------------------------------
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Status feed (what's happening on the jobs you can see)
// ---------------------------------------------------------------------------
export interface ActivityItem {
  id: string;
  at: string;
  /** "Pat submitted JOB#2249 LIST#4" */
  text: string;
  who: string | null;
  siteLabel: string | null;
  link: string | null;
  icon: string;
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------
export type SearchKind = 'JOB' | 'ORDER' | 'PO' | 'BOL' | 'CONTACT' | 'EQUIPMENT' | 'INVOICE' | 'CUSTOMER' | 'MEETING' | 'LINE';
export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  JOB: 'Jobs & yards',
  ORDER: 'Order lists',
  LINE: 'Materials',
  PO: 'Purchase orders',
  BOL: 'BOLs',
  CONTACT: 'Contacts',
  EQUIPMENT: 'Equipment',
  INVOICE: 'Vendor invoices',
  CUSTOMER: 'Customers',
  MEETING: 'Meetings',
};
export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  link: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export interface DashboardTile {
  key: string;
  label: string;
  value: number;
  /** Something needs attention */
  warn: boolean;
  link: string;
}

// ---------------------------------------------------------------------------
// Appearance: background picture, how faded it is, the logo "decal"
// ---------------------------------------------------------------------------
export const appearanceInput = z.object({
  /** 0 = picture at full strength, 95 = barely there (default 85 so screens stay readable) */
  fade: z.number().int().min(0).max(95),
  /** Show the company logo faintly in the corner of every screen */
  decal: z.boolean(),
  /** Remove the background picture */
  clearBackground: z.boolean().optional(),
});
export type AppearanceInput = z.infer<typeof appearanceInput>;
export interface Appearance {
  backgroundUrl: string | null;
  fade: number;
  decal: boolean;
}
export const DEFAULT_APPEARANCE: Appearance = { backgroundUrl: null, fade: 85, decal: false };

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------
export const healthSettingsInput = z.object({
  enabled: z.boolean(),
  /** How often to run (minutes) */
  intervalMinutes: z.number().int().min(5).max(1440),
  /** Who gets the alert email (admins + the platform owner when empty) */
  alertEmails: z.array(z.string().trim().toLowerCase().email('Enter a valid email')).max(20),
});
export type HealthSettings = z.infer<typeof healthSettingsInput>;
export const DEFAULT_HEALTH: HealthSettings = { enabled: true, intervalMinutes: 15, alertEmails: [] };

export interface HealthResult {
  key: string;
  label: string;
  ok: boolean;
  /** Warning = works but needs a look */
  warn?: boolean;
  detail: string;
  ms: number;
}
export interface HealthRunView {
  id: string;
  at: string;
  ok: boolean;
  alerted: boolean;
  results: HealthResult[];
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export const REPORTS = [
  { key: 'spend-by-job', label: 'Spend by job', help: 'Purchase orders issued per job: committed, received, invoiced.' },
  { key: 'vendor-on-time', label: 'Vendors on time', help: 'PO lines received at the yard vs the vendor’s expected date.' },
  { key: 'deliveries', label: 'Deliveries per job', help: 'BOLs shipped to each job, items, and estimated weight.' },
  { key: 'order-turnaround', label: 'Order list turnaround', help: 'Days from a list being submitted to the material arriving on site.' },
  { key: 'action-items', label: 'Action items by person', help: 'Open, overdue and done action items from meetings.' },
  { key: 'ap-aging', label: 'Vendor invoices by age', help: 'Approved but unpaid vendor invoices by days since the invoice date.' },
] as const;
export type ReportKey = (typeof REPORTS)[number]['key'];
export interface ReportResult {
  key: ReportKey;
  title: string;
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, string | number | null>[];
}
