// Voice AI and document reading. Every call goes through here: it checks the
// organization's settings, on/off switches and monthly cap, picks the key (the
// organization's own, or the platform owner's if allowed), logs the request
// and its cost in CAD, and emails admins at 80% and 100% of the cap.
// The AI only proposes values — people review and save.

import sharp from 'sharp';
import {
  AI_SCREENS,
  DEFAULT_AI_MODEL,
  type AiLogRow,
  type AiTokenHistory,
  type AiScreen,
  type AiSettingsInput,
  type AiSettingsView,
  type AiStatus,
  type AiToggleInput,
  type AiUsageRow,
  type InvoiceScanResult,
  type QuoteScanResult,
  type VoiceFillInput,
  type VoiceResult,
  type VoiceValue,
  type NavigateInput,
} from '@supplyline/core/models';
import { audit } from '../lib/audit';
import { isAdmin, requirePermission, type AuthContext } from '../lib/auth';
import { decrypt, encrypt } from '../lib/crypto';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, conflict } from '../lib/errors';
import { claudeToolCall, transcribeAudio, type ClaudeContent } from '../integrations/claude';
import { sendEmail } from '../integrations/email';
import { accessibleCompanyIds } from './access';
import { todayLocal } from './project';

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d));
const monthOf = (d = new Date()) => todayLocal(d).slice(0, 7);
const monthStart = () => new Date(`${monthOf()}-01T00:00:00Z`);

// ---------------------------------------------------------------------------
// Settings (Admin › AI)
// ---------------------------------------------------------------------------
async function config(orgId: string) {
  return db.aiConfig.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId }, update: {} });
}

async function spendThisMonth(orgId: string) {
  const rows = await db.aiRequestLog.groupBy({ by: ['usedPlatformKey'], where: { organizationId: orgId, createdAt: { gte: monthStart() } }, _sum: { costCad: true }, _count: true });
  const own = rows.find((r) => !r.usedPlatformKey);
  const plat = rows.find((r) => r.usedPlatformKey);
  return { ownCad: n(own?._sum.costCad), platformCad: n(plat?._sum.costCad), requests: rows.reduce((a, r) => a + r._count, 0) };
}

