-- AlterTable
ALTER TABLE "leads" ADD COLUMN "originType" TEXT,
ADD COLUMN "originNote" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "walletPatient" BOOLEAN;
