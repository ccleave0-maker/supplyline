import { qcDocInput } from '@supplyline/core/models';
import { parseForm, route } from '@/lib/http';
import { listQcDocs, uploadQcDoc } from '@/services/project';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, params, url }) => listQcDocs(auth, params.id!, url.searchParams.get('q') ?? undefined),
  POST: async ({ req, auth, params }) => {
    const { data, file } = await parseForm(req, qcDocInput, { fileRequired: true });
    return uploadQcDoc(auth, params.id!, data, file!);
  },
});
