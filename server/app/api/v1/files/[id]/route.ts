import { verifyFileSignature } from '@/lib/crypto';
import { notFound, unauthorized } from '@/lib/errors';
import { route } from '@/lib/http';
import { readFileAsset } from '@/services/files';

// Files are served through signed, expiring URLs (see signFilePath), so they
// work in <img> tags on every platform without exposing the login token.
export const { GET, OPTIONS } = route({
  GET: {
    public: true,
    handler: async ({ url, params }) => {
      const id = params.id!;
      if (!verifyFileSignature(id, url.searchParams.get('exp'), url.searchParams.get('sig'))) throw unauthorized('This link has expired.');
      const found = await readFileAsset(id);
      if (!found) throw notFound('File');
      return new Response(found.bytes as unknown as BodyInit, {
        headers: {
          'Content-Type': found.file.mimeType,
          'Content-Length': String(found.bytes.byteLength),
          'Content-Disposition': `inline; filename="${encodeURIComponent(found.file.fileName)}"`,
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
          // SVG uploads must never run scripts
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      });
    },
  },
});
