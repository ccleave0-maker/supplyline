-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extraCompanyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "navLayout" JSONB,
ADD COLUMN     "procurementScope" TEXT NOT NULL DEFAULT 'ALL';

