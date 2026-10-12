import { route } from '@/lib/http';
import { listConversations } from '@/services/assistant';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => listConversations(auth),
});
