import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { addSiteReceiptPhoto } from '@/services/bols';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw badRequest('Take or choose a photo.');
    return addSiteReceiptPhoto(auth, params.id!, file);
  },
});
