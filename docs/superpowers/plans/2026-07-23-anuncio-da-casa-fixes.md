# Anúncio da casa — correções da revisão final Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 4 achados da revisão final de branch inteira do plano "Anúncio da casa"
(commits `57df0f7..26a7f7d`, já mergeados): (1) métricas do anúncio da casa contaminando o
relatório em PDF de anunciantes pagantes, (2) URL de destino sem restrição de esquema, (3)
arquivo órfão no storage quando a fonte de uma posição deixa de ser "Anúncio da casa", (4) testes
faltando pras rotas de falha de storage (502/503).

**Architecture:** `AdMetricsSnapshot` ganha uma dimensão `source` (nova coluna, com constraint
único `[adSlotId, date, source]` em vez de `[adSlotId, date]`), permitindo separar de vez métricas
de `"PRIVATE"` (marketplace) e `"HOUSE"` (anúncio da casa) — mesmo slot, mesmo dia, duas linhas.
`buildAdReportData` (relatório do anunciante) passa a filtrar só `source: "PRIVATE"`, fechando o
vazamento. As outras 3 correções são pontuais nas rotas já existentes.

**Tech Stack:** Next.js (App Router), Prisma, Zod, Vitest.

## Global Constraints

- Esta leva **conscientemente toca no marketplace** (`lib/ads/private-ad-report.ts`) — decisão
  explícita do usuário depois da revisão final, abrindo mão do isolamento total do plano anterior
  em troca de separar as métricas de verdade. Fora esse arquivo, nenhuma outra parte do
  marketplace (`PrivateAd`, `AdPurchase`, `AdvertiserProfile`, moderação, cron de expiração) é
  tocada.
- TDD obrigatório em toda mudança de `lib/`/rota de API.
- Nenhuma mudança de comportamento visível pro anunciante: o valor NUMÉRICO do relatório dele deve
  ficar igual ou MENOR do que está hoje (nunca maior) depois desta correção — hoje pode estar
  inflado por métricas de anúncio da casa vazadas; corrigir só remove esse vazamento, nunca
  adiciona nada novo à conta dele.
- Dados históricos: linhas de `AdMetricsSnapshot` já existentes no banco são, por definição, todas
  do marketplace (o anúncio da casa não existia antes deste plano) — a migração aplica
  `DEFAULT 'PRIVATE'` na coluna nova pra refletir isso automaticamente, sem script de backfill
  manual.

---

### Task 1: `AdMetricsSnapshot.source` — separar métricas por origem

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260723020000_add_ad_metrics_snapshot_source/migration.sql`
- Modify: `lib/ads/private-ad-metrics.ts`
- Test: `tests/lib-private-ad-metrics.test.ts`

**Interfaces:**
- Produces: `recordImpression(adSlotId: string, source: string): Promise<void>`,
  `recordClick(adSlotId: string, source: string): Promise<void>` — assinatura muda (ganham 2º
  parâmetro obrigatório) — consumido pela Task 2.

- [ ] **Step 1: Escrever os testes que falham**

Substituir o conteúdo inteiro de `tests/lib-private-ad-metrics.test.ts` por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { recordImpression, recordClick } from "@/lib/ads/private-ad-metrics";

const dbMock = db as any;

describe("recordImpression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("faz upsert incrementando impressions na linha do dia+source (data zerada, sem hora)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});

    await recordImpression("slot-1", "PRIVATE");

    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date_source.adSlotId).toBe("slot-1");
    expect(call.where.adSlotId_date_source.source).toBe("PRIVATE");
    expect(call.where.adSlotId_date_source.date.getUTCHours()).toBe(0);
    expect(call.create).toEqual({
      adSlotId: "slot-1",
      date: call.where.adSlotId_date_source.date,
      source: "PRIVATE",
      impressions: 1,
      clicks: 0,
      estimatedRevenueMicros: 0n,
      currency: "BRL",
    });
    expect(call.update).toEqual({ impressions: { increment: 1 } });
  });

  it("usa uma linha separada por source (HOUSE não soma na mesma linha de PRIVATE)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});
    await recordImpression("slot-1", "HOUSE");
    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date_source.source).toBe("HOUSE");
    expect(call.create.source).toBe("HOUSE");
  });

  it("nunca lança erro (best-effort — falha de log de métrica não pode derrubar a exibição do anúncio)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockRejectedValueOnce(new Error("db down"));
    await expect(recordImpression("slot-1", "PRIVATE")).resolves.toBeUndefined();
  });
});

describe("recordClick", () => {
  beforeEach(() => vi.clearAllMocks());

  it("faz upsert incrementando clicks na linha do dia+source", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});

    await recordClick("slot-1", "PRIVATE");

    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date_source.adSlotId).toBe("slot-1");
    expect(call.where.adSlotId_date_source.source).toBe("PRIVATE");
    expect(call.create).toEqual({
      adSlotId: "slot-1",
      date: call.where.adSlotId_date_source.date,
      source: "PRIVATE",
      impressions: 0,
      clicks: 1,
      estimatedRevenueMicros: 0n,
      currency: "BRL",
    });
    expect(call.update).toEqual({ clicks: { increment: 1 } });
  });

  it("usa uma linha separada por source (HOUSE não soma na mesma linha de PRIVATE)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});
    await recordClick("slot-1", "HOUSE");
    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date_source.source).toBe("HOUSE");
    expect(call.create.source).toBe("HOUSE");
  });

  it("nunca lança erro (best-effort — falha de log de métrica não pode derrubar o redirect)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockRejectedValueOnce(new Error("db down"));
    await expect(recordClick("slot-1", "PRIVATE")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-private-ad-metrics.test.ts`
