-- AlterTable: escopo por evento nas permissões de assistente.
-- eventId NULL = permissão vale para todos os eventos do responsável (comportamento histórico).
ALTER TABLE "assistant_permissions" ADD COLUMN "eventId" TEXT;

-- Troca o índice único (userId, actionKey) pelo novo (userId, actionKey, eventId).
DROP INDEX "assistant_permissions_userId_actionKey_key";
CREATE UNIQUE INDEX "assistant_permissions_userId_actionKey_eventId_key" ON "assistant_permissions"("userId", "actionKey", "eventId");

-- Índice pra lookup por evento (e pra FK).
CREATE INDEX "assistant_permissions_eventId_idx" ON "assistant_permissions"("eventId");

-- FK opcional pro evento; deletar o evento remove as permissões restritas a ele.
ALTER TABLE "assistant_permissions" ADD CONSTRAINT "assistant_permissions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
