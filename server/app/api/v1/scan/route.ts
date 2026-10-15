import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { scanAnything } from '@/services/scan';

// One Scan button: a photo of any Bowron QR code (BOL, PO, packing list, order list, equipment tag).
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw badRequest('Take or choose a photo.');
    return scanAnything(auth, file);
  },
});
