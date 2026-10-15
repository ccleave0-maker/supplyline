// Database backup: a full pg_dump to a dated file, keeping the newest 14.
//   pnpm --filter @supplyline/server backup            (uses DATABASE_URL from .env)
//   BACKUP_DIR="D:\Bowron backups" pnpm ... backup  (somewhere else, e.g. a network drive)
// Hosted databases (Supabase) also keep their own daily backups; this is an extra
// copy you hold yourself. Needs pg_dump (installed with PostgreSQL).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const dir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
const keep = Number(process.env.BACKUP_KEEP || 14);
mkdirSync(dir, { recursive: true });

function findPgDump(): string {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  if (process.platform === 'win32') {
    const base = 'C:\Program Files\PostgreSQL';
    if (existsSync(base)) {
      const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
      for (const v of versions) {
        const exe = path.join(base, v, 'bin', 'pg_dump.exe');
        if (existsSync(exe)) return exe;
      }
    }
  }
  return 'pg_dump';
}

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const out = path.join(dir, `supplyline-${stamp}.dump`);
const r = spawnSync(findPgDump(), ['--format=custom', '--no-owner', '--no-privileges', `--file=${out}`, url], { stdio: ['ignore', 'inherit', 'inherit'] });
if (r.status !== 0) {
  console.error(r.error ? `Could not run pg_dump: ${r.error.message}` : `pg_dump failed (exit ${r.status}).`);
  process.exit(1);
}
console.log(`Backup saved: ${out} (${(statSync(out).size / 1_048_576).toFixed(1)} MB)`);

const old = readdirSync(dir)
  .filter((f) => /^supplyline-.*\.dump$/.test(f))
  .sort()
  .reverse()
  .slice(keep);
for (const f of old) rmSync(path.join(dir, f));
if (old.length) console.log(`Removed ${old.length} older backup(s); keeping ${keep}.`);
console.log('Restore with: pg_restore --clean --no-owner -d <DATABASE_URL> <file>');
