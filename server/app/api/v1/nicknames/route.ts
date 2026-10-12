import { nicknameInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listNicknames, saveNickname } from '@/services/assistant';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth }) => listNicknames(auth),
  POST: async ({ req, auth }) => saveNickname(auth, await parseJson(req, nicknameInput)),
});
