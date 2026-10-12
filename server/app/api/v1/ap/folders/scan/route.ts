import { requirePermission } from '@/lib/auth';
import { route } from '@/lib/http';
import { scanApFolders } from '@/services/ap-folders';

// "Check the folder now"
export const { POST, OPTIONS } = route({
  POST: async ({ auth }) => {
    requirePermission(auth, 'ap:work');
    return scanApFolders(auth.orgId);
  },
});