Expected: FAIL — `recordImpression`/`recordClick` ainda têm assinatura de 1 parâmetro, e a chave
`adSlotId_date` (não `adSlotId_date_source`) ainda é usada.

- [ ] **Step 3: Adicionar a coluna ao schema Prisma**

Em `prisma/schema.prisma`, no `model AdMetricsSnapshot`, adicionar `source` logo depois de
`adSlotId` e atualizar o `@@unique`:

```prisma
model AdMetricsSnapshot {
  id                     String   @id @default(cuid())
  adSlotId               String
  source                 String   @default("PRIVATE")
  date                   DateTime
  impressions            Int
  clicks                 Int
  estimatedRevenueMicros BigInt
  currency               String
  createdAt              DateTime @default(now())

  adSlot AdSlot @relation(fields: [adSlotId], references: [id])

  @@unique([adSlotId, date, source])
  @@map("ad_metrics_snapshots")
}
```

Criar `prisma/migrations/20260723020000_add_ad_metrics_snapshot_source/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "ad_metrics_snapshots" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PRIVATE';

-- DropIndex
DROP INDEX "ad_metrics_snapshots_adSlotId_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "ad_metrics_snapshots_adSlotId_date_source_key" ON "ad_metrics_snapshots"("adSlotId", "date", "source");
```

(O `DEFAULT 'PRIVATE'` faz o backfill automático de qualquer linha já existente — todo dado
histórico é, por definição, do marketplace, já que o anúncio da casa não existia antes deste
plano.)

Rodar `npx prisma generate`.

- [ ] **Step 4: Atualizar `lib/ads/private-ad-metrics.ts`**

Substituir o conteúdo inteiro do arquivo por:

```ts
import { db } from "../db";

function todayUtcMidnight(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function recordImpression(adSlotId: string, source: string): Promise<void> {
  try {
    const date = todayUtcMidnight();
    await db.adMetricsSnapshot.upsert({
      where: { adSlotId_date_source: { adSlotId, date, source } },
      create: { adSlotId, date, source, impressions: 1, clicks: 0, estimatedRevenueMicros: 0n, currency: "BRL" },
      update: { impressions: { increment: 1 } },
    });
  } catch {
    // Best-effort — nunca deve quebrar a exibição do anúncio.
  }
}

export async function recordClick(adSlotId: string, source: string): Promise<void> {
  try {
    const date = todayUtcMidnight();
    await db.adMetricsSnapshot.upsert({
      where: { adSlotId_date_source: { adSlotId, date, source } },
      create: { adSlotId, date, source, impressions: 0, clicks: 1, estimatedRevenueMicros: 0n, currency: "BRL" },
      update: { clicks: { increment: 1 } },
    });
  } catch {
    // Best-effort — nunca deve quebrar o redirect.
  }
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-private-ad-metrics.test.ts`
Expected: PASS (6 testes — 3 de `recordImpression` + 3 de `recordClick`)

