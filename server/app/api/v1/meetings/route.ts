import { meetingCreateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createMeeting, listMeetings } from '@/services/meetings';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listMeetings(auth, { siteId: url.searchParams.get('siteId') ?? undefined, status: url.searchParams.get('status') ?? undefined }),
  POST: async ({ req, auth }) => createMeeting(auth, await parseJson(req, meetingCreateInput)),
});
