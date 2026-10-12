import { route } from '@/lib/http';
import { deleteQcDoc } from '@/services/project';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => {
    await deleteQcDoc(auth, params.id!);
    return { ok: true };
  },
});