export async function getAiSettings(auth: AuthContext): Promise<AiSettingsView> {
  requirePermission(auth, 'org:manage');
  const c = await config(auth.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  let keyHint: string | null = null;
  if (c.apiKeyEncrypted) {
    try {
      const k = decrypt(c.apiKeyEncrypted);
      keyHint = `${k.slice(0, 7)}…${k.slice(-4)}`;
    } catch {
      keyHint = '(stored key can’t be read — enter it again)';
    }
  }
  return {
    enabled: c.enabled,
    model: c.model ?? DEFAULT_AI_MODEL,
    hasKey: !!c.apiKeyEncrypted,
    keyHint,
    monthlyCapCad: c.monthlyCapCad == null ? null : n(c.monthlyCapCad),
    usdToCad: n(c.usdToCad),
    priceInputUsdPerM: n(c.priceInputUsdPerM),
    priceOutputUsdPerM: n(c.priceOutputUsdPerM),
    sttProvider: c.sttProvider === 'openai' ? 'openai' : 'none',
    hasSttKey: !!c.sttKeyEncrypted,
    fallback: { allowed: org.aiFallbackEnabled, capCad: org.aiFallbackMonthlyCapCad == null ? null : n(org.aiFallbackMonthlyCapCad), available: org.aiFallbackEnabled && !!env().PLATFORM_ANTHROPIC_API_KEY },
    spend: { month: monthOf(), ...(await spendThisMonth(auth.orgId)) },
  };
}

export async function saveAiSettings(auth: AuthContext, input: AiSettingsInput) {
  requirePermission(auth, 'org:manage');
  await config(auth.orgId);
  const data: Record<string, unknown> = {
    enabled: input.enabled,
    model: input.model,
    monthlyCapCad: input.monthlyCapCad,
    usdToCad: input.usdToCad,
    priceInputUsdPerM: input.priceInputUsdPerM,
    priceOutputUsdPerM: input.priceOutputUsdPerM,
    sttProvider: input.sttProvider === 'none' ? null : input.sttProvider,
  };
  if (input.apiKey !== undefined) {
    if (input.apiKey && !/^sk-ant-[\w-]{20,}$/.test(input.apiKey)) throw badRequest('That doesn’t look like a Claude API key (it starts with “sk-ant-”).');
    data.apiKeyEncrypted = input.apiKey ? encrypt(input.apiKey) : null;
  }
  if (input.sttKey !== undefined) data.sttKeyEncrypted = input.sttKey ? encrypt(input.sttKey) : null;
  await db.aiConfig.update({ where: { organizationId: auth.orgId }, data });
  // Never log the keys themselves.
  await audit(db, auth, 'ai.settings', 'Organization', auth.orgId, null, { ...input, apiKey: input.apiKey === undefined ? undefined : input.apiKey ? '(new key)' : '(removed)', sttKey: input.sttKey === undefined ? undefined : '(changed)' });
  return getAiSettings(auth);
}

/** "Test connection": a tiny call with the stored key. */
export async function testAi(auth: AuthContext): Promise<{ ok: boolean; message: string }> {
  requirePermission(auth, 'org:manage');
  try {
    const r = await callAi(auth, 'navigate', {
      system: 'Reply using the tool.',
      content: [{ type: 'text', text: 'Say OK.' }],
      tool: { name: 'reply', description: 'Reply', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      maxTokens: 50,
      summary: 'Connection test',
      ignoreSwitches: true,
    });
    return { ok: true, message: `Connected (${r.model}). That test cost about ${r.costCad.toFixed(4)} CAD.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function listToggles(auth: AuthContext) {
  requirePermission(auth, 'org:manage');
  return db.aiToggle.findMany({ where: { organizationId: auth.orgId }, select: { companyId: true, role: true, screen: true, enabled: true } });
}

export async function saveToggles(auth: AuthContext, input: AiToggleInput) {
  requirePermission(auth, 'org:manage');
  const companies = await accessibleCompanyIds(auth);
  if (input.toggles.some((t) => t.companyId && !companies.includes(t.companyId))) throw badRequest('Unknown company.');
  await db.$transaction(async (tx) => {
    await tx.aiToggle.deleteMany({ where: { organizationId: auth.orgId } });
    if (input.toggles.length) await tx.aiToggle.createMany({ data: input.toggles.map((t) => ({ ...t, organizationId: auth.orgId })) });
    await audit(tx, auth, 'ai.toggles', 'Organization', auth.orgId, null, input);
  });
  return listToggles(auth);
}

/** Most specific switch wins (company + role + screen beats a general one). No switch = on. */
function switchedOn(toggles: { companyId: string | null; role: string | null; screen: string | null; enabled: boolean }[], companyId: string | null, roles: string[], screen: string) {
  let best: { score: number; enabled: boolean } | null = null;
  for (const t of toggles) {
    if (t.companyId && t.companyId !== companyId) continue;
    if (t.role && !roles.includes(t.role)) continue;
    if (t.screen && t.screen !== screen) continue;
    const score = (t.companyId ? 4 : 0) + (t.screen ? 2 : 0) + (t.role ? 1 : 0);
    if (!best || score > best.score || (score === best.score && t.enabled)) best = { score, enabled: t.enabled };
  }
  return best ? best.enabled : true;
}

export async function usage(auth: AuthContext, months = 3): Promise<AiUsageRow[]> {
  requirePermission(auth, 'org:manage');
  const since = new Date(monthStart().getTime() - months * 31 * 86_400_000);
  const rows = await db.aiRequestLog.findMany({ where: { organizationId: auth.orgId, createdAt: { gte: since } }, select: { createdAt: true, companyId: true, siteId: true, userId: true, costCad: true, inputTokens: true, outputTokens: true } });
  const [companies, sites, users] = await Promise.all([
    db.company.findMany({ where: { organizationId: auth.orgId }, select: { id: true, name: true } }),
    db.site.findMany({ where: { organizationId: auth.orgId }, select: { id: true, name: true, jobNumber: true } }),
    db.user.findMany({ where: { organizationId: auth.orgId }, select: { id: true, name: true } }),
  ]);
  const groups = new Map<string, AiUsageRow>();
  for (const r of rows) {
    const month = monthOf(r.createdAt);
    const key = [month, r.companyId, r.siteId, r.userId].join('|');
    const g = groups.get(key) ?? {
      month,
      companyName: companies.find((c) => c.id === r.companyId)?.name ?? null,
      siteName: (() => {
        const s = sites.find((x) => x.id === r.siteId);
        return s ? `${s.jobNumber} ${s.name}` : null;
      })(),
      userName: users.find((u) => u.id === r.userId)?.name ?? 'Unknown',
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costCad: 0,
    };
    g.requests++;
    g.inputTokens += r.inputTokens;
    g.outputTokens += r.outputTokens;
    g.costCad = Math.round((g.costCad + n(r.costCad)) * 10000) / 10000;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.month.localeCompare(a.month) || b.costCad - a.costCad);
}

export async function requestLog(auth: AuthContext): Promise<AiLogRow[]> {
  requirePermission(auth, 'org:manage');
  const rows = await db.aiRequestLog.findMany({ where: { organizationId: auth.orgId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    userName: users.find((u) => u.id === r.userId)?.name ?? 'Unknown',
    screen: AI_SCREENS.find((s) => s.key === r.screen)?.label ?? r.screen,
    kind: r.kind,
    transcript: r.transcript,
    summary: r.error ? `Failed: ${r.error}` : r.summary,
    costCad: n(r.costCad),
    usedPlatformKey: r.usedPlatformKey,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  }));
}

/** Every AI request's tokens, added up by day, model and screen (kept as history). */
export async function tokenHistory(auth: AuthContext, days = 90): Promise<AiTokenHistory> {
  requirePermission(auth, 'org:manage');
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  from.setUTCHours(0, 0, 0, 0);
  const rows = await db.aiRequestLog.findMany({ where: { organizationId: auth.orgId, createdAt: { gte: from } }, select: { createdAt: true, model: true, screen: true, inputTokens: true, outputTokens: true, costCad: true, error: true } });
  const add = <K extends string>(m: Map<K, { requests: number; inputTokens: number; outputTokens: number; costCad: number; failed?: number }>, k: K, r: (typeof rows)[number]) => {
    const g = m.get(k) ?? { requests: 0, inputTokens: 0, outputTokens: 0, costCad: 0, failed: 0 };
    g.requests++;
    g.inputTokens += r.inputTokens;
    g.outputTokens += r.outputTokens;
    g.costCad = Math.round((g.costCad + n(r.costCad)) * 10000) / 10000;
    if (r.error) g.failed = (g.failed ?? 0) + 1;
    m.set(k, g);
  };
  const byDay = new Map<string, { requests: number; inputTokens: number; outputTokens: number; costCad: number; failed?: number }>();
  const byModel = new Map<string, { requests: number; inputTokens: number; outputTokens: number; costCad: number }>();
  const byScreen = new Map<string, { requests: number; inputTokens: number; outputTokens: number; costCad: number }>();
  for (const r of rows) {
    add(byDay, r.createdAt.toISOString().slice(0, 10), r);
    add(byModel, r.model, r);
    add(byScreen, AI_SCREENS.find((s) => s.key === r.screen)?.label ?? r.screen, r);
  }
  const totals = { requests: rows.length, inputTokens: rows.reduce((t, r) => t + r.inputTokens, 0), outputTokens: rows.reduce((t, r) => t + r.outputTokens, 0), costCad: Math.round(rows.reduce((t, r) => t + n(r.costCad), 0) * 100) / 100 };
  const strip = (g: { requests: number; inputTokens: number; outputTokens: number; costCad: number; failed?: number }) => ({ requests: g.requests, inputTokens: g.inputTokens, outputTokens: g.outputTokens, costCad: g.costCad });
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, g]) => ({ day, requests: g.requests, failed: g.failed ?? 0, inputTokens: g.inputTokens, outputTokens: g.outputTokens, costCad: g.costCad })),
    byModel: [...byModel.entries()].map(([model, g]) => ({ model, ...strip(g) })).sort((a, b) => b.costCad - a.costCad),
    byScreen: [...byScreen.entries()].map(([screen, g]) => ({ screen, ...strip(g) })).sort((a, b) => b.costCad - a.costCad),
    totals: { ...totals, avgCostCad: totals.requests ? Math.round((totals.costCad / totals.requests) * 10000) / 10000 : 0 },
  };
}

// ---------------------------------------------------------------------------
// Can this person use AI here, and with which key?
// ---------------------------------------------------------------------------
async function resolveAccess(auth: AuthContext, screen: AiScreen, companyId: string | null, ignoreSwitches = false) {
  const c = await config(auth.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  if (!c.enabled && !ignoreSwitches) return { ok: false as const, reason: 'Voice AI is turned off. An admin can turn it on under Admin › AI.' };
  if (!ignoreSwitches) {
    const toggles = await db.aiToggle.findMany({ where: { organizationId: auth.orgId } });
    if (!switchedOn(toggles, companyId ?? auth.companyId, auth.roles, screen)) return { ok: false as const, reason: 'Voice is turned off for this screen.' };
  }
  const spend = await spendThisMonth(auth.orgId);
  if (c.apiKeyEncrypted) {
    if (c.monthlyCapCad != null && spend.ownCad >= n(c.monthlyCapCad)) return { ok: false as const, reason: 'This month’s AI spending cap has been reached. An admin can raise it under Admin › AI.' };
    return { ok: true as const, apiKey: decrypt(c.apiKeyEncrypted), usedPlatformKey: false, model: c.model ?? DEFAULT_AI_MODEL, cfg: c, org, spend };
  }
  const platformKey = env().PLATFORM_ANTHROPIC_API_KEY;
  if (org.aiFallbackEnabled && platformKey) {
    if (org.aiFallbackMonthlyCapCad != null && spend.platformCad >= n(org.aiFallbackMonthlyCapCad)) return { ok: false as const, reason: 'This month’s allowance on the shared AI key has been used up.' };
    return { ok: true as const, apiKey: platformKey, usedPlatformKey: true, model: c.model ?? DEFAULT_AI_MODEL, cfg: c, org, spend };
  }
  return { ok: false as const, reason: 'No Claude API key yet. An admin can add one under Admin › AI.' };
}

export async function aiStatus(auth: AuthContext): Promise<AiStatus> {
  const c = await config(auth.orgId);
  const screens: AiScreen[] = [];
  const first = await resolveAccess(auth, 'navigate', auth.companyId);
  if (first.ok || first.reason === 'Voice is turned off for this screen.') {
    const toggles = await db.aiToggle.findMany({ where: { organizationId: auth.orgId } });
    for (const s of AI_SCREENS) if (switchedOn(toggles, auth.companyId, auth.roles, s.key)) screens.push(s.key);
  }
  const ok = first.ok || first.reason === 'Voice is turned off for this screen.';
  return { available: ok && screens.length > 0, screens: ok ? screens : [], serverTranscribe: ok && c.sttProvider === 'openai' && !!c.sttKeyEncrypted, reason: ok ? null : first.reason };
}

/** One Claude call, logged and costed. */
export async function callAi(
  auth: AuthContext,
  screen: AiScreen,
  opts: {
    system: string;
    content: ClaudeContent[];
    tool: { name: string; description: string; input_schema: Record<string, unknown> };
    maxTokens?: number;
    transcript?: string | null;
    summary?: string;
    companyId?: string | null;
    siteId?: string | null;
    ignoreSwitches?: boolean;
  },
): Promise<{ input: unknown; costCad: number; model: string; logId: string }> {
  const access = await resolveAccess(auth, screen, opts.companyId ?? null, opts.ignoreSwitches);
  if (!access.ok) throw conflict(access.reason);
  const base = {
    organizationId: auth.orgId,
    companyId: opts.companyId ?? auth.companyId,
    siteId: opts.siteId ?? null,
    userId: auth.userId,
    screen,
    kind: screen.endsWith('Scan') ? 'SCAN' : 'VOICE',
    model: access.model,
    usedPlatformKey: access.usedPlatformKey,
    transcript: opts.transcript ?? null,
  };
  let reply;
  try {
    reply = await claudeToolCall({ apiKey: access.apiKey, model: access.model, system: opts.system, content: opts.content, tool: opts.tool, maxTokens: opts.maxTokens });
  } catch (e) {
    const msg = (e as Error).message ?? 'AI request failed';
    await db.aiRequestLog.create({ data: { ...base, inputTokens: 0, outputTokens: 0, costCad: 0, error: msg.slice(0, 500) } });
    const friendly = /401|authentication|invalid x-api-key/i.test(msg) ? 'The Claude API key was rejected. Check it under Admin › AI.' : /model/i.test(msg) && /not.?found|404/i.test(msg) ? `The model “${access.model}” isn’t available on this key. Pick another under Admin › AI.` : `The AI request failed: ${msg.slice(0, 160)}`;
    throw conflict(friendly);
  }
  const usd = (reply.inputTokens * n(access.cfg.priceInputUsdPerM) + reply.outputTokens * n(access.cfg.priceOutputUsdPerM)) / 1_000_000;
  const costCad = Math.round(usd * n(access.cfg.usdToCad) * 10000) / 10000;
  const log = await db.aiRequestLog.create({
    data: { ...base, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, costCad, summary: opts.summary ?? null, fieldsFilled: (reply.input ?? null) as object },
  });
  await capAlerts(auth.orgId, access.usedPlatformKey);
  return { input: reply.input, costCad, model: access.model, logId: log.id };
}

/** Email admins once a month at 80% and 100% of the cap. */
async function capAlerts(orgId: string, platform: boolean) {
  const c = await config(orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const cap = platform ? (org.aiFallbackMonthlyCapCad == null ? null : n(org.aiFallbackMonthlyCapCad)) : c.monthlyCapCad == null ? null : n(c.monthlyCapCad);
  if (cap == null || cap <= 0) return;
  const spend = await spendThisMonth(orgId);
  const used = platform ? spend.platformCad : spend.ownCad;
  const month = monthOf();
  const level = used >= cap ? 100 : used >= cap * 0.8 ? 80 : 0;
  if (!level) return;
  if (level === 100 && c.alertedMonth100 === month) return;
  if (level === 80 && (c.alertedMonth80 === month || c.alertedMonth100 === month)) return;
  await db.aiConfig.update({ where: { organizationId: orgId }, data: level === 100 ? { alertedMonth100: month } : { alertedMonth80: month } });
  const admins = await db.user.findMany({ where: { organizationId: orgId, active: true, deletedAt: null, roles: { has: 'ADMIN' } }, select: { email: true } });
  if (admins.length)
    await sendEmail(
      {
        fromName: env().EMAIL_FROM_NAME,
        to: admins.map((a) => a.email),
        subject: `SupplyLine AI spending: ${level}% of this month's cap`,
        text: `Voice AI and document reading have used ${used.toFixed(2)} CAD of the ${cap.toFixed(2)} CAD monthly cap${platform ? ' on the shared key' : ''}.${level === 100 ? '\n\nAI is paused until next month or until the cap is raised (Admin › AI).' : ''}`,
      },
      { organizationId: orgId, relatedType: 'ai_cap' },
    );
}

// ---------------------------------------------------------------------------
// Voice: fill in the screen from what was said
// ---------------------------------------------------------------------------
const UOMS = ['EA', 'PCS', 'M', 'LM', 'FT', 'LF', 'M2', 'M3', 'YD3', 'KG', 'T', 'TONNE', 'L', 'ROLL', 'BOX', 'BAG', 'BDL', 'PALLET', 'SHEET', 'LOT', 'HR', 'DAY'];

function jsonType(f: { type: string; options?: { value: string }[] }) {
  if (f.type === 'number') return { type: ['number', 'null'] };
  if (f.type === 'boolean') return { type: ['boolean', 'null'] };
  if (f.type === 'choice' && f.options?.length) return { type: ['string', 'null'], enum: [...f.options.map((o) => o.value), null] };
  return { type: ['string', 'null'] };
}

async function contextFor(auth: AuthContext, input: VoiceFillInput) {
  const lines: string[] = [];
  const siteId = input.siteId ?? null;
  let companyId = input.companyId ?? null;
  if (siteId) {
    const site = await db.site.findFirst({ where: { id: siteId, organizationId: auth.orgId } });
    if (site) {
      companyId ??= site.companyId;
      lines.push(`Job / site: ${site.type === 'JOB' ? `JOB#${site.jobNumber}` : site.name} ${site.name}`);
    }
  }
  if (companyId) {
    const codes = await db.costCode.findMany({ where: { companyId, OR: [{ siteId: null }, ...(siteId ? [{ siteId }] : [])] }, select: { code: true, description: true }, take: 150 });
    if (codes.length) lines.push(`Cost codes: ${codes.map((c) => `${c.code}${c.description ? ` (${c.description})` : ''}`).join('; ')}`);
    const past = await db.orderLine.findMany({
      where: { companyId, ...(siteId ? { siteId } : {}), cancelledAt: null },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: { description: true, uom: true, quantity: true, costCode: true },
    });
    const seen = new Set<string>();
    const items = past.filter((p) => (seen.has(p.description.toLowerCase()) ? false : (seen.add(p.description.toLowerCase()), true))).slice(0, 60);
    if (items.length) lines.push(`Items ordered before (description | unit | last qty | cost code):\n${items.map((p) => `- ${p.description} | ${p.uom} | ${Number(p.quantity)} | ${p.costCode ?? ''}`).join('\n')}`);
  }
  lines.push(`Units of measure used: ${UOMS.join(', ')}`);
  lines.push(`Today: ${todayLocal()}`);
  return { text: lines.join('\n'), companyId, siteId };
}

export async function voiceFill(auth: AuthContext, input: VoiceFillInput): Promise<VoiceResult> {
  const schema = input.schema;
  const ctx = await contextFor(auth, input);
  const rowProps = schema.rows ? Object.fromEntries(schema.rows.fields.map((f) => [f.key, jsonType(f)])) : {};
  const tool = {
    name: 'fill_form',
    description: 'Fill in the form fields from what the person said.',
    input_schema: {
      type: 'object',
      properties: {
        set: { type: 'object', description: 'Single fields to set (only the ones the person mentioned).', properties: Object.fromEntries(schema.fields.map((f) => [f.key, jsonType(f)])), additionalProperties: false },
        rowOps: {
          type: 'array',
          description: schema.rows ? `Changes to the list of ${schema.rows.label}. "index" is 0-based into the current rows (row 1 = index 0).` : 'Leave empty.',
          items: {
            type: 'object',
            properties: { op: { type: 'string', enum: ['add', 'update', 'remove'] }, index: { type: ['integer', 'null'] }, values: { type: 'object', properties: rowProps, additionalProperties: false } },
            required: ['op'],
          },
        },
        summary: { type: 'string', description: 'One short plain sentence saying what you changed, e.g. "Added 2 lines; set L3 to 50 EA".' },
        question: { type: ['string', 'null'], description: 'If something important was unclear, a short question to ask. Otherwise null.' },
      },
      required: ['set', 'rowOps', 'summary', 'question'],
    },
  };
  const describe = (f: { key: string; label: string; type: string; options?: { value: string; label: string }[]; hint?: string }) =>
    `- ${f.key} (${f.label}; ${f.type}${f.options ? `; one of: ${f.options.slice(0, 80).map((o) => (o.value === o.label ? o.value : `${o.value}=${o.label}`)).join(', ')}` : ''}${f.hint ? `; ${f.hint}` : ''})`;
  const system = [
    'You fill in a form in SupplyLine, a construction materials and procurement app, from what a person said (speech-to-text, so expect mis-heard words).',
    'Rules: only change what the person asked for; never invent quantities, prices or items they did not say; keep existing values otherwise.',
    'Quantities are numbers; use the units of measure listed; match items to past items and cost codes when they clearly mean them (e.g. "20 mil rebar" = "20M rebar").',
    'Dates are YYYY-MM-DD (resolve "tomorrow", "next Friday" from today). For choice fields use the given values exactly.',
    'Lines / rows are numbered from 1 when people speak ("line 3" = index 2). "Same as last time" means copy the matching past item.',
    'You never save or submit — the person reviews your changes.',
  ].join('\n');
  const user = [
    `Screen: ${schema.title}`,
    schema.fields.length ? `Fields:\n${schema.fields.map(describe).join('\n')}` : '',
    schema.rows ? `List "${schema.rows.label}" (can add: ${schema.rows.canAdd}, can remove: ${schema.rows.canRemove}), row fields:\n${schema.rows.fields.map(describe).join('\n')}` : '',
    `Current values: ${JSON.stringify(input.current.values).slice(0, 4000)}`,
    schema.rows ? `Current rows:\n${input.current.rows.map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join('\n').slice(0, 12000)}` : '',
    `Context:\n${ctx.text}`,
    `The person said: "${input.transcript}"`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const r = await callAi(auth, schema.screen, { system, content: [{ type: 'text', text: user }], tool, maxTokens: 3000, transcript: input.transcript, companyId: ctx.companyId, siteId: ctx.siteId });
  const out = (r.input ?? {}) as { set?: Record<string, VoiceValue>; rowOps?: VoiceResult['rowOps']; summary?: string; question?: string | null };
  // Keep only fields the screen offered.
  const allowed = new Set(schema.fields.map((f) => f.key));
  const rowAllowed = new Set(schema.rows?.fields.map((f) => f.key) ?? []);
  const set = Object.fromEntries(Object.entries(out.set ?? {}).filter(([k, v]) => allowed.has(k) && v !== undefined));
  const rowOps = (schema.rows ? (out.rowOps ?? []) : [])
    .filter((o) => (o.op === 'add' ? schema.rows!.canAdd : o.op === 'remove' ? schema.rows!.canRemove : true))
    .filter((o) => o.op === 'add' || (typeof o.index === 'number' && o.index >= 0 && o.index < input.current.rows.length))
    .map((o) => ({ ...o, values: o.values ? Object.fromEntries(Object.entries(o.values).filter(([k]) => rowAllowed.has(k))) : undefined }));
  const summary = out.summary?.trim() || 'Nothing to change.';
  await db.aiRequestLog.update({ where: { id: r.logId }, data: { summary } });
  return { heard: input.transcript, summary, set, rowOps, navigate: null, question: out.question ?? null };
}

/** "Open job 2249", "new BOL", "receive PO 1042"… → which screen to open. */
export async function voiceNavigate(auth: AuthContext, transcript: string, destinations: { path: string; label: string }[], screen: NavigateInput['screen'] = null): Promise<VoiceResult> {
  const sites = await db.site.findMany({ where: { organizationId: auth.orgId, active: true }, select: { id: true, type: true, jobNumber: true, name: true }, take: 300 });
  const tool = {
    name: 'open_screen',
    description: 'Choose the screen to open.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: ['string', 'null'], description: 'The path to open (from the list, with ?id= for a specific job, or ?q= for receiving a number), or null when filling in this screen.' },
        set: {
          type: 'object',
          description: 'Fields on the current screen to fill in (by key), only those the person gave values for. Empty when opening another screen.',
          properties: Object.fromEntries((screen?.fields ?? []).map((f) => [f.key, f.type === 'checkbox' ? { type: 'boolean' } : f.type === 'number' ? { type: ['number', 'string'] } : { type: 'string' }])),
          additionalProperties: false,
        },
        summary: { type: 'string', description: 'What you are opening, in a few words.' },
        question: { type: ['string', 'null'] },
        handoff: { type: 'boolean', description: 'True when they ask to MAKE or DO something (a PO, an order, a contact, a load, look something up…) rather than open a screen or fill this screen\'s fields.' },
      },
      required: ['path', 'set', 'summary', 'question', 'handoff'],
    },
  };
  const user = [
    `Screens:\n${destinations.map((d) => `- ${d.path} = ${d.label}`).join('\n')}`,
    `Special paths: /sites/view/?id=<site id> opens a job or yard; /orders/?siteId=<site id> its order lists; /yard/receive/?q=<PO or order #> receives a delivery; /purchase-orders/edit/?siteId=<site id> new PO for a job; /bols/edit/ new BOL.`,
    `Jobs and yards (id | type | number | name):\n${sites.map((s) => `${s.id} | ${s.type} | ${s.jobNumber} | ${s.name}`).join('\n')}`,
    screen?.fields.length
      ? `They are on: ${screen.title} (${screen.path}). Fields on this screen (key | label | type | current value | choices):\n${screen.fields.map((f) => `${f.key} | ${f.label} | ${f.type} | ${JSON.stringify(f.value).slice(0, 200)}${f.options ? ` | ${f.options.slice(0, 60).map((o) => (o.value === o.label ? o.value : `${o.value}=${o.label}`)).join(', ')}` : ''}`).join('\n')}`
      : '',
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `The person said: "${transcript}"`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const r = await callAi(auth, 'navigate', {
    system:
      'You help someone use the SupplyLine app by voice. Either (a) they are giving information for the fields on the screen they are on — fill those fields ("set", path null), or (b) they want another screen — give its path ("set" empty). ' +
      'Speech-to-text mishears words; match choices by meaning (job nicknames, partial names). For choice fields use the exact value. Dates are YYYY-MM-DD. Never invent values the person did not say. Nothing is saved — the person reviews it.',
    content: [{ type: 'text', text: user }],
    tool,
    maxTokens: 900,
    transcript,
  });
  const out = (r.input ?? {}) as { path?: string | null; set?: Record<string, VoiceValue>; summary?: string; question?: string | null; handoff?: boolean };
  // "Make me a PO for…": the assistant does it (with all the details), instead of just opening a screen.
  if (out.handoff) {
    const { ask, assistantOf } = await import('./assistant');
    const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { settings: true } });
    if (assistantOf(org.settings).enabled) {
      const a = await ask(auth, { text: transcript, screen: screen ? { path: screen.path, title: screen.title } : null });
      const reply = a.messages[a.messages.length - 1]!;
      const waiting = reply.actionStatus === 'PROPOSED';
      return {
        heard: transcript,
        summary: [reply.text, reply.actionResult?.message].filter(Boolean).join(' '),
        set: {},
        rowOps: [],
        navigate: a.navigate,
        question: waiting ? `${reply.action?.confirm ?? 'Do it?'} — open 💬 to say yes.` : null,
      };
    }
  }
  const known = new Set((screen?.fields ?? []).map((f) => f.key));
  const set = Object.fromEntries(Object.entries(out.set ?? {}).filter(([k]) => known.has(k)));
  const path = typeof out.path === 'string' && out.path.startsWith('/') && !out.path.startsWith('//') ? out.path : null;
  await db.aiRequestLog.update({ where: { id: r.logId }, data: { summary: out.summary ?? null } });
  const filled = Object.keys(set).length > 0;
  return {
    heard: transcript,
    summary: out.summary ?? (path ? 'Opening…' : filled ? 'Filled in.' : 'Not sure what to do.'),
    set: path ? {} : set,
    rowOps: [],
    navigate: path,
    question: path || filled ? null : (out.question ?? 'What would you like to do?'),
  };
}

/** Recorded audio → text (for devices that can't do speech-to-text themselves). */
export async function transcribe(auth: AuthContext, file: File): Promise<{ text: string }> {
  if (file.size === 0 || file.size > 20 * 1_048_576) throw badRequest('The recording was empty or too long.');
  const c = await config(auth.orgId);
  if (c.sttProvider !== 'openai' || !c.sttKeyEncrypted) throw conflict('Speech-to-text isn’t set up. An admin can add it under Admin › AI, or type / use Windows key + H.');
  const access = await resolveAccess(auth, 'navigate', auth.companyId);
  if (!access.ok && access.reason !== 'Voice is turned off for this screen.') throw conflict(access.reason);
  const text = await transcribeAudio(decrypt(c.sttKeyEncrypted), file, file.name || 'speech.webm');
  return { text };
}

// ---------------------------------------------------------------------------
// Reading documents (quotes, invoices, packing slips)
// ---------------------------------------------------------------------------
async function docContent(file: File | { bytes: Uint8Array; type: string }): Promise<ClaudeContent> {
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
  const type = file instanceof File ? file.type : file.type;
  if (type === 'application/pdf' || (file instanceof File && file.name.toLowerCase().endsWith('.pdf'))) {
    if (bytes.length > 25 * 1_048_576) throw badRequest('That PDF is too big (max 25 MB).');
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } };
  }
  let jpeg: Buffer;
  try {
    jpeg = await sharp(bytes).rotate().resize({ width: 1800, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    throw badRequest('Upload a photo (JPG / PNG) or a PDF.');
  }
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } };
}

