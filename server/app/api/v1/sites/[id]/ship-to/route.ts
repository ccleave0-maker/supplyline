import { route } from '@/lib/http';
import { shipToOptions } from '@/services/locations';

// Where a PO for this job can ship to: the job, its extra ship-tos, the yards.
export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => shipToOptions(auth, params.id!),
});
