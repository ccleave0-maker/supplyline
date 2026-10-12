import QRCode from 'qrcode';
import sharp from 'sharp';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { qrPayload } from '@supplyline/core/domain';
import type { VoiceFillInput } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { setClaudeForTests, type ClaudeToolCall } from '../src/integrations/claude';
import { aiStatus, getAiSettings, readQuote, saveAiSettings, saveToggles, transcribe, voiceFill, voiceNavigate } from '../src/services/ai';
import { createPo, issuePo } from '../src/services/purchasing';
import { scanDocument } from '../src/services/scan';
import { makeOrg, makeUser, uid } from './helpers';

process.env.PLATFORM_ANTHROPIC_API_KEY = 'sk-ant-platform-key-for-tests-0000000000';
afterAll(() => db.$disconnect());
afterEach(() => setClaudeForTests(null));

const KEY = 'sk-ant-api03-test-key-abcdefghijklmnopqrstuvwxyz1234';
const settings = (over = {}) => ({ enabled: true, model: 'claude-sonnet-5-5', apiKey: KEY, monthlyCapCad: null, usdToCad: 1.37, priceInputUsdPerM: 3, priceOutputUsdPerM: 15, sttProvider: 'none' as const, ...over });
/** Pretend Claude: returns this answer and counts tokens. */
function fakeClaude(answer: unknown, seen: ClaudeToolCall[] = []) {
  setClaudeForTests(async (c) => {
    seen.push(c);
    return { input: answer, inputTokens: 1000, outputTokens: 200 };
  });
  return seen;
}

const orderSchema = (): VoiceFillInput['schema'] => ({
  screen: 'order',
  title: 'Order list',
  fields: [{ key: 'notes', label: 'Notes', type: 'text' }],
  rows: {
    label: 'lines',
    canAdd: true,
    canRemove: true,
    fields: [
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'quantity', label: 'Qty', type: 'number' },
      { key: 'uom', label: 'Unit', type: 'text' },
    ],
  },
});

async function setup() {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: yard } = await makeUser(o.org.id, ['YARD'], o.a.id, [o.yard.id]);
  const { auth: buyer } = await makeUser(o.org.id, ['PROCUREMENT'], o.a.id);
  return { ...o, yardSite: o.yard, admin, site, yard, buyer };
}

