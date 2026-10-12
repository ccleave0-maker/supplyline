import { rentalInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteRental, updateRental } from '@/services/project';

export const { PATCH, DELETE, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => updateRental(auth, params.id!, await parseJson(req, rentalInput.partial())),
  DELETE: async ({ auth, params }) => {
    await deleteRental(auth, params.id!);
    return { ok: true };
  },
});
