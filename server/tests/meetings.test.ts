import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_FILING, STARTER_7030_TEMPLATE } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { setClaudeForTests } from '../src/integrations/claude';
import { saveAiSettings } from '../src/services/ai';
import { listFilingJobs, saveFilingSettings } from '../src/services/filing';
import { addAction, addMeetingAudio, createMeeting, finishMeeting, getMeeting, listActions, listMeetings, listTemplates, meetingPeople, saveTemplate, suggestActions, updateAction, updateMeeting } from '../src/services/meetings';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());
afterEach(() => setClaudeForTests(null));

async function setup() {
  const o = await makeOrg();
  const { auth: admin } = await makeUser(o.org.id, ['ADMIN'], null);
  const { auth: pm, user: pmUser } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: foreman, user: foremanUser } = await makeUser(o.org.id, ['SITE'], o.a.id, [o.jobA.id]);
  const { auth: other } = await makeUser(o.org.id, ['SITE'], o.b.id, [o.jobB.id]);
  await db.user.update({ where: { id: pmUser.id }, data: { name: 'Pat Morgan' } });
  await db.user.update({ where: { id: foremanUser.id }, data: { name: 'Sam Reyes' } });
  return { ...o, admin, pm, foreman, other, pmUser, foremanUser };
}

const aiOn = (admin: Parameters<typeof saveAiSettings>[0], stt = false) =>
  saveAiSettings(admin, { enabled: true, model: 'claude-sonnet-5-5', apiKey: 'sk-ant-api03-test-key-abcdefghijklmnopqrstuvwxyz1234', monthlyCapCad: null, usdToCad: 1.37, priceInputUsdPerM: 3, priceOutputUsdPerM: 15, sttProvider: stt ? 'openai' : 'none', ...(stt ? { sttKey: 'sk-test-openai-key-1234567890' } : {}) });

