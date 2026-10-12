import { makeLoadsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { makePlannedLoads } from '@/services/loads';

// One planned load (draft BOL) per truckload, on the schedule.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => makePlannedLoads(auth, await parseJson(req, makeLoadsInput)),
});
