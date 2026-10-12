import { z } from 'zod';
import { idSchema, ROLES } from './common';

// ---------------------------------------------------------------------------
// Voice AI and document reading. All AI calls go through the server; the apps
// never see the key. The AI only fills in fields — people review and save.
// ---------------------------------------------------------------------------
export const AI_MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — recommended (fast and accurate)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — cheapest' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — most capable, costs the most' },
] as const;
export const DEFAULT_AI_MODEL = 'claude-sonnet-5-5';

/** Screens voice can be switched on/off for (Admin › AI). */
export const AI_SCREENS = [
  { key: 'navigate', label: 'Voice navigation (the mic in the menu bar)' },
  { key: 'order', label: 'Order lists' },
  { key: 'stockCheck', label: 'Yard stock check' },
  { key: 'yardReceive', label: 'Yard receiving' },
  { key: 'bol', label: 'Building BOLs' },
  { key: 'bolReceive', label: 'Site receiving' },
  { key: 'return', label: 'Returns' },
  { key: 'equipmentMove', label: 'Equipment moves' },
  { key: 'site', label: 'Job / yard details' },
  { key: 'location', label: 'Shipping locations' },
  { key: 'contact', label: 'Contacts' },
  { key: 'buying', label: 'Buying (PO / vendor / ETA)' },
  { key: 'po', label: 'Purchase orders' },
  { key: 'docScan', label: 'Reading delivery paperwork (yard)' },
  { key: 'quoteScan', label: 'Reading quotes into a PO' },
  { key: 'invoiceScan', label: 'Reading invoices' },
  { key: 'meetings', label: 'Meetings (action items, summary)' },
  { key: 'assistant', label: 'The assistant (ask in plain words)' },
] as const;
export type AiScreen = (typeof AI_SCREENS)[number]['key'];
const AI_SCREEN_KEYS = AI_SCREENS.map((s) => s.key) as [AiScreen, ...AiScreen[]];

