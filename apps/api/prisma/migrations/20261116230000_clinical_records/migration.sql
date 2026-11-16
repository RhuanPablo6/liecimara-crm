-- Prontuário estético
CREATE TABLE "clinical_forms" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "procedureId" TEXT,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "imageUse" TEXT,
    "signerName" TEXT,
    "signerDocument" TEXT,
    "signature" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "contentHash" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "clinical_forms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "clinical_forms_contactId_idx" ON "clinical_forms"("contactId");

CREATE TABLE "clinical_sessions" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "procedureId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "products" JSONB NOT NULL,
    "areas" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "clinical_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "clinical_sessions_contactId_idx" ON "clinical_sessions"("contactId");

CREATE TABLE "clinical_photos" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "sessionId" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "stage" TEXT NOT NULL,
    "angle" TEXT,
    "caption" TEXT,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clinical_photos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "clinical_photos_contactId_idx" ON "clinical_photos"("contactId");
CREATE INDEX "clinical_photos_sessionId_idx" ON "clinical_photos"("sessionId");
