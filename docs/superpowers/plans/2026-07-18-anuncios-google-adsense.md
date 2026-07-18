# Anúncios — posições no site + Google AdSense — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o admin ative posições de anúncio fixas em 5 pontos do site público,
exiba anúncios reais do Google AdSense nelas, e veja métricas (impressões/cliques/receita
estimada) puxadas via OAuth da API de relatórios do AdSense.

**Architecture:** Tabela `AdSlot` guarda as 5 posições fixas (liga/desliga + fonte +
`googleAdUnitId`). Um componente `<AdSlotRenderer>` (Server Component) é inserido nos 5 pontos
reais do layout já mapeados; ele só carrega o script do AdSense quando pelo menos uma posição
Google está ativa. Conexão OAuth com a conta AdSense (fluxo padrão authorization-code, sem SDK —
`fetch` puro, mesmo estilo de `lib/whatsapp/evolution-client.ts`) alimenta um cron que sincroniza
métricas diárias em `AdMetricsSnapshot`.

**Tech Stack:** Next.js 15 App Router, Prisma, Vitest, Google OAuth2 + AdSense Management API v2
(REST puro, sem SDK).

## Global Constraints

- As 5 posições são fixas no código nesta versão — sem CRUD de criação de posição pela UI (ver
  spec, "Fora de escopo").
- `source: "PRIVATE"` é um valor de string válido no campo `AdSlot.source` desde já (schema), mas
  nenhum código produz esse valor nesta feature — reservado pro sub-projeto 4.
- Métricas nunca mostram zero como se fosse dado real — sem conexão OAuth, a tela mostra estado
  vazio explícito ("Conecte sua conta...").
- Uma falha de sincronização de métricas (token expirado sem refresh, API fora do ar) nunca
  quebra a exibição dos anúncios em si — são sistemas independentes (exibição não depende de
  OAuth; só o painel de métricas depende).
- Sem SDK novo (`googleapis` ou similar) — chamadas REST via `fetch`, mesmo padrão de
  `lib/whatsapp/evolution-client.ts`.
- Script do AdSense só carrega no client quando existe ao menos 1 `AdSlot` com
  `enabled=true, source="GOOGLE"` — nunca carrega à toa.

Spec completa: `docs/superpowers/specs/2026-07-18-anuncios-google-adsense-design.md`.

---

## Task 1: Schema — `AdSlot` + `AdMetricsSnapshot` + seed das 5 posições

**Files:**
- Modify: `prisma/schema.prisma` (novos modelos, após `MessageLog`)
- Create: `prisma/migrations/20260718000000_add_ad_slots/migration.sql`

**Interfaces:**
- Produces: modelos `AdSlot` (`id, key, label, width, height, enabled, source, googleAdUnitId,
  createdAt, updatedAt`) e `AdMetricsSnapshot` (`id, adSlotId, date, impressions, clicks,
  estimatedRevenueMicros, currency, createdAt`) — consumidos por todas as tasks seguintes.

Sem banco de dev acessível — verificação só de sintaxe (`prisma validate`/`generate`).

- [ ] **Step 1: Adicionar os modelos em `prisma/schema.prisma`**

Logo após o modelo `MessageLog` (que termina em `@@map("message_logs")`), inserir:

```prisma
model AdSlot {
  id             String   @id @default(cuid())
  key            String   @unique
  label          String
  width          Int
  height         Int
  enabled        Boolean  @default(false)
  source         String?
  googleAdUnitId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  metrics AdMetricsSnapshot[]

  @@map("ad_slots")
}

model AdMetricsSnapshot {
  id                     String   @id @default(cuid())
  adSlotId               String
  date                   DateTime
  impressions            Int
  clicks                 Int
  estimatedRevenueMicros BigInt
  currency               String
  createdAt              DateTime @default(now())

  adSlot AdSlot @relation(fields: [adSlotId], references: [id])

  @@unique([adSlotId, date])
  @@map("ad_metrics_snapshots")
}
```

- [ ] **Step 2: Validar a sintaxe**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sem erros.

- [ ] **Step 3: Escrever a migração manualmente (com seed das 5 posições)**

Criar `prisma/migrations/20260718000000_add_ad_slots/migration.sql`:

```sql
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
```

Aditiva, sem sequenciamento especial — `prisma db push` no deploy não roda `migration.sql`
(esse projeto usa `db push`, não `migrate deploy`), então o INSERT do seed **não será aplicado
automaticamente pelo deploy**. Anotar isso explicitamente pra Task 17 (verificação final) — os
5 registros de `AdSlot` precisam ser inseridos manualmente (rodando esse mesmo bloco de `INSERT`
direto no banco, ou via `prisma db seed` se esse projeto tiver um seed script) como parte do
deploy desta feature, não é automático como as migrações puramente estruturais já foram até
agora.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260718000000_add_ad_slots
git commit -m "feat: add AdSlot and AdMetricsSnapshot schema, seed 5 fixed positions"
```

---

## Task 2: `tests/setup.ts` — mock dos novos modelos

**Files:**
- Modify: `tests/setup.ts`

**Interfaces:**
- Produces: `db.adSlot.{findMany,findUnique,update,updateMany}`,
  `db.adMetricsSnapshot.{findMany,upsert,aggregate}` mockados.

- [ ] **Step 1: Editar `tests/setup.ts`**

Logo após a linha do `messageLog` (adicionada na feature anterior), adicionar:

```ts
    adSlot: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    adMetricsSnapshot: { findMany: vi.fn(), upsert: vi.fn(), aggregate: vi.fn() },
