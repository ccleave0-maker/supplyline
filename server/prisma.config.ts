import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Generating the client (during installs and builds) doesn't touch a database, so a
    // build machine without DATABASE_URL still works. Migrations and the app itself need
    // the real one and fail clearly without it.
    url: process.env.DATABASE_URL ?? 'postgresql://build-only@localhost:5432/none',
  },
});
