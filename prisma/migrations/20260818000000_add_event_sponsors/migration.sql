-- CreateTable
CREATE TABLE "event_sponsors" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_sponsors_eventId_idx" ON "event_sponsors"("eventId");

-- AddForeignKey
ALTER TABLE "event_sponsors" ADD CONSTRAINT "event_sponsors_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: todo evento que já tem sponsorLink preenchido ganha 1 EventSponsor
-- equivalente, pra nada se perder na migração do mecanismo antigo pro novo. Nome e
-- mensagem genéricos — o organizador ajusta depois na tela nova se quiser.
-- gen_random_uuid() é nativo do Postgres a partir da versão 13, não precisa de extensão.
INSERT INTO "event_sponsors" ("id", "eventId", "name", "url", "message", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Patrocinador', "sponsorLink", 'Confira nosso patrocinador:', true, now(), now()
FROM "events"
WHERE "sponsorLink" IS NOT NULL AND "sponsorLink" != '';
