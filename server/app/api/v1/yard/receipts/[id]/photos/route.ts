import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { addReceiptPhoto } from '@/services/yard';

// POST multipart/form-data with a "file" field (one photo per request).
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw badRequest('Choose a photo to upload.');
    return addReceiptPhoto(auth, params.id!, file);
  },
});
