-- Draft BOLs get their number when issued.
ALTER TABLE "BillOfLading" ALTER COLUMN "bolNumber" DROP NOT NULL;