describe('meetings', () => {
  it('starts every organization with the 70-30 starter template; admins can change it', async () => {
    const s = await setup();
    const t = await listTemplates(s.pm);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ name: STARTER_7030_TEMPLATE.name, isDefault: true, starter: true });
    expect(t[0]!.steps.map((x) => x.key)).toContain('lookahead');
    await expect(saveTemplate(s.pm, null, { name: 'Mine', steps: [{ key: 'a', title: 'A', prompt: '', minutes: null, kind: 'NOTES', items: [] }], isDefault: false })).rejects.toThrow(/permission|access/i);
    const mine = await saveTemplate(s.admin, null, { name: 'Our 70-30', steps: [{ key: 'a', title: 'Look ahead', prompt: '', minutes: 20, kind: 'NOTES', items: [] }], isDefault: true });
    const after = await listTemplates(s.pm);
    expect(after.find((x) => x.isDefault)!.id).toBe(mine.id); // only one default
    await expect(saveTemplate(s.admin, null, { name: 'Dup', steps: [{ key: 'a', title: 'A', prompt: '', minutes: null, kind: 'NOTES', items: [] }, { key: 'a', title: 'B', prompt: '', minutes: null, kind: 'NOTES', items: [] }], isDefault: false })).rejects.toThrow(/same key/);
  });

  it('runs a job meeting step by step, with action items, recording and AI suggestions, then minutes', async () => {
    const s = await setup();
    const root = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'sl-meet-'));
    await saveFilingSettings(s.admin, s.a.id, { ...DEFAULT_FILING, enabled: true, root });
    const people = await meetingPeople(s.pm, { siteId: s.jobA.id });
    expect(people.map((p) => p.name).sort()).toEqual(['Pat Morgan', 'Sam Reyes']);

    const m = await createMeeting(s.pm, {
      companyId: s.a.id,
      siteId: s.jobA.id,
      title: 'Job 2249 weekly 70-30',
      attendees: [
        { userId: s.pmUser.id, name: 'Pat Morgan', email: null, present: true },
        { userId: s.foremanUser.id, name: 'Sam Reyes', email: null, present: true },
        { name: 'Owner rep', email: 'rep@client.example', present: true },
      ],
    });
    expect(m.status).toBe('PLANNED');
    expect(m.templateName).toBe(STARTER_7030_TEMPLATE.name);
    expect(m.steps.find((x) => x.key === 'readiness')!.items).toHaveLength(5);
    await expect(getMeeting(s.other, m.id)).rejects.toThrow(/not found/i); // other company's job

    const u = await updateMeeting(s.pm, m.id, {
      currentStep: 3,
      steps: [
        { key: 'lookahead', notes: 'Pile driving starts Monday. Sam to book the crane by Friday.', checked: [] },
        { key: 'readiness', notes: '', checked: ['Materials ordered', 'Not an item'] },
      ],
    });
    expect(u.status).toBe('IN_PROGRESS');
    expect(u.steps.find((x) => x.key === 'readiness')!.checked).toEqual(['Materials ordered']);

    // A recorded piece is kept; with speech-to-text set up it becomes transcript.
    await aiOn(s.admin, true);
    setClaudeForTests(null, async () => 'Pat will send the revised drawings to the owner by Wednesday.');
    const audio = new File([new Uint8Array([26, 69, 223, 163, 1, 2, 3])], 'part-1.webm', { type: 'audio/webm' });
    expect(await addMeetingAudio(s.pm, m.id, audio)).toMatchObject({ transcribed: true });
    let d = await getMeeting(s.pm, m.id);
    expect(d.audio).toHaveLength(1);
    expect(d.transcript).toMatch(/revised drawings/);
    expect(d.canTranscribe).toBe(true);

    // AI suggests action items, matched to the people there; nothing is saved until accepted.
    setClaudeForTests(async () => ({
      input: {
        summary: 'Piling starts Monday; crane and drawings needed.',
        actions: [
          { text: 'Book the crane for pile driving', assigneeName: 'Sam', dueDate: '2026-10-16' },
          { text: 'Send revised drawings to the owner', assigneeName: 'Pat Morgan', dueDate: '2026-10-14' },
          { text: 'Confirm survey', assigneeName: 'Unknown person', dueDate: 'next week' },
        ],
      },
      inputTokens: 100,
      outputTokens: 50,
    }));
    const sug = await suggestActions(s.pm, m.id);
    expect(sug.summary).toMatch(/Piling/);
    expect(sug.suggestions.map((x) => [x.assigneeUserId, x.dueDate])).toEqual([
      [s.foremanUser.id, '2026-10-16'],
      [s.pmUser.id, '2026-10-14'],
      [null, null],
    ]);
    expect((await getMeeting(s.pm, m.id)).actions).toHaveLength(0);

    const a1 = await addAction(s.pm, m.id, { text: sug.suggestions[0]!.text, assigneeUserId: sug.suggestions[0]!.assigneeUserId, dueDate: '2026-10-16', stepKey: 'lookahead' }, 'AI');
    await addAction(s.pm, m.id, { text: 'Order more tie wire', assigneeName: 'Yard', dueDate: '2020-01-01' });
    // Sam was told (in-app); Sam sees it under their own action items.
    expect(await db.notification.count({ where: { userId: s.foremanUser.id, type: 'action_item' } })).toBe(1);
    const mine = await listActions(s.foreman, { mine: true });
    expect(mine.map((x) => x.text)).toEqual(['Book the crane for pile driving']);
    expect((await listActions(s.pm, {})).find((x) => x.text === 'Order more tie wire')!.overdue).toBe(true);

    // Minutes: PDF, email to everyone there, filed to the job's Meetings folder.
    await updateMeeting(s.pm, m.id, { summary: sug.summary });
    const done = await finishMeeting(s.pm, m.id, { email: true });
    expect(done.status).toBe('DONE');
    expect(done.pdfUrl).toMatch(/\/api\/v1\/files\//);
    expect(done.emailed).toBe(3);
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { relatedId: m.id } });
    expect(mail.subject).toMatch(/^Minutes: Job 2249 weekly 70-30/);
    expect((await listFilingJobs(s.admin, 'pending')).map((j) => j.relativePath)).toEqual([expect.stringMatching(/^AAA\/Jobs\/2249 Job A\/Meetings\/Minutes-Job-2249-weekly-70-30-.+\.pdf$/)]);

    // The assignee marks it done; it carries over to the next meeting until then.
    const next = await createMeeting(s.pm, { companyId: s.a.id, siteId: s.jobA.id, title: 'Next week', attendees: [] });
    expect(next.carriedOver.map((x) => x.text).sort()).toEqual(['Book the crane for pile driving', 'Order more tie wire']);
    await updateAction(s.foreman, a1.id, { status: 'DONE' });
    expect((await getMeeting(s.pm, next.id)).carriedOver.map((x) => x.text)).toEqual(['Order more tie wire']);
    expect((await listMeetings(s.pm, { siteId: s.jobA.id })).map((x) => x.title).sort()).toEqual(['Job 2249 weekly 70-30', 'Next week']);
    expect(await listMeetings(s.other)).toEqual([]);
  });

  it('asks for notes before the AI reads, and says when AI is off', async () => {
    const s = await setup();
    const m = await createMeeting(s.pm, { companyId: s.a.id, siteId: s.jobA.id, title: 'Empty', attendees: [] });
    await expect(suggestActions(s.pm, m.id)).rejects.toThrow(/no notes/);
    await updateMeeting(s.pm, m.id, { steps: [{ key: 'issues', notes: 'Fence is down', checked: [] }] });
    await expect(suggestActions(s.pm, m.id)).rejects.toThrow(/turned off/);
    // Without speech-to-text, recordings are still kept.
    const r = await addMeetingAudio(s.pm, m.id, new File([new Uint8Array([1, 2, 3])], 'p.webm', { type: 'audio/webm' }));
    expect(r).toEqual({ transcribed: false, text: null });
    expect((await getMeeting(s.pm, m.id)).audio).toHaveLength(1);
  });
});