Nota: os call sites existentes (`AdSlotRenderer.tsx`, os 2 endpoints de clique) ainda chamam
`recordImpression(slot.id)`/`recordClick(...)` com 1 argumento só — isso vai quebrar o `tsc` até
a Task 2 atualizar os call sites. **Não rodar a suíte completa nem `tsc --noEmit` nesta task** —
isso é esperado e corrigido na Task 2, que já está planejada em seguida. Rodar só o teste do
Step 5 acima pra confirmar o comportamento da própria função.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260723020000_add_ad_metrics_snapshot_source lib/ads/private-ad-metrics.ts tests/lib-private-ad-metrics.test.ts
git commit -m "feat: AdMetricsSnapshot ganha dimensao source (separa metricas HOUSE de PRIVATE)"
```

---

### Task 2: Atualizar os 4 call sites de `recordImpression`/`recordClick`

**Files:**
- Modify: `components/ads/AdSlotRenderer.tsx`
- Modify: `app/api/ads/click/[privateAdId]/route.ts`
- Modify: `app/api/ads/click/house/[slotId]/route.ts`
- Test: `tests/ads-click-route.test.ts`
- Test: `tests/ads-click-house-route.test.ts`

**Interfaces:**
- Consumes: `recordImpression(adSlotId, source)`, `recordClick(adSlotId, source)` (Task 1).

- [ ] **Step 1: Atualizar os testes que falham**

Em `tests/ads-click-route.test.ts`, trocar a asserção existente:

```ts
    expect(recordClick).toHaveBeenCalledWith("slot-1");
```

por:

```ts
    expect(recordClick).toHaveBeenCalledWith("slot-1", "PRIVATE");
```

Em `tests/ads-click-house-route.test.ts`, trocar a asserção existente (no teste de sucesso):

```ts
    expect(recordClick).toHaveBeenCalledWith("slot-1");
```

por:

```ts
    expect(recordClick).toHaveBeenCalledWith("slot-1", "HOUSE");
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/ads-click-route.test.ts tests/ads-click-house-route.test.ts`
Expected: FAIL — as chamadas atuais ainda passam só 1 argumento.

- [ ] **Step 3: Atualizar os 3 arquivos de produção**

Em `app/api/ads/click/[privateAdId]/route.ts`, trocar:

```ts
  await recordClick(ad.adSlotId);
```

por:

```ts
  await recordClick(ad.adSlotId, "PRIVATE");
```

Em `app/api/ads/click/house/[slotId]/route.ts`, trocar:

```ts
  await recordClick(slot.id);
```

por:

```ts
  await recordClick(slot.id, "HOUSE");
```

Em `components/ads/AdSlotRenderer.tsx`, trocar as 2 chamadas de `recordImpression`:

```ts
    await recordImpression(slot.id);
```

(a do branch `PRIVATE`, logo depois de `if (!ad) return null;`) por:

```ts
    await recordImpression(slot.id, "PRIVATE");
```

E (a do branch `HOUSE`, logo depois de `if (!slot.houseAdImageUrl || !slot.houseAdTargetUrl) return null;`) por:

```ts
    await recordImpression(slot.id, "HOUSE");
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/ads-click-route.test.ts tests/ads-click-house-route.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros (essa é a task que corrige o erro de tipo deixado pela Task 1)

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 6: Commit**

```bash
git add components/ads/AdSlotRenderer.tsx "app/api/ads/click/[privateAdId]/route.ts" "app/api/ads/click/house/[slotId]/route.ts" tests/ads-click-route.test.ts tests/ads-click-house-route.test.ts
git commit -m "feat: call sites de recordImpression/recordClick passam a informar source"
```

---

### Task 3: `buildAdReportData` só soma métricas `source: "PRIVATE"`

**Files:**
- Modify: `lib/ads/private-ad-report.ts`
- Test: `tests/lib-private-ad-report.test.ts`

**Interfaces:** Nenhuma nova.

