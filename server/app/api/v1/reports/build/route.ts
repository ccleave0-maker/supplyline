import { savedReportInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { buildReport, renderReport } from '@/services/report-builder';

// Try a report without saving it: ?preview=1 gives the first rows of each section, otherwise the file.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, url }) => {
    const input = await parseJson(req, savedReportInput);
    if (url.searchParams.get('preview')) {
      const r = await buildReport(auth, input);
      return { ...r, sections: r.sections.map((s) => ({ ...s, total: s.rows.length, rows: s.rows.slice(0, 25) })) };
    }
    const { bytes, fileName, contentType } = await renderReport(auth, input);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
  },
});
