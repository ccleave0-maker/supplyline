// Offline copies: the last answer to each screen's data request is kept on the
// device, so when there's no signal (yard, remote job) screens still open with
// what was seen last. Read-only: saving still needs a connection.

const PREFIX = 'sl-off:';
const INDEX = 'sl-off-index';
const MAX_ENTRIES = 150;
const MAX_BYTES = 250_000;
/** Data that changes too fast (or isn't worth keeping). */
const SKIP = [/^\/notifications\/count/, /^\/search/, /^\/events/, /^\/meta/, /^\/health/];

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Short, non-reversible tag per signed-in person (the token itself is never stored). */
function tag(token: string | null) {
  if (!token) return 'anon';
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function offlineKey(token: string | null, path: string) {
  return `${PREFIX}${tag(token)}:${path}`;
}

export function shouldCache(path: string) {
  return !SKIP.some((re) => re.test(path));
}

export function saveOffline(key: string, text: string) {
  const s = storage();
  if (!s || text.length > MAX_BYTES) return;
  try {
    s.setItem(key, JSON.stringify({ at: Date.now(), text }));
    const index = (JSON.parse(s.getItem(INDEX) ?? '[]') as string[]).filter((k) => k !== key);
    index.push(key);
    while (index.length > MAX_ENTRIES) s.removeItem(index.shift()!);
    s.setItem(INDEX, JSON.stringify(index));
  } catch {
    // Storage full or blocked: drop the oldest half and carry on.
    try {
      const index = JSON.parse(s.getItem(INDEX) ?? '[]') as string[];
      for (const k of index.splice(0, Math.ceil(index.length / 2))) s.removeItem(k);
      s.setItem(INDEX, JSON.stringify(index));
    } catch {
      /* give up quietly */
    }
  }
}

export function readOffline(key: string): { at: number; text: string } | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as { at: number; text: string }) : null;
  } catch {
    return null;
  }
}

export function clearOffline() {
  const s = storage();
  if (!s) return;
  try {
    for (const k of JSON.parse(s.getItem(INDEX) ?? '[]') as string[]) s.removeItem(k);
    s.removeItem(INDEX);
  } catch {
    /* nothing to clear */
  }
}

// Online / offline state, for the banner.
type Listener = (offline: { since: number; savedAt: number | null } | null) => void;
let state: { since: number; savedAt: number | null } | null = null;
const listeners = new Set<Listener>();
export function setOffline(next: { savedAt: number | null } | null) {
  const was = state;
  state = next ? { since: was?.since ?? Date.now(), savedAt: next.savedAt ?? was?.savedAt ?? null } : null;
  if ((was === null) !== (state === null) || (state && was && state.savedAt !== was.savedAt)) for (const l of listeners) l(state);
}
export function onOfflineChange(fn: Listener) {
  listeners.add(fn);
  fn(state);
  return () => void listeners.delete(fn);
}
