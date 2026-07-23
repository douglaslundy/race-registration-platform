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

### Task A: `AdMetricsSnapshot.source` — separar métricas por origem

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260723020000_add_ad_metrics_snapshot_source/migration.sql`
- Modify: `lib/ads/private-ad-metrics.ts`
- Test: `tests/lib-private-ad-metrics.test.ts`

**Interfaces:**
- Produces: `recordImpression(adSlotId: string, source: string): Promise<void>`,
  `recordClick(adSlotId: string, source: string): Promise<void>` — assinatura muda (ganham 2º
  parâmetro obrigatório) — consumido pela Task B.

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
a Task B atualizar os call sites. **Não rodar a suíte completa nem `tsc --noEmit` nesta task** —
isso é esperado e corrigido na Task B, que já está planejada em seguida. Rodar só o teste do
Step 5 acima pra confirmar o comportamento da própria função.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260723020000_add_ad_metrics_snapshot_source lib/ads/private-ad-metrics.ts tests/lib-private-ad-metrics.test.ts
git commit -m "feat: AdMetricsSnapshot ganha dimensao source (separa metricas HOUSE de PRIVATE)"
```

---

### Task B: Atualizar os 4 call sites de `recordImpression`/`recordClick`

**Files:**
- Modify: `components/ads/AdSlotRenderer.tsx`
- Modify: `app/api/ads/click/[privateAdId]/route.ts`
- Modify: `app/api/ads/click/house/[slotId]/route.ts`
- Test: `tests/ads-click-route.test.ts`
- Test: `tests/ads-click-house-route.test.ts`

**Interfaces:**
- Consumes: `recordImpression(adSlotId, source)`, `recordClick(adSlotId, source)` (Task A).

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
Expected: sem erros (essa é a task que corrige o erro de tipo deixado pela Task A)

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 6: Commit**

```bash
git add components/ads/AdSlotRenderer.tsx "app/api/ads/click/[privateAdId]/route.ts" "app/api/ads/click/house/[slotId]/route.ts" tests/ads-click-route.test.ts tests/ads-click-house-route.test.ts
git commit -m "feat: call sites de recordImpression/recordClick passam a informar source"
```

---

### Task C: `buildAdReportData` só soma métricas `source: "PRIVATE"`

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

### Task D: URL de destino restrita a http/https + cobertura de teste das falhas de storage

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

### Task E: Limpar arquivo órfão no storage quando o anúncio da casa é removido

**Files:**
- Modify: `app/api/admin/ads/slots/[id]/route.ts`
- Test: `tests/admin-ad-slots-route.test.ts`

**Interfaces:** Nenhuma nova — função auxiliar nova é local ao arquivo da rota, não exportada
(usada só ali).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/admin-ad-slots-route.test.ts`, adicionar os 2 testes abaixo ao final do
`describe("PATCH /api/admin/ads/slots/[id]", ...)`, antes do fechamento (depois do teste da
Task D):

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

(A checagem de esquema da Task D é preservada — este Step substitui o arquivo inteiro porque a
Task D já rodou antes e está na base desta task.)

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
