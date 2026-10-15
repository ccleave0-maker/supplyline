// Subscriptions: plan, seats and trial per organization. The platform owner can
// set them by hand (invoiced customers). Online card payments go through Stripe
// (its plain HTTPS API, no SDK) once the owner adds the Stripe keys — off until then.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLANS, type BillingView, type PlanKey } from '@supplyline/core/models';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, conflict, unauthorized } from '../lib/errors';

const priceFor = (plan: PlanKey) => (plan === 'STANDARD' ? env().STRIPE_PRICE_STANDARD : plan === 'PRO' ? env().STRIPE_PRICE_PRO : '');
const stripeOn = () => !!env().STRIPE_SECRET_KEY;

export async function getBilling(auth: AuthContext): Promise<BillingView> {
  requirePermission(auth, 'org:manage');
  const o = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  const seatsUsed = await db.user.count({ where: { organizationId: o.id, active: true, deletedAt: null } });
  const plan = (PLANS.some((p) => p.key === o.plan) ? o.plan : 'TRIAL') as PlanKey;
  return {
    plan,
    planLabel: PLANS.find((p) => p.key === plan)!.label,
    seats: o.seats,
    seatsUsed,
    trialEndsAt: o.trialEndsAt?.toISOString().slice(0, 10) ?? null,
    trialDaysLeft: plan === 'TRIAL' && o.trialEndsAt ? Math.ceil((o.trialEndsAt.getTime() - Date.now()) / 86_400_000) : null,
    status: o.billingStatus as BillingView['status'],
    onlinePayments: stripeOn(),
    plans: stripeOn() ? PLANS.filter((p) => p.selfServe && priceFor(p.key)).map((p) => ({ key: p.key, label: p.label })) : [],
    canManage: stripeOn() && !!o.stripeCustomerId,
  };
}

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env().STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!res.ok) throw badRequest(`Payments: ${body.error?.message ?? res.statusText}`);
  return body;
}

/** A Stripe Checkout page to subscribe (returns the page to open). */
export async function startCheckout(auth: AuthContext, plan: 'STANDARD' | 'PRO', seats: number): Promise<{ url: string }> {
  requirePermission(auth, 'org:manage');
  if (!stripeOn()) throw conflict('Online payments aren’t set up yet. Contact Bowron to subscribe.');
  const price = priceFor(plan);
  if (!price) throw badRequest('That plan isn’t available online.');
  const o = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  const used = await db.user.count({ where: { organizationId: o.id, active: true, deletedAt: null } });
  const app = env().APP_URL.replace(/\/$/, '');
  const s = await stripe('checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': String(Math.max(seats, used)),
    success_url: `${app}/account/billing/?done=1`,
    cancel_url: `${app}/account/billing/`,
    client_reference_id: o.id,
    'metadata[organizationId]': o.id,
    'metadata[plan]': plan,
    'subscription_data[metadata][organizationId]': o.id,
    'subscription_data[metadata][plan]': plan,
    ...(o.stripeCustomerId ? { customer: o.stripeCustomerId } : { customer_email: auth.email }),
  });
  await audit(db, auth, 'billing.checkout', 'Organization', o.id, null, { plan, seats });
  return { url: s.url! };
}

/** Stripe's page to change the card, see invoices or cancel. */
export async function billingPortal(auth: AuthContext): Promise<{ url: string }> {
  requirePermission(auth, 'org:manage');
  const o = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  if (!stripeOn() || !o.stripeCustomerId) throw conflict('There’s no online subscription to manage.');
  const s = await stripe('billing_portal/sessions', { customer: o.stripeCustomerId, return_url: `${env().APP_URL.replace(/\/$/, '')}/account/billing/` });
  return { url: s.url! };
}

/** Check Stripe's signature header ("t=…,v1=…") on a webhook body. */
export function verifyStripeSignature(body: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

const STATUS: Record<string, string> = { active: 'ACTIVE', trialing: 'ACTIVE', past_due: 'PAST_DUE', unpaid: 'PAST_DUE', canceled: 'CANCELLED', incomplete_expired: 'CANCELLED' };

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

export async function stripeWebhook(body: string, signature: string | null) {
  if (!verifyStripeSignature(body, signature, env().STRIPE_WEBHOOK_SECRET)) throw unauthorized('Bad signature.');
  const ev = JSON.parse(body) as StripeEvent;
  const o = ev.data.object;
  const meta = (o.metadata as Record<string, string> | undefined) ?? {};
  if (ev.type === 'checkout.session.completed') {
    const orgId = (o.client_reference_id as string) ?? meta.organizationId;
    if (!orgId) return { ok: true };
    await db.organization.update({
      where: { id: orgId },
      data: { stripeCustomerId: (o.customer as string) ?? undefined, stripeSubscriptionId: (o.subscription as string) ?? undefined, plan: meta.plan === 'PRO' ? 'PRO' : 'STANDARD', billingStatus: 'ACTIVE', trialEndsAt: null },
    });
    await audit(db, null, 'billing.subscribed', 'Organization', orgId, null, { event: ev.id, plan: meta.plan }, orgId);
  } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
    const org = await db.organization.findFirst({ where: { OR: [{ stripeSubscriptionId: o.id as string }, ...(meta.organizationId ? [{ id: meta.organizationId }] : [])] } });
    if (!org) return { ok: true };
    const items = (o.items as { data?: { quantity?: number }[] } | undefined)?.data ?? [];
    await db.organization.update({
      where: { id: org.id },
      data: {
        billingStatus: ev.type === 'customer.subscription.deleted' ? 'CANCELLED' : (STATUS[o.status as string] ?? org.billingStatus),
        ...(items[0]?.quantity ? { seats: items[0].quantity } : {}),
        ...(meta.plan === 'PRO' || meta.plan === 'STANDARD' ? { plan: meta.plan } : {}),
      },
    });
    await audit(db, null, 'billing.subscription_change', 'Organization', org.id, null, { event: ev.id, type: ev.type, status: o.status }, org.id);
  } else if (ev.type === 'invoice.payment_failed') {
    const org = await db.organization.findFirst({ where: { stripeCustomerId: o.customer as string } });
    if (org) await db.organization.update({ where: { id: org.id }, data: { billingStatus: 'PAST_DUE' } });
  } else if (ev.type === 'invoice.paid') {
    const org = await db.organization.findFirst({ where: { stripeCustomerId: o.customer as string } });
    if (org && org.billingStatus === 'PAST_DUE') await db.organization.update({ where: { id: org.id }, data: { billingStatus: 'ACTIVE' } });
  }
  return { ok: true };
}
