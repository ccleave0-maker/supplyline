import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { setSitePstForm } from '@/services/sites';

export const { POST, DELETE, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a file to upload.');
    return setSitePstForm(auth, params.id!, f);
  },
  DELETE: async ({ auth, params }) => setSitePstForm(auth, params.id!, null),
});
