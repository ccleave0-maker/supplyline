import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { createSyncDevice, listSyncDevices } from '@/services/filing';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth }) => listSyncDevices(auth),
  POST: async ({ req, auth }) => createSyncDevice(auth, (await parseJson(req, z.object({ name: z.string().max(80) }))).name),
});
