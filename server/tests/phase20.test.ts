import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ASSISTANT, emptyDraftRow } from '@supplyline/core/models';
import { setClaudeForTests, type ClaudeToolCall } from '../src/integrations/claude';
import { db } from '../src/lib/db';
import { saveAiSettings } from '../src/services/ai';
import { answerAction, ask, blockedBy, listNicknames, pruneAssistant, saveAssistantSettings, saveNickname } from '../src/services/assistant';
import { createDraft, saveDraft, submitOrder } from '../src/services/orders';
import { createPo } from '../src/services/purchasing';
import { insights, poDefaults, recordSuggestion, suggestItems } from '../src/services/suggestions';
import { makeOrg, makeUser, uid } from './helpers';

afterAll(() => db.$disconnect());
afterEach(() => setClaudeForTests(null));

async function setup() {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  await saveAiSettings(admin, { enabled: true, model: 'claude-sonnet-5-5', apiKey: 'sk-ant-api03-test-key-abcdefghijklmnopqrstuvwxyz1234', monthlyCapCad: null, usdToCad: 1.37, priceInputUsdPerM: 3, priceOutputUsdPerM: 15, sttProvider: 'none' });
  return { ...o, admin, buyer, site };
}

/** Script Claude's answers, one per call; keeps what it was sent. */
function script(...answers: Record<string, unknown>[]) {
  const calls: ClaudeToolCall[] = [];
  setClaudeForTests(async (c) => {
    calls.push(c);
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return { input: { lookup: null, action: null, navigate: null, links: [], unanswered: false, ...a }, inputTokens: 10, outputTokens: 10 };
  });
  return calls;
}
const allText = (c: ClaudeToolCall) => c.content.map((x) => (x.type === 'text' ? x.text : '')).join('\n');

