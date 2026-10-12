import { checkoutInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { startCheckout } from '@/services/billing';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => {
    const b = await parseJson(req, checkoutInput);
    return startCheckout(auth, b.plan, b.seats);
  },
});
