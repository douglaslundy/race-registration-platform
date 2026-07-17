-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_logs_channel_createdAt_idx" ON "message_logs"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "message_logs_recipientUserId_channel_createdAt_idx" ON "message_logs"("recipientUserId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "message_logs_providerMessageId_idx" ON "message_logs"("providerMessageId");

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
