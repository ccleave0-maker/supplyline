import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { finishMeeting } from '@/services/meetings';

// Minutes PDF, emailed to the people there, filed to the network folder.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => finishMeeting(auth, params.id!, await parseJson(req, z.object({ email: z.boolean().default(true) }))),
});