const numOrNull = { type: ['number', 'null'] };
const strOrNull = { type: ['string', 'null'] };

/** A vendor quote → PO lines. Only quantities, descriptions and unit prices — never quote numbers. */
export async function readQuote(auth: AuthContext, file: File, companyId: string | null): Promise<QuoteScanResult> {
  requirePermission(auth, 'procurement:work');
  const r = await callAi(auth, 'quoteScan', {
    system:
      'You read a supplier quote (typed, handwritten, or written on a tender form) for a construction company. Extract ONLY the line items, and for each only: quantity, unit of measure, description, and the part / item / catalogue number if one is shown. Do NOT read prices, quote numbers, quote dates, validity terms, references or totals. If something is unreadable, skip it rather than guess.',
    content: [await docContent(file), { type: 'text', text: 'Extract the line items.' }],
    tool: {
      name: 'quote_lines',
      description: 'The items on the quote.',
      input_schema: {
        type: 'object',
        properties: {
          vendorName: strOrNull,
          lines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, partNumber: strOrNull, qty: { type: 'number' }, uom: { type: 'string' } }, required: ['description', 'partNumber', 'qty', 'uom'] } },
          notes: { ...strOrNull, description: 'Anything the buyer should double-check (e.g. a line you could not read).' },
        },
        required: ['vendorName', 'lines', 'notes'],
      },
    },
    maxTokens: 4000,
    companyId,
    summary: 'Quote read',
  });
  const out = r.input as { vendorName?: string | null; notes?: string | null; lines?: { description: string; partNumber?: string | null; qty: number; uom: string }[] };
  // Description and part number go on one line; no prices or quote numbers are taken from the quote.
  const lines = (out.lines ?? [])
    .filter((l) => l.description && Number.isFinite(l.qty) && l.qty > 0)
    .map((l) => {
      const part = l.partNumber?.trim();
      const desc = String(l.description).trim();
      return { description: (part && !desc.includes(part) ? `${desc} — Part# ${part}` : desc).slice(0, 300), qty: l.qty, uom: (l.uom || 'EA').toUpperCase().slice(0, 20), unitPrice: null };
    });
  await db.aiRequestLog.update({ where: { id: r.logId }, data: { summary: `Quote read: ${lines.length} line(s)` } });
  return { vendorName: out.vendorName ?? null, lines, notes: out.notes ?? null };
}

