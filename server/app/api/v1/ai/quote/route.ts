import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { readQuote } from '@/services/ai';

// A quote (PDF / photo) → PO lines to review.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, url }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a file.');
    return readQuote(auth, f, url.searchParams.get('companyId'));
  },
});