**Esta é a correção real do vazamento** encontrado na revisão final: sem ela, as Tasks A/B sozinhas
só criam a separação nos dados — quem lê os dados (o relatório do anunciante) continua somando
tudo até esta task.

- [ ] **Step 1: Atualizar o teste que falha**

Em `tests/lib-private-ad-report.test.ts`, no primeiro teste ("soma métricas do período..."), trocar
a asserção:

```ts
    expect(dbMock.adMetricsSnapshot.findMany).toHaveBeenCalledWith({
      where: { adSlotId: "slot-1", date: { gte: startAt, lte: now } },
    });
```

por:

```ts
    expect(dbMock.adMetricsSnapshot.findMany).toHaveBeenCalledWith({
      where: { adSlotId: "slot-1", source: "PRIVATE", date: { gte: startAt, lte: now } },
    });
```

No segundo teste ("usa endAt como periodEnd..."), trocar a asserção:

```ts
    expect(dbMock.adMetricsSnapshot.findMany).toHaveBeenCalledWith({
      where: { adSlotId: "slot-2", date: { gte: startAt, lte: endAt } },
    });
```

por:

```ts
    expect(dbMock.adMetricsSnapshot.findMany).toHaveBeenCalledWith({
      where: { adSlotId: "slot-2", source: "PRIVATE", date: { gte: startAt, lte: endAt } },
    });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-private-ad-report.test.ts`
Expected: FAIL — a query ainda não filtra por `source`.

- [ ] **Step 3: Corrigir `buildAdReportData`**

Em `lib/ads/private-ad-report.ts`, trocar:

```ts
  const snapshots = await db.adMetricsSnapshot.findMany({
    where: { adSlotId: ad.adSlotId, date: { gte: periodStart, lte: periodEnd } },
  });
```

por:

```ts
  // Só soma métricas do marketplace (source "PRIVATE") — uma posição pode ter sido usada como
  // anúncio da casa (source "HOUSE") em parte do período, e essas métricas nunca devem entrar na
  // conta do anunciante pagante.
  const snapshots = await db.adMetricsSnapshot.findMany({
    where: { adSlotId: ad.adSlotId, source: "PRIVATE", date: { gte: periodStart, lte: periodEnd } },
  });
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-private-ad-report.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add lib/ads/private-ad-report.ts tests/lib-private-ad-report.test.ts
git commit -m "fix: relatorio do anunciante nao soma mais metricas do anuncio da casa"
```

---

### Task 4: URL de destino restrita a http/https + cobertura de teste das falhas de storage

**Files:**
- Modify: `app/api/admin/ads/slots/[id]/house-ad/route.ts`
- Modify: `app/api/admin/ads/slots/[id]/route.ts`
- Test: `tests/admin-house-ad-upload-route.test.ts`
- Test: `tests/admin-ad-slots-route.test.ts`

