import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import { requestLog, tokenHistory, usage } from '../src/services/ai';
import { makeOrg, makeUser } from './helpers';

afterAll(() => db.$disconnect());

describe('AI token usage history', () => {
  it('keeps tokens per request and adds them up by day, model and feature, in CAD', async () => {
    const o = await makeOrg();
    const { auth: admin, user } = await makeUser(o.org.id, ['ADMIN'], null);
    const base = { organizationId: o.org.id, userId: user.id, kind: 'VOICE', usedPlatformKey: false };
    await db.aiRequestLog.createMany({
      data: [
        { ...base, screen: 'assistant', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 200, costCad: 0.0082 },
        { ...base, screen: 'assistant', model: 'claude-sonnet-5-5', inputTokens: 3000, outputTokens: 400, costCad: 0.0206 },
        { ...base, screen: 'invoiceScan', model: 'claude-haiku-4-5', inputTokens: 500, outputTokens: 0, costCad: 0, error: 'boom' },
      ],
    });
    const h = await tokenHistory(admin, 30);
    expect(h.totals).toMatchObject({ requests: 3, inputTokens: 4500, outputTokens: 600, costCad: 0.03 });
    expect(h.days[0]).toMatchObject({ requests: 3, failed: 1, inputTokens: 4500 });
    expect(h.byModel[0]).toMatchObject({ model: 'claude-sonnet-5-5', requests: 2, inputTokens: 4000 });
    expect(h.byScreen.map((s) => s.screen)).toContain('The assistant (ask in plain words)');
    expect((await requestLog(admin))[0]).toHaveProperty('inputTokens');
    expect((await usage(admin))[0]!.inputTokens).toBe(4500);
    const { auth: site } = await makeUser(o.org.id, ['SITE'], o.a.id);
    await expect(tokenHistory(site)).rejects.toThrow();
  });
});
