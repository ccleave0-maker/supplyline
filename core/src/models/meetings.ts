import { z } from 'zod';
import { idSchema, optionalText } from './common';

// ---------------------------------------------------------------------------
// Templates (the 70-30 format is a template; replace the starter with yours)
// ---------------------------------------------------------------------------
export const MEETING_STEP_KINDS = ['NOTES', 'REVIEW_ACTIONS', 'CHECKLIST'] as const;
export type MeetingStepKind = (typeof MEETING_STEP_KINDS)[number];

export const meetingStepInput = z.object({
  key: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1, 'Name the step').max(120),
  /** What to talk about (shown to the person running it) */
  prompt: z.string().trim().max(1000).default(''),
  minutes: z.number().int().min(0).max(240).nullable().default(null),
  kind: z.enum(MEETING_STEP_KINDS).default('NOTES'),
  /** CHECKLIST steps: the things to tick */
  items: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});
export type MeetingStepDef = z.infer<typeof meetingStepInput>;

export const meetingTemplateInput = z.object({
  name: z.string().trim().min(1, 'Name it').max(120),
  companyId: idSchema.nullable().optional(),
  steps: z.array(meetingStepInput).min(1, 'Add at least one step').max(40),
  isDefault: z.boolean().default(false),
  active: z.boolean().optional(),
});
export type MeetingTemplateInput = z.infer<typeof meetingTemplateInput>;
export interface MeetingTemplateView extends Omit<MeetingTemplateInput, 'active' | 'companyId'> {
  id: string;
  companyId: string | null;
  active: boolean;
  starter: boolean;
}

/**
 * Starter "70-30" layout until the real format arrives: about 70% of the time
 * looking ahead, 30% looking back. Every step is editable in Admin › Meeting templates.
 */
export const STARTER_7030_TEMPLATE: MeetingTemplateInput = {
  name: '70-30 meeting (starter — replace with your format)',
  isDefault: true,
  steps: [
    { key: 'safety', title: 'Safety moment', prompt: 'Incidents, near misses, hazards for the coming weeks.', minutes: 5, kind: 'NOTES', items: [] },
    { key: 'actions', title: 'Last meeting’s action items', prompt: 'Go through what is still open. Mark done or move the date.', minutes: 5, kind: 'REVIEW_ACTIONS', items: [] },
    { key: 'lookback', title: 'Look back (30%) — last two weeks', prompt: 'What got done, what slipped and why. Keep it short.', minutes: 10, kind: 'NOTES', items: [] },
    { key: 'lookahead', title: 'Look ahead (70%) — next three weeks', prompt: 'Work coming up, crews, equipment, inspections, what must happen first.', minutes: 20, kind: 'NOTES', items: [] },
    { key: 'materials', title: 'Materials and deliveries', prompt: 'Open order lists, late POs, loads on the schedule, what the yard needs to know.', minutes: 5, kind: 'NOTES', items: [] },
    {
      key: 'readiness',
      title: 'Ready for the work ahead?',
      prompt: 'Tick what is in place for the look-ahead work.',
      minutes: 5,
      kind: 'CHECKLIST',
      items: ['Drawings / RFIs answered', 'Materials ordered', 'Equipment booked', 'Subcontractors confirmed', 'Permits and inspections booked'],
    },
    { key: 'issues', title: 'Issues and risks', prompt: 'Anything that could stop the work. Who owns it.', minutes: 5, kind: 'NOTES', items: [] },
    { key: 'wrap', title: 'Action items and next meeting', prompt: 'Read back the action items: who, what, by when.', minutes: 5, kind: 'NOTES', items: [] },
  ],
};

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------
export interface MeetingAttendee {
  userId: string | null;
  name: string;
  email: string | null;
  present: boolean;
}
export interface MeetingStepState extends MeetingStepDef {
  notes: string;
  /** CHECKLIST: which items are ticked */
  checked: string[];
}

export const meetingCreateInput = z.object({
  companyId: idSchema,
  siteId: idSchema.nullable().optional(),
  templateId: idSchema.nullable().optional(),
  title: z.string().trim().min(1).max(160),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
  attendees: z
    .array(z.object({ userId: idSchema.nullable().optional(), name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().max(200).nullable().optional(), present: z.boolean().default(true) }))
    .max(80)
    .default([]),
});
export type MeetingCreateInput = z.infer<typeof meetingCreateInput>;

export const meetingUpdateInput = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  attendees: meetingCreateInput.shape.attendees.optional(),
  currentStep: z.number().int().min(0).max(40).optional(),
  /** Notes / ticks per step key */
  steps: z.array(z.object({ key: z.string().max(40), notes: z.string().max(20_000), checked: z.array(z.string().max(200)).max(50).default([]) })).max(40).optional(),
  transcript: z.string().max(400_000).nullable().optional(),
  summary: z.string().max(20_000).nullable().optional(),
});
export type MeetingUpdateInput = z.infer<typeof meetingUpdateInput>;

export type MeetingStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE';
export interface MeetingSummary {
  id: string;
  title: string;
  companyId: string;
  siteId: string | null;
  siteLabel: string | null;
  status: MeetingStatus;
  scheduledFor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  openActions: number;
}
export interface MeetingDetail extends MeetingSummary {
  templateName: string | null;
  attendees: MeetingAttendee[];
  steps: MeetingStepState[];
  currentStep: number;
  transcript: string | null;
  summary: string | null;
  pdfUrl: string | null;
  audio: { id: string; url: string; createdAt: string; sizeBytes: number }[];
  actions: ActionItemView[];
  /** Still-open items from earlier meetings on the same job (for the review step) */
  carriedOver: ActionItemView[];
  canEdit: boolean;
  /** Speech-to-text is set up (Admin › AI) so recordings become a transcript */
  canTranscribe: boolean;
}

// ---------------------------------------------------------------------------
// Action items
// ---------------------------------------------------------------------------
export const actionItemInput = z.object({
  text: z.string().trim().min(1, 'What needs doing?').max(500),
  assigneeUserId: idSchema.nullable().optional(),
  assigneeName: optionalText,
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  stepKey: z.string().max(40).nullable().optional(),
  status: z.enum(['OPEN', 'DONE', 'CANCELLED']).optional(),
});
export type ActionItemInput = z.infer<typeof actionItemInput>;
export interface ActionItemView {
  id: string;
  meetingId: string | null;
  meetingTitle: string | null;
  siteId: string | null;
  siteLabel: string | null;
  stepKey: string | null;
  text: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  overdue: boolean;
  source: 'MANUAL' | 'AI';
  createdAt: string;
}
/** What the AI suggests from the notes / transcript (the person accepts each). */
export interface SuggestedAction {
  text: string;
  assigneeName: string | null;
  assigneeUserId: string | null;
  dueDate: string | null;
}
