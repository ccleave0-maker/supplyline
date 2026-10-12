-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "mfaFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mfaVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastStep" INTEGER,
ADD COLUMN     "mfaPendingSecretEnc" TEXT,
ADD COLUMN     "mfaRecoveryHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfaSecretEnc" TEXT;

