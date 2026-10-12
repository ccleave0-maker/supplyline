import { locationInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteLocation, getLocation, updateLocation } from '@/services/locations';

export const { GET, PATCH, DELETE, OPTIONS } = route({
  GET: async ({ auth, params }) => getLocation(auth, params.id!),
  PATCH: async ({ req, auth, params }) => updateLocation(auth, params.id!, await parseJson(req, locationInput.partial())),
  DELETE: async ({ auth, params }) => {
    await deleteLocation(auth, params.id!);
    return { ok: true };
  },
});
