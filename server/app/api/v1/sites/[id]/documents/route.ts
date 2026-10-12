import { z } from 'zod';
import { parseForm, route } from '@/lib/http';
import { addProjectDocument, listProjectDocuments } from '@/services/project-docs';

// The job's documents (drawings, subcontract agreement…), picked per PO.
export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, params }) => listProjectDocuments(auth, params.id!),
  POST: async ({ req, auth, params }) => {
    const { data, file } = await parseForm(req, z.object({ linkName: z.string().trim().max(120).nullish() }), { fileRequired: true });
    return addProjectDocument(auth, params.id!, file!, data.linkName ?? null);
  },
});
