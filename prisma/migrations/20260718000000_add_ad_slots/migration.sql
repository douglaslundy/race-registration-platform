-- CreateTable
CREATE TABLE "ad_slots" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "googleAdUnitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_slots_key_key" ON "ad_slots"("key");

-- CreateTable
CREATE TABLE "ad_metrics_snapshots" (
    "id" TEXT NOT NULL,
    "adSlotId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "estimatedRevenueMicros" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_metrics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_metrics_snapshots_adSlotId_date_key" ON "ad_metrics_snapshots"("adSlotId", "date");

-- AddForeignKey
ALTER TABLE "ad_metrics_snapshots" ADD CONSTRAINT "ad_metrics_snapshots_adSlotId_fkey" FOREIGN KEY ("adSlotId") REFERENCES "ad_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: as 5 posições fixas, todas desabilitadas por padrão
INSERT INTO "ad_slots" ("id", "key", "label", "width", "height", "enabled", "updatedAt") VALUES
  ('adslot_eventos_abaixo_banner', 'EVENTOS_ABAIXO_BANNER', 'Abaixo do banner — página de eventos', 728, 90, false, CURRENT_TIMESTAMP),
  ('adslot_eventos_coluna_esquerda', 'EVENTOS_COLUNA_ESQUERDA', 'Coluna de filtros — página de eventos', 300, 250, false, CURRENT_TIMESTAMP),
  ('adslot_eventos_entre_resultados', 'EVENTOS_ENTRE_RESULTADOS', 'Entre os resultados — página de eventos', 728, 90, false, CURRENT_TIMESTAMP),
  ('adslot_evento_detalhe_abaixo_banner', 'EVENTO_DETALHE_ABAIXO_BANNER', 'Abaixo do banner — detalhe do evento', 728, 90, false, CURRENT_TIMESTAMP),
  ('adslot_evento_detalhe_coluna_direita', 'EVENTO_DETALHE_COLUNA_DIREITA', 'Coluna direita — detalhe do evento', 300, 250, false, CURRENT_TIMESTAMP);
