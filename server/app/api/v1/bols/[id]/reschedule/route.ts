import { rescheduleInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { rescheduleBol } from '@/services/schedule';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => rescheduleBol(auth, params.id!, await parseJson(req, rescheduleInput)),
});
