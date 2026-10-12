import { route } from '@/lib/http';
import { sendArInvoice } from '@/services/accounting';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    return sendArInvoice(auth, params.id!, { email: body.email === true });
  },
});
