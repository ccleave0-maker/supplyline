import { route } from '@/lib/http';
import { startMeeting } from '@/services/meetings';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => startMeeting(auth, params.id!),
});
