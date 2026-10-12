import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { exportAllData } from '@/services/data-export';

// Everything the organization has, as one ZIP.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const { includeFiles } = await parseJson(req, z.object({ includeFiles: z.boolean().default(true) }));
    const { bytes, fileName } = await exportAllData(auth, { includeFiles });
    const contentType = 'application/zip';
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
  },
});
