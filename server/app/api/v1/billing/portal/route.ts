import { route } from '@/lib/http';
import { billingPortal } from '@/services/billing';

export const { POST, OPTIONS } = route({
  POST: async ({ auth }) => billingPortal(auth),
});
