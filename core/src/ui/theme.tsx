'use client';

import { useEffect } from 'react';
import { BRANDING } from '../branding';
import { brandTextColor, readableTextOn } from '../domain/color';

/** Applies a company theme colour to the whole app via CSS variables. */
export function applyTheme(color: string | null | undefined) {
  const brand = color && /^#[0-9a-f]{6}$/i.test(color) ? color : BRANDING.defaultThemeColor;
  const root = document.documentElement;
  root.style.setProperty('--brand', brand);
  root.style.setProperty('--brand-contrast', readableTextOn(brand));
  root.style.setProperty('--brand-ink-light', brandTextColor(brand, '#ffffff'));
  root.style.setProperty('--brand-ink-dark', brandTextColor(brand, '#111317'));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', brand);
}

export function useTheme(color: string | null | undefined) {
  useEffect(() => {
    applyTheme(color);
  }, [color]);
}
