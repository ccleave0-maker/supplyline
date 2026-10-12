import { navigateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { voiceNavigate } from '@/services/ai';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const input = await parseJson(req, navigateInput);
    return voiceNavigate(auth, input.transcript, input.destinations, input.screen ?? null);
  },
});
