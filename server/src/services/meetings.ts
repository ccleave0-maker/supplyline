// Meetings (the 70-30 meeting and any other format): templates, running a
// meeting step by step, recording + transcript, action items (typed, or found
// by the AI), minutes PDF emailed to the attendees and filed to the network.

import QRCode from 'qrcode';
import { qrPayload } from '@supplyline/core/domain';
import {
  STARTER_7030_TEMPLATE,
  type ActionItemInput,
  type ActionItemView,
  type MeetingAttendee,
  type MeetingCreateInput,
  type MeetingDetail,
  type MeetingStepDef,
  type MeetingStepState,
  type MeetingSummary,
  type MeetingTemplateInput,
  type MeetingTemplateView,
  type MeetingUpdateInput,
  type SuggestedAction,
} from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { renderMeetingPdf } from '../pdf/meeting-pdf';
import { accessibleCompanyIds, assertCompanyAccessible, assertSiteVisible, siteWhereFor } from './access';
import { canTranscribe, readMeeting, transcribeMeetingAudio } from './ai';
import { fileUrl, logoForPdf, saveUpload } from './files';
import { fileDocument, jobLabel } from './filing';
import { sendTemplated } from './mail';

const isAdmin = (auth: AuthContext) => auth.roles.includes('ADMIN');
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
const tView = (t: Prisma.MeetingTemplateGetPayload<object>): MeetingTemplateView => ({
  id: t.id,
  name: t.name,
  companyId: t.companyId,
  steps: t.steps as unknown as MeetingStepDef[],
  isDefault: t.isDefault,
  active: t.active,
  starter: t.name === STARTER_7030_TEMPLATE.name,
});

/** Every organization starts with the starter 70-30 template. */
async function ensureStarter(orgId: string) {
  if ((await db.meetingTemplate.count({ where: { organizationId: orgId } })) > 0) return;
  await db.meetingTemplate.create({ data: { organizationId: orgId, name: STARTER_7030_TEMPLATE.name, steps: STARTER_7030_TEMPLATE.steps as unknown as Prisma.InputJsonValue, isDefault: true } });
}

export async function listTemplates(auth: AuthContext, includeInactive = false): Promise<MeetingTemplateView[]> {
  requirePermission(auth, 'meeting:run');
  await ensureStarter(auth.orgId);
  const companies = await accessibleCompanyIds(auth);
  const rows = await db.meetingTemplate.findMany({
    where: { organizationId: auth.orgId, ...(includeInactive ? {} : { active: true }), OR: [{ companyId: null }, { companyId: { in: companies } }] },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
  return rows.map(tView);
}

export async function saveTemplate(auth: AuthContext, id: string | null, input: MeetingTemplateInput): Promise<MeetingTemplateView> {
  requirePermission(auth, 'meeting:template');
  if (input.companyId) await assertCompanyAccessible(auth, input.companyId);
  const keys = input.steps.map((s) => s.key);
  if (new Set(keys).size !== keys.length) throw badRequest('Two steps have the same key.');
  const data = { name: input.name, companyId: input.companyId ?? null, steps: input.steps as unknown as Prisma.InputJsonValue, isDefault: input.isDefault, ...(input.active !== undefined ? { active: input.active } : {}) };
  const t = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.meetingTemplate.updateMany({ where: { organizationId: auth.orgId, companyId: data.companyId }, data: { isDefault: false } });
    if (id) {
      if (!(await tx.meetingTemplate.findFirst({ where: { id, organizationId: auth.orgId } }))) throw notFound('Template');
      return tx.meetingTemplate.update({ where: { id }, data });
    }
    return tx.meetingTemplate.create({ data: { organizationId: auth.orgId, ...data } });
  });
  await audit(db, auth, id ? 'meeting_template.update' : 'meeting_template.create', 'MeetingTemplate', t.id, null, input);
  return tView(t);
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------
type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>;
const meetingInclude = {
  template: { select: { name: true } },
  actions: { orderBy: { createdAt: 'asc' } },
  audio: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, createdAt: true, sizeBytes: true } },
} satisfies Prisma.MeetingInclude;

