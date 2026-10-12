import { route } from '@/lib/http';
import { deleteNickname } from '@/services/assistant';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => deleteNickname(auth, params.id!),
});
