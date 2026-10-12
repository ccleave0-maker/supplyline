import { tableExportInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { exportTable } from '@/services/exports';

// Any list on screen → Excel (.xlsx) or PDF.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const { bytes, fileName, contentType } = await exportTable(auth, await parseJson(req, tableExportInput));
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
  },
});
