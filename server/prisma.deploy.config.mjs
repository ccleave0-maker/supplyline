// Used by the hosted server before each deploy (`prisma migrate deploy`) to apply database
// changes. Plain JavaScript with no imports, so the slim server image needs only the Prisma CLI.
export default {
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
};
