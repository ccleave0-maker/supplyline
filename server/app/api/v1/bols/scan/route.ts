import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { scanDocument } from '@/services/scan';

// A photo of a BOL (site receiving): reads the QR code, or the BOL number.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw badRequest('Take or choose a photo.');
    return scanDocument(auth, file, 'site');
  },
});
