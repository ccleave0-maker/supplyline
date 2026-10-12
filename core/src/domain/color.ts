// Colour helpers so any company theme colour stays readable (WCAG contrast).

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white text, whichever reads better on the given background. */
export function readableTextOn(bg: string): '#000000' | '#ffffff' {
  return contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff';
}

/** Darken (amount < 0) or lighten (amount > 0) a colour by mixing with black/white. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex([r + (target - r) * t, g + (target - g) * t, b + (target - b) * t]);
}

/** A version of the brand colour dark enough for text/links on white (≥ 4.5:1). */
export function brandTextColor(hex: string, on = '#ffffff'): string {
  const darkBg = luminance(on) < 0.2;
  let c = hex;
  for (let i = 0; i < 20 && contrastRatio(c, on) < 4.5; i++) c = shade(c, darkBg ? 0.08 : -0.08);
  return c;
}
