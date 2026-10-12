import { route } from '@/lib/http';
import { invoicePack } from '@/services/ap';

// The invoice with its receiving reports added at the back.
export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => {
    const { bytes, fileName } = await invoicePack(auth, params.id!);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
  },
});
