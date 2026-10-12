import { route } from '@/lib/http';
import { revokeSyncDevice } from '@/services/filing';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => revokeSyncDevice(auth, params.id!),
});
