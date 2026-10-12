import { route } from '@/lib/http';
import { getPoPdf } from '@/services/purchasing';

// ?packing=1 for the packing list (no prices)
export const { GET, OPTIONS } = route({
  GET: async ({ auth, params, url }) => {
    const { bytes, fileName } = await getPoPdf(auth, params.id!, url.searchParams.get('packing') === '1');
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'no-store' },
    });
  },
});
