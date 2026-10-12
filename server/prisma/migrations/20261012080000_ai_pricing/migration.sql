-- AlterTable
ALTER TABLE "AiConfig" ADD COLUMN     "priceInputUsdPerM" DECIMAL(10,4) NOT NULL DEFAULT 3,
ADD COLUMN     "priceOutputUsdPerM" DECIMAL(10,4) NOT NULL DEFAULT 15,
ADD COLUMN     "usdToCad" DECIMAL(6,4) NOT NULL DEFAULT 1.37;

-- AlterTable
ALTER TABLE "AiRequestLog" ADD COLUMN     "error" TEXT,
ADD COLUMN     "summary" TEXT;

