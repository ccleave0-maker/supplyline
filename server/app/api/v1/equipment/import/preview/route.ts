import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { previewSheet } from '@/services/equipment';

// Read a CSV / Excel sheet so the columns can be matched up before importing.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a file to upload.');
    return previewSheet(auth, f);
  },
});
