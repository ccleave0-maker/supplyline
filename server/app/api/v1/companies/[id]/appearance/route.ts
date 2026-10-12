import { appearanceInput } from '@supplyline/core/models';
import { parseForm, route } from '@/lib/http';
import { saveAppearance } from '@/services/polish';

// Background picture (optional file), fade and logo decal.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const { data, file } = await parseForm(req, appearanceInput);
    return saveAppearance(auth, params.id!, data, file);
  },
});
