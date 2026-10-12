import { route } from '@/lib/http';
import { getBolPdf } from '@/services/bols';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => {
    const { bytes, fileName } = await getBolPdf(auth, params.id!);
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'no-store' },
    });
  },
});
