-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "patientResponse" TEXT,
ADD COLUMN "patientResponseAt" TIMESTAMP(3),
ADD COLUMN "patientNote" TEXT,
ADD COLUMN "rescheduleHandled" BOOLEAN NOT NULL DEFAULT false;
