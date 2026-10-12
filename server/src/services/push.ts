// Push notifications (Web Push): the web app / installed web app on phones and
// PCs can show SupplyLine notifications even when it's closed. Needs no outside
// account — just a key pair in the server settings (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
// Native iPhone / Android push (APNs / Firebase) plugs in here later.

import webpush from 'web-push';
import type { PushSubscriptionInput } from '@supplyline/core/models';
import type { AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { conflict } from '../lib/errors';

const enabled = () => !!env().VAPID_PUBLIC_KEY && !!env().VAPID_PRIVATE_KEY;

type Sender = (sub: PushSubscriptionInput, payload: string) => Promise<void>;
let sender: Sender = async (sub, payload) => {
  await webpush.sendNotification(sub, payload, { vapidDetails: { subject: env().VAPID_SUBJECT, publicKey: env().VAPID_PUBLIC_KEY, privateKey: env().VAPID_PRIVATE_KEY }, TTL: 60 * 60 * 12 });
};
/** Tests only. */
export function setPushSenderForTests(fn: Sender | null, force = false) {
  sender = fn ?? sender;
  forced = force;
}
let forced = false;

export async function registerPush(auth: AuthContext, sub: PushSubscriptionInput, appVersion?: string) {
  if (!enabled() && !forced) throw conflict('Push notifications aren’t set up on this server yet.');
  const token = JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys });
  await db.deviceRegistration.upsert({
    where: { platform_pushToken: { platform: 'webpush', pushToken: token } },
    create: { userId: auth.userId, platform: 'webpush', pushToken: token, appVersion: appVersion ?? null },
    update: { userId: auth.userId, lastSeenAt: new Date(), appVersion: appVersion ?? undefined },
  });
  return { ok: true };
}

export async function unregisterPush(auth: AuthContext, endpoint: string) {
  const regs = await db.deviceRegistration.findMany({ where: { userId: auth.userId, platform: 'webpush' } });
  const mine = regs.filter((r) => (JSON.parse(r.pushToken) as { endpoint: string }).endpoint === endpoint);
  await db.deviceRegistration.deleteMany({ where: { id: { in: mine.map((r) => r.id) } } });
  return { ok: true };
}

/** Send new notifications as pushes. Runs every 20 seconds; each notification goes once. */
export async function dispatchPushes(): Promise<{ sent: number; gone: number }> {
  const pending = await db.notification.findMany({ where: { pushedAt: null }, orderBy: { createdAt: 'asc' }, take: 200 });
  if (!pending.length) return { sent: 0, gone: 0 };
  await db.notification.updateMany({ where: { id: { in: pending.map((n) => n.id) } }, data: { pushedAt: new Date() } });
  if (!enabled() && !forced) return { sent: 0, gone: 0 };
  // Only recent ones (nobody wants yesterday's alerts buzzing when the server restarts).
  const fresh = pending.filter((n) => Date.now() - n.createdAt.getTime() < 15 * 60_000);
  const regs = await db.deviceRegistration.findMany({ where: { platform: 'webpush', userId: { in: [...new Set(fresh.map((n) => n.userId))] } } });
  let sent = 0;
  let gone = 0;
  for (const n of fresh) {
    const unread = await db.notification.count({ where: { userId: n.userId, readAt: null } });
    for (const r of regs.filter((x) => x.userId === n.userId)) {
      try {
        await sender(JSON.parse(r.pushToken) as PushSubscriptionInput, JSON.stringify({ title: n.title, body: n.body, link: n.link ?? '/notifications/', tag: n.type, badge: unread }));
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser threw the subscription away (app removed / permission revoked).
          await db.deviceRegistration.delete({ where: { id: r.id } }).catch(() => {});
          gone++;
        }
      }
    }
  }
  return { sent, gone };
}
