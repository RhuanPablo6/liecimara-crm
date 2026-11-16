-- Agenda fechada (férias, congresso, compromisso...)
CREATE TABLE "agenda_blocks" (
    "id" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agenda_blocks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agenda_blocks_startAt_endAt_idx" ON "agenda_blocks"("startAt", "endAt");
