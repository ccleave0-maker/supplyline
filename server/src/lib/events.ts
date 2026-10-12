import { EventEmitter } from 'node:events';
import type { LiveEvent } from '@supplyline/core/models';

// Live updates: when something changes, every open app in the same
// organization is told to refresh. One server process today; if the server is
// ever scaled to several instances, forward these through Postgres NOTIFY.

type Envelope = { orgId: string; event: LiveEvent };

const globalForEvents = globalThis as unknown as { supplylineBus?: EventEmitter };
const bus = globalForEvents.supplylineBus ?? new EventEmitter();
bus.setMaxListeners(0);
globalForEvents.supplylineBus = bus;

export function publish(orgId: string, event: LiveEvent): void {
  bus.emit('event', { orgId, event } satisfies Envelope);
}

export function subscribe(orgId: string, onEvent: (e: LiveEvent) => void): () => void {
  const handler = (env: Envelope) => {
    if (env.orgId === orgId) onEvent(env.event);
  };
  bus.on('event', handler);
  return () => bus.off('event', handler);
}
