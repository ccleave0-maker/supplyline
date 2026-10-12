import { z } from 'zod';
import { idSchema } from './common';

// ---------------------------------------------------------------------------
// The assistant: ask in plain words, it asks back when unsure, and it only
// changes things after you say yes.
// ---------------------------------------------------------------------------
/** draft = makes something you review before it goes anywhere; change / send = affects others, always asks first. */
export const ASSISTANT_ACTIONS = [
  { key: 'create_po', kind: 'draft', label: 'Make a purchase order (draft)', help: 'Vendor, job or equipment, lines, prices, cost codes. Opens it for you to check and issue.' },
  { key: 'add_to_order', kind: 'draft', label: 'Add lines to a job’s order list (draft)', help: 'Puts the lines on your draft list for that job. Nothing is sent until you submit it.' },
  { key: 'create_contact', kind: 'draft', label: 'Add a contact (vendor, trucking, sub…)', help: 'Name, business, phone, email.' },
  { key: 'plan_equipment', kind: 'draft', label: 'Add to a job’s equipment plan', help: 'What the job needs and when.' },
  { key: 'remember_nickname', kind: 'draft', label: 'Remember a nickname', help: '“The bridge job” = JOB#2249, for you or for everyone.' },
  { key: 'post_load', kind: 'change', label: 'Post a load to the load board', help: 'Pickup, drop-off, dates, urgency — the yard and drivers see it.' },
  { key: 'set_load_priority', kind: 'change', label: 'Change a load’s urgency', help: 'Emergency / High / Normal / Anytime on the load board.' },
  { key: 'issue_po', kind: 'send', label: 'Issue a purchase order (and email the vendor)', help: 'Always asks first.' },
] as const;
export const ASSISTANT_ACTION_KEYS = ASSISTANT_ACTIONS.map((a) => a.key);
export type AssistantActionKey = (typeof ASSISTANT_ACTIONS)[number]['key'];
const ACTION_KEYS = ASSISTANT_ACTIONS.map((a) => a.key) as [AssistantActionKey, ...AssistantActionKey[]];

/** Admin › Assistant: the guardrails. */
export const assistantSettingsInput = z.object({
  enabled: z.boolean(),
  /** What it may offer to do (always after the person confirms) */
  allowedActions: z.array(z.enum(ACTION_KEYS)).max(ACTION_KEYS.length),
  /** Messages per person per day */
  dailyLimitPerUser: z.number().int().min(1).max(1000),
  /** Extra guidance for the assistant, e.g. "Yard 2 is called the north yard." */
  instructions: z.string().trim().max(2000).default(''),
  /** Things it must not talk about or do (one per line) */
  blockedTopics: z.string().trim().max(2000).default(''),
  /** Conversations are deleted after this many days */
  keepDays: z.number().int().min(1).max(3650),
  /** Who may save nicknames for everyone (others save only their own) */
  sharedNicknamesBy: z.enum(['ADMIN', 'ANYONE']),
  /** 'drafts' = make drafts straight away (you review them); 'never' = always ask first. Sending / issuing / changing others' work always asks. */
  autoDo: z.enum(['drafts', 'never']).default('drafts'),
});
export type AssistantSettings = z.infer<typeof assistantSettingsInput>;
export const DEFAULT_ASSISTANT: AssistantSettings = {
  enabled: true,
  allowedActions: [...ASSISTANT_ACTION_KEYS],
  dailyLimitPerUser: 150,
  instructions: '',
  blockedTopics: '',
  keepDays: 90,
  sharedNicknamesBy: 'ADMIN',
  autoDo: 'drafts',
};

export const assistantAskInput = z.object({
  conversationId: idSchema.nullable().optional(),
  text: z.string().trim().min(1, 'Say or type something').max(2000),
  /** Where the person is in the app (helps with "this job") */
  screen: z.object({ path: z.string().max(300), title: z.string().max(200) }).nullable().optional(),
});
export type AssistantAskInput = z.infer<typeof assistantAskInput>;

export interface AssistantAction {
  type: AssistantActionKey;
  params: Record<string, unknown>;
  /** What will happen, in plain words — shown with Yes / No */
  confirm: string;
}

export interface AssistantMessageView {
  id: string;
  role: 'USER' | 'ASSISTANT';
  text: string;
  /** Links the assistant gives ("Open the order list") */
  links: { label: string; href: string }[];
  action: AssistantAction | null;
  actionStatus: 'PROPOSED' | 'DONE' | 'CANCELLED' | 'FAILED' | null;
  actionResult: { message: string; href?: string | null } | null;
  createdAt: string;
}

export interface AssistantConversationView {
  id: string;
  title: string | null;
  updatedAt: string;
  messages: AssistantMessageView[];
}

export interface AssistantReply {
  conversationId: string;
  messages: AssistantMessageView[];
  /** Open this screen now */
  navigate: string | null;
}

// Nicknames -----------------------------------------------------------------
export const NICKNAME_KINDS = [
  { key: 'SITE', label: 'Job / yard' },
  { key: 'LOCATION', label: 'Shipping location' },
  { key: 'VENDOR', label: 'Vendor' },
  { key: 'EQUIPMENT', label: 'Equipment' },
  { key: 'ITEM', label: 'Material / item' },
] as const;
export type NicknameKind = (typeof NICKNAME_KINDS)[number]['key'];
export const nicknameInput = z.object({
  phrase: z.string().trim().toLowerCase().min(2, 'Enter the nickname').max(80),
  kind: z.enum(NICKNAME_KINDS.map((k) => k.key) as [NicknameKind, ...NicknameKind[]]),
  targetId: idSchema.nullable().optional(),
  /** What it means, e.g. "JOB#2249 Bridge" or "20M rebar, 12 m" */
  targetLabel: z.string().trim().min(1).max(200),
  /** For everyone in the organization (admins, or anyone if the admin allows) */
  shared: z.boolean().default(false),
});
export type NicknameInput = z.infer<typeof nicknameInput>;
export interface NicknameView extends Omit<NicknameInput, 'shared'> {
  id: string;
  shared: boolean;
  createdByName: string | null;
  canEdit: boolean;
}

// ---------------------------------------------------------------------------
// Suggestions learned from this organization's own history (never other customers')
// ---------------------------------------------------------------------------
export interface ItemSuggestion {
  description: string;
  uom: string | null;
  costCode: string | null;
  /** How often it was ordered (here, or by this company) */
  count: number;
  lastUsed: string;
}
export interface PoDefaults {
  /** For this vendor: the carrier it usually ships with */
  shipViaId: string | null;
  /** The yard this person usually receives into */
  deliverToYardId: string | null;
  /** Vendors this company usually buys these items from */
  vendors: { name: string; count: number }[];
}
export const SUGGESTION_KINDS = ['PO_SHIP_VIA', 'PO_YARD', 'ITEM', 'VENDOR'] as const;
export const suggestionFeedbackInput = z.object({
  kind: z.enum(SUGGESTION_KINDS),
  contextKey: z.string().max(200).default(''),
  value: z.string().max(300),
  accepted: z.boolean(),
  companyId: idSchema.nullable().optional(),
});
export type SuggestionFeedback = z.infer<typeof suggestionFeedbackInput>;

/** Admin only: patterns worth a look. */
export interface InsightsView {
  period: { from: string; to: string };
  cards: { key: string; title: string; detail: string; rows: { label: string; value: string | number; href?: string | null }[] }[];
  /** Off until the privacy policy and terms cover it — never uses other customers' data. */
  crossCustomerLearning: false;
}
