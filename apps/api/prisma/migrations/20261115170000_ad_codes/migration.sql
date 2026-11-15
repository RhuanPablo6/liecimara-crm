-- AlterTable
ALTER TABLE "ads" ADD COLUMN "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ads_code_key" ON "ads"("code");
