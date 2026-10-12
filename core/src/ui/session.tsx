'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePlatform } from '@supplyline/platform';
import { clearOffline, createApi, type Api } from '../api-client';
import type { AuthResult, CompanySummary, LiveEvent, Me } from '../models';

const TOKEN_KEY = 'session-token';
const COMPANY_KEY = 'active-company';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface SessionValue {
  status: Status;
  api: Api;
  me: Me | null;
  /** The company whose theme, logo and data are shown. */
  activeCompany: CompanySummary | null;
  setActiveCompany: (id: string) => void;
  signIn: (result: AuthResult) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  /** Company remembered on this device — used to theme the login screen. */
  lastCompanyId: string | null;
  /** Listen for live changes from other devices. Returns an unsubscribe function. */
  onLive: (fn: (e: LiveEvent) => void) => () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const companyRef = useRef<string | null>(null);
  companyRef.current = activeCompanyId;
  const [lastCompanyId, setLastCompanyId] = useState<string | null>(null);

  const clearLocal = useCallback(async () => {
    tokenRef.current = null;
    clearOffline();
    await platform.secureStore.remove(TOKEN_KEY);
    setMe(null);
    setStatus('anonymous');
  }, [platform]);

  const api = useMemo(
    () =>
      createApi({
        baseUrl: platform.info.apiBaseUrl,
        clientApp: platform.info.app,
        clientVersion: platform.info.version,
        getToken: () => tokenRef.current,
        getCompanyId: () => companyRef.current,
        onUnauthorized: () => void clearLocal(),
      }),
    [platform, clearLocal],
  );

  const pickCompany = useCallback(
    async (m: Me) => {
      const saved = await platform.prefs.get(COMPANY_KEY);
      const ids = m.companies.map((c) => c.id);
      const chosen = (saved && ids.includes(saved) && saved) || (m.user.companyId && ids.includes(m.user.companyId) && m.user.companyId) || ids[0] || null;
      setActiveCompanyId(chosen);
      if (chosen) {
        setLastCompanyId(chosen);
        await platform.prefs.set(COMPANY_KEY, chosen);
      }
    },
    [platform],
  );

  // Restore a saved session on start-up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLastCompanyId(await platform.prefs.get(COMPANY_KEY));
      const token = await platform.secureStore.get(TOKEN_KEY);
      if (!token) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      tokenRef.current = token;
      try {
        const m = await api.me.get();
        if (cancelled) return;
        setMe(m);
        await pickCompany(m);
        setStatus('authenticated');
      } catch (e) {
        if (cancelled) return;
        // Offline with a saved token: keep the token, show sign-in only if it was rejected.
        if ((e as { status?: number }).status === 401) await clearLocal();
        else setStatus('anonymous');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, platform, pickCompany, clearLocal]);

  const signIn = useCallback(
    async (result: AuthResult) => {
      tokenRef.current = result.token;
      await platform.secureStore.set(TOKEN_KEY, result.token);
      setMe(result.me);
      await pickCompany(result.me);
      setStatus('authenticated');
    },
    [platform, pickCompany],
  );

  const signOut = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* already signed out on the server */
    }
    await clearLocal();
  }, [api, clearLocal]);

  const refreshMe = useCallback(async () => {
    const m = await api.me.get();
    setMe(m);
    await pickCompany(m);
  }, [api, pickCompany]);

  const setActiveCompany = useCallback(
    (id: string) => {
      setActiveCompanyId(id);
      setLastCompanyId(id);
      void platform.prefs.set(COMPANY_KEY, id);
    },
    [platform],
  );

  const activeCompany = me?.companies.find((c) => c.id === activeCompanyId) ?? null;

  // One live-updates connection per signed-in app, shared by every screen.
  const listeners = useRef(new Set<(e: LiveEvent) => void>());
  useEffect(() => {
    if (status !== 'authenticated') return;
    return api.subscribeEvents((e) => listeners.current.forEach((fn) => fn(e)));
  }, [api, status]);
  const onLive = useCallback((fn: (e: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status, api, me, activeCompany, setActiveCompany, signIn, signOut, refreshMe, lastCompanyId, onLive }),
    [status, api, me, activeCompany, setActiveCompany, signIn, signOut, refreshMe, lastCompanyId, onLive],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession() must be used inside <SessionProvider>');
  return s;
}

/** Runs `fn` whenever another device changes something (latest `fn` is always used). */
export function useLive(fn: (e: LiveEvent) => void) {
  const { onLive } = useSession();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onLive((e) => ref.current(e)), [onLive]);
}

/** For screens that only render when signed in. */
export function useAuthed() {
  const s = useSession();
  if (!s.me) throw new Error('Not signed in');
  return { ...s, me: s.me };
}
