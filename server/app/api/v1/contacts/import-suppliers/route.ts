import { z } from 'zod';
import { badRequest } from '@/lib/errors';
import { parseForm, route } from '@/lib/http';
import { importSuppliers, previewSuppliers } from '@/services/supplier-import';

// Supplier list (Excel / CSV, e.g. exported from Sage): ?preview=1 shows what was found, otherwise imports.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, url }) => {
    const { data, file } = await parseForm(req, z.object({ companyId: z.string().nullish() }), { fileRequired: true });
    if (url.searchParams.get('preview')) return previewSuppliers(auth, file!);
    if (!data.companyId) throw badRequest('Pick the company these suppliers are for.');
    return importSuppliers(auth, data.companyId, file!);
  },
});
