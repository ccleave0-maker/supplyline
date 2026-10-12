import { route } from '@/lib/http';
import { listTemplates } from '@/services/mail';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => listTemplates(auth, params.id!),
});
