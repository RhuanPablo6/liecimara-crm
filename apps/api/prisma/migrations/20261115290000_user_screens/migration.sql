-- AlterTable
ALTER TABLE "users" ADD COLUMN "screens" JSONB,
ADD COLUMN "lastLoginAt" TIMESTAMP(3);