describe('AI settings, switches, costs and caps', () => {
  it('keeps the key encrypted and masked; nothing works until it is set up', async () => {
    const s = await setup();
    expect((await aiStatus(s.site)).available).toBe(false);
    await expect(voiceFill(s.site, { transcript: 'x', schema: orderSchema(), current: { values: {}, rows: [] } } as VoiceFillInput)).rejects.toThrow(/turned off/);
    await expect(saveAiSettings(s.admin, settings({ apiKey: 'not-a-key' }))).rejects.toThrow(/sk-ant/);
    const v = await saveAiSettings(s.admin, settings());
    expect(v.keyHint).toBe('sk-ant-…1234');
    const raw = await db.aiConfig.findUniqueOrThrow({ where: { organizationId: s.org.id } });
    expect(raw.apiKeyEncrypted).not.toContain('abcdefghijklmnop');
    expect((await aiStatus(s.site)).screens).toContain('order');
    await expect(getAiSettings(s.site)).rejects.toThrow(/access|permission/i);
  });

  it('fills an order list from speech, keeps only allowed fields, and logs the cost in CAD', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings());
    const seen = fakeClaude({
      set: { notes: 'Rush', secret: 'x' },
      rowOps: [
        { op: 'add', values: { description: '20M rebar 6m', quantity: 40, uom: 'EA', price: 9 } },
        { op: 'update', index: 0, values: { quantity: 50 } },
        { op: 'remove', index: 7 },
      ],
      summary: 'Added 20M rebar; line 1 to 50',
      question: null,
    });
    const r = await voiceFill(s.site, {
      transcript: 'add forty 20 mil rebar six metre and change line one to fifty, rush',
      schema: orderSchema(),
      current: { values: {}, rows: [{ description: 'Tie wire', quantity: 5, uom: 'ROLL' }] },
      siteId: s.jobA.id,
    } as VoiceFillInput);
    expect(r.set).toEqual({ notes: 'Rush' });
    expect(r.rowOps).toEqual([
      { op: 'add', values: { description: '20M rebar 6m', quantity: 40, uom: 'EA' } },
      { op: 'update', index: 0, values: { quantity: 50 } },
    ]);
    expect(seen[0]!.apiKey).toBe(KEY);
    expect(JSON.stringify(seen[0]!.content)).toContain('add forty 20 mil rebar');
    const log = await db.aiRequestLog.findFirstOrThrow({ where: { organizationId: s.org.id } });
    expect([Number(log.costCad), log.screen, log.summary, log.usedPlatformKey]).toEqual([0.0082, 'order', 'Added 20M rebar; line 1 to 50', false]);
  });

  it('switches: voice off for site users on order lists', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings());
    await saveToggles(s.admin, { toggles: [{ companyId: null, role: 'SITE', screen: 'order', enabled: false }] });
    fakeClaude({ set: {}, rowOps: [], summary: 'x', question: null });
    await expect(voiceFill(s.site, { transcript: 'add one', schema: orderSchema(), current: { values: {}, rows: [] } } as VoiceFillInput)).rejects.toThrow(/turned off for this screen/);
    expect((await aiStatus(s.site)).screens).not.toContain('order');
    expect((await aiStatus(s.yard)).screens).toContain('order');
  });

  it('stops at the monthly cap and emails admins', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings({ monthlyCapCad: 0.01 }));
    fakeClaude({ set: {}, rowOps: [], summary: 'ok', question: null });
    const input = { transcript: 'hi', schema: orderSchema(), current: { values: {}, rows: [] } } as VoiceFillInput;
    await voiceFill(s.site, input); // 0.0082 → over 80%
    await voiceFill(s.site, input); // 0.0164 → over 100%
    await expect(voiceFill(s.site, input)).rejects.toThrow(/cap/);
    const alerts = await db.emailOutbox.findMany({ where: { organizationId: s.org.id, relatedType: 'ai_cap' }, orderBy: { createdAt: 'asc' } });
    expect(alerts.map((a) => a.subject)).toEqual(["SupplyLine AI spending: 80% of this month's cap", "SupplyLine AI spending: 100% of this month's cap"]);
  });

  it('uses the platform key only when the owner allowed it', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings({ apiKey: undefined }));
    expect((await aiStatus(s.site)).reason).toMatch(/No Claude API key/);
    await db.organization.update({ where: { id: s.org.id }, data: { aiFallbackEnabled: true, aiFallbackMonthlyCapCad: 5 } });
    const seen = fakeClaude({ set: {}, rowOps: [], summary: 'ok', question: null });
    await voiceFill(s.site, { transcript: 'hi', schema: orderSchema(), current: { values: {}, rows: [] } } as VoiceFillInput);
    expect(seen[0]!.apiKey).toBe(process.env.PLATFORM_ANTHROPIC_API_KEY);
    expect((await db.aiRequestLog.findFirstOrThrow({ where: { organizationId: s.org.id } })).usedPlatformKey).toBe(true);
  });
});

