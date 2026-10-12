import { badRequest, unauthorized } from '@/lib/errors';
import { route } from '@/lib/http';
import { deviceFromRequest, syncApUpload } from '@/services/filing';

async function device(req: Request) {
  const d = await deviceFromRequest(req);
  if (!d) throw unauthorized('This Sync app key is not valid (it may have been removed in Admin › Network filing).');
  return d;
}

// A new invoice the Sync app found in a company's AP inbox folder.
export const { POST, OPTIONS } = route({
  POST: {
    public: true,
    handler: async ({ req }) => {
      const d = await device(req);
      const form = await req.formData().catch(() => null);
      const f = form?.get('file');
      const companyId = String(form?.get('companyId') ?? '');
      const sourcePath = String(form?.get('sourcePath') ?? '');
      if (!(f instanceof File) || f.size === 0 || !companyId || !sourcePath) throw badRequest('Send file, companyId and sourcePath.');
      if (f.size > 30 * 1_048_576) throw badRequest('That file is over 30 MB.');
      return syncApUpload(d.organizationId, companyId, sourcePath, f);
    },
  },
});
