-- CreateTable
CREATE TABLE "event_social_links" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxSends" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_link_sends" (
    "id" TEXT NOT NULL,
    "eventSocialLinkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_link_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_social_links_eventId_idx" ON "event_social_links"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "social_link_sends_eventSocialLinkId_userId_key" ON "social_link_sends"("eventSocialLinkId", "userId");

-- AddForeignKey
ALTER TABLE "event_social_links" ADD CONSTRAINT "event_social_links_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_link_sends" ADD CONSTRAINT "social_link_sends_eventSocialLinkId_fkey" FOREIGN KEY ("eventSocialLinkId") REFERENCES "event_social_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
