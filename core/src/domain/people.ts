export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** "Jane van der Berg" → "JB" (skips lower-case particles); single names give the first two letters. */
export function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => /^[A-Za-z]/.test(p));
  if (parts.length === 0) return 'XX';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  const first = parts[0]![0]!;
  const last = parts.filter((p) => p[0] === p[0]!.toUpperCase()).at(-1) ?? parts.at(-1)!;
  return (first + last[0]!).toUpperCase();
}
