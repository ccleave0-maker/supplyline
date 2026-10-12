import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    globalSetup: './tests/global-setup.ts',
    setupFiles: ['./tests/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