describe('assistant', () => {
  it('looks things up with the person’s own access, then answers', async () => {
    const s = await setup();
    const { id } = await createDraft(s.site, s.jobA.id);
    await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('SS'), description: 'Rebar 20M', quantity: '12', uom: 'EA' }] });
    await submitOrder(s.site, id);
    const calls = script({ reply: '', lookup: { kind: 'job_materials', siteId: s.jobA.id } }, { reply: '12 Rebar 20M are ordered and haven’t arrived yet.' });
    const r = await ask(s.site, { text: 'where is the rebar for my job?' });
    expect(calls).toHaveLength(2);
    expect(allText(calls[0]!)).toContain(s.jobA.jobNumber); // their job is in the context
    expect(allText(calls[1]!)).toMatch(/Lookup 1 \(job_materials\)[\s\S]*Rebar 20M/);
    expect(r.messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
    expect(r.messages[1]!.text).toMatch(/haven’t arrived/);
  });

  it('only changes things after “yes”, and only allowed actions', async () => {
    const s = await setup();
    await saveAssistantSettings(s.admin, { ...DEFAULT_ASSISTANT, autoDo: 'never' });
    script({ reply: 'Add 5 rolls of tie wire to JOB A?', action: { type: 'add_to_order', params: { siteId: s.jobA.id, lines: [{ description: 'Tie wire', quantity: 5, uom: 'roll' }] }, confirm: 'Add 5 ROLL tie wire to your draft list' } });
    const first = await ask(s.site, { text: 'need 5 rolls of tie wire on the bridge job' });
    const offer = first.messages[1]!;
    expect(offer.actionStatus).toBe('PROPOSED');
    expect(await db.orderForm.count({ where: { siteId: s.jobA.id, createdById: s.site.userId } })).toBe(0); // nothing yet

    // Someone else can't say yes for them.
    await expect(answerAction(s.buyer, offer.id, true)).rejects.toThrow(/not found/i);
    // Saying "yes" in the conversation does it.
    const yes = await ask(s.site, { conversationId: first.conversationId, text: 'yes' });
    expect(yes.messages[1]!.text).toMatch(/Added 1 line/);
    const draft = await db.orderForm.findFirstOrThrow({ where: { siteId: s.jobA.id, createdById: s.site.userId, status: 'DRAFT' } });
    expect(draft.draftRows).toEqual([expect.objectContaining({ description: 'Tie wire', quantity: '5', uom: 'ROLL' })]);
    await expect(answerAction(s.site, offer.id, true)).rejects.toThrow(/already answered/);

    // Admin turns that action off: offers are dropped.
    await saveAssistantSettings(s.admin, { ...DEFAULT_ASSISTANT, autoDo: 'never', allowedActions: ['remember_nickname'] });
    const calls = script({ reply: 'Adding it.', action: { type: 'add_to_order', params: { siteId: s.jobA.id, lines: [{ description: 'Nails', quantity: 1, uom: 'BOX' }] }, confirm: 'Add nails' } });
    const r = await ask(s.site, { text: 'add a box of nails' });
    expect(r.messages[1]!.action).toBeNull();
    expect(JSON.stringify(calls[0]!.tool.input_schema)).not.toContain('"add_to_order"]');
  });

  it('blocked topics never reach the AI; daily limit; turned off', async () => {
    const s = await setup();
    expect(blockedBy('What are the Payroll numbers?', 'salaries\npayroll')).toBe('payroll');
    await saveAssistantSettings(s.admin, { ...DEFAULT_ASSISTANT, blockedTopics: 'payroll', dailyLimitPerUser: 2 });
    const calls = script({ reply: 'hi' });
    const r = await ask(s.site, { text: 'show me payroll' });
    expect(calls).toHaveLength(0);
    expect(r.messages[1]!.text).toMatch(/turned that topic off/);
    await ask(s.site, { text: 'hello' });
    await expect(ask(s.site, { text: 'again' })).rejects.toThrow(/today’s limit/);
    await saveAssistantSettings(s.admin, { ...DEFAULT_ASSISTANT, enabled: false });
    await expect(ask(s.buyer, { text: 'hello' })).rejects.toThrow(/turned off/);
  });

  it('remembers nicknames (shared ones need an admin by default) and uses them', async () => {
    const s = await setup();
    await expect(saveNickname(s.site, { phrase: 'the bridge', kind: 'SITE', targetId: s.jobA.id, targetLabel: `JOB#${s.jobA.jobNumber}`, shared: true })).rejects.toThrow(/Only an admin/);
    await saveNickname(s.site, { phrase: 'the bridge', kind: 'SITE', targetId: s.jobA.id, targetLabel: `JOB#${s.jobA.jobNumber}`, shared: false });
    await saveNickname(s.admin, { phrase: 'north yard', kind: 'SITE', targetId: s.yard.id, targetLabel: 'Shared Yard', shared: true });
    expect((await listNicknames(s.site)).map((n) => [n.phrase, n.shared])).toEqual([['north yard', true], ['the bridge', false]]);
    expect((await listNicknames(s.buyer)).map((n) => n.phrase)).toEqual(['north yard']); // private ones stay private
    const calls = script({ reply: 'ok' });
    await ask(s.site, { text: 'anything coming to the bridge?' });
    expect(allText(calls[0]!)).toContain('"the bridge" → SITE');

    // The assistant can offer to remember one; a non-admin's "for everyone" becomes "just for you".
    script({ reply: 'Remember it?', action: { type: 'remember_nickname', params: { phrase: 'Pier job', kind: 'SITE', targetId: s.jobA.id, targetLabel: 'JOB A', shared: true }, confirm: 'Remember “pier job” = JOB A' } });
    const r = await ask(s.site, { text: 'pier job means job A' });
    expect(r.messages[1]!.actionStatus).toBe('DONE'); // drafts are made straight away
    expect(r.messages[1]!.actionResult?.message).toMatch(/just for you/);
  });

  it('old conversations are deleted after the keep period', async () => {
    const s = await setup();
    script({ reply: 'hi' });
    const r = await ask(s.site, { text: 'hello' });
    await db.assistantConversation.update({ where: { id: r.conversationId }, data: { updatedAt: new Date(Date.now() - 200 * 86_400_000) } });
    await pruneAssistant();
    expect(await db.assistantConversation.count({ where: { id: r.conversationId } })).toBe(0);
  });
});

