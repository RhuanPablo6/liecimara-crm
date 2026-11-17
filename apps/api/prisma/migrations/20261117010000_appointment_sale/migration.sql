-- Venda vinculada ao agendamento
ALTER TABLE "appointments" ADD COLUMN "saleId" TEXT;
CREATE INDEX "appointments_saleId_idx" ON "appointments"("saleId");
