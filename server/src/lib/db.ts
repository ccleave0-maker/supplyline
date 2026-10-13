import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaModels?: string };

// While the app is being built (e.g. on the host, which has no database during builds)
// nothing is queried, so a placeholder lets the build finish. Connections are lazy.
const BUILDING = process.env.NEXT_PHASE === 'phase-production-build';

export function createPrisma(connectionString = process.env.DATABASE_URL || (BUILDING ? 'postgresql://build-only@localhost:5432/none' : undefined)): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One client per process (survives hot reload in development). After a database
// change (`prisma generate`), the tables/fields differ, so a fresh client is made —
// otherwise the running dev server keeps the old one and new tables "don't exist".
const models = JSON.stringify(Object.entries(Prisma as unknown as Record<string, unknown>).filter(([k]) => k.endsWith('ScalarFieldEnum')));
const reuse = globalForPrisma.prisma && globalForPrisma.prismaModels === models;
if (globalForPrisma.prisma && !reuse) void globalForPrisma.prisma.$disconnect().catch(() => undefined);
export const db: PrismaClient = reuse ? globalForPrisma.prisma! : createPrisma();
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaModels = models;
}
