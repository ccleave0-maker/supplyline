/*
  Warnings:

  - You are about to drop the column `costCodeId` on the `OrderLine` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "OrderLine" DROP CONSTRAINT "OrderLine_costCodeId_fkey";

-- AlterTable
ALTER TABLE "OrderLine" DROP COLUMN "costCodeId",
ADD COLUMN     "costCode" TEXT;
