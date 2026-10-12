import { route } from '@/lib/http';
import { issueBol } from '@/services/bols';

// Optional body { ship: true } = issue and mark shipped in one go.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const body = (await req.json().catch(() => ({}))) as { ship?: unknown };
    return issueBol(auth, params.id!, { ship: body?.ship === true });
  },
});
