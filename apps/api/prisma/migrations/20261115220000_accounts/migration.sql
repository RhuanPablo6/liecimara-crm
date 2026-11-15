-- AlterTable
ALTER TABLE "sales" ADD COLUMN "dueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "supply_purchases" ADD COLUMN "firstDueAt" TIMESTAMP(3),
ADD COLUMN "paidInstallments" INTEGER NOT NULL DEFAULT 0;

-- Compras à vista já lançadas: consideradas pagas na data da compra.
UPDATE "supply_purchases" SET "paidInstallments" = 1 WHERE "installments" = 1;

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);
