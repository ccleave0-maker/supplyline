import { route } from '@/lib/http';
import { stripeWebhook } from '@/services/billing';

// Stripe tells us about payments here (signed; ignored until STRIPE_WEBHOOK_SECRET is set).
export const { POST, OPTIONS } = route({
  POST: { public: true, handler: async ({ req }) => stripeWebhook(await req.text(), req.headers.get('stripe-signature')) },
});
