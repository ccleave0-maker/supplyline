import { clientErrorInput } from '@supplyline/core/models';
import { authenticate } from '@/lib/auth';
import { clientIp, parseJson, route } from '@/lib/http';
import { allowClientReport, listErrors, recordError } from '@/services/errors';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listErrors(auth, { includeResolved: url.searchParams.get('all') === '1' }),
  // The apps report crashes here (signed in or not).
  POST: {
    public: true,
    handler: async ({ req }) => {
      const auth = await authenticate(req).catch(() => null);
      if (!allowClientReport(auth?.userId ?? clientIp(req) ?? 'anon')) return { ok: true };
      const b = await parseJson(req, clientErrorInput);
      await recordError({ source: 'CLIENT', message: b.message, stack: b.stack, path: b.path, organizationId: auth?.orgId, userId: auth?.userId, app: req.headers.get('x-client-app'), version: req.headers.get('x-client-version') });
      return { ok: true };
    },
  },
});
