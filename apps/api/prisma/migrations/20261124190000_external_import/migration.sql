-- Importação de pacientes e agenda de outro sistema (Heon)
ALTER TABLE "contacts" ADD COLUMN "externalId" TEXT;
ALTER TABLE "contacts" ADD COLUMN "importedAt" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN "email" TEXT;
ALTER TABLE "contacts" ADD COLUMN "cpf" TEXT;
ALTER TABLE "contacts" ADD COLUMN "birthDate" DATE;
ALTER TABLE "contacts" ADD COLUMN "addressCep" TEXT;
ALTER TABLE "contacts" ADD COLUMN "addressStreet" TEXT;
ALTER TABLE "contacts" ADD COLUMN "addressNumber" TEXT;
ALTER TABLE "contacts" ADD COLUMN "addressDistrict" TEXT;
ALTER TABLE "contacts" ADD COLUMN "addressCity" TEXT;
ALTER TABLE "contacts" ADD COLUMN "addressState" TEXT;
CREATE UNIQUE INDEX "contacts_externalId_key" ON "contacts"("externalId");

ALTER TABLE "leads" ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "appointments" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "appointments_externalId_key" ON "appointments"("externalId");
