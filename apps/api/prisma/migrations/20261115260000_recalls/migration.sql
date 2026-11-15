-- AlterTable
ALTER TABLE "procedures" ADD COLUMN "returnDays" INTEGER;

-- Sugestões de intervalo de retorno (a clínica ajusta em Financeiro → Procedimentos)
UPDATE "procedures" SET "returnDays" = 120 WHERE "name" IN ('Botox', 'Combo botox + Preenchimento', 'Combo botox + Bioestimulador') AND "returnDays" IS NULL;
UPDATE "procedures" SET "returnDays" = 270 WHERE "name" = 'Preenchimento' AND "returnDays" IS NULL;
UPDATE "procedures" SET "returnDays" = 90 WHERE "name" = 'Bioestimulador' AND "returnDays" IS NULL;
UPDATE "procedures" SET "returnDays" = 30 WHERE "name" = 'Lavieen' AND "returnDays" IS NULL;
UPDATE "procedures" SET "returnDays" = 180 WHERE "name" = 'Ultraformer MPT' AND "returnDays" IS NULL;

-- CreateTable
CREATE TABLE "recall_actions" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dueKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recall_actions_contactId_idx" ON "recall_actions"("contactId");