async function meetingWhere(auth: AuthContext): Promise<Prisma.MeetingWhereInput> {
  const base: Prisma.MeetingWhereInput = { organizationId: auth.orgId, companyId: { in: await accessibleCompanyIds(auth) } };
  if (isAdmin(auth)) return { organizationId: auth.orgId };
  // Job meetings: jobs you can see. Company meetings (no job): anyone in the company; your own always.
  const visible = (await db.site.findMany({ where: await siteWhereFor(auth), select: { id: true } })).map((s) => s.id);
  return { ...base, OR: [{ siteId: null }, { siteId: { in: visible } }, { createdById: auth.userId }] };
}

async function loadMeeting(auth: AuthContext, id: string): Promise<MeetingRow> {
  requirePermission(auth, 'meeting:run');
  const m = await db.meeting.findFirst({ where: { AND: [{ id }, await meetingWhere(auth)] }, include: meetingInclude });
  if (!m) throw notFound('Meeting');
  return m;
}

const siteLabels = async (ids: (string | null)[]) => {
  const sites = await db.site.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, jobNumber: true, name: true } });
  return new Map(sites.map((s) => [s.id, `JOB#${s.jobNumber} ${s.name}`]));
};

function aView(a: Prisma.MeetingActionItemGetPayload<object>, extra: { meetingTitle?: string | null; siteLabel?: string | null } = {}): ActionItemView {
  const due = dateOnly(a.dueDate);
  return {
    id: a.id,
    meetingId: a.meetingId,
    meetingTitle: extra.meetingTitle ?? null,
    siteId: a.siteId,
    siteLabel: extra.siteLabel ?? null,
    stepKey: a.stepKey,
    text: a.text,
    assigneeUserId: a.assigneeUserId,
    assigneeName: a.assigneeName,
    dueDate: due,
    status: a.status as ActionItemView['status'],
    overdue: a.status === 'OPEN' && !!due && due < today(),
    source: a.source as ActionItemView['source'],
    createdAt: a.createdAt.toISOString(),
  };
}

function summary(m: Pick<MeetingRow, 'id' | 'title' | 'companyId' | 'siteId' | 'status' | 'scheduledFor' | 'startedAt' | 'endedAt'> & { actions: { status: string }[] }, sites: Map<string, string>): MeetingSummary {
  return {
    id: m.id,
    title: m.title,
    companyId: m.companyId,
    siteId: m.siteId,
    siteLabel: m.siteId ? (sites.get(m.siteId) ?? null) : null,
    status: m.status as MeetingSummary['status'],
    scheduledFor: m.scheduledFor?.toISOString() ?? null,
    startedAt: m.startedAt?.toISOString() ?? null,
    endedAt: m.endedAt?.toISOString() ?? null,
    openActions: m.actions.filter((a) => a.status === 'OPEN').length,
  };
}

