import { trailerInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listTrailers, saveTrailer } from '@/services/loads';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listTrailers(auth, url.searchParams.get('all') === '1'),
  POST: async ({ req, auth }) => saveTrailer(auth, null, await parseJson(req, trailerInput)),
});