/** An invoice → the numbers AP needs (used by the AP inbox in Phase 8). */
export async function readInvoice(auth: AuthContext, file: File, companyId: string | null): Promise<InvoiceScanResult> {
  requirePermission(auth, 'ap:work');
  const r = await callAi(auth, 'invoiceScan', {
    system: 'You read a supplier invoice for a Canadian construction company. Extract the header numbers and line items exactly as printed. Amounts in dollars. Dates as YYYY-MM-DD. Use null for anything not on the invoice.',
    content: [await docContent(file), { type: 'text', text: 'Read this invoice.' }],
    tool: {
      name: 'invoice',
      description: 'The invoice details.',
      input_schema: {
        type: 'object',
        properties: {
          documentType: { type: 'string', enum: ['INVOICE', 'CREDIT', 'REVISED'], description: 'CREDIT for a credit note / credit memo; REVISED for a corrected / revised / re-issued invoice' },
          refInvoiceNumber: { ...strOrNull, description: 'For a credit or revised invoice: the ORIGINAL invoice number it refers to, if printed' },
          vendorName: strOrNull,
          invoiceNumber: strOrNull,
          invoiceDate: strOrNull,
          dueDate: strOrNull,
          poNumber: strOrNull,
          subtotal: numOrNull,
          gst: numOrNull,
          pst: numOrNull,
          total: numOrNull,
          lines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, qty: numOrNull, uom: strOrNull, unitPrice: numOrNull, amount: numOrNull }, required: ['description'] } },
        },
        required: ['documentType', 'refInvoiceNumber', 'vendorName', 'invoiceNumber', 'invoiceDate', 'dueDate', 'poNumber', 'subtotal', 'gst', 'pst', 'total', 'lines'],
      },
    },
    maxTokens: 4000,
    companyId,
    summary: 'Invoice read',
  });
  return r.input as InvoiceScanResult;
}

