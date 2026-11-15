-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'RECEPTIONIST', 'VIEWER');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('CUSTOMER', 'BUSINESS_APP', 'CLOUD_API', 'HISTORY');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'SCHEDULED', 'ATTENDED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "AttributionConfidence" AS ENUM ('OFFICIAL_REFERRAL', 'MANUAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('PRICE', 'NO_RESPONSE', 'CHOSE_COMPETITOR', 'NOT_A_CANDIDATE', 'SCHEDULE_CONFLICT', 'JUST_RESEARCHING', 'OTHER');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('OFFICIAL_REFERRAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CANCELED', 'NO_SHOW', 'ATTENDED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('ACTIVE', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('WHATSAPP_CLOUD_API', 'WHATSAPP_COEXISTENCE_PARTNER', 'META_MARKETING');

-- CreateEnum
CREATE TYPE "IntegrationEnvironment" AS ENUM ('HOMOLOG', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "InboundEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD', 'IGNORED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'RECEPTIONIST',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "waId" TEXT,
    "bsuid" TEXT,
    "name" TEXT,
    "profileName" TEXT,
    "preExisting" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "removedFromAppAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "openedByAdMetaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "source" "MessageSource" NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,
    "hasAdReferral" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "metaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "objective" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("metaId")
);

-- CreateTable
CREATE TABLE "ad_sets" (
    "metaId" TEXT NOT NULL,
    "campaignMetaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_sets_pkey" PRIMARY KEY ("metaId")
);

-- CreateTable
CREATE TABLE "ads" (
    "metaId" TEXT NOT NULL,
    "adSetMetaId" TEXT NOT NULL,
    "campaignMetaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("metaId")
);

-- CreateTable
CREATE TABLE "ad_insights_daily" (
    "id" TEXT NOT NULL,
    "adMetaId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "metaMessagingConversationsStarted" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_insights_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultPriceCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "procedureInterestId" TEXT,
    "ownerId" TEXT,
    "attributionConfidence" "AttributionConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "adMetaId" TEXT,
    "adSetMetaId" TEXT,
    "campaignMetaId" TEXT,
    "attributionEvidenceId" TEXT,
    "lostReason" "LostReason",
    "lostNote" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribution_evidence" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" "EvidenceKind" NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "ctwaClid" TEXT,
    "headline" TEXT,
    "adMetaId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "note" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stage_history" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStage" "LeadStage",
    "toStage" "LeadStage" NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "procedureId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'ACTIVE',
    "attributionConfidence" "AttributionConfidence" NOT NULL,
    "adMetaId" TEXT,
    "campaignMetaId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedures_performed" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "saleId" TEXT,
    "procedureId" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procedures_performed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "assignedToId" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "environment" "IntegrationEnvironment" NOT NULL DEFAULT 'HOMOLOG',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "label" TEXT,
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "displayPhoneNumber" TEXT,
    "adAccountId" TEXT,
    "coexistence" BOOLEAN NOT NULL DEFAULT false,
    "encryptedCredentials" TEXT,
    "partnerConfig" JSONB,
    "webhookStatus" TEXT,
    "lastWebhookAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "permissionsDiagnostic" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_errors" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_events" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "InboundEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "dedupKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_waId_key" ON "contacts"("waId");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_bsuid_key" ON "contacts"("bsuid");

-- CreateIndex
CREATE INDEX "contacts_lastMessageAt_idx" ON "contacts"("lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_contactId_startedAt_idx" ON "conversations"("contactId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_waMessageId_key" ON "messages"("waMessageId");

-- CreateIndex
CREATE INDEX "messages_contactId_occurredAt_idx" ON "messages"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "messages_occurredAt_idx" ON "messages"("occurredAt");

-- CreateIndex
CREATE INDEX "ad_sets_campaignMetaId_idx" ON "ad_sets"("campaignMetaId");

-- CreateIndex
CREATE INDEX "ads_campaignMetaId_idx" ON "ads"("campaignMetaId");

-- CreateIndex
CREATE INDEX "ads_adSetMetaId_idx" ON "ads"("adSetMetaId");

-- CreateIndex
CREATE INDEX "ad_insights_daily_date_idx" ON "ad_insights_daily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_insights_daily_adMetaId_date_key" ON "ad_insights_daily"("adMetaId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "procedures_name_key" ON "procedures"("name");

-- CreateIndex
CREATE INDEX "leads_contactId_closedAt_idx" ON "leads"("contactId", "closedAt");

-- CreateIndex
CREATE INDEX "leads_stage_idx" ON "leads"("stage");

-- CreateIndex
CREATE INDEX "leads_adMetaId_idx" ON "leads"("adMetaId");

-- CreateIndex
CREATE INDEX "leads_openedAt_idx" ON "leads"("openedAt");

-- CreateIndex
CREATE INDEX "attribution_evidence_leadId_idx" ON "attribution_evidence"("leadId");

-- CreateIndex
CREATE INDEX "attribution_evidence_adMetaId_idx" ON "attribution_evidence"("adMetaId");

-- CreateIndex
CREATE INDEX "lead_stage_history_leadId_idx" ON "lead_stage_history"("leadId");

-- CreateIndex
CREATE INDEX "appointments_leadId_idx" ON "appointments"("leadId");

-- CreateIndex
CREATE INDEX "appointments_scheduledFor_idx" ON "appointments"("scheduledFor");

-- CreateIndex
CREATE INDEX "sales_leadId_idx" ON "sales"("leadId");

-- CreateIndex
CREATE INDEX "sales_soldAt_idx" ON "sales"("soldAt");

-- CreateIndex
CREATE INDEX "sales_adMetaId_idx" ON "sales"("adMetaId");

-- CreateIndex
CREATE INDEX "payments_saleId_idx" ON "payments"("saleId");

-- CreateIndex
CREATE INDEX "procedures_performed_leadId_idx" ON "procedures_performed"("leadId");

-- CreateIndex
CREATE INDEX "procedures_performed_performedAt_idx" ON "procedures_performed"("performedAt");

-- CreateIndex
CREATE INDEX "reminders_dueAt_doneAt_idx" ON "reminders"("dueAt", "doneAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_provider_environment_key" ON "integration_connections"("provider", "environment");

-- CreateIndex
CREATE INDEX "integration_errors_provider_createdAt_idx" ON "integration_errors"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_events_dedupKey_key" ON "inbound_events"("dedupKey");

-- CreateIndex
CREATE INDEX "inbound_events_status_receivedAt_idx" ON "inbound_events"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupKey_key" ON "jobs"("dedupKey");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_idx" ON "jobs"("status", "runAt");
