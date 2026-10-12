import { trailerInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { saveTrailer } from '@/services/loads';

export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => saveTrailer(auth, params.id!, await parseJson(req, trailerInput)),
});
