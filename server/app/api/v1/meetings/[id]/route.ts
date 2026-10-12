import { meetingUpdateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getMeeting, updateMeeting } from '@/services/meetings';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth, params }) => getMeeting(auth, params.id!),
  PUT: async ({ req, auth, params }) => updateMeeting(auth, params.id!, await parseJson(req, meetingUpdateInput)),
});
