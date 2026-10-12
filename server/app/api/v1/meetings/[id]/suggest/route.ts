import { route } from '@/lib/http';
import { suggestActions } from '@/services/meetings';

// The AI reads the notes + transcript: a summary and suggested action items.
export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => suggestActions(auth, params.id!),
});
