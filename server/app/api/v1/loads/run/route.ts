import { parseJson, route } from '@/lib/http';
import { makeRun, makeRunInput } from '@/services/optimizer';

// Turn a suggestion into planned loads on the schedule.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => makeRun(auth, await parseJson(req, makeRunInput)),
});
