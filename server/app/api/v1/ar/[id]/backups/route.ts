import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { addArBackup } from '@/services/accounting';

// A backup document for this customer invoice (filed to the network folder too).
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a file.');
    return addArBackup(auth, params.id!, f);
  },
});
