import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { importOrderSheet } from '@/services/order-import';

// Your own order list (Excel / CSV, any layout) → rows for the draft grid.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a file.');
    return importOrderSheet(auth, params.id!, f);
  },
});