describe('AI voice navigation, transcription and documents', () => {
  it('navigates only to app paths', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings());
    fakeClaude({ path: `/sites/view/?id=${s.jobA.id}`, summary: 'Opening job 2249', question: null });
    expect((await voiceNavigate(s.site, 'open job 2249', [{ path: '/sites/', label: 'Jobs' }])).navigate).toBe(`/sites/view/?id=${s.jobA.id}`);
    fakeClaude({ path: 'https://evil.example.com', summary: 'x', question: null });
    expect((await voiceNavigate(s.site, 'go', [])).navigate).toBeNull();
  });

  it('fills in the fields on whatever screen (or tab) the person is on', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings());
    const seen: ClaudeToolCall[] = [];
    const screen = {
      title: 'Rentals',
      path: '/sites/rentals/?id=x',
      fields: [
        { key: 'f0', label: 'Rental company', type: 'select' as const, value: '', options: [{ value: 'c1', label: 'Coast Rentals' }] },
        { key: 'f1', label: 'Off-rent date', type: 'date' as const, value: '' },
        { key: 'f2', label: 'Insured', type: 'checkbox' as const, value: false },
      ],
    };
    fakeClaude({ path: null, set: { f0: 'c1', f1: '2026-10-20', f2: true, f9: 'not on screen' }, summary: 'Set the rental', question: null }, seen);
    const r = await voiceNavigate(s.site, 'coast rentals, off rent the 20th, insured', [], screen);
    expect(r).toMatchObject({ navigate: null, question: null, set: { f0: 'c1', f1: '2026-10-20', f2: true } });
    expect(r.set).not.toHaveProperty('f9'); // only fields that are on the screen
    expect(JSON.stringify(seen[0]!.content)).toContain('f1 | Off-rent date | date');
    // Asking to go somewhere still navigates (and fills nothing).
    fakeClaude({ path: '/schedule/', set: { f0: 'c1' }, summary: 'Opening the schedule', question: null });
    expect(await voiceNavigate(s.site, 'show me the schedule', [{ path: '/schedule/', label: 'Schedule' }], screen)).toMatchObject({ navigate: '/schedule/', set: {} });
  });

  it('transcribes recorded audio when speech-to-text is set up', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings());
    const audio = new File([new Uint8Array([1, 2, 3])], 'speech.webm', { type: 'audio/webm' });
    await expect(transcribe(s.site, audio)).rejects.toThrow(/isn’t set up/);
    await saveAiSettings(s.admin, settings({ apiKey: undefined, sttProvider: 'openai', sttKey: 'sk-openai-test' }));
    setClaudeForTests(null, async (key) => (key === 'sk-openai-test' ? 'got four of five on line two' : 'wrong key'));
    expect(await transcribe(s.site, audio)).toEqual({ text: 'got four of five on line two' });
  });

  it('reads a quote into PO lines: qty, unit, description + part # only (no prices, no quote numbers)', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings());
    fakeClaude({
      vendorName: 'Coastal Steel',
      lines: [
        { description: 'HP 310x110 pile', partNumber: 'HP310-110', qty: 12, uom: 'ea', unitPrice: 845.5 },
        { description: 'Shoe plate SP-4', partNumber: 'SP-4', qty: 4, uom: 'EA' },
        { description: '', partNumber: null, qty: 3, uom: 'EA' },
        { description: 'Splice plate', partNumber: null, qty: 0, uom: 'EA' },
      ],
      notes: 'Freight not included',
    });
    const img = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const q = await readQuote(s.buyer, new File([new Uint8Array(img)], 'quote.png', { type: 'image/png' }), s.a.id);
    expect(q.lines).toEqual([
      { description: 'HP 310x110 pile — Part# HP310-110', qty: 12, uom: 'EA', unitPrice: null },
      { description: 'Shoe plate SP-4', qty: 4, uom: 'EA', unitPrice: null },
    ]);
    expect(q.notes).toBe('Freight not included');
    await expect(readQuote(s.site, new File([new Uint8Array(img)], 'q.png', { type: 'image/png' }), s.a.id)).rejects.toThrow(/access|permission/i);
  });

  it('yard: a packing slip photo finds the PO and reads how much came', async () => {
    const s = await setup();
    await saveAiSettings(s.admin, settings());
    const po = await issuePo(
      s.buyer,
      (
        await createPo(s.buyer, {
          companyId: s.a.id,
          poNumber: `S-${uid()}`,
          vendorName: 'Coastal Steel',
          siteId: s.jobA.id,
          deliverToYardId: s.yardSite.id,
          lines: [
            { description: 'Pipe pile', qty: 10, uom: 'EA', unitCost: 100 },
            { description: 'Splice plate', qty: 4, uom: 'EA', unitCost: 25 },
          ],
        })
      ).id,
    );
    const lineIds = (await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id }, orderBy: { lineNo: 'asc' } })).map((l) => l.id);
    fakeClaude({ lines: [{ poLineId: lineIds[0], qty: 8 }, { poLineId: 'made-up', qty: 1 }] });
    const qr = await QRCode.toBuffer(qrPayload({ kind: 'PO', id: po.id, label: `PO ${po.poNumber}` }), { type: 'png', margin: 1, width: 300 });
    const photo = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#f4f4f0' } }).composite([{ input: qr, left: 820, top: 100 }]).jpeg().toBuffer();
    const r = await scanDocument(s.yard, new File([new Uint8Array(photo)], 'slip.jpg', { type: 'image/jpeg' }), 'yard');
    expect(r.match?.query).toBe(po.poNumber);
    expect(r.slip).toEqual([{ poLineId: lineIds[0], description: 'Pipe pile', qty: 8 }]);
  });
});
