'use client';

// PC app auto-update: checks the Bowron server for a newer signed version at
// start-up and every 6 hours; offers to restart into it.
import { useEffect, useState } from 'react';

type Ready = { version: string; install: () => Promise<void> };

export function UpdateChecker() {
  const [ready, setReady] = useState<Ready | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return; // only inside the PC app
    let stopped = false;
    const check = async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!update || stopped) return;
        setReady({
          version: update.version,
          install: async () => {
            await update.downloadAndInstall();
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          },
        });
      } catch {
        // No connection or no update server yet: try again later.
      }
    };
    void check();
    const t = setInterval(check, 6 * 60 * 60_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);
  if (!ready) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-brand px-4 py-2 text-brand-fg">
      <span>Bowron {ready.version} is ready.</span>
      <button
        type="button"
        disabled={busy}
        className="min-h-10 rounded-lg bg-surface px-3 font-semibold text-ink"
        onClick={() => {
          setBusy(true);
          void ready.install().catch(() => setBusy(false));
        }}
      >
        {busy ? 'Updating…' : 'Restart to update'}
      </button>
      <button type="button" className="min-h-10 px-2 underline" onClick={() => setReady(null)}>
        Later
      </button>
    </div>
  );
}
