import { route } from '@/lib/http';
import { listOutbox } from '@/services/mail';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => listOutbox(auth, (url.searchParams.get('show') as 'review' | 'failed' | 'sent' | null) ?? 'review'),
});
