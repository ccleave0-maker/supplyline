import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { setPriority } from '@/services/board';

export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => setPriority(auth, params.id!, (await parseJson(req, z.object({ priority: z.enum(['EMERGENCY', 'HIGH', 'NORMAL', 'ANYTIME']) }))).priority),
});