async function detail(auth: AuthContext, m: MeetingRow): Promise<MeetingDetail> {
  const sites = await siteLabels([m.siteId]);
  const carried = m.siteId
    ? await db.meetingActionItem.findMany({ where: { organizationId: auth.orgId, siteId: m.siteId, status: 'OPEN', OR: [{ meetingId: null }, { meetingId: { not: m.id } }] }, include: { meeting: { select: { title: true } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 100 })
    : [];
  return {
    ...summary(m, sites),
    templateName: m.template?.name ?? null,
    attendees: m.attendees as unknown as MeetingAttendee[],
    steps: m.steps as unknown as MeetingStepState[],
    currentStep: m.currentStep,
    transcript: m.transcript,
    summary: m.summary,
    pdfUrl: fileUrl(m.pdfFileId),
    audio: m.audio.map((a) => ({ id: a.id, url: fileUrl(a.id)!, createdAt: a.createdAt.toISOString(), sizeBytes: a.sizeBytes })),
    actions: m.actions.map((a) => aView(a, { meetingTitle: m.title, siteLabel: sites.get(m.siteId ?? '') ?? null })),
    carriedOver: carried.map((a) => aView(a, { meetingTitle: a.meeting?.title ?? null, siteLabel: sites.get(m.siteId ?? '') ?? null })),
    canEdit: m.status !== 'DONE' || isAdmin(auth) || m.createdById === auth.userId,
    canTranscribe: await canTranscribe(auth.orgId),
  };
}

export async function listMeetings(auth: AuthContext, f: { siteId?: string; status?: string } = {}): Promise<MeetingSummary[]> {
  requirePermission(auth, 'meeting:run');
  const rows = await db.meeting.findMany({
    where: { AND: [await meetingWhere(auth), f.siteId ? { siteId: f.siteId } : {}, f.status ? { status: f.status } : {}] },
    include: { actions: { select: { status: true } } },
    orderBy: [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
    take: 300,
  });
  const sites = await siteLabels(rows.map((r) => r.siteId));
  return rows.map((r) => summary(r, sites));
}

export async function getMeeting(auth: AuthContext, id: string) {
  return detail(auth, await loadMeeting(auth, id));
}

export async function createMeeting(auth: AuthContext, input: MeetingCreateInput): Promise<MeetingDetail> {
  requirePermission(auth, 'meeting:run');
  await assertCompanyAccessible(auth, input.companyId);
  if (input.siteId) {
    const site = await assertSiteVisible(auth, input.siteId);
    if (site.companyId && site.companyId !== input.companyId) throw badRequest('That job belongs to a different company.');
  }
  await ensureStarter(auth.orgId);
  const template = input.templateId
    ? await db.meetingTemplate.findFirst({ where: { id: input.templateId, organizationId: auth.orgId } })
    : ((await db.meetingTemplate.findFirst({ where: { organizationId: auth.orgId, isDefault: true, active: true, companyId: input.companyId } })) ??
      (await db.meetingTemplate.findFirst({ where: { organizationId: auth.orgId, isDefault: true, active: true, companyId: null } })) ??
      (await db.meetingTemplate.findFirst({ where: { organizationId: auth.orgId, active: true } })));
  if (!template) throw badRequest('Pick a meeting template.');
  const steps: MeetingStepState[] = (template.steps as unknown as MeetingStepDef[]).map((s) => ({ ...s, notes: '', checked: [] }));
  const m = await db.meeting.create({
    data: {
      organizationId: auth.orgId,
      companyId: input.companyId,
      siteId: input.siteId ?? null,
      templateId: template.id,
      title: input.title,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
      attendees: input.attendees.map((a) => ({ userId: a.userId ?? null, name: a.name, email: a.email || null, present: a.present })) as unknown as Prisma.InputJsonValue,
      steps: steps as unknown as Prisma.InputJsonValue,
      createdById: auth.userId,
    },
    include: meetingInclude,
  });
  await audit(db, auth, 'meeting.create', 'Meeting', m.id, null, { title: input.title, siteId: input.siteId });
  return detail(auth, m);
}

/** People who could attend: the job's members (or the company's people). */
export async function meetingPeople(auth: AuthContext, f: { siteId?: string; companyId?: string }) {
  requirePermission(auth, 'meeting:run');
  const where: Prisma.UserWhereInput = { organizationId: auth.orgId, active: true, deletedAt: null };
  if (f.siteId) {
    await assertSiteVisible(auth, f.siteId);
    const site = await db.site.findUnique({ where: { id: f.siteId }, select: { projectManagerId: true, companyId: true } });
    where.OR = [{ memberships: { some: { siteId: f.siteId } } }, ...(site?.projectManagerId ? [{ id: site.projectManagerId }] : []), ...(site?.companyId ? [{ companyId: site.companyId, roles: { hasSome: ['ADMIN', 'PROCUREMENT'] as never } }] : [])];
  } else if (f.companyId) where.companyId = f.companyId;
  const users = await db.user.findMany({ where, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' }, take: 300 });
  return users;
}

export async function updateMeeting(auth: AuthContext, id: string, input: MeetingUpdateInput): Promise<MeetingDetail> {
  const m = await loadMeeting(auth, id);
  const d = await detail(auth, m);
  if (!d.canEdit) throw conflict('These minutes are finished. Ask the person who ran it or an admin.');
  const steps = m.steps as unknown as MeetingStepState[];
  if (input.steps) {
    for (const u of input.steps) {
      const s = steps.find((x) => x.key === u.key);
      if (!s) continue;
      s.notes = u.notes;
      s.checked = u.checked.filter((c) => s.items.includes(c));
    }
  }
  const data: Prisma.MeetingUpdateInput = {
    ...(input.title ? { title: input.title } : {}),
    ...(input.attendees ? { attendees: input.attendees.map((a) => ({ userId: a.userId ?? null, name: a.name, email: a.email || null, present: a.present })) as unknown as Prisma.InputJsonValue } : {}),
    ...(input.currentStep !== undefined ? { currentStep: Math.min(input.currentStep, Math.max(0, steps.length - 1)) } : {}),
    ...(input.steps ? { steps: steps as unknown as Prisma.InputJsonValue } : {}),
    ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    // Typing in it starts the meeting.
    ...(m.status === 'PLANNED' && (input.steps || input.currentStep !== undefined) ? { status: 'IN_PROGRESS', startedAt: new Date() } : {}),
  };
  await db.meeting.update({ where: { id }, data });
  return getMeeting(auth, id);
}

export async function startMeeting(auth: AuthContext, id: string) {
  const m = await loadMeeting(auth, id);
  if (m.status === 'PLANNED') await db.meeting.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
  return getMeeting(auth, id);
}

/** A recorded piece (about 10 minutes each): saved with the meeting, and added to the transcript if speech-to-text is set up. */
export async function addMeetingAudio(auth: AuthContext, id: string, file: File): Promise<{ transcribed: boolean; text: string | null }> {
  const m = await loadMeeting(auth, id);
  if (!file.type.startsWith('audio/') && !/\.(webm|ogg|m4a|mp3|wav)$/i.test(file.name)) throw badRequest('That isn’t a sound recording.');
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: m.companyId, uploadedById: auth.userId, kind: 'MEETING_AUDIO', file, maxBytes: 24 * 1_048_576 });
  await db.fileAsset.update({ where: { id: asset.id }, data: { meetingId: id } });
  let text: string | null = null;
  try {
    text = await transcribeMeetingAudio(auth.orgId, file);
  } catch (e) {
    console.error('[meetings] transcription failed', (e as Error).message);
  }
  if (text?.trim()) {
    const fresh = await db.meeting.findUniqueOrThrow({ where: { id }, select: { transcript: true } });
    await db.meeting.update({ where: { id }, data: { transcript: [fresh.transcript, text.trim()].filter(Boolean).join('\n\n') } });
  }
  return { transcribed: !!text, text };
}

// ---------------------------------------------------------------------------
// Action items
// ---------------------------------------------------------------------------
async function checkAssignee(auth: AuthContext, input: ActionItemInput) {
  if (!input.assigneeUserId) return null;
  const u = await db.user.findFirst({ where: { id: input.assigneeUserId, organizationId: auth.orgId }, select: { id: true, name: true, email: true, active: true } });
  if (!u) throw badRequest('That person isn’t in SupplyLine.');
  return u;
}

async function tellAssignee(auth: AuthContext, a: { id: string; text: string; dueDate: Date | null; assigneeUserId: string | null }, meeting: { title: string; companyId: string } | null) {
  if (!a.assigneeUserId || a.assigneeUserId === auth.userId) return;
  const u = await db.user.findUnique({ where: { id: a.assigneeUserId }, select: { name: true, email: true, active: true, companyId: true } });
  if (!u?.active) return;
  await db.notification.create({ data: { userId: a.assigneeUserId, type: 'action_item', title: `Action item: ${a.text.slice(0, 120)}`, body: [meeting?.title, a.dueDate ? `due ${dateOnly(a.dueDate)}` : null].filter(Boolean).join(' · '), link: '/actions/' } });
  const companyId = meeting?.companyId ?? u.companyId;
  if (companyId)
    await sendTemplated({
      organizationId: auth.orgId,
      companyId,
      key: 'ACTION_ASSIGNED',
      vars: { assigneeName: u.name, actionText: a.text, meetingTitle: meeting?.title ?? 'SupplyLine', dueDate: dateOnly(a.dueDate) ?? 'no date set', senderName: auth.name },
      to: [u.email],
      fromName: `${auth.name} via SupplyLine`,
      replyTo: auth.email,
      relatedType: 'action_item',
      relatedId: a.id,
    }).catch((e) => console.error('[meetings] action email failed', e));
}

export async function addAction(auth: AuthContext, meetingId: string, input: ActionItemInput, source: 'MANUAL' | 'AI' = 'MANUAL'): Promise<ActionItemView> {
  const m = await loadMeeting(auth, meetingId);
  const u = await checkAssignee(auth, input);
  const a = await db.meetingActionItem.create({
    data: {
      organizationId: auth.orgId,
      meetingId,
      siteId: m.siteId,
      stepKey: input.stepKey ?? null,
      text: input.text,
      assigneeUserId: u?.id ?? null,
      assigneeName: u?.name ?? input.assigneeName ?? null,
      dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
      source,
      createdById: auth.userId,
    },
  });
  await tellAssignee(auth, a, m);
  return aView(a, { meetingTitle: m.title });
}

export async function updateAction(auth: AuthContext, id: string, input: Partial<ActionItemInput>): Promise<ActionItemView> {
  requirePermission(auth, 'meeting:run');
  const a = await db.meetingActionItem.findFirst({ where: { id, organizationId: auth.orgId }, include: { meeting: { select: { title: true, companyId: true } } } });
  if (!a) throw notFound('Action item');
  // The person it's given to can always mark it done; otherwise it must be a meeting you can see.
  if (a.assigneeUserId !== auth.userId && a.meetingId) await loadMeeting(auth, a.meetingId);
  const u = input.assigneeUserId !== undefined ? await checkAssignee(auth, { text: a.text, ...input } as ActionItemInput) : undefined;
  const next = await db.meetingActionItem.update({
    where: { id },
    data: {
      ...(input.text ? { text: input.text } : {}),
      ...(input.assigneeUserId !== undefined ? { assigneeUserId: u?.id ?? null, assigneeName: u?.name ?? input.assigneeName ?? null } : input.assigneeName !== undefined ? { assigneeName: input.assigneeName } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null } : {}),
      ...(input.status ? { status: input.status, doneAt: input.status === 'DONE' ? new Date() : null } : {}),
    },
  });
  if (u && u.id !== a.assigneeUserId) await tellAssignee(auth, next, a.meeting);
  await audit(db, auth, 'action_item.update', 'MeetingActionItem', id, null, input);
  return aView(next, { meetingTitle: a.meeting?.title ?? null });
}

export async function listActions(auth: AuthContext, f: { mine?: boolean; siteId?: string; status?: 'OPEN' | 'DONE' | 'ALL' } = {}): Promise<ActionItemView[]> {
  requirePermission(auth, 'meeting:run');
  const visibleMeetings = await meetingWhere(auth);
  const rows = await db.meetingActionItem.findMany({
    where: {
      organizationId: auth.orgId,
      ...(f.status === 'ALL' ? {} : { status: f.status ?? 'OPEN' }),
      ...(f.siteId ? { siteId: f.siteId } : {}),
      ...(f.mine ? { assigneeUserId: auth.userId } : { OR: [{ assigneeUserId: auth.userId }, { meeting: visibleMeetings }] }),
    },
    include: { meeting: { select: { title: true } } },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 500,
  });
  const sites = await siteLabels(rows.map((r) => r.siteId));
  return rows.map((r) => aView(r, { meetingTitle: r.meeting?.title ?? null, siteLabel: r.siteId ? (sites.get(r.siteId) ?? null) : null }));
}

/** The AI reads the notes and transcript: a summary, and suggested action items (not saved until accepted). */
export async function suggestActions(auth: AuthContext, id: string): Promise<{ summary: string; suggestions: SuggestedAction[] }> {
  const m = await loadMeeting(auth, id);
  const steps = m.steps as unknown as MeetingStepState[];
  const people = (m.attendees as unknown as MeetingAttendee[]).filter((a) => a.present);
  const notes = steps
    .map((s) => `## ${s.title}\n${s.kind === 'CHECKLIST' ? s.items.map((i) => `${s.checked.includes(i) ? '[x]' : '[ ]'} ${i}`).join('\n') + '\n' : ''}${s.notes}`)
    .join('\n\n');
  if (!steps.some((s) => s.notes.trim() || s.checked.length) && !m.transcript?.trim()) throw badRequest('There are no notes or transcript to read yet.');
  const r = await readMeeting(auth, { companyId: m.companyId, title: m.title, date: dateOnly(m.startedAt ?? m.scheduledFor ?? m.createdAt)!, people: people.map((p) => p.name), notes, transcript: m.transcript });
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const match = (name: string | null) => {
    if (!name) return null;
    const n = norm(name);
    return people.find((p) => p.userId && (norm(p.name) === n || norm(p.name).startsWith(n) || n.startsWith(norm(p.name.split(' ')[0] ?? '')))) ?? null;
  };
  return {
    summary: r.summary,
    suggestions: r.actions.map((a) => {
      const p = match(a.assigneeName);
      return { text: a.text, assigneeName: p?.name ?? a.assigneeName, assigneeUserId: p?.userId ?? null, dueDate: a.dueDate };
    }),
  };
}

// ---------------------------------------------------------------------------
// Finish: minutes PDF, email to the people there, network folder
// ---------------------------------------------------------------------------
export async function finishMeeting(auth: AuthContext, id: string, opts: { email: boolean }): Promise<MeetingDetail & { emailed: number }> {
  const m = await loadMeeting(auth, id);
  const company = await db.company.findUniqueOrThrow({ where: { id: m.companyId } });
  const job = await jobLabel(m.siteId);
  const attendees = m.attendees as unknown as MeetingAttendee[];
  const when = (m.startedAt ?? m.scheduledFor ?? m.createdAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Vancouver' });
  const names = new Map((await db.user.findMany({ where: { id: { in: m.actions.map((a) => a.assigneeUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const actions = m.actions.filter((a) => a.status !== 'CANCELLED').map((a) => ({ text: a.text, who: (a.assigneeUserId && names.get(a.assigneeUserId)) || a.assigneeName || '—', due: dateOnly(a.dueDate) ?? '—', status: a.status === 'DONE' ? 'Done' : 'Open' }));
  const bytes = await renderMeetingPdf({
    title: m.title,
    companyName: company.name,
    companyCode: company.code,
    themeColor: company.themeColor,
    logo: await logoForPdf(company.logoFileId),
    jobLabel: job ? `JOB#${job}` : null,
    when,
    attendees,
    steps: (m.steps as unknown as MeetingStepState[]).map((s) => ({ title: s.title, notes: s.notes, items: s.items, checked: s.checked, kind: s.kind })),
    actions,
    summary: m.summary,
    qr: await QRCode.toBuffer(qrPayload({ kind: 'MEETING', id: m.id, label: m.title }), { type: 'png', margin: 1, width: 200 }),
  });
  const safe = m.title.replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 60) || 'meeting';
  const asset = await saveUpload({
    organizationId: auth.orgId,
    companyId: m.companyId,
    uploadedById: auth.userId,
    kind: 'MEETING_PDF',
    file: new File([new Uint8Array(bytes)], `Minutes-${safe}-${dateOnly(m.startedAt ?? m.createdAt)}.pdf`, { type: 'application/pdf' }),
    maxBytes: 30 * 1_048_576,
  });
  await db.meeting.update({ where: { id }, data: { status: 'DONE', endedAt: m.endedAt ?? new Date(), pdfFileId: asset.id, startedAt: m.startedAt ?? new Date() } });
  await fileDocument({ companyId: m.companyId, docType: 'MEETING_PDF', fileId: asset.id, vars: { job } });
  let emailed = 0;
  if (opts.email) {
    const ids = attendees.map((a) => a.userId).filter((x): x is string => !!x);
    const users = await db.user.findMany({ where: { id: { in: ids }, active: true }, select: { email: true } });
    const to = [...new Set([...users.map((u) => u.email), ...attendees.filter((a) => !a.userId && a.email).map((a) => a.email!)])];
    const r = await sendTemplated({
      organizationId: auth.orgId,
      companyId: m.companyId,
      key: 'MEETING_MINUTES',
      vars: { meetingTitle: m.title, meetingDate: when, actionList: actions.map((a) => `- ${a.text} (${a.who}, due ${a.due})`).join('\n') || 'None', senderName: auth.name, companyName: company.name },
      to,
      fromName: `${auth.name} via SupplyLine`,
      replyTo: auth.email,
      attachmentFileIds: [asset.id],
      relatedType: 'meeting',
      relatedId: id,
    });
    if (r.state === 'SENT' || r.state === 'HELD') emailed = to.length;
  }
  await audit(db, auth, 'meeting.finish', 'Meeting', id, null, { email: opts.email, emailed });
  return { ...(await getMeeting(auth, id)), emailed };
}

export async function meetingPdf(auth: AuthContext, id: string) {
  const m = await loadMeeting(auth, id);
  if (!m.pdfFileId) throw notFound('Minutes (finish the meeting first)');
  return { url: fileUrl(m.pdfFileId)! };
}
