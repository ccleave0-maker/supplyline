import { route } from '@/lib/http';
import { deleteCompliance } from '@/services/project';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => deleteCompliance(auth, params.id!),
});
