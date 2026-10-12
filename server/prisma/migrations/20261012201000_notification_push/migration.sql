-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "pushedAt" TIMESTAMP(3);


-- Old notifications are not pushed.
UPDATE "Notification" SET "pushedAt" = NOW();
