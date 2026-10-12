import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { addMeetingAudio } from '@/services/meetings';

// One recorded piece of the meeting (the app sends one about every 10 minutes).
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('The recording was empty.');
    return addMeetingAudio(auth, params.id!, f);
  },
});
