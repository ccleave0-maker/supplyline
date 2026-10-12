import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { importKml } from '@/services/board';

// Pins from Google Earth / My Maps (KML) become shipping locations.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose a .kml file.');
    return importKml(auth, f);
  },
});
