import { rentalInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createRental, listRentals } from '@/services/project';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, params }) => listRentals(auth, params.id!),
  POST: async ({ req, auth, params }) => createRental(auth, params.id!, await parseJson(req, rentalInput)),
});
