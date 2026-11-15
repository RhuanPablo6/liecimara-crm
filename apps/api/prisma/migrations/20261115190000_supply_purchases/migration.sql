-- CreateTable
CREATE TABLE "supply_purchases" (
    "id" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "supplier" TEXT,
    "items" JSONB NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supply_purchases_purchasedAt_idx" ON "supply_purchases"("purchasedAt");
