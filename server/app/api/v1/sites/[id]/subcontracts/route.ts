import { subcontractDocInput } from '@supplyline/core/models';
import { parseForm, route } from '@/lib/http';
import { listSubcontractDocs, uploadSubcontractDoc } from '@/services/project';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, params }) => listSubcontractDocs(auth, params.id!),
  POST: async ({ req, auth, params }) => {
    const { data, file } = await parseForm(req, subcontractDocInput, { fileRequired: true });
    return uploadSubcontractDoc(auth, params.id!, data, file!);
  },
});