**Interfaces:** Nenhuma nova.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/admin-house-ad-upload-route.test.ts`, adicionar os 3 testes abaixo ao final do
`describe("POST /api/admin/ads/slots/[id]/house-ad", ...)`, antes do fechamento:

```ts
  it("retorna 400 quando a URL de destino usa esquema não-http (ex: javascript:)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(
      makeRequest({ targetUrl: "javascript:alert(1)" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(res.status).toBe(400);
    expect(dbMock.adSlot.findUnique).not.toHaveBeenCalled();
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 503 quando o storage não está configurado", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 502 quando o upload pro Supabase falha", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(true);
    fetchSpy.mockResolvedValueOnce(new Response("erro", { status: 500 }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(502);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });
```

Em `tests/admin-ad-slots-route.test.ts`, adicionar o teste abaixo ao final do
`describe("PATCH /api/admin/ads/slots/[id]", ...)`, antes do fechamento:

```ts
  it("retorna 400 quando houseAdTargetUrl usa esquema não-http (ex: javascript:)", async () => {
    const res = await PATCH(
      makeRequest({ source: "HOUSE", houseAdTargetUrl: "javascript:alert(1)" }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(res.status).toBe(400);
    expect(updateAdSlot).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-house-ad-upload-route.test.ts tests/admin-ad-slots-route.test.ts`
Expected: FAIL — o teste de esquema-inválido falha porque nenhuma das 2 rotas valida esquema
ainda (a URL `javascript:alert(1)` passa por `new URL(...)` sem erro, já que é sintaticamente
válida); os 2 testes de 503/502 devem já passar sozinhos (são só cobertura nova pra código que já
existe) — se algum desses 2 falhar, é sinal de que o mock de `fetchSpy`/env não está isolado
corretamente entre testes, revisar antes de prosseguir.

- [ ] **Step 3: Adicionar a checagem de esquema em `app/api/admin/ads/slots/[id]/house-ad/route.ts`**

Trocar:

```ts
  try {
    new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
  }
```

por:

```ts
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
  }
```

- [ ] **Step 4: Adicionar a mesma checagem em `app/api/admin/ads/slots/[id]/route.ts`**

Trocar o corpo da função `PATCH`:

```ts
  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await updateAdSlot(id, parsed.data);
  return NextResponse.json({ ok: true });
```

por:

```ts
  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.houseAdTargetUrl) {
    try {
      const url = new URL(parsed.data.houseAdTargetUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  }

  await updateAdSlot(id, parsed.data);
  return NextResponse.json({ ok: true });
```

(A checagem só roda quando `houseAdTargetUrl` está presente e truthy — `null`/`undefined`, os
únicos outros valores possíveis pelo schema Zod, continuam passando direto, sem mudança pro
caminho de limpar o campo.)

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-house-ad-upload-route.test.ts tests/admin-ad-slots-route.test.ts`
Expected: PASS (8 testes no primeiro arquivo — 5 já existentes + 3 novos; 9 no segundo — 8 já
existentes + 1 novo)

- [ ] **Step 6: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 7: Commit**

```bash
git add "app/api/admin/ads/slots/[id]/house-ad/route.ts" "app/api/admin/ads/slots/[id]/route.ts" tests/admin-house-ad-upload-route.test.ts tests/admin-ad-slots-route.test.ts
git commit -m "fix: restringe URL de destino do anuncio da casa a http/https + testes de falha de storage"
```

---

### Task 5: Limpar arquivo órfão no storage quando o anúncio da casa é removido

**Files:**
- Modify: `app/api/admin/ads/slots/[id]/route.ts`
- Test: `tests/admin-ad-slots-route.test.ts`

**Interfaces:** Nenhuma nova — função auxiliar nova é local ao arquivo da rota, não exportada
(usada só ali).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/admin-ad-slots-route.test.ts`, adicionar os 2 testes abaixo ao final do
`describe("PATCH /api/admin/ads/slots/[id]", ...)`, antes do fechamento (depois do teste da
Task 4):

```ts
  it("apaga o arquivo do storage quando houseAdImageUrl é limpo (troca de fonte)", async () => {
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_BUCKET = "uploads";
    dbMock.adSlot.findUnique.mockResolvedValueOnce({
      houseAdImageUrl: "https://supabase.example.com/storage/v1/object/public/uploads/house-ads/abc.png",
    });
    const fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValueOnce(new Response(null, { status: 200 })) as any;

    const res = await PATCH(
      makeRequest({ source: "GOOGLE", houseAdImageUrl: null, houseAdTargetUrl: null }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://supabase.example.com/storage/v1/object/uploads/house-ads/abc.png",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", { source: "GOOGLE", houseAdImageUrl: null, houseAdTargetUrl: null });
    expect(res.status).toBe(200);
  });

  it("não tenta apagar nada quando o slot não tinha houseAdImageUrl configurado", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({ houseAdImageUrl: null });
    const fetchSpy = vi.spyOn(global, "fetch" as any) as any;

    const res = await PATCH(
      makeRequest({ source: "GOOGLE", houseAdImageUrl: null, houseAdTargetUrl: null }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-ad-slots-route.test.ts`
Expected: FAIL — a rota ainda não busca o slot atual nem chama `fetch` com `DELETE`.

- [ ] **Step 3: Implementar a limpeza em `app/api/admin/ads/slots/[id]/route.ts`**

Substituir o conteúdo inteiro do arquivo por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateAdSlot } from "@/lib/ad-slots";
import { z } from "zod";

const schema = z.object({
  enabled: z.boolean().optional(),
  source: z.enum(["GOOGLE", "PRIVATE", "HOUSE"]).nullable().optional(),
  googleAdUnitId: z.string().max(100).nullable().optional(),
  houseAdImageUrl: z.string().max(500).nullable().optional(),
  houseAdTargetUrl: z.string().max(500).nullable().optional(),
});

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "uploads";
  return { url, key, bucket, ready: Boolean(url && key) };
}

// Apaga o arquivo antigo do storage quando a imagem do anúncio da casa é limpa (troca de fonte).
// Best-effort: nunca lança — um arquivo órfão no storage é bem menos grave do que quebrar a
// atualização da posição por causa de uma falha de rede num delete secundário.
async function deleteOrphanedHouseAdImage(imageUrl: string): Promise<void> {
  try {
    const cfg = getSupabaseConfig();
    if (!cfg.ready) return;
    const marker = `/storage/v1/object/public/${cfg.bucket}/`;
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return;
    const key = imageUrl.slice(idx + marker.length);
    await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${key}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${cfg.key}` },
    });
  } catch (err) {
    console.error("[admin/ads/slots] failed to delete orphaned house-ad image:", err);
  }
}

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

  if (parsed.data.houseAdTargetUrl) {
    try {
      const url = new URL(parsed.data.houseAdTargetUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  }

  if (parsed.data.houseAdImageUrl === null) {
    const current = await db.adSlot.findUnique({ where: { id }, select: { houseAdImageUrl: true } });
    if (current?.houseAdImageUrl) {
      await deleteOrphanedHouseAdImage(current.houseAdImageUrl);
    }
  }

  await updateAdSlot(id, parsed.data);
  return NextResponse.json({ ok: true });
}
```

(A checagem de esquema da Task 4 é preservada — este Step substitui o arquivo inteiro porque a
Task 4 já rodou antes e está na base desta task.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-ad-slots-route.test.ts`
Expected: PASS (11 testes — 9 já existentes + 2 novos)

- [ ] **Step 5: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/ads/slots/[id]/route.ts" tests/admin-ad-slots-route.test.ts
git commit -m "fix: apaga arquivo orfao do storage quando anuncio da casa e removido"
```

---

### Task 6: Reenviar uma nova imagem também limpa a anterior do storage

**Contexto (achado da revisão final desta mesma leva):** a Task 5 só limpa o storage quando a
fonte de um slot deixa de ser `"HOUSE"`. Mas reenviar uma imagem nova **sem trocar de fonte**
(substituir a arte de um anúncio da casa já ativo) também deixa a imagem antiga órfã — mesma
classe de bug, gatilho diferente. Verificado antes de escrever esta task: a chave anon do
Supabase **tem permissão de DELETE no bucket real de produção** (testado diretamente via API do
Supabase Storage: upload 200, delete 200 "Successfully deleted") — a limpeza funciona de verdade,
não é só teórica.

**Files:**
- Create: `lib/ads/house-ad-storage.ts`
- Test: `tests/lib-house-ad-storage.test.ts`
- Modify: `app/api/admin/ads/slots/[id]/house-ad/route.ts`
- Modify: `app/api/admin/ads/slots/[id]/route.ts`
- Test: `tests/admin-house-ad-upload-route.test.ts`

**Interfaces:**
- Produces: `getSupabaseConfig(): { url, key, bucket, ready }`,
  `deleteHouseAdImage(imageUrl: string): Promise<void>` (best-effort, nunca lança) — extraídos de
  `app/api/admin/ads/slots/[id]/route.ts` (Task 5) pra serem reaproveitados também pela rota de
  upload.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-house-ad-storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteHouseAdImage } from "@/lib/ads/house-ad-storage";

describe("deleteHouseAdImage", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_BUCKET = "uploads";
    fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValue(new Response(null, { status: 200 })) as any;
  });

  it("extrai a key da URL pública e chama DELETE no endpoint do storage", async () => {
    await deleteHouseAdImage("https://supabase.example.com/storage/v1/object/public/uploads/house-ads/abc.png");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://supabase.example.com/storage/v1/object/uploads/house-ads/abc.png",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("não faz nada quando o storage não está configurado", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    await deleteHouseAdImage("https://supabase.example.com/storage/v1/object/public/uploads/house-ads/abc.png");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("não faz nada quando a URL não bate com o formato esperado", async () => {
    await deleteHouseAdImage("https://outro-dominio.com/arquivo.png");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("nunca lança erro quando o delete falha (best-effort)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    await expect(
      deleteHouseAdImage("https://supabase.example.com/storage/v1/object/public/uploads/house-ads/abc.png"),
    ).resolves.toBeUndefined();
  });
});
```

Em `tests/admin-house-ad-upload-route.test.ts`, adicionar o teste abaixo ao final do
`describe("POST /api/admin/ads/slots/[id]/house-ad", ...)`, antes do fechamento:

```ts
  it("apaga a imagem anterior do storage quando a posição já tinha uma (reenvio substituindo a arte)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce({
      ...SLOT,
      houseAdImageUrl: "https://supabase.example.com/storage/v1/object/public/uploads/house-ads/old.png",
    });
    validateImageDimensionsMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://supabase.example.com/storage/v1/object/uploads/house-ads/old.png",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-house-ad-storage.test.ts tests/admin-house-ad-upload-route.test.ts`
Expected: FAIL — `@/lib/ads/house-ad-storage` ainda não existe; o teste de reenvio falha porque
`fetchSpy` só é chamado 1 vez (upload), nunca um 2º (delete).

- [ ] **Step 3: Criar `lib/ads/house-ad-storage.ts`**

```ts
export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "uploads";
  return { url, key, bucket, ready: Boolean(url && key) };
}

// Apaga um arquivo de anúncio da casa do storage. Best-effort: nunca lança — um arquivo órfão é
// bem menos grave do que quebrar a operação principal (upload de uma imagem nova, ou atualização
// da posição) por causa de uma falha de rede num delete secundário.
export async function deleteHouseAdImage(imageUrl: string): Promise<void> {
  try {
    const cfg = getSupabaseConfig();
    if (!cfg.ready) return;
    const marker = `/storage/v1/object/public/${cfg.bucket}/`;
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return;
    const key = imageUrl.slice(idx + marker.length);
    await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${key}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${cfg.key}` },
    });
  } catch (err) {
    console.error("[house-ad-storage] failed to delete house-ad image:", err);
  }
}
```

- [ ] **Step 4: Atualizar `app/api/admin/ads/slots/[id]/house-ad/route.ts`**

Substituir o conteúdo inteiro do arquivo por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateImageDimensions } from "@/lib/ads/private-ads";
import { updateAdSlot } from "@/lib/ad-slots";
import { getSupabaseConfig, deleteHouseAdImage } from "@/lib/ads/house-ad-storage";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const targetUrl = formData.get("targetUrl") as string | null;
  const image = formData.get("image") as File | null;

  if (!targetUrl || !image) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }

  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
  }

  const slot = await db.adSlot.findUnique({ where: { id } });
  if (!slot) {
    return NextResponse.json({ error: "Posição não encontrada" }, { status: 404 });
  }

  if (image.size > MAX_SIZE) {
    return NextResponse.json({ error: "Arquivo muito grande (máx 10 MB)" }, { status: 400 });
  }
  const extension = ALLOWED_MIME[image.type];
  if (!extension) {
    return NextResponse.json({ error: "Tipo de arquivo não suportado" }, { status: 400 });
  }

  const bytes = await image.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Dimensão validada ANTES do upload, pra não deixar arquivo órfão no storage se falhar —
  // mesmo cuidado já usado no fluxo de cadastro de anúncio do anunciante.
  const dimensionsOk = await validateImageDimensions(buffer, slot.width, slot.height);
  if (!dimensionsOk) {
    return NextResponse.json(
      { error: `Dimensão da imagem deve ser ${slot.width}x${slot.height}px` },
      { status: 400 },
    );
  }

  const cfg = getSupabaseConfig();
  if (!cfg.ready) {
    return NextResponse.json({ error: "Storage não configurado" }, { status: 503 });
  }

  const key = `house-ads/${randomUUID()}.${extension}`;
  const uploadRes = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": image.type,
      "x-upsert": "true",
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text().catch(() => "");
    console.error("[admin/house-ad] Supabase error:", uploadRes.status, err);
    return NextResponse.json({ error: "Falha ao enviar arquivo para o storage" }, { status: 502 });
  }

  const imageUrl = `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${key}`;

  // O anúncio da casa é ativo imediatamente — sem passo de aprovação (é o próprio admin).
  await updateAdSlot(id, {
    source: "HOUSE",
    houseAdImageUrl: imageUrl,
    houseAdTargetUrl: targetUrl,
  });

  // Limpa a imagem anterior do storage, se havia uma (reenvio substituindo uma arte já
  // existente) — roda só DEPOIS que a nova imagem já está salva com sucesso, pra nunca ficar sem
  // nenhuma arte se esta limpeza secundária falhar.
  if (slot.houseAdImageUrl) {
    await deleteHouseAdImage(slot.houseAdImageUrl);
  }

  return NextResponse.json({ houseAdImageUrl: imageUrl, houseAdTargetUrl: targetUrl });
}
```

- [ ] **Step 5: Atualizar `app/api/admin/ads/slots/[id]/route.ts`**

Substituir o conteúdo inteiro do arquivo por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateAdSlot } from "@/lib/ad-slots";
import { deleteHouseAdImage } from "@/lib/ads/house-ad-storage";
import { z } from "zod";

const schema = z.object({
  enabled: z.boolean().optional(),
  source: z.enum(["GOOGLE", "PRIVATE", "HOUSE"]).nullable().optional(),
  googleAdUnitId: z.string().max(100).nullable().optional(),
  houseAdImageUrl: z.string().max(500).nullable().optional(),
  houseAdTargetUrl: z.string().max(500).nullable().optional(),
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

  if (parsed.data.houseAdTargetUrl) {
    try {
      const url = new URL(parsed.data.houseAdTargetUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  }

  if (parsed.data.houseAdImageUrl === null) {
    const current = await db.adSlot.findUnique({ where: { id }, select: { houseAdImageUrl: true } });
    if (current?.houseAdImageUrl) {
      await deleteHouseAdImage(current.houseAdImageUrl);
    }
  }

  await updateAdSlot(id, parsed.data);
  return NextResponse.json({ ok: true });
}
```

(`getSupabaseConfig`/`deleteOrphanedHouseAdImage` locais são removidos deste arquivo — a mesma
lógica agora vem de `lib/ads/house-ad-storage.ts`, criado no Step 3. Os 2 testes de delete já
existentes em `tests/admin-ad-slots-route.test.ts`, da Task 5, continuam passando sem nenhuma
mudança — eles verificam o `fetch` real via spy, não uma função intermediária, então o
comportamento observável é idêntico antes e depois deste refactor.)

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-house-ad-storage.test.ts tests/admin-house-ad-upload-route.test.ts tests/admin-ad-slots-route.test.ts`
Expected: PASS (todos — os 2 arquivos novos/alterados mais a confirmação de que
`admin-ad-slots-route.test.ts` continua passando sem alteração)

- [ ] **Step 7: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 8: Commit**

```bash
git add lib/ads/house-ad-storage.ts tests/lib-house-ad-storage.test.ts "app/api/admin/ads/slots/[id]/house-ad/route.ts" "app/api/admin/ads/slots/[id]/route.ts" tests/admin-house-ad-upload-route.test.ts
git commit -m "fix: reenviar imagem do anuncio da casa tambem limpa a arte anterior do storage"
```

---

## Revisão final (depois de todas as 5 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo.
- [ ] Conferir que `lib/ads/private-ad-report.ts` é o ÚNICO arquivo do marketplace tocado nesta
  leva (decisão consciente do usuário) — `PrivateAd`/`AdPurchase`/`AdvertiserProfile`/moderação/
  cron de expiração continuam intocados.
- [ ] Conferir manualmente (leitura de código) que a query de `app/admin/anuncios/metricas`
  (`lib/ads/ad-metrics.ts::listAdMetricsSummary`) continua somando TODAS as origens por posição
  (comportamento correto pra visão geral do admin, não precisa filtrar por source) — só o
  relatório do ANUNCIANTE (`buildAdReportData`) precisa do filtro.
