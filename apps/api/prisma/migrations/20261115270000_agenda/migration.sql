-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "durationMin" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "notes" TEXT;
