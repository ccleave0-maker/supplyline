import { route } from '@/lib/http';
import { listBoard } from '@/services/board';

// Open loads on the map (the companies chosen in the board settings).
export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => listBoard(auth, { from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined, companyId: url.searchParams.get('companyId') ?? undefined }),
});
