-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "eventId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_templates_eventId_idx" ON "message_templates"("eventId");

-- CreateIndex
CREATE INDEX "message_templates_alertKey_channel_recipientRole_idx" ON "message_templates"("alertKey", "channel", "recipientRole");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_alertKey_channel_recipientRole_scope_eventId_key" ON "message_templates"("alertKey", "channel", "recipientRole", "scope", "eventId");

-- CreateIndex
CREATE INDEX "message_template_versions_templateId_idx" ON "message_template_versions"("templateId");

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
