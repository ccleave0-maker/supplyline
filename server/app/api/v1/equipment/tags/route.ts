import { route } from '@/lib/http';
import { equipmentTagsPdf } from '@/services/equipment';

// ?ids=a,b,c for some units; no ids = every active unit you can see.
export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const ids = url.searchParams.get('ids')?.split(',').filter(Boolean) ?? null;
    const { bytes, fileName } = await equipmentTagsPdf(auth, ids);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
  },
});
