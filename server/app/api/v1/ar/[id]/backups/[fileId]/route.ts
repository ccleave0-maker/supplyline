import { route } from '@/lib/http';
import { removeArBackup } from '@/services/accounting';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => removeArBackup(auth, params.id!, params.fileId!),
});
