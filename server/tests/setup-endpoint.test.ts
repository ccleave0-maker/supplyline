import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { POST } from '../app/api/setup/route';
import { db } from '../src/lib/db';
import { makeOrg } from './helpers';

afterAll(() => db.$disconnect());
afterEach(() => {
  delete process.env.SETUP_TOKEN;
});

const call = (token?: string) =>
  POST(new Request('http://x/api/setup', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify({}) }));

// The one-time hosted setup can't be used to take over a server that's already running.
describe('one-time setup endpoint', () => {
  it('is hidden unless SETUP_TOKEN is set and matches', async () => {
    expect((await call('x'.repeat(40))).status).toBe(404);
    process.env.SETUP_TOKEN = 'short';
    expect((await call('short')).status).toBe(404);
    process.env.SETUP_TOKEN = 'a'.repeat(40);
    expect((await call('b'.repeat(40))).status).toBe(404);
  });
  it('refuses once any organization exists', async () => {
    await makeOrg();
    process.env.SETUP_TOKEN = 'a'.repeat(40);
    expect((await call('a'.repeat(40))).status).toBe(409);
  });
});