// Settings (Admin only) ---------------------------------------------------------
export const aiSettingsInput = z.object({
  enabled: z.boolean(),
  model: z.string().min(1).max(80),
  /** A new key ("" removes it; leave out to keep the current one) */
  apiKey: z.string().trim().max(300).optional(),
  monthlyCapCad: z.number().min(0).max(1_000_000).nullable(),
  /** Exchange rate used to show Claude's USD prices in CAD */
  usdToCad: z.number().min(0.5).max(3),
  /** USD per million tokens — check Anthropic's pricing page for your model */
  priceInputUsdPerM: z.number().min(0).max(1000),
  priceOutputUsdPerM: z.number().min(0).max(1000),
  sttProvider: z.enum(['none', 'openai']),
  sttKey: z.string().trim().max(300).optional(),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInput>;

export interface AiSettingsView {
  enabled: boolean;
  model: string;
  hasKey: boolean;
  /** "sk-ant-…a1b2" */
  keyHint: string | null;
  monthlyCapCad: number | null;
  usdToCad: number;
  priceInputUsdPerM: number;
  priceOutputUsdPerM: number;
  sttProvider: 'none' | 'openai';
  hasSttKey: boolean;
  /** The platform owner's key, if they've allowed it for you */
  fallback: { allowed: boolean; capCad: number | null; available: boolean };
  spend: { month: string; ownCad: number; platformCad: number; requests: number };
}

export const aiToggleInput = z.object({
  toggles: z
    .array(z.object({ companyId: idSchema.nullable(), role: z.enum(ROLES).nullable(), screen: z.enum(AI_SCREEN_KEYS).nullable(), enabled: z.boolean() }))
    .max(500),
});
export type AiToggleInput = z.infer<typeof aiToggleInput>;
export type AiToggleRow = AiToggleInput['toggles'][number];

export interface AiUsageRow {
  month: string;
  companyName: string | null;
  siteName: string | null;
  userName: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costCad: number;
}
export interface AiLogRow {
  id: string;
  createdAt: string;
  userName: string;
  screen: string;
  kind: string;
  transcript: string | null;
  summary: string | null;
  costCad: number;
  usedPlatformKey: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Token use day by day, to watch use and estimate the cost (CAD). */
export interface AiTokenHistory {
  from: string;
  to: string;
  days: { day: string; requests: number; failed: number; inputTokens: number; outputTokens: number; costCad: number }[];
  byModel: { model: string; requests: number; inputTokens: number; outputTokens: number; costCad: number }[];
  byScreen: { screen: string; requests: number; inputTokens: number; outputTokens: number; costCad: number }[];
  totals: { requests: number; inputTokens: number; outputTokens: number; costCad: number; avgCostCad: number };
}

/** What this person can use right now (sent to the apps; never the key). */
export interface AiStatus {
  available: boolean;
  /** Screens voice is on for, for this user */
  screens: AiScreen[];
  /** The server can turn recorded audio into text (for devices with no speech recognition) */
  serverTranscribe: boolean;
  reason: string | null;
}

// Voice fill --------------------------------------------------------------------
export const voiceFieldSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().max(120),
  type: z.enum(['text', 'number', 'date', 'boolean', 'choice']),
  options: z.array(z.object({ value: z.string().max(200), label: z.string().max(200) })).max(300).optional(),
  hint: z.string().max(300).optional(),
});
export type VoiceField = z.infer<typeof voiceFieldSchema>;

/** What a screen lets the AI fill: single fields and/or a list of rows. */
export const voiceSchemaInput = z.object({
  screen: z.enum(AI_SCREEN_KEYS),
  title: z.string().max(200),
  fields: z.array(voiceFieldSchema).max(60).default([]),
  rows: z
    .object({
      label: z.string().max(120),
      fields: z.array(voiceFieldSchema).max(30),
      canAdd: z.boolean(),
      canRemove: z.boolean(),
    })
    .nullable()
    .default(null),
});
export type VoiceSchema = z.input<typeof voiceSchemaInput>;

export const voiceFillInput = z.object({
  transcript: z.string().trim().min(1, 'Say something first').max(4000),
  schema: voiceSchemaInput,
  /** What's on the screen now: single field values, and the rows */
  current: z.object({ values: z.record(z.string(), z.unknown()).default({}), rows: z.array(z.record(z.string(), z.unknown())).max(500).default([]) }),
  /** Job / yard this screen is about (for cost codes and past items) */
  siteId: idSchema.nullable().optional(),
  companyId: idSchema.nullable().optional(),
});
export type VoiceFillInput = z.infer<typeof voiceFillInput>;

export type VoiceValue = string | number | boolean | null;
export interface VoiceResult {
  heard: string;
  /** One line on what was changed, e.g. "Added 2 lines, changed L3 quantity to 50" */
  summary: string;
  set: Record<string, VoiceValue>;
  rowOps: { op: 'add' | 'update' | 'remove'; index?: number; values?: Record<string, VoiceValue> }[];
  /** Open another screen (voice navigation) */
  navigate: string | null;
  /** The AI wasn't sure: ask the person */
  question: string | null;
}

export const navigateInput = z.object({
  transcript: z.string().trim().min(1).max(1000),
  /** Screens the app can open (path + plain name) */
  destinations: z.array(z.object({ path: z.string().max(200), label: z.string().max(120) })).max(80),
  /** The screen the person is on: its visible fields (so voice works inside any tab) */
  screen: z
    .object({
      title: z.string().max(200),
      path: z.string().max(300),
      fields: z
        .array(
          z.object({
            key: z.string().max(10),
            label: z.string().max(120),
            type: z.enum(['text', 'number', 'date', 'select', 'checkbox', 'textarea']),
            options: z.array(z.object({ value: z.string().max(200), label: z.string().max(200) })).max(150).optional(),
            value: z.union([z.string().max(2000), z.boolean()]),
          }),
        )
        .max(80),
    })
    .nullable()
    .optional(),
});
export type NavigateInput = z.infer<typeof navigateInput>;

// Documents -----------------------------------------------------------------------
export interface QuoteLine {
  description: string;
  qty: number;
  uom: string;
  unitPrice: number | null;
}
export interface QuoteScanResult {
  vendorName: string | null;
  lines: QuoteLine[];
  notes: string | null;
}
export interface InvoiceScanResult {
  /** INVOICE, CREDIT (credit note) or REVISED (a corrected invoice) */
  documentType: 'INVOICE' | 'CREDIT' | 'REVISED';
  /** For credits / revised invoices: the original invoice number it refers to */
  refInvoiceNumber: string | null;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  poNumber: string | null;
  subtotal: number | null;
  gst: number | null;
  pst: number | null;
  total: number | null;
  lines: { description: string; qty: number | null; uom: string | null; unitPrice: number | null; amount: number | null }[];
}
/** Quantities read off a vendor's packing slip, matched to the PO's lines. */
export interface PackingSlipRead {
  poNumber: string | null;
  lines: { poLineId: string | null; description: string; qty: number }[];
}
