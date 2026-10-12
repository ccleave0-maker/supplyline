import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { addRentalFile } from '@/services/project';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a file to upload.');
    return addRentalFile(auth, params.id!, f);
  },
});
