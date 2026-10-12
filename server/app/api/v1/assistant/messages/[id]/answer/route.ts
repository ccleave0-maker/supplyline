import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { answerAction } from '@/services/assistant';

// Yes / No to something the assistant offered to do.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => answerAction(auth, params.id!, (await parseJson(req, z.object({ yes: z.boolean() }))).yes),
});