```

- [ ] **Step 2: Commit**

```bash
git add tests/setup.ts
git commit -m "test: add AdSlot and AdMetricsSnapshot to the global db mock"
```

---

## Task 3: `lib/ad-slots.ts` — leitura/escrita das posições

**Files:**
- Create: `lib/ad-slots.ts`
- Test: `tests/lib-ad-slots.test.ts`

**Interfaces:**
- Produces: `listAdSlots(): Promise<AdSlotRow[]>`, `getAdSlot(key: string): Promise<AdSlotRow |
  null>` (cacheável, mesmo padrão de `lib/settings.ts`), `updateAdSlot(id: string, data: {
  enabled?: boolean; source?: string | null; googleAdUnitId?: string | null }): Promise<void>` —
  consumidos pelas Tasks 4 (exibição), 7-8 (admin UI).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-ad-slots.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listAdSlots, getAdSlot, updateAdSlot } from "@/lib/ad-slots";

const dbMock = db as any;

describe("listAdSlots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna todas as posições ordenadas por key", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ key: "A" }, { key: "B" }]);
    const result = await listAdSlots();
    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({ orderBy: { key: "asc" } });
    expect(result).toEqual([{ key: "A" }, { key: "B" }]);
  });
});

describe("getAdSlot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("busca uma posição pela key", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({ key: "EVENTOS_ABAIXO_BANNER", enabled: true });
    const result = await getAdSlot("EVENTOS_ABAIXO_BANNER");
    expect(dbMock.adSlot.findUnique).toHaveBeenCalledWith({ where: { key: "EVENTOS_ABAIXO_BANNER" } });
    expect(result).toEqual({ key: "EVENTOS_ABAIXO_BANNER", enabled: true });
  });

  it("retorna null quando a posição não existe", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce(null);
    expect(await getAdSlot("INEXISTENTE")).toBeNull();
  });
});

describe("updateAdSlot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atualiza só os campos informados", async () => {
    dbMock.adSlot.update.mockResolvedValueOnce({});
    await updateAdSlot("slot-1", { enabled: true, source: "GOOGLE", googleAdUnitId: "1234567890" });
    expect(dbMock.adSlot.update).toHaveBeenCalledWith({
      where: { id: "slot-1" },
      data: { enabled: true, source: "GOOGLE", googleAdUnitId: "1234567890" },
    });
  });

  it("permite limpar source e googleAdUnitId com null", async () => {
    dbMock.adSlot.update.mockResolvedValueOnce({});
    await updateAdSlot("slot-1", { enabled: false, source: null, googleAdUnitId: null });
    expect(dbMock.adSlot.update).toHaveBeenCalledWith({
      where: { id: "slot-1" },
      data: { enabled: false, source: null, googleAdUnitId: null },
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-ad-slots.test.ts`
Expected: FAIL — módulo `@/lib/ad-slots` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/ad-slots.ts`:

```ts
import { cache } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { db } from "./db";

export interface AdSlotRow {
  id: string;
  key: string;
  label: string;
  width: number;
  height: number;
  enabled: boolean;
  source: string | null;
  googleAdUnitId: string | null;
}

export async function listAdSlots(): Promise<AdSlotRow[]> {
  return db.adSlot.findMany({ orderBy: { key: "asc" } });
}

export const getAdSlot = cache(async (key: string): Promise<AdSlotRow | null> => {
  noStore();
  return db.adSlot.findUnique({ where: { key } });
});

export interface UpdateAdSlotData {
  enabled?: boolean;
  source?: string | null;
  googleAdUnitId?: string | null;
}

export async function updateAdSlot(id: string, data: UpdateAdSlotData): Promise<void> {
  await db.adSlot.update({ where: { id }, data });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-ad-slots.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add lib/ad-slots.ts tests/lib-ad-slots.test.ts
git commit -m "feat: add ad-slots read/write module"
```

---

## Task 4: `<AdSlotRenderer>` + script do AdSense no layout público

**Files:**
- Create: `components/ads/AdSlotRenderer.tsx`
- Modify: `app/(public)/layout.tsx`
- Test: `tests/has-active-google-ad-slot.test.ts` (só a função auxiliar de decisão, ver Step 1)

**Interfaces:**
- Consumes: `getAdSlot` (Task 3).
- Produces: `<AdSlotRenderer position="..." />` — consumido pelas Tasks 5 e 6.
  `hasActiveGoogleAdSlot(): Promise<boolean>` — consumido pelo layout público (Step 3) pra decidir
  se carrega o script do AdSense.

- [ ] **Step 1: Escrever o teste que falha (só a função auxiliar — o componente React em si não
  tem teste automatizado, mesmo padrão de zero testes de componente já estabelecido no repo)**

Criar `tests/has-active-google-ad-slot.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasActiveGoogleAdSlot } from "@/lib/ad-slots";

const dbMock = db as any;

describe("hasActiveGoogleAdSlot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna true quando existe ao menos 1 posição enabled com source GOOGLE", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "1" }]);
    const result = await hasActiveGoogleAdSlot();
    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({
      where: { enabled: true, source: "GOOGLE" },
      take: 1,
    });
    expect(result).toBe(true);
  });

  it("retorna false quando não existe nenhuma", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([]);
    expect(await hasActiveGoogleAdSlot()).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/has-active-google-ad-slot.test.ts`
Expected: FAIL — `hasActiveGoogleAdSlot` não existe em `lib/ad-slots.ts`.

- [ ] **Step 3: Implementar**

Adicionar ao final de `lib/ad-slots.ts`:

```ts
export async function hasActiveGoogleAdSlot(): Promise<boolean> {
  const rows = await db.adSlot.findMany({ where: { enabled: true, source: "GOOGLE" }, take: 1 });
  return rows.length > 0;
}
```

Criar `components/ads/AdSlotRenderer.tsx`:

```tsx
import { getAdSlot } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";

export default async function AdSlotRenderer({ position }: { position: string }) {
  const slot = await getAdSlot(position);
  if (!slot || !slot.enabled || slot.source !== "GOOGLE" || !slot.googleAdUnitId) return null;

  const clientId = await getSetting("google_adsense_client_id");
  if (!clientId) return null;

  return (
    <div style={{ width: slot.width, maxWidth: "100%" }} className="mx-auto">
      <ins
        className="adsbygoogle"
        style={{ display: "inline-block", width: slot.width, height: slot.height }}
        data-ad-client={clientId}
        data-ad-slot={slot.googleAdUnitId}
      />
      <script
        dangerouslySetInnerHTML={{ __html: "(adsbygoogle = window.adsbygoogle || []).push({});" }}
      />
    </div>
  );
}
```

Modificar `app/(public)/layout.tsx` — adicionar o carregamento condicional do script principal:

```tsx
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { getAppName } from "@/lib/settings";
import { hasActiveGoogleAdSlot } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";
import Script from "next/script";

export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [appName, showAdSenseScript, clientId] = await Promise.all([
    getAppName(),
    hasActiveGoogleAdSlot(),
    getSetting("google_adsense_client_id"),
  ]);

  return (
    <div className="flex flex-col min-h-screen">
      {showAdSenseScript && clientId && (
        <Script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      )}
      <Header appName={appName} />
      <div className="flex-1">{children}</div>
      <Footer appName={appName} />
    </div>
  );
}
```

`next/script`'s `Script` component já é a forma padrão do Next.js de carregar script de terceiro
— não precisa de nenhuma dependência nova.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/has-active-google-ad-slot.test.ts`
Expected: PASS (2/2)

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add lib/ad-slots.ts components/ads/AdSlotRenderer.tsx app/\(public\)/layout.tsx tests/has-active-google-ad-slot.test.ts
git commit -m "feat: add AdSlotRenderer component and conditional AdSense script loading"
```

---

## Task 5: Inserir `<AdSlotRenderer>` em `app/(public)/eventos/page.tsx`

**Files:**
- Modify: `app/(public)/eventos/page.tsx`

**Interfaces:**
- Consumes: `<AdSlotRenderer position="..." />` (Task 4).

Sem teste automatizado (página, zero testes de página neste repo). Verificação: `tsc` + Task 17.

- [ ] **Step 1: Adicionar o import**

```tsx
import AdSlotRenderer from "@/components/ads/AdSlotRenderer";
```

- [ ] **Step 2: Inserir os 3 slots**

Logo após `<EventsBanner intervalSeconds={bannerInterval} />` e antes do bloco `<div
className="mb-8">` do título:

```tsx
      <EventsBanner intervalSeconds={bannerInterval} />

      <AdSlotRenderer position="EVENTOS_ABAIXO_BANNER" />

      <div className="mb-8">
