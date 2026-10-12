import { route } from '@/lib/http';
import { lookupForReceiving } from '@/services/yard';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => lookupForReceiving(auth, (url.searchParams.get('q') ?? '').slice(0, 80)),
});
