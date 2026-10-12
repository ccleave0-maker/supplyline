import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { runExportMapping } from '@/services/export-mappings';

// The mapped export for a date range, as Excel or CSV.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const { from, to } = await parseJson(req, z.object({ from: z.string(), to: z.string() }));
    const { bytes, fileName, contentType } = await runExportMapping(auth, params.id!, from, to);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
  },
});
