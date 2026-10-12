import { z } from 'zod';

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
export const PLANS = [
  { key: 'TRIAL', label: 'Free trial', selfServe: false },
  { key: 'STANDARD', label: 'Standard', selfServe: true },
  { key: 'PRO', label: 'Pro', selfServe: true },
  { key: 'CUSTOM', label: 'Custom (invoiced)', selfServe: false },
  { key: 'FREE', label: 'Free (owner / partner)', selfServe: false },
] as const;
export type PlanKey = (typeof PLANS)[number]['key'];

export interface BillingView {
  plan: PlanKey;
  planLabel: string;
  seats: number;
  seatsUsed: number;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'NONE';
  /** Online card payments are set up (the platform owner added Stripe keys) */
  onlinePayments: boolean;
  /** Plans you can subscribe to online */
  plans: { key: PlanKey; label: string }[];
  /** There's a subscription to manage (change card, cancel, invoices) */
  canManage: boolean;
}
export const checkoutInput = z.object({ plan: z.enum(['STANDARD', 'PRO']), seats: z.number().int().min(1).max(10000) });

// ---------------------------------------------------------------------------
// Error log (platform owner)
// ---------------------------------------------------------------------------
export const clientErrorInput = z.object({
  message: z.string().max(2000),
  stack: z.string().max(8000).nullable().optional(),
  path: z.string().max(500).nullable().optional(),
});
export interface ErrorEventView {
  id: string;
  source: 'SERVER' | 'CLIENT';
  message: string;
  stack: string | null;
  path: string | null;
  app: string | null;
  version: string | null;
  organizationName: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// Push notifications (Web Push)
// ---------------------------------------------------------------------------
export const pushSubscriptionInput = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;