/** A packing slip photo + the PO it's for → how much of each PO line arrived. Null if AI isn't available. */
export async function readPackingSlip(
  auth: AuthContext,
  image: { bytes: Uint8Array; type: string },
  po: { companyId: string; poNumber: string; lines: { id: string; description: string; uom: string; remaining: number }[] },
): Promise<{ poLineId: string; description: string; qty: number }[] | null> {
  const access = await resolveAccess(auth, 'docScan', po.companyId);
  if (!access.ok) return null;
  try {
    const r = await callAi(auth, 'docScan', {
      system:
        'You read a vendor packing slip / delivery ticket photographed at a construction yard. Match each item shipped to one of the purchase order lines given, and read the quantity SHIPPED on this paper (not the quantity ordered or back-ordered). Skip items you cannot match or read.',
      content: [
        await docContent(image),
        { type: 'text', text: `PO ${po.poNumber} lines (id | description | unit | still expected):\n${po.lines.map((l) => `${l.id} | ${l.description} | ${l.uom} | ${l.remaining}`).join('\n')}` },
      ],
      tool: {
        name: 'shipped',
        description: 'What this delivery brought, per PO line.',
        input_schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: { poLineId: { type: 'string' }, qty: { type: 'number' } }, required: ['poLineId', 'qty'] } } }, required: ['lines'] },
      },
      maxTokens: 1500,
      companyId: po.companyId,
      summary: `Packing slip for PO ${po.poNumber}`,
    });
    const out = (r.input as { lines?: { poLineId: string; qty: number }[] }).lines ?? [];
    return out
      .filter((l) => po.lines.some((x) => x.id === l.poLineId) && Number.isFinite(l.qty) && l.qty >= 0)
      .map((l) => ({ poLineId: l.poLineId, description: po.lines.find((x) => x.id === l.poLineId)!.description, qty: l.qty }));
  } catch {
    return null; // reading quantities is a bonus; the PO match still works
  }
}

