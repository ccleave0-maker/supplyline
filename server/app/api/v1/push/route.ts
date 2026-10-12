import { z } from 'zod';
import { pushSubscriptionInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { registerPush, unregisterPush } from '@/services/push';

export const { POST, DELETE, OPTIONS } = route({
  POST: async ({ req, auth }) => registerPush(auth, await parseJson(req, pushSubscriptionInput), req.headers.get('x-client-version') ?? undefined),
  DELETE: async ({ req, auth }) => unregisterPush(auth, (await parseJson(req, z.object({ endpoint: z.string().max(2000) }))).endpoint),
});
