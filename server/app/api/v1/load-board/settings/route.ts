import { boardSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getBoardSettings, saveBoardSettings } from '@/services/board';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth }) => getBoardSettings(auth),
  PUT: async ({ req, auth }) => saveBoardSettings(auth, await parseJson(req, boardSettingsInput)),
});
