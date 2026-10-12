'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UnitSystem } from '../models';

const KEY = 'sl-units';

/** Feet/pounds or metres/kilograms — each person's own choice, remembered on this device. */
export function useUnits(): [UnitSystem, (u: UnitSystem) => void] {
  const [units, setUnits] = useState<UnitSystem>('imperial');
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (v === 'metric' || v === 'imperial') setUnits(v);
    } catch {
      /* private window etc. */
    }
  }, []);
  const set = useCallback((u: UnitSystem) => {
    setUnits(u);
    try {
      window.localStorage.setItem(KEY, u);
    } catch {
      /* not remembered */
    }
  }, []);
  return [units, set];
}
