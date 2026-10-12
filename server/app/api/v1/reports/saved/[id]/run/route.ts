import { route } from '@/lib/http';
import { runSavedReport } from '@/services/report-builder';

// A saved report, as Excel or PDF.
export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => {
    const { bytes, fileName, contentType } = await runSavedReport(auth, params.id!);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
  },
});
