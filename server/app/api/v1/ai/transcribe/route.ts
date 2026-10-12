import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { transcribe } from '@/services/ai';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a file.');
    return transcribe(auth, f);
  },
});
