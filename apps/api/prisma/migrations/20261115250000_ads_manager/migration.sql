-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "accountId" TEXT,
ADD COLUMN "effectiveStatus" TEXT,
ADD COLUMN "dailyBudgetCents" INTEGER,
ADD COLUMN "lifetimeBudgetCents" INTEGER,
ADD COLUMN "stopTime" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ad_sets" ADD COLUMN "effectiveStatus" TEXT,
ADD COLUMN "dailyBudgetCents" INTEGER,
ADD COLUMN "lifetimeBudgetCents" INTEGER;

-- AlterTable
ALTER TABLE "ads" ADD COLUMN "effectiveStatus" TEXT;

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "timezoneName" TEXT,
    "status" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);
