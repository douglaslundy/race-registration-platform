-- AlterTable
ALTER TABLE "ad_metrics_snapshots" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PRIVATE';

-- DropIndex
DROP INDEX "ad_metrics_snapshots_adSlotId_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "ad_metrics_snapshots_adSlotId_date_source_key" ON "ad_metrics_snapshots"("adSlotId", "date", "source");
