import { IMPORT_DATASETS, type ImportDataset } from '@supplyline/core/models';
import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { previewImportSheet } from '@/services/imports';

// Read a CSV / Excel sheet so the columns can be matched up before importing.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, url }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    const dataset = url.searchParams.get('dataset') ?? '';
    if (!(dataset in IMPORT_DATASETS)) throw badRequest('Pick what you are importing.');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a file to upload.');
    return previewImportSheet(auth, dataset as ImportDataset, f);
  },
});
