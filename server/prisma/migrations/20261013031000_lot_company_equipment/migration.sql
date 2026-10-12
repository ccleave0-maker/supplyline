-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YardInventoryItem" ADD CONSTRAINT "YardInventoryItem_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

