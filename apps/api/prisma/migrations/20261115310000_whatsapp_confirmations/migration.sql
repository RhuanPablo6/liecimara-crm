-- Confirmação de agendamento enviada pelo WhatsApp (YCloud)
ALTER TABLE "appointments" ADD COLUMN "confirmationSentAt" TIMESTAMP(3),
ADD COLUMN "confirmationMessageId" TEXT,
ADD COLUMN "confirmationError" TEXT;
