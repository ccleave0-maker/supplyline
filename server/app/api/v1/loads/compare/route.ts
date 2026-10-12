import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { compareTrailers } from '@/services/loads';

// How many loads it takes on each trailer in the library.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => compareTrailers(auth, (await parseJson(req, z.object({ items: z.array(z.object({ key: z.string().min(1).max(80), qty: z.number().positive() })).min(1).max(500) }))).items),
});
