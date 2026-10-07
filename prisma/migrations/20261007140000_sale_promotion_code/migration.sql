-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "promotionCode" TEXT;

-- CreateIndex
CREATE INDEX "Sale_promotionCode_idx" ON "Sale"("promotionCode");