```

Dentro do `<aside>`, logo após `<EventFilters locations={locations} />`:

```tsx
        <aside>
          <EventFilters locations={locations} />
          <div className="mt-6">
            <AdSlotRenderer position="EVENTOS_COLUNA_ESQUERDA" />
          </div>
        </aside>
```

Entre o grid de eventos e a checagem `{totalPages > 1 && (`, dentro do `<div
className="lg:col-span-3">`:

```tsx
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>

              <div className="my-6">
                <AdSlotRenderer position="EVENTOS_ENTRE_RESULTADOS" />
              </div>

              {totalPages > 1 && (
```

- [ ] **Step 3: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/\(public\)/eventos/page.tsx
git commit -m "feat: add 3 ad slots to the public events listing page"
```

---

## Task 6: Inserir `<AdSlotRenderer>` em `app/(public)/eventos/[slug]/page.tsx`

**Files:**
- Modify: `app/(public)/eventos/[slug]/page.tsx`

**Interfaces:**
- Consumes: `<AdSlotRenderer position="..." />` (Task 4).

Sem teste automatizado. Verificação: `tsc` + Task 17.

- [ ] **Step 1: Adicionar o import**

```tsx
import AdSlotRenderer from "@/components/ads/AdSlotRenderer";
```

- [ ] **Step 2: Inserir os 2 slots**

Logo após o bloco condicional do `heroBannerUrl` (fecha em `)}` na linha 76) e antes do `<div
className="grid grid-cols-1 md:grid-cols-3 gap-8">` (linha 78):

```tsx
      )}

      <div className="mb-8">
        <AdSlotRenderer position="EVENTO_DETALHE_ABAIXO_BANNER" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
```

Dentro do `<aside>`, como último elemento, depois do `</div>` que fecha o card `sticky top-4`
(linha 193) e antes do `</aside>` (linha 194):

```tsx
          </div>

          <div className="mt-4">
            <AdSlotRenderer position="EVENTO_DETALHE_COLUNA_DIREITA" />
          </div>
        </aside>
```

- [ ] **Step 3: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/\(public\)/eventos/\[slug\]/page.tsx
git commit -m "feat: add 2 ad slots to the public event detail page"
```

---

## Task 7: `PATCH /api/admin/ads/slots/[id]`

**Files:**
- Create: `app/api/admin/ads/slots/[id]/route.ts`
- Test: `tests/admin-ad-slots-route.test.ts`

**Interfaces:**
- Consumes: `updateAdSlot` (Task 3).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-ad-slots-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ad-slots", () => ({ updateAdSlot: vi.fn() }));

import { PATCH } from "@/app/api/admin/ads/slots/[id]/route";
import { updateAdSlot } from "@/lib/ad-slots";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/ads/slots/slot-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/admin/ads/slots/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await PATCH(makeRequest({ enabled: true }), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(403);
    expect(updateAdSlot).not.toHaveBeenCalled();
  });

  it("retorna 400 com payload inválido (source fora do enum aceito)", async () => {
    const res = await PATCH(
      makeRequest({ source: "BING" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(res.status).toBe(400);
    expect(updateAdSlot).not.toHaveBeenCalled();
  });

  it("atualiza a posição com payload válido e retorna 200", async () => {
    const res = await PATCH(
      makeRequest({ enabled: true, source: "GOOGLE", googleAdUnitId: "1234567890" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", {
      enabled: true,
      source: "GOOGLE",
      googleAdUnitId: "1234567890",
    });
    expect(res.status).toBe(200);
  });

  it("aceita source null (desativa a fonte sem desligar a posição)", async () => {
    const res = await PATCH(
      makeRequest({ source: null, googleAdUnitId: null }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", { source: null, googleAdUnitId: null });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/admin-ad-slots-route.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/admin/ads/slots/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateAdSlot } from "@/lib/ad-slots";
import { z } from "zod";

const schema = z.object({
  enabled: z.boolean().optional(),
  source: z.enum(["GOOGLE", "PRIVATE"]).nullable().optional(),
  googleAdUnitId: z.string().max(100).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await updateAdSlot(id, parsed.data);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/admin-ad-slots-route.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/ads/slots/\[id\]/route.ts tests/admin-ad-slots-route.test.ts
git commit -m "feat: add PATCH route to update ad slot configuration"
```

---

## Task 8: `/admin/anuncios` — lista + formulário de edição

**Files:**
- Create: `app/admin/anuncios/page.tsx`
- Create: `components/admin/AdSlotEditForm.tsx`

**Interfaces:**
- Consumes: `listAdSlots` (Task 3), `PATCH /api/admin/ads/slots/[id]` (Task 7).

Sem teste automatizado (página + componente client, zero testes de UI no repo). Verificação:
`tsc` + Task 17.

- [ ] **Step 1: Criar o formulário client**

Criar `components/admin/AdSlotEditForm.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Props {
  id: string;
  enabled: boolean;
  source: string | null;
  googleAdUnitId: string | null;
}

export default function AdSlotEditForm({ id, enabled: initialEnabled, source: initialSource, googleAdUnitId: initialGoogleAdUnitId }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [source, setSource] = useState(initialSource ?? "");
  const [googleAdUnitId, setGoogleAdUnitId] = useState(initialGoogleAdUnitId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/admin/ads/slots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        source: source || null,
        googleAdUnitId: source === "GOOGLE" ? (googleAdUnitId || null) : null,
      }),
    });
    if (res.ok) {
      setSaved(true);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ? JSON.stringify(data.error) : "Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} />
        Ativa
      </label>
      <select
        value={source}
        onChange={(e) => { setSource(e.target.value); setSaved(false); }}
        className="input-field text-sm py-1 w-40"
      >
        <option value="">Nenhuma</option>
        <option value="GOOGLE">Google AdSense</option>
        <option value="PRIVATE" disabled>Privada (em breve)</option>
      </select>
      {source === "GOOGLE" && (
        <input
          type="text"
          value={googleAdUnitId}
          onChange={(e) => { setGoogleAdUnitId(e.target.value); setSaved(false); }}
          placeholder="ID do bloco de anúncio (data-ad-slot)"
          className="input-field text-sm py-1 w-56"
        />
      )}
      <button onClick={handleSave} disabled={saving} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
        {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Criar a página**

Criar `app/admin/anuncios/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/rbac";
import { listAdSlots } from "@/lib/ad-slots";
import AdSlotEditForm from "@/components/admin/AdSlotEditForm";

export const metadata: Metadata = { title: "Anúncios — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAnunciosPage() {
  await requireAdmin();
  const slots = await listAdSlots();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Anúncios</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/anuncios/conectar-google" className="btn-secondary py-1.5 px-3">Conectar Google AdSense</Link>
          <Link href="/admin/anuncios/metricas" className="btn-secondary py-1.5 px-3">Métricas</Link>
        </div>
      </div>

      <div className="card divide-y dark:divide-gray-700">
        {slots.map((slot) => (
          <div key={slot.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
            <div>
              <p className="font-medium">{slot.label}</p>
              <p className="text-xs text-gray-500">{slot.width}×{slot.height}px — {slot.key}</p>
            </div>
            <AdSlotEditForm
              id={slot.id}
              enabled={slot.enabled}
              source={slot.source}
              googleAdUnitId={slot.googleAdUnitId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/admin/anuncios/page.tsx components/admin/AdSlotEditForm.tsx
git commit -m "feat: add admin ad slots management page"
```

---

## Task 9: `lib/ads/adsense-oauth.ts` — OAuth com o Google

**Files:**
- Create: `lib/ads/adsense-oauth.ts`
- Test: `tests/adsense-oauth.test.ts`

**Interfaces:**
- Produces: `buildGoogleAuthUrl(redirectUri: string): string`,
  `exchangeCodeForTokens(code: string, redirectUri: string): Promise<{accessToken: string;
  refreshToken: string; expiresAt: Date}>`, `refreshAccessToken(refreshToken: string):
  Promise<{accessToken: string; expiresAt: Date}>`, `fetchAdSensePublisherId(accessToken:
  string): Promise<string | null>` — consumidos pela Task 10.

> **Nota pro implementador:** os endpoints/escopos usados aqui são os documentados publicamente
> pela Google (OAuth2 padrão + AdSense Management API v2) — mais estáveis que a API da Evolution
> usada no sub-projeto anterior, mas ainda assim, sem uma conta real conectada, os testes cobrem
> a MONTAGEM da requisição (URL, headers, body), não uma chamada de verdade. Se o formato da
> resposta real da Google divergir num detalhe (nome de campo, por exemplo) ao testar com conta
> real, ajustar só a função afetada — a estrutura (montar URL → trocar código → renovar → buscar
> publisher) não muda.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/adsense-oauth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchAdSensePublisherId,
} from "@/lib/ads/adsense-oauth";

const originalEnv = { ...process.env };

describe("buildGoogleAuthUrl", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, GOOGLE_ADS_OAUTH_CLIENT_ID: "client-123" };
  });

  it("monta a URL de autorização com escopo readonly e o client_id configurado", () => {
    const url = buildGoogleAuthUrl("https://app.example.com/api/admin/ads/google/callback");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("client-123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/admin/ads/google/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adsense.readonly");
  });
});

describe("exchangeCodeForTokens", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, GOOGLE_ADS_OAUTH_CLIENT_ID: "client-123", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret-abc" };
    global.fetch = vi.fn();
  });

  it("troca o código por tokens via POST em oauth2.googleapis.com/token", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
    });

    const result = await exchangeCodeForTokens("auth-code", "https://app.example.com/callback");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.accessToken).toBe("at-1");
    expect(result.refreshToken).toBe("rt-1");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("lança erro quando a Google rejeita a troca", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });
    await expect(exchangeCodeForTokens("bad-code", "https://app.example.com/callback")).rejects.toThrow();
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, GOOGLE_ADS_OAUTH_CLIENT_ID: "client-123", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret-abc" };
    global.fetch = vi.fn();
  });

  it("renova o access token usando o refresh token", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at-2", expires_in: 3600 }),
    });

    const result = await refreshAccessToken("rt-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.accessToken).toBe("at-2");
  });

  it("lança erro quando o refresh falha (ex.: acesso revogado)", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });
    await expect(refreshAccessToken("revoked-token")).rejects.toThrow();
  });
});

describe("fetchAdSensePublisherId", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("busca a lista de contas e retorna o primeiro publisherId (formato pub-XXXX)", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accounts: [{ name: "accounts/pub-1234567890123456" }] }),
    });

    const result = await fetchAdSensePublisherId("at-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://adsense.googleapis.com/v2/accounts",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer at-1" }) }),
    );
    expect(result).toBe("pub-1234567890123456");
  });

  it("retorna null quando não há nenhuma conta", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ accounts: [] }) });
    expect(await fetchAdSensePublisherId("at-1")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/adsense-oauth.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `lib/ads/adsense-oauth.ts`:

```ts
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADSENSE_SCOPE = "https://www.googleapis.com/auth/adsense.readonly";

export function buildGoogleAuthUrl(redirectUri: string): string {
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: ADSENSE_SCOPE,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function requestToken(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`Google OAuth ${res.status}: ${JSON.stringify(errBody).slice(0, 300)}`);
  }
  return res.json();
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const data = await requestToken({
    code,
    client_id: process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const data = await requestToken({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
}

export async function fetchAdSensePublisherId(accessToken: string): Promise<string | null> {
  const res = await fetch("https://adsense.googleapis.com/v2/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`AdSense API ${res.status}: ${JSON.stringify(errBody).slice(0, 300)}`);
  }
  const data = await res.json();
  const first = data.accounts?.[0]?.name as string | undefined;
  if (!first) return null;
  return first.replace("accounts/", "");
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/adsense-oauth.test.ts`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add lib/ads/adsense-oauth.ts tests/adsense-oauth.test.ts
git commit -m "feat: add Google OAuth + AdSense account lookup module"
```

---

## Task 10: Rotas de conexão — `connect` / `callback` / `disconnect`

**Files:**
- Create: `app/api/admin/ads/google/connect/route.ts`
- Create: `app/api/admin/ads/google/callback/route.ts`
- Create: `app/api/admin/ads/google/disconnect/route.ts`
- Test: `tests/admin-ads-google-routes.test.ts`

**Interfaces:**
- Consumes: `buildGoogleAuthUrl`, `exchangeCodeForTokens`, `fetchAdSensePublisherId` (Task 9),
  `upsertSetting` (`lib/settings.ts`, já existente).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-ads-google-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ upsertSetting: vi.fn(), getSetting: vi.fn() }));
vi.mock("@/lib/ads/adsense-oauth", () => ({
  buildGoogleAuthUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  fetchAdSensePublisherId: vi.fn(),
}));

import { GET as connectGet } from "@/app/api/admin/ads/google/connect/route";
import { GET as callbackGet } from "@/app/api/admin/ads/google/callback/route";
import { POST as disconnectPost } from "@/app/api/admin/ads/google/disconnect/route";
import { upsertSetting } from "@/lib/settings";
import { buildGoogleAuthUrl, exchangeCodeForTokens, fetchAdSensePublisherId } from "@/lib/ads/adsense-oauth";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeCallbackRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/admin/ads/google/callback");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url) as any;
}

describe("GET /api/admin/ads/google/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await connectGet();
    expect(res.status).toBe(403);
  });

  it("redireciona pra URL de autorização da Google", async () => {
    vi.mocked(buildGoogleAuthUrl).mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    const res = await connectGet();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1");
  });
});

describe("GET /api/admin/ads/google/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await callbackGet(makeCallbackRequest({ code: "abc" }));
    expect(res.status).toBe(403);
  });

  it("redireciona de volta pra tela de anúncios com erro quando falta o code", async () => {
    const res = await callbackGet(makeCallbackRequest({}));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/anuncios/conectar-google");
    expect(res.headers.get("location")).toContain("error");
  });

  it("troca o code por tokens, busca o publisherId, salva tudo e redireciona com sucesso", async () => {
    vi.mocked(exchangeCodeForTokens).mockResolvedValueOnce({
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    vi.mocked(fetchAdSensePublisherId).mockResolvedValueOnce("pub-123");

    const res = await callbackGet(makeCallbackRequest({ code: "auth-code" }));

    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_access_token", "at-1");
    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_refresh_token", "rt-1");
    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_publisher_id", "pub-123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/anuncios/conectar-google");
    expect(res.headers.get("location")).not.toContain("error");
  });
});

describe("POST /api/admin/ads/google/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await disconnectPost();
    expect(res.status).toBe(403);
  });

  it("limpa os tokens salvos e retorna 200", async () => {
    const res = await disconnectPost();
    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_access_token", "");
    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_refresh_token", "");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run tests/admin-ads-google-routes.test.ts`
Expected: FAIL — nenhuma das 3 rotas existe.

- [ ] **Step 3: Implementar**

Criar `app/api/admin/ads/google/connect/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildGoogleAuthUrl } from "@/lib/ads/adsense-oauth";

function callbackUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `${baseUrl}/api/admin/ads/google/callback`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  return NextResponse.redirect(buildGoogleAuthUrl(callbackUrl()));
}
```

Criar `app/api/admin/ads/google/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertSetting } from "@/lib/settings";
import { exchangeCodeForTokens, fetchAdSensePublisherId } from "@/lib/ads/adsense-oauth";

function callbackUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `${baseUrl}/api/admin/ads/google/callback`;
}

function redirectTo(path: string): NextResponse {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return NextResponse.redirect(`${baseUrl}${path}`);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectTo("/admin/anuncios/conectar-google?error=1");
  }

  try {
    const tokens = await exchangeCodeForTokens(code, callbackUrl());
    const publisherId = await fetchAdSensePublisherId(tokens.accessToken);

    await upsertSetting("google_adsense_access_token", tokens.accessToken);
    await upsertSetting("google_adsense_refresh_token", tokens.refreshToken);
    await upsertSetting("google_adsense_token_expires_at", tokens.expiresAt.toISOString());
    if (publisherId) await upsertSetting("google_adsense_publisher_id", publisherId);

    return redirectTo("/admin/anuncios/conectar-google");
  } catch {
    return redirectTo("/admin/anuncios/conectar-google?error=1");
  }
}
```

Criar `app/api/admin/ads/google/disconnect/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertSetting } from "@/lib/settings";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  await upsertSetting("google_adsense_access_token", "");
  await upsertSetting("google_adsense_refresh_token", "");

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npx vitest run tests/admin-ads-google-routes.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Documentar as env vars**

Em `.env.example`, adicionar após o bloco `WHATSAPP_WEBHOOK_SECRET`:

```
# Google AdSense (OAuth) — criar em console.cloud.google.com, ativar "AdSense Management API"
GOOGLE_ADS_OAUTH_CLIENT_ID=""
GOOGLE_ADS_OAUTH_CLIENT_SECRET=""
```

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/ads/google tests/admin-ads-google-routes.test.ts .env.example
git commit -m "feat: add Google AdSense OAuth connect/callback/disconnect routes"
```

---

## Task 11: `/admin/anuncios/conectar-google`

**Files:**
- Create: `app/admin/anuncios/conectar-google/page.tsx`
- Create: `components/admin/GoogleAdsConnectionPanel.tsx`

**Interfaces:**
- Consumes: `getSetting` (`lib/settings.ts`), rotas da Task 10.

Sem teste automatizado. Verificação: `tsc` + Task 17.

- [ ] **Step 1: Criar o painel client**

Criar `components/admin/GoogleAdsConnectionPanel.tsx` (mesmo padrão de
`WhatsAppConnectionPanel.tsx` — status + ações):

```tsx
"use client";

import { useState } from "react";

export default function GoogleAdsConnectionPanel({
  connected,
  publisherId,
  hasError,
}: {
  connected: boolean;
  publisherId: string | null;
  hasError: boolean;
}) {
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    setDisconnecting(true);
    await fetch("/api/admin/ads/google/disconnect", { method: "POST" });
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Status:</span>
        <span className={connected ? "text-green-600 font-medium" : "text-gray-500 font-medium"}>
          {connected ? "Conectado" : "Não conectado"}
        </span>
      </div>

      {hasError && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          Falha ao conectar. Tente novamente.
        </div>
      )}

      {connected && publisherId && (
        <p className="text-sm text-gray-600 dark:text-gray-400">Conta: {publisherId}</p>
      )}

      {connected ? (
        <button onClick={handleDisconnect} disabled={disconnecting} className="btn-secondary text-sm disabled:opacity-50">
          {disconnecting ? "Desconectando..." : "Desconectar"}
        </button>
      ) : (
        <a href="/api/admin/ads/google/connect" className="btn-primary text-sm inline-block">
          Conectar conta Google AdSense
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Criar a página**

Criar `app/admin/anuncios/conectar-google/page.tsx`:

```tsx
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import GoogleAdsConnectionPanel from "@/components/admin/GoogleAdsConnectionPanel";

export const metadata: Metadata = { title: "Conectar Google AdSense — Admin" };
export const dynamic = "force-dynamic";

export default async function ConectarGooglePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [accessToken, publisherId] = await Promise.all([
    getSetting("google_adsense_access_token"),
    getSetting("google_adsense_publisher_id"),
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Conectar Google AdSense</h1>
      <div className="card">
        <GoogleAdsConnectionPanel
          connected={Boolean(accessToken)}
          publisherId={publisherId}
          hasError={params.error === "1"}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/admin/anuncios/conectar-google/page.tsx components/admin/GoogleAdsConnectionPanel.tsx
git commit -m "feat: add Google AdSense connection admin page"
```

---

## Task 12: `lib/ads/adsense-reports.ts` — busca de relatório por ad unit

**Files:**
- Create: `lib/ads/adsense-reports.ts`
- Test: `tests/adsense-reports.test.ts`

**Interfaces:**
- Produces: `fetchDailyAdUnitReport(params: {accessToken: string; publisherId: string;
  adUnitId: string; date: Date}): Promise<{impressions: number; clicks: number;
  estimatedRevenueMicros: bigint; currency: string} | null>` — consumido pela Task 13.

> **Nota pro implementador**: mesma ressalva da Task 9 — a forma exata da resposta da
> `accounts.reports.generate` (nomes de campo dentro de `rows`/`headers`) deve ser conferida
> contra a documentação atual da Google ao testar com uma conta real; a estrutura da função
> (montar query params → parsear `rows[0].cells` → mapear pros nomes do nosso domínio) é o que
> importa manter.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/adsense-reports.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDailyAdUnitReport } from "@/lib/ads/adsense-reports";

describe("fetchDailyAdUnitReport", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("monta a query certa e mapeia a primeira linha do relatório", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [{ cells: [{ value: "1500" }, { value: "12" }, { value: "3450000" }] }],
        totals: { cells: [{ value: "1500" }, { value: "12" }, { value: "3450000" }] },
        averages: { cells: [] },
        headers: [
          { name: "IMPRESSIONS" }, { name: "CLICKS" }, { name: "ESTIMATED_EARNINGS" },
        ],
      }),
    });

    const date = new Date("2026-07-18T00:00:00.000Z");
    const result = await fetchDailyAdUnitReport({
      accessToken: "at-1",
      publisherId: "pub-123",
      adUnitId: "1234567890",
      date,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://adsense.googleapis.com/v2/accounts/pub-123/reports:generate"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer at-1" }) }),
    );
    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain("dateRange=CUSTOM");
    expect(calledUrl).toContain("startDate.year=2026");
    expect(calledUrl).toContain("filters=AD_UNIT_ID%3D%3D1234567890");

    expect(result).toEqual({
      impressions: 1500,
      clicks: 12,
      estimatedRevenueMicros: 3450000n,
      currency: "BRL",
    });
  });

  it("retorna null quando não há nenhuma linha no relatório (sem tráfego no dia)", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
    const result = await fetchDailyAdUnitReport({
      accessToken: "at-1", publisherId: "pub-123", adUnitId: "123", date: new Date(),
    });
    expect(result).toBeNull();
  });

  it("lança erro quando a API retorna status de erro", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) });
    await expect(
      fetchDailyAdUnitReport({ accessToken: "expired", publisherId: "pub-123", adUnitId: "123", date: new Date() }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/adsense-reports.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `lib/ads/adsense-reports.ts`:

```ts
export interface DailyAdUnitReport {
  impressions: number;
  clicks: number;
  estimatedRevenueMicros: bigint;
  currency: string;
}

export async function fetchDailyAdUnitReport(params: {
  accessToken: string;
  publisherId: string;
  adUnitId: string;
  date: Date;
}): Promise<DailyAdUnitReport | null> {
  const { accessToken, publisherId, adUnitId, date } = params;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const query = new URLSearchParams({
    dateRange: "CUSTOM",
    "startDate.year": String(year),
    "startDate.month": String(month),
    "startDate.day": String(day),
    "endDate.year": String(year),
    "endDate.month": String(month),
    "endDate.day": String(day),
    filters: `AD_UNIT_ID==${adUnitId}`,
  });
  query.append("metrics", "IMPRESSIONS");
  query.append("metrics", "CLICKS");
  query.append("metrics", "ESTIMATED_EARNINGS");

  const url = `https://adsense.googleapis.com/v2/accounts/${publisherId}/reports:generate?${query.toString()}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`AdSense API ${res.status}: ${JSON.stringify(errBody).slice(0, 300)}`);
  }

  const data = await res.json();
  const row = data.rows?.[0];
  if (!row) return null;

  const [impressionsCell, clicksCell, earningsCell] = row.cells;
  return {
    impressions: parseInt(impressionsCell.value, 10),
    clicks: parseInt(clicksCell.value, 10),
    estimatedRevenueMicros: BigInt(earningsCell.value),
    currency: "BRL",
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/adsense-reports.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add lib/ads/adsense-reports.ts tests/adsense-reports.test.ts
git commit -m "feat: add AdSense daily ad-unit report fetcher"
```

---

## Task 13: `lib/ads/metrics-sync.ts` — orquestração da sincronização

**Files:**
- Create: `lib/ads/metrics-sync.ts`
- Test: `tests/ads-metrics-sync.test.ts`

**Interfaces:**
- Consumes: `db.adSlot.findMany` (posições Google ativas), `getSetting`/`upsertSetting`
  (tokens), `refreshAccessToken` (Task 9), `fetchDailyAdUnitReport` (Task 12),
  `db.adMetricsSnapshot.upsert`.
- Produces: `syncAdMetrics(date: Date): Promise<{synced: number; failed: number}>` — consumido
  pela Task 14.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/ads-metrics-sync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(), upsertSetting: vi.fn() }));
vi.mock("@/lib/ads/adsense-oauth", () => ({ refreshAccessToken: vi.fn() }));
vi.mock("@/lib/ads/adsense-reports", () => ({ fetchDailyAdUnitReport: vi.fn() }));

import { syncAdMetrics } from "@/lib/ads/metrics-sync";
import { getSetting, upsertSetting } from "@/lib/settings";
import { refreshAccessToken } from "@/lib/ads/adsense-oauth";
import { fetchDailyAdUnitReport } from "@/lib/ads/adsense-reports";

const dbMock = db as any;
const date = new Date("2026-07-18T00:00:00.000Z");

describe("syncAdMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.adSlot.findMany.mockResolvedValue([]);
  });

  it("retorna 0/0 e não chama a API quando não há conexão salva (sem refresh token)", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => (key === "google_adsense_refresh_token" ? null : "pub-123"));
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", googleAdUnitId: "111" }]);

    const result = await syncAdMetrics(date);

    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(fetchDailyAdUnitReport).not.toHaveBeenCalled();
  });

  it("renova o token, busca o relatório de cada slot Google ativo e faz upsert do snapshot", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "google_adsense_refresh_token") return "rt-1";
      if (key === "google_adsense_publisher_id") return "pub-123";
      return null;
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: "at-new", expiresAt: new Date() });
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", googleAdUnitId: "111" }]);
    vi.mocked(fetchDailyAdUnitReport).mockResolvedValueOnce({
      impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n, currency: "BRL",
    });

    const result = await syncAdMetrics(date);

    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({ where: { enabled: true, source: "GOOGLE", googleAdUnitId: { not: null } } });
    expect(fetchDailyAdUnitReport).toHaveBeenCalledWith({ accessToken: "at-new", publisherId: "pub-123", adUnitId: "111", date });
    expect(dbMock.adMetricsSnapshot.upsert).toHaveBeenCalledWith({
      where: { adSlotId_date: { adSlotId: "s1", date } },
      create: { adSlotId: "s1", date, impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n, currency: "BRL" },
      update: { impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n, currency: "BRL" },
    });
    expect(result).toEqual({ synced: 1, failed: 0 });
  });

  it("marca a conexão como desconectada quando o refresh do token falha, sem quebrar o sync das outras posições", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "google_adsense_refresh_token") return "revoked";
      if (key === "google_adsense_publisher_id") return "pub-123";
      return null;
    });
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new Error("invalid_grant"));
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", googleAdUnitId: "111" }]);

    const result = await syncAdMetrics(date);

    expect(upsertSetting).toHaveBeenCalledWith("google_adsense_access_token", "");
    expect(fetchDailyAdUnitReport).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });

  it("conta como falha (sem derrubar as demais) quando o relatório de uma posição específica lança erro", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "google_adsense_refresh_token") return "rt-1";
      if (key === "google_adsense_publisher_id") return "pub-123";
      return null;
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: "at-new", expiresAt: new Date() });
    dbMock.adSlot.findMany.mockResolvedValueOnce([
      { id: "s1", googleAdUnitId: "111" },
      { id: "s2", googleAdUnitId: "222" },
    ]);
    vi.mocked(fetchDailyAdUnitReport)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ impressions: 10, clicks: 1, estimatedRevenueMicros: 5000n, currency: "BRL" });

    const result = await syncAdMetrics(date);

    expect(result).toEqual({ synced: 1, failed: 1 });
  });

  it("quando o relatório não tem linha (sem tráfego no dia), não faz upsert e não conta como falha", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "google_adsense_refresh_token") return "rt-1";
      if (key === "google_adsense_publisher_id") return "pub-123";
      return null;
    });
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: "at-new", expiresAt: new Date() });
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", googleAdUnitId: "111" }]);
    vi.mocked(fetchDailyAdUnitReport).mockResolvedValueOnce(null);

    const result = await syncAdMetrics(date);

    expect(dbMock.adMetricsSnapshot.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/ads-metrics-sync.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `lib/ads/metrics-sync.ts`:

```ts
import { db } from "../db";
import { getSetting, upsertSetting } from "../settings";
import { refreshAccessToken } from "./adsense-oauth";
import { fetchDailyAdUnitReport } from "./adsense-reports";

export async function syncAdMetrics(date: Date): Promise<{ synced: number; failed: number }> {
  const refreshToken = await getSetting("google_adsense_refresh_token");
  if (!refreshToken) return { synced: 0, failed: 0 };

  const slots = await db.adSlot.findMany({
    where: { enabled: true, source: "GOOGLE", googleAdUnitId: { not: null } },
  });
  if (slots.length === 0) return { synced: 0, failed: 0 };

  let accessToken: string;
  try {
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.accessToken;
  } catch {
    await upsertSetting("google_adsense_access_token", "");
    await upsertSetting("google_adsense_refresh_token", "");
    return { synced: 0, failed: 0 };
  }

  const publisherId = await getSetting("google_adsense_publisher_id");
  if (!publisherId) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const slot of slots) {
    try {
      const report = await fetchDailyAdUnitReport({
        accessToken,
        publisherId,
        adUnitId: slot.googleAdUnitId as string,
        date,
      });
      if (!report) continue;

      await db.adMetricsSnapshot.upsert({
        where: { adSlotId_date: { adSlotId: slot.id, date } },
        create: {
          adSlotId: slot.id,
          date,
          impressions: report.impressions,
          clicks: report.clicks,
          estimatedRevenueMicros: report.estimatedRevenueMicros,
          currency: report.currency,
        },
        update: {
          impressions: report.impressions,
          clicks: report.clicks,
          estimatedRevenueMicros: report.estimatedRevenueMicros,
          currency: report.currency,
        },
      });
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/ads-metrics-sync.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add lib/ads/metrics-sync.ts tests/ads-metrics-sync.test.ts
git commit -m "feat: add ad metrics sync orchestration"
```

---

## Task 14: `POST /api/cron/ad-metrics-sync`

**Files:**
- Create: `app/api/cron/ad-metrics-sync/route.ts`
- Test: `tests/cron-ad-metrics-sync-route.test.ts`

**Interfaces:**
- Consumes: `syncAdMetrics` (Task 13).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/cron-ad-metrics-sync-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ads/metrics-sync", () => ({ syncAdMetrics: vi.fn() }));

import { POST } from "@/app/api/cron/ad-metrics-sync/route";
import { syncAdMetrics } from "@/lib/ads/metrics-sync";

function makeRequest(secret?: string) {
  return new Request("http://localhost/api/cron/ad-metrics-sync", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  }) as any;
}