describe('suggestions', () => {
  it('suggests items from this job first and learns from changes', async () => {
    const s = await setup();
    const { id } = await createDraft(s.site, s.jobA.id);
    const word = `Zq${uid().slice(0, 5)}`;
    await saveDraft(s.site, id, { rows: [{ ...emptyDraftRow('SS'), description: `${word} rebar 20M`, quantity: '1', uom: 'EA' }, { ...emptyDraftRow('SS'), description: `${word} rebar 15M`, quantity: '1', uom: 'EA' }] });
    await submitOrder(s.site, id);
    const first = await suggestItems(s.site, { q: word, siteId: s.jobA.id });
    expect(first.map((x) => x.description).sort()).toEqual([`${word} rebar 15M`, `${word} rebar 20M`]);
    for (let i = 0; i < 2; i++) await recordSuggestion(s.site, { kind: 'ITEM', contextKey: '', value: `${word} rebar 15M`, accepted: false });
    const after = await suggestItems(s.site, { q: word, siteId: s.jobA.id });
    expect(after.map((x) => x.description)).toEqual([`${word} rebar 20M`]); // changed twice → dropped
  });

  it('defaults a PO to the yard this person usually uses', async () => {
    const s = await setup();
    for (let i = 0; i < 2; i++) await createPo(s.buyer, { companyId: s.a.id, poNumber: `P-${uid()}`, vendorName: 'Coastal Steel', siteId: s.jobA.id, deliverToYardId: s.yard.id, lines: [{ description: 'Pile', qty: 1, uom: 'EA', unitCost: 1 }] });
    expect((await poDefaults(s.buyer, { companyId: s.a.id })).deliverToYardId).toBe(s.yard.id);
    expect((await poDefaults(s.admin, { companyId: s.a.id })).deliverToYardId).toBeNull(); // per person
  });

  it('insights are for admins only and never use other customers’ data', async () => {
    const s = await setup();
    await expect(insights(s.buyer)).rejects.toThrow(/admins/);
    const v = await insights(s.admin);
    expect(v.crossCustomerLearning).toBe(false);
    expect(v.cards.map((c) => c.key)).toEqual(['top-items', 'off-list', 'problems', 'late', 'defaults', 'assistant']);
  });
});

describe('assistant makes things', () => {
  it('makes a draft PO straight away from one sentence, and opens it', async () => {
    const s = await setup();
    const calls = script({
      reply: 'Making a draft PO for Northern Metallic.',
      action: { type: 'create_po', params: { vendorName: 'Northern Metallic', siteId: s.jobA.id, lines: [{ description: 'Chainsaw', qty: '3', uom: 'each', unitCost: '$1,200', costCode: '1000-0065' }] }, confirm: 'Make draft PO' },
    });
    const r = await ask(s.buyer, { text: 'make a PO for Northern Metallic, 3 chainsaws at 1200 each, job A, cost code 1000-0065' });
    expect(JSON.stringify(calls[0]!.tool.input_schema)).toContain('create_po');
    const m = r.messages[1]!;
    expect(m.actionStatus).toBe('DONE');
    expect(m.actionResult?.message).toMatch(/Made draft PO .* Northern Metallic — 1 line/);
    expect(r.navigate).toMatch(/^\/purchase-orders\/edit\/\?id=/);
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { siteId: s.jobA.id, vendor: { name: 'Northern Metallic' } }, include: { lines: true } });
    expect(po.status).toBe('DRAFT');
    expect(po.lines[0]).toMatchObject({ description: 'Chainsaw', uom: 'EACH', costCode: '1000-0065' });
    expect(Number(po.lines[0]!.qty)).toBe(3);
    expect(Number(po.lines[0]!.unitCost)).toBe(1200);
  });

  it('issuing still waits for Yes; site users can’t make POs', async () => {
    const s = await setup();
    script({ reply: 'Issue it?', action: { type: 'issue_po', params: { poId: 'x', emailVendor: true }, confirm: 'Issue PO and email vendor' } });
    const r = await ask(s.buyer, { text: 'issue it' });
    expect(r.messages[1]!.actionStatus).toBe('PROPOSED');
    const calls = script({ reply: 'ok' });
    await ask(s.site, { text: 'make a PO' });
    expect(JSON.stringify(calls[0]!.tool.input_schema)).not.toContain('create_po');
  });
});
