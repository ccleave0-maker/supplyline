'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePlatform } from '@supplyline/platform';
import { cx } from './components';

export type ColorMode = 'light' | 'dark';

const PREF_KEY = 'color-mode';

interface ColorModeValue {
  mode: ColorMode;
  toggle: () => void;
  setMode: (m: ColorMode) => void;
}

const ColorModeContext = createContext<ColorModeValue | null>(null);

function systemMode(): ColorMode {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Light/dark for the whole app. Follows the device until the user picks one; the choice is remembered on this device. */
export function ColorModeProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const [mode, setModeState] = useState<ColorMode>('light');

  useEffect(() => {
    let cancelled = false;
    platform.prefs.get(PREF_KEY).then((saved) => {
      if (cancelled) return;
      if (saved === 'light' || saved === 'dark') {
        setModeState(saved);
        document.documentElement.dataset.theme = saved;
      } else {
        setModeState(systemMode());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const setMode = useCallback(
    (m: ColorMode) => {
      setModeState(m);
      document.documentElement.dataset.theme = m;
      void platform.prefs.set(PREF_KEY, m);
    },
    [platform],
  );

  const value = useMemo(() => ({ mode, setMode, toggle: () => setMode(mode === 'dark' ? 'light' : 'dark') }), [mode, setMode]);
  return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

export function useColorMode(): ColorModeValue {
  const v = useContext(ColorModeContext);
  if (!v) throw new Error('useColorMode() must be used inside <ColorModeProvider>');
  return v;
}

/** Sun/moon switch. 48px tap target, announced as a switch to screen readers. */
export function ColorModeToggle({ className }: { className?: string }) {
  const { mode, toggle } = useColorMode();
  const dark = mode === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggle}
      className={cx(
        'sl-icon-btn inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-xl text-ink hover:bg-surface-2',
        className,
      )}
    >
      <span aria-hidden="true">{dark ? '☾' : '☀'}</span>
    </button>
  );
}
