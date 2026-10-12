import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { removeProjectDocument, renameProjectDocument } from '@/services/project-docs';

export const { PATCH, DELETE, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => renameProjectDocument(auth, params.id!, (await parseJson(req, z.object({ linkName: z.string().trim().min(1).max(120) }))).linkName),
  DELETE: async ({ auth, params }) => removeProjectDocument(auth, params.id!),
});
