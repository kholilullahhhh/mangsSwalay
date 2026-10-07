-- Add a cost snapshot to stock opname lines.

-- The variance of a physical count has to be valued against the cost that
-- applied when the session opened. Without this, valuing an old session later
-- would silently use a price that has since changed.

-- AlterTable
ALTER TABLE "StockOpnameItem" ADD COLUMN     "purchasePriceSnapshot" DECIMAL(15,2);
