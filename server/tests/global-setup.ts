import 'dotenv/config';
import { execSync } from 'node:child_process';

/**
 * Brings the separate test database up to the latest schema (non-destructive).
 * Tests don't need an empty database: each one creates its own organization.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL in server/.env to run tests');
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
