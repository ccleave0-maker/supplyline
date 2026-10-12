import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { scanDocument } from '@/services/scan';

// A photo of delivery papers (yard receiving): finds the PO / order / BOL it belongs to.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw badRequest('Take or choose a photo.');
    return scanDocument(auth, file, 'yard');
  },
});
