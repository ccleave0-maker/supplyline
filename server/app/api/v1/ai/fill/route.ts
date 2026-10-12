import { voiceFillInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { voiceFill } from '@/services/ai';

// What was said + what the screen allows → proposed changes (never saved here).
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => voiceFill(auth, await parseJson(req, voiceFillInput)),
});
