import { route } from '@/lib/http';
import { voidArInvoice } from '@/services/accounting';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => voidArInvoice(auth, params.id!),
});
