import { route } from '@/lib/http';
import { deleteConversation, getConversation } from '@/services/assistant';

export const { GET, DELETE, OPTIONS } = route({
  GET: async ({ auth, params }) => getConversation(auth, params.id!),
  DELETE: async ({ auth, params }) => deleteConversation(auth, params.id!),
});