export const aiIsAdmin = isAdmin;

// ---------------------------------------------------------------------------
// Meetings: action items and a short summary from the notes / transcript
// ---------------------------------------------------------------------------
export async function readMeeting(
  auth: AuthContext,
  m: { companyId: string; title: string; date: string; people: string[]; notes: string; transcript: string | null },
): Promise<{ summary: string; actions: { text: string; assigneeName: string | null; dueDate: string | null }[] }> {
  const access = await resolveAccess(auth, 'meetings', m.companyId);
  if (!access.ok) throw conflict(access.reason);
  const r = await callAi(auth, 'meetings', {
    system:
      'You take minutes for a construction company meeting. From the notes and transcript, list the action items (a specific task someone agreed to do) and write a short summary (3-6 sentences). ' +
      'For each action: who (use a name from the attendee list when you can tell), what (one clear sentence starting with a verb), and the due date as YYYY-MM-DD if one was said or implied ("by Friday" = the coming Friday after the meeting date), else null. Do not invent tasks.',
    content: [
      {
        type: 'text',
        text: `Meeting: ${m.title}\nDate: ${m.date}\nAttendees: ${m.people.join(', ') || '(not listed)'}\n\nNOTES BY STEP:\n${m.notes.slice(0, 60_000)}\n\nTRANSCRIPT:\n${(m.transcript ?? '(none)').slice(0, 120_000)}`,
      },
    ],
    tool: {
      name: 'minutes',
      description: 'The meeting summary and action items.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          actions: {
            type: 'array',
            items: { type: 'object', properties: { text: { type: 'string' }, assigneeName: { type: ['string', 'null'] }, dueDate: { type: ['string', 'null'] } }, required: ['text', 'assigneeName', 'dueDate'] },
          },
        },
        required: ['summary', 'actions'],
      },
    },
    maxTokens: 3000,
    companyId: m.companyId,
    summary: `Meeting: ${m.title}`,
  });
  const out = r.input as { summary?: string; actions?: { text: string; assigneeName: string | null; dueDate: string | null }[] };
  return {
    summary: String(out.summary ?? '').slice(0, 5000),
    actions: (out.actions ?? [])
      .filter((a) => a && typeof a.text === 'string' && a.text.trim())
      .slice(0, 60)
      .map((a) => ({ text: a.text.trim().slice(0, 500), assigneeName: a.assigneeName?.trim() || null, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate ?? '') ? a.dueDate : null })),
  };
}

