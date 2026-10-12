import { suggestionFeedbackInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { recordSuggestion } from '@/services/suggestions';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => recordSuggestion(auth, await parseJson(req, suggestionFeedbackInput)),
});
