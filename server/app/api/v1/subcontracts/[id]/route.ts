import { route } from '@/lib/http';
import { deleteSubcontractDoc } from '@/services/project';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => {
    await deleteSubcontractDoc(auth, params.id!);
    return { ok: true };
  },
});