describe("POST /api/cron/ad-metrics-sync", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "shh";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("retorna 401 com secret errado", async () => {
    const res = await POST(makeRequest("wrong"));
    expect(res.status).toBe(401);
    expect(syncAdMetrics).not.toHaveBeenCalled();
  });

  it("chama syncAdMetrics com a data de ontem e retorna os totais", async () => {
    vi.mocked(syncAdMetrics).mockResolvedValueOnce({ synced: 3, failed: 1 });
    const res = await POST(makeRequest("shh"));
    const body = await res.json();
    expect(syncAdMetrics).toHaveBeenCalledWith(expect.any(Date));
    expect(body).toEqual({ synced: 3, failed: 1 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/cron-ad-metrics-sync-route.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/cron/ad-metrics-sync/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { syncAdMetrics } from "@/lib/ads/metrics-sync";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const result = await syncAdMetrics(yesterday);
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/cron-ad-metrics-sync-route.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/ad-metrics-sync/route.ts tests/cron-ad-metrics-sync-route.test.ts
git commit -m "feat: add ad-metrics-sync cron route"
```

---

## Task 15: `lib/ads/ad-metrics.ts` + `/admin/anuncios/metricas`

**Files:**
- Create: `lib/ads/ad-metrics.ts`
- Create: `app/admin/anuncios/metricas/page.tsx`
- Test: `tests/lib-ad-metrics.test.ts`

**Interfaces:**
- Produces: `listAdMetricsSummary(from: Date, to: Date): Promise<{slotLabel: string;
  impressions: number; clicks: number; estimatedRevenueMicros: bigint}[]>` — consumido pela
  página.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-ad-metrics.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listAdMetricsSummary } from "@/lib/ads/ad-metrics";

const dbMock = db as any;

describe("listAdMetricsSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("agrupa snapshots por posição, somando impressões/cliques/receita no intervalo", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([
      {
        id: "s1",
        label: "Abaixo do banner",
        metrics: [
          { impressions: 100, clicks: 5, estimatedRevenueMicros: 1000000n },
          { impressions: 200, clicks: 10, estimatedRevenueMicros: 2000000n },
        ],
      },
    ]);

    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-18T00:00:00.000Z");
    const result = await listAdMetricsSummary(from, to);

    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({
      include: { metrics: { where: { date: { gte: from, lte: to } } } },
      orderBy: { key: "asc" },
    });
    expect(result).toEqual([
      { slotLabel: "Abaixo do banner", impressions: 300, clicks: 15, estimatedRevenueMicros: 3000000n },
    ]);
  });

  it("posição sem nenhum snapshot no intervalo aparece zerada, não some da lista", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "s1", label: "Sem tráfego", metrics: [] }]);
    const result = await listAdMetricsSummary(new Date(), new Date());
    expect(result).toEqual([{ slotLabel: "Sem tráfego", impressions: 0, clicks: 0, estimatedRevenueMicros: 0n }]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-ad-metrics.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `lib/ads/ad-metrics.ts`:

```ts
import { db } from "../db";

export interface AdMetricsSummaryRow {
  slotLabel: string;
  impressions: number;
  clicks: number;
  estimatedRevenueMicros: bigint;
}

export async function listAdMetricsSummary(from: Date, to: Date): Promise<AdMetricsSummaryRow[]> {
  const slots = await db.adSlot.findMany({
    include: { metrics: { where: { date: { gte: from, lte: to } } } },
    orderBy: { key: "asc" },
  });

  return slots.map((slot) => ({
    slotLabel: slot.label,
    impressions: slot.metrics.reduce((sum: number, m: { impressions: number }) => sum + m.impressions, 0),
    clicks: slot.metrics.reduce((sum: number, m: { clicks: number }) => sum + m.clicks, 0),
    estimatedRevenueMicros: slot.metrics.reduce(
      (sum: bigint, m: { estimatedRevenueMicros: bigint }) => sum + m.estimatedRevenueMicros,
      0n,
    ),
  }));
}
```

Criar `app/admin/anuncios/metricas/page.tsx`:

```tsx
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import { listAdMetricsSummary } from "@/lib/ads/ad-metrics";

export const metadata: Metadata = { title: "Métricas de Anúncios — Admin" };
export const dynamic = "force-dynamic";

function formatMicrosAsCurrency(micros: bigint): string {
  const value = Number(micros) / 1_000_000;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function AdMetricasPage() {
  await requireAdmin();

  const connected = Boolean(await getSetting("google_adsense_access_token"));

  if (!connected) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Métricas de Anúncios</h1>
        <div className="card text-center py-12 text-gray-500">
          Conecte sua conta Google AdSense pra ver métricas.
        </div>
      </div>
    );
  }

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await listAdMetricsSummary(from, to);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Métricas de Anúncios — últimos 30 dias</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b dark:border-gray-700 text-xs uppercase">
              <th className="pb-2 pr-4">Posição</th>
              <th className="pb-2 pr-4">Impressões</th>
              <th className="pb-2 pr-4">Cliques</th>
              <th className="pb-2">Receita estimada</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slotLabel} className="border-b dark:border-gray-700 last:border-0">
                <td className="py-2 pr-4">{row.slotLabel}</td>
                <td className="py-2 pr-4">{row.impressions.toLocaleString("pt-BR")}</td>
                <td className="py-2 pr-4">{row.clicks.toLocaleString("pt-BR")}</td>
                <td className="py-2 font-medium">{formatMicrosAsCurrency(row.estimatedRevenueMicros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-ad-metrics.test.ts`
Expected: PASS (2/2)

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/ad-metrics.ts app/admin/anuncios/metricas/page.tsx tests/lib-ad-metrics.test.ts
git commit -m "feat: add ad metrics summary page"
```

---

## Task 16: Nav — link "Anúncios" no admin

**Files:**
- Modify: `components/admin/AdminNav.tsx`

Sem teste (componente de navegação, sem lógica).

- [ ] **Step 1: Adicionar o link**

Entre "Mensagens" (`/admin/mensagens`, adicionada no sub-projeto anterior) e "Config."
(`/admin/configuracoes`):

```tsx
          <Link href="/admin/anuncios" className="hover:text-gray-300">Anúncios</Link>
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/AdminNav.tsx
git commit -m "feat: add Anúncios link to admin nav"
```

---

## Task 17: Verificação final

**Files:** nenhum (só verificação)

- [ ] **Step 1: Suíte completa e type-check**

Run: `npx vitest run`
Expected: todos os testes passando (baseline + os novos desta feature).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 2: Checklist de verificação manual (registrar como pendência — banco de dev
  inacessível nesta sessão, mesma situação dos 2 sub-projetos anteriores)**

- [ ] `/admin/anuncios` lista as 5 posições, liga/desliga funciona, salvar fonte + ID do bloco
  funciona.
- [ ] `/admin/anuncios/conectar-google` — fluxo completo só pode ser testado com credenciais
  OAuth reais (`GOOGLE_ADS_OAUTH_CLIENT_ID`/`SECRET`) e uma conta AdSense aprovada, nenhuma das
  duas existe ainda.
- [ ] Com uma posição ativada e `google_adsense_client_id` configurado, confirmar visualmente
  que o `<ins class="adsbygoogle">` aparece nos 5 pontos certos das páginas (mesmo sem uma conta
  real, o container deve renderizar — só não preenche com anúncio de verdade sem AdSense
  aprovando o site).
- [ ] Cron `/api/cron/ad-metrics-sync` só pode ser exercitado de verdade após a conexão OAuth
  real existir.
- [ ] Dark mode: painéis e tabela de métricas legíveis.

- [ ] **Step 3: Atualizar `PROGRESSO.md`**

Marcar o sub-projeto 3 (anúncios/Google AdSense) como implementado, registrar os commits das 17
tasks, apontar as pendências reais (credenciais OAuth + conta AdSense aprovada, ambas fora do
nosso controle) e a próxima tarefa da sessão (brainstorm do sub-projeto 4 — marketplace de
anunciantes privados, que depende desta infraestrutura de posições). Lembrar que o usuário pediu
pra **não fazer deploy ainda** — bater tudo num deploy único depois do sub-projeto 4, incluindo
a migração desta feature + o seed manual das 5 posições (`prisma db push` não roda o INSERT do
seed automaticamente, ver nota na Task 1).

```bash
git add PROGRESSO.md
git commit -m "docs: record completion of ad slots + Google AdSense sub-project"
```
