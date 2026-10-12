import { outboxEditInput } from '@supplyline/core/models';
import { route } from '@/lib/http';
import { sendOutbox } from '@/services/mail';

// Optional body: the edited email to send.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const text = await req.text();
    return sendOutbox(auth, params.id!, text ? outboxEditInput.parse(JSON.parse(text)) : undefined);
  },
});
