import { lineSizeInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { setLineSize } from '@/services/loads';

// Optional size and weight (per unit) for the load builder.
export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => setLineSize(auth, params.id!, await parseJson(req, lineSizeInput)),
});
