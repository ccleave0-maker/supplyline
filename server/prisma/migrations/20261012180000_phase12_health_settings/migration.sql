-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "HealthCheckRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "results" JSONB NOT NULL,
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthCheckRun_organizationId_at_idx" ON "HealthCheckRun"("organizationId", "at");

