-- Orçamentos
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "contactId" TEXT NOT NULL,
    "leadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "items" JSONB NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "saleIds" JSONB,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quotes_number_key" ON "quotes"("number");
CREATE INDEX "quotes_contactId_idx" ON "quotes"("contactId");
CREATE INDEX "quotes_createdAt_idx" ON "quotes"("createdAt");