/** A recorded piece of a meeting → text (null when speech-to-text isn't set up). */
export async function transcribeMeetingAudio(orgId: string, file: File): Promise<string | null> {
  const c = await config(orgId);
  if (c.sttProvider !== 'openai' || !c.sttKeyEncrypted) return null;
  return transcribeAudio(decrypt(c.sttKeyEncrypted), file, file.name || 'meeting.webm');
}

export async function canTranscribe(orgId: string) {
  const c = await config(orgId);
  return c.sttProvider === 'openai' && !!c.sttKeyEncrypted;
}

/** An order list in an unusual layout (as text) → draft rows. Used by the order-list import. */
export async function readOrderSheet(auth: AuthContext, sheetText: string, companyId: string | null) {
  const access = await resolveAccess(auth, 'order', companyId);
  if (!access.ok) throw conflict(access.reason);
  const r = await callAi(auth, 'order', {
    system:
      'You read a construction materials order list exported from a spreadsheet (cells separated by " | "). Extract only the material lines: description (with any part number), quantity, unit, cost code and required-on-site date (YYYY-MM-DD) when shown. Skip titles, headers, totals, notes and signatures. Never invent lines or quantities.',
    content: [{ type: 'text', text: sheetText.slice(0, 60_000) }],
    tool: {
      name: 'order_lines',
      description: 'The material lines on the order list.',
      input_schema: {
        type: 'object',
        properties: {
          lines: {
            type: 'array',
            items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'string' }, uom: { type: 'string' }, costCode: { type: 'string' }, requiredOnSite: { type: 'string' } }, required: ['description', 'quantity', 'uom', 'costCode', 'requiredOnSite'] },
          },
        },
        required: ['lines'],
      },
    },
    maxTokens: 6000,
    companyId,
    summary: 'Order list import',
  });
  const out = (r.input as { lines?: { description: string; quantity: string; uom: string; costCode: string; requiredOnSite: string }[] }).lines ?? [];
  return out
    .filter((l) => l.description?.trim())
    .slice(0, 500)
    .map((l) => ({
      description: l.description.trim().slice(0, 500),
      quantity: String(l.quantity ?? '').trim().slice(0, 30),
      uom: String(l.uom ?? '').trim().toUpperCase().slice(0, 20),
      costCode: String(l.costCode ?? '').trim().slice(0, 40),
      requiredOnSite: /^\d{4}-\d{2}-\d{2}$/.test(l.requiredOnSite ?? '') ? l.requiredOnSite : '',
    }));
}
