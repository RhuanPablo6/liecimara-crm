-- Valores de tabela do histórico importado (Heon): fora do Financeiro e dos relatórios
ALTER TABLE "sales" ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payments" ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;
