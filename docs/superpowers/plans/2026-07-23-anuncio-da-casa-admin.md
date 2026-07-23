# Anúncio da casa (admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o admin cadastre e ative um anúncio próprio ("anúncio da casa") direto numa
posição do site, sem depender de um anunciante pagante do marketplace.

**Architecture:** Terceira fonte de posição (`AdSlot.source = "HOUSE"`), com 2 campos novos
isolados no próprio `AdSlot` (`houseAdImageUrl`, `houseAdTargetUrl`) — zero mudança em
`PrivateAd`/`AdPurchase`/`AdvertiserProfile`. Endpoint de upload dedicado reaproveita a validação
de dimensão já existente no marketplace; renderização e rastreio de clique/impressão seguem o
mesmo padrão já usado pra `source = "PRIVATE"`, com uma rota de clique própria (o slot não tem
`PrivateAd.id` pra reaproveitar a rota existente).

**Tech Stack:** Next.js (App Router, Server + Client Components), Prisma, Zod, Vitest, Supabase
Storage, `sharp` (via `validateImageDimensions` já existente).

## Global Constraints

- Zero mudança em `PrivateAd`, `AdPurchase`, `AdvertiserProfile`, moderação, relatório em PDF, ou
  qualquer outro código do marketplace de anunciantes existente.
- Ativação do anúncio da casa é imediata — sem passo de aprovação.
- Nunca usar `alert()`/`confirm()`/`window.prompt()` — usar `ErrorModal`/`ConfirmModal`
  (`CLAUDE.md`, regra permanente do projeto).
- TDD em toda rota de API nova/tocada. Componentes React (client ou Server Component) sem teste
  automatizado — convenção já estabelecida no projeto.
- Migração de schema documentada em `prisma/migrations/` mas o deploy real usa
  `prisma db push --skip-generate` (não roda `migration.sql`).

---

### Task 1: Schema — campos novos no `AdSlot` + `lib/ad-slots.ts`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260723010000_add_adslot_house_ad_fields/migration.sql`
- Modify: `lib/ad-slots.ts`
- Test: `tests/lib-ad-slots.test.ts`

**Interfaces:**
- Produces: `AdSlotRow.houseAdImageUrl: string | null`, `AdSlotRow.houseAdTargetUrl: string |
  null`; `UpdateAdSlotData.houseAdImageUrl?: string | null`,
  `UpdateAdSlotData.houseAdTargetUrl?: string | null` — consumidos pelas Tasks 2-7.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/lib-ad-slots.test.ts`, no `describe("updateAdSlot", ...)` já existente, adicionar mais
um teste ao final, antes do fechamento do `describe`:

```ts
  it("atualiza houseAdImageUrl e houseAdTargetUrl", async () => {
    dbMock.adSlot.update.mockResolvedValueOnce({});
    await updateAdSlot("slot-1", {
      source: "HOUSE",
      houseAdImageUrl: "https://storage.example.com/house-ads/a.png",
      houseAdTargetUrl: "https://empresa.com",
    });
    expect(dbMock.adSlot.update).toHaveBeenCalledWith({
      where: { id: "slot-1" },
      data: {
        source: "HOUSE",
        houseAdImageUrl: "https://storage.example.com/house-ads/a.png",
        houseAdTargetUrl: "https://empresa.com",
      },
    });
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/lib-ad-slots.test.ts`
Expected: FAIL — `UpdateAdSlotData` (tipo TypeScript) ainda não aceita `houseAdImageUrl`/
`houseAdTargetUrl` (erro de tipo) e/ou o teste falha porque o campo não é repassado.

- [ ] **Step 3: Adicionar os campos ao schema Prisma**

Em `prisma/schema.prisma`, no `model AdSlot`, adicionar logo depois de `googleAdUnitId`:

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
  houseAdImageUrl  String?
  houseAdTargetUrl String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  metrics    AdMetricsSnapshot[]
  privateAds PrivateAd[]

  @@map("ad_slots")
}
```

Criar `prisma/migrations/20260723010000_add_adslot_house_ad_fields/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "ad_slots" ADD COLUMN "houseAdImageUrl" TEXT;
ALTER TABLE "ad_slots" ADD COLUMN "houseAdTargetUrl" TEXT;
```

Rodar `npx prisma generate` pra atualizar o client TypeScript.

- [ ] **Step 4: Atualizar `lib/ad-slots.ts`**

Substituir o conteúdo inteiro do arquivo por:

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
  houseAdImageUrl: string | null;
  houseAdTargetUrl: string | null;
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
  houseAdImageUrl?: string | null;
  houseAdTargetUrl?: string | null;
}

export async function updateAdSlot(id: string, data: UpdateAdSlotData): Promise<void> {
  await db.adSlot.update({ where: { id }, data });
}

export async function hasActiveGoogleAdSlot(): Promise<boolean> {
  const rows = await db.adSlot.findMany({ where: { enabled: true, source: "GOOGLE" }, take: 1 });
  return rows.length > 0;
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/lib-ad-slots.test.ts`
Expected: PASS (6 testes — 5 já existentes + 1 novo)

- [ ] **Step 6: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260723010000_add_adslot_house_ad_fields lib/ad-slots.ts tests/lib-ad-slots.test.ts
git commit -m "feat: campos houseAdImageUrl/houseAdTargetUrl no AdSlot"
```

---

### Task 2: `PATCH /api/admin/ads/slots/[id]` — aceitar fonte `HOUSE`

**Files:**
- Modify: `app/api/admin/ads/slots/[id]/route.ts`
- Test: `tests/admin-ad-slots-route.test.ts`

**Interfaces:**
- Consumes: `updateAdSlot` (Task 1, já aceita os campos novos).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/admin-ad-slots-route.test.ts`, adicionar os 2 testes abaixo ao final do
`describe("PATCH /api/admin/ads/slots/[id]", ...)`, antes do fechamento:

```ts
  it("aceita source HOUSE com houseAdImageUrl/houseAdTargetUrl", async () => {
    const res = await PATCH(
      makeRequest({
        source: "HOUSE",
        houseAdImageUrl: "https://storage.example.com/house-ads/a.png",
        houseAdTargetUrl: "https://empresa.com",
      }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", {
      source: "HOUSE",
      houseAdImageUrl: "https://storage.example.com/house-ads/a.png",
      houseAdTargetUrl: "https://empresa.com",
    });
    expect(res.status).toBe(200);
  });

  it("aceita limpar houseAdImageUrl/houseAdTargetUrl com null ao trocar de fonte", async () => {
    const res = await PATCH(
      makeRequest({ source: "GOOGLE", houseAdImageUrl: null, houseAdTargetUrl: null }),
      { params: Promise.resolve({ id: "slot-1" }) },
    );
    expect(updateAdSlot).toHaveBeenCalledWith("slot-1", {
      source: "GOOGLE",
      houseAdImageUrl: null,
      houseAdTargetUrl: null,
    });
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-ad-slots-route.test.ts`
Expected: FAIL — `"HOUSE"` não está no enum do Zod schema atual (`source` rejeitado com 400).

- [ ] **Step 3: Atualizar o schema Zod da rota**

Em `app/api/admin/ads/slots/[id]/route.ts`, trocar o `schema`:

```ts
const schema = z.object({
  enabled: z.boolean().optional(),
  source: z.enum(["GOOGLE", "PRIVATE", "HOUSE"]).nullable().optional(),
  googleAdUnitId: z.string().max(100).nullable().optional(),
  houseAdImageUrl: z.string().max(500).nullable().optional(),
  houseAdTargetUrl: z.string().max(500).nullable().optional(),
});
```

(Nenhuma outra mudança no arquivo — `updateAdSlot(id, parsed.data)` já repassa qualquer campo
presente no body, mesmo padrão de `googleAdUnitId`.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-ad-slots-route.test.ts`
Expected: PASS (7 testes — 5 já existentes + 2 novos)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/ads/slots/\[id\]/route.ts tests/admin-ad-slots-route.test.ts
git commit -m "feat: PATCH de posicao aceita fonte HOUSE e campos de anuncio da casa"
```

---

### Task 3: `POST /api/admin/ads/slots/[id]/house-ad` — upload do anúncio da casa

**Files:**
- Create: `app/api/admin/ads/slots/[id]/house-ad/route.ts`
- Test: `tests/admin-house-ad-upload-route.test.ts`

**Interfaces:**
- Consumes: `validateImageDimensions` (`@/lib/ads/private-ads`, já existe, sem mudança),
  `updateAdSlot` (`@/lib/ad-slots`, Task 1).
- Produces: `POST /api/admin/ads/slots/:id/house-ad` — `multipart/form-data` com `image` (File) +
  `targetUrl` (string) → `200 { houseAdImageUrl: string, houseAdTargetUrl: string }` — consumido
  pela Task 7 (`HouseAdUploadForm.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-house-ad-upload-route.test.ts` (mesmo padrão de
`tests/advertiser-ads-route.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ads/private-ads", () => ({
  validateImageDimensions: vi.fn(),
}));
vi.mock("@/lib/ad-slots", () => ({ updateAdSlot: vi.fn() }));

import { POST } from "@/app/api/admin/ads/slots/[id]/house-ad/route";
import { validateImageDimensions } from "@/lib/ads/private-ads";
import { updateAdSlot } from "@/lib/ad-slots";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const validateImageDimensionsMock = vi.mocked(validateImageDimensions);
const updateAdSlotMock = vi.mocked(updateAdSlot);

const SLOT = { id: "slot-1", key: "A", label: "Posição A", width: 300, height: 250 };

function makeRequest(fields: Record<string, string | Blob> = {}) {
  const formData = new FormData();
  const defaults: Record<string, string | Blob> = {
    targetUrl: "https://empresa.com",
    image: new File(["fake-image-bytes"], "ad.png", { type: "image/png" }),
  };
  const merged = { ...defaults, ...fields };
  for (const [key, value] of Object.entries(merged)) {
    formData.append(key, value as any);
  }
  return new Request("http://localhost/api/admin/ads/slots/slot-1/house-ad", {
    method: "POST",
    body: formData,
  }) as any;
}

describe("POST /api/admin/ads/slots/[id]/house-ad", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_BUCKET = "uploads";
    fetchSpy = vi.spyOn(global, "fetch" as any).mockResolvedValue(new Response(null, { status: 200 })) as any;
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(403);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 400 com URL de destino inválida", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const res = await POST(makeRequest({ targetUrl: "não-é-url" }), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(400);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a posição não existe", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });
    expect(res.status).toBe(404);
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a dimensão da imagem não bate, sem subir arquivo nem atualizar a posição", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(false);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(res.status).toBe(400);
    expect(validateImageDimensionsMock).toHaveBeenCalledWith(expect.any(Buffer), SLOT.width, SLOT.height);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateAdSlotMock).not.toHaveBeenCalled();
  });

  it("retorna 200 e atualiza a posição no caminho de sucesso", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.adSlot.findUnique.mockResolvedValueOnce(SLOT);
    validateImageDimensionsMock.mockResolvedValueOnce(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "slot-1" }) });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(updateAdSlotMock).toHaveBeenCalledWith("slot-1", {
      source: "HOUSE",
      houseAdImageUrl: expect.any(String),
      houseAdTargetUrl: "https://empresa.com",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.houseAdTargetUrl).toBe("https://empresa.com");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-house-ad-upload-route.test.ts`
Expected: FAIL — `@/app/api/admin/ads/slots/[id]/house-ad/route` não existe.

- [ ] **Step 3: Implementar a rota**

Criar `app/api/admin/ads/slots/[id]/house-ad/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateImageDimensions } from "@/lib/ads/private-ads";
import { updateAdSlot } from "@/lib/ad-slots";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_SIZE = 10 * 1024 * 1024;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "uploads";
  return { url, key, bucket, ready: Boolean(url && key) };
}

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
    new URL(targetUrl);
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

  return NextResponse.json({ houseAdImageUrl: imageUrl, houseAdTargetUrl: targetUrl });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-house-ad-upload-route.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/ads/slots/[id]/house-ad/route.ts" tests/admin-house-ad-upload-route.test.ts
git commit -m "feat: rota de upload do anuncio da casa (admin)"
```

---

### Task 4: `GET /api/ads/click/house/[slotId]` — rastreio de clique

**Files:**
- Create: `app/api/ads/click/house/[slotId]/route.ts`
- Test: `tests/ads-click-house-route.test.ts`

**Interfaces:**
- Consumes: `recordClick` (`@/lib/ads/private-ad-metrics`, já existe, sem mudança).
- Produces: `GET /api/ads/click/house/:slotId` → 307 redirect pro `houseAdTargetUrl`, ou 404 —
  consumido pela Task 5 (`AdSlotRenderer.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/ads-click-house-route.test.ts` (mesmo padrão de `tests/ads-click-route.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/ads/private-ad-metrics", () => ({ recordClick: vi.fn() }));

import { GET } from "@/app/api/ads/click/house/[slotId]/route";
import { recordClick } from "@/lib/ads/private-ad-metrics";

const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/ads/click/house/slot-1") as any;
}

describe("GET /api/ads/click/house/[slotId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redireciona pra houseAdTargetUrl e registra o clique quando o slot é HOUSE e está configurado", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({
      id: "slot-1",
      source: "HOUSE",
      houseAdTargetUrl: "https://empresa.com",
    });

    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });

    expect(recordClick).toHaveBeenCalledWith("slot-1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://empresa.com");
  });

  it("retorna 404 quando o slot não existe", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o slot existe mas a fonte não é mais HOUSE", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({
      id: "slot-1",
      source: "GOOGLE",
      houseAdTargetUrl: "https://empresa.com",
    });
    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o slot é HOUSE mas não tem houseAdTargetUrl configurado", async () => {
    dbMock.adSlot.findUnique.mockResolvedValueOnce({ id: "slot-1", source: "HOUSE", houseAdTargetUrl: null });
    const res = await GET(makeRequest(), { params: Promise.resolve({ slotId: "slot-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/ads-click-house-route.test.ts`
Expected: FAIL — `@/app/api/ads/click/house/[slotId]/route` não existe.

- [ ] **Step 3: Implementar a rota**

Criar `app/api/ads/click/house/[slotId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordClick } from "@/lib/ads/private-ad-metrics";

export async function GET(_req: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  const slot = await db.adSlot.findUnique({ where: { id: slotId } });

  if (!slot || slot.source !== "HOUSE" || !slot.houseAdTargetUrl) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  await recordClick(slot.id);
  return new Response(null, {
    status: 307,
    headers: { location: slot.houseAdTargetUrl },
  });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/ads-click-house-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add "app/api/ads/click/house/[slotId]/route.ts" tests/ads-click-house-route.test.ts
git commit -m "feat: rota de rastreio de clique do anuncio da casa"
```

---

### Task 5: `AdSlotRenderer.tsx` — renderizar fonte `HOUSE`

**Files:**
- Modify: `components/ads/AdSlotRenderer.tsx`

**Interfaces:** Nenhuma nova — consome `slot.houseAdImageUrl`/`slot.houseAdTargetUrl` (Task 1) e a
rota da Task 4. Sem teste automatizado (Server Component, convenção já estabelecida no projeto).

- [ ] **Step 1: Implementar**

Substituir o conteúdo inteiro de `components/ads/AdSlotRenderer.tsx` por:

```tsx
import Image from "next/image";
import { getAdSlot } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { recordImpression } from "@/lib/ads/private-ad-metrics";

export default async function AdSlotRenderer({ position }: { position: string }) {
  const slot = await getAdSlot(position);
  if (!slot) return null;
  if (!slot.enabled) return null;

  if (slot.source === "PRIVATE") {
    const ad = await db.privateAd.findFirst({ where: { adSlotId: slot.id, status: "APPROVED" } });
    if (!ad) return null;
    await recordImpression(slot.id);
    return (
      <a href={`/api/ads/click/${ad.id}`} style={{ display: "inline-block", width: slot.width, height: slot.height }}>
        <Image src={ad.imageUrl} alt="" width={slot.width} height={slot.height} style={{ objectFit: "cover" }} />
      </a>
    );
  }

  if (slot.source === "HOUSE") {
    if (!slot.houseAdImageUrl || !slot.houseAdTargetUrl) return null;
    await recordImpression(slot.id);
    return (
      <a href={`/api/ads/click/house/${slot.id}`} style={{ display: "inline-block", width: slot.width, height: slot.height }}>
        <Image src={slot.houseAdImageUrl} alt="" width={slot.width} height={slot.height} style={{ objectFit: "cover" }} />
      </a>
    );
  }

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

- [ ] **Step 2: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 3: Commit**

```bash
git add components/ads/AdSlotRenderer.tsx
git commit -m "feat: AdSlotRenderer exibe anuncio da casa (source HOUSE)"
```

---

### Task 6: `AdSlotEditForm.tsx` — opção "Anúncio da casa" no dropdown

**Files:**
- Modify: `components/admin/AdSlotEditForm.tsx`

**Interfaces:** Nenhuma nova — o PATCH já aceita os campos (Task 2). Sem teste automatizado
(componente client, convenção já estabelecida no projeto).

- [ ] **Step 1: Implementar**

Substituir o conteúdo inteiro de `components/admin/AdSlotEditForm.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  id: string;
  enabled: boolean;
  source: string | null;
  googleAdUnitId: string | null;
}

export default function AdSlotEditForm({ id, enabled: initialEnabled, source: initialSource, googleAdUnitId: initialGoogleAdUnitId }: Props) {
  const router = useRouter();
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
        ...(source !== "HOUSE" ? { houseAdImageUrl: null, houseAdTargetUrl: null } : {}),
      }),
    });
    if (res.ok) {
      setSaved(true);
      router.refresh();
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
        <option value="PRIVATE">Privada (marketplace de anunciantes)</option>
        <option value="HOUSE">Anúncio da casa (admin)</option>
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

(Mudanças: import de `useRouter`, chamada de `router.refresh()` após salvar com sucesso — sem
isso, a página não veria o `source` atualizado a tempo de decidir mostrar o formulário de upload
da Task 7 — e a nova opção "Anúncio da casa (admin)" no `<select>`, mais o espalhamento
condicional que zera `houseAdImageUrl`/`houseAdTargetUrl` quando a fonte selecionada não é
`"HOUSE"`, mesmo padrão já usado pra `googleAdUnitId`.)

- [ ] **Step 2: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdSlotEditForm.tsx
git commit -m "feat: opcao Anuncio da casa no formulario de posicao do admin"
```

---

### Task 7: `HouseAdUploadForm.tsx` — formulário de upload + wiring na página

**Files:**
- Create: `components/admin/HouseAdUploadForm.tsx`
- Modify: `app/admin/anuncios/page.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/ads/slots/:id/house-ad` (Task 3).

Sem teste automatizado (componente client + Server Component, convenção já estabelecida no
projeto).

- [ ] **Step 1: Criar o componente**

Criar `components/admin/HouseAdUploadForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ErrorModal from "@/components/ui/ErrorModal";

interface Props {
  slotId: string;
  width: number;
  height: number;
  initialImageUrl: string | null;
  initialTargetUrl: string | null;
}

export default function HouseAdUploadForm({ slotId, width, height, initialImageUrl, initialTargetUrl }: Props) {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState(initialTargetUrl ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Selecione a imagem do anúncio");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("targetUrl", targetUrl);
      formData.append("image", file);

      const res = await fetch(`/api/admin/ads/slots/${slotId}/house-ad`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Erro ao salvar anúncio da casa");
        return;
      }

      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar anúncio da casa");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3 border-t pt-3 mt-2 dark:border-gray-700">
        {initialImageUrl && (
          <img src={initialImageUrl} alt="Anúncio da casa atual" className="w-20 h-14 object-cover rounded border border-gray-200 dark:border-gray-700" />
        )}
        <input
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="URL de destino"
          className="input-field text-sm py-1 w-56"
          required
        />
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-gray-600 dark:text-gray-400"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">{width}×{height}px exatos</span>
        <button type="submit" disabled={submitting} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
          {submitting ? "Enviando…" : "Salvar anúncio da casa"}
        </button>
      </form>
      <ErrorModal message={error} onClose={() => setError(null)} />
    </>
  );
}
```

- [ ] **Step 2: Wire na página**

Em `app/admin/anuncios/page.tsx`, adicionar o import:

```tsx
import HouseAdUploadForm from "@/components/admin/HouseAdUploadForm";
```

E trocar o bloco de renderização de cada slot:

```tsx
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
            {slot.source === "HOUSE" && (
              <HouseAdUploadForm
                slotId={slot.id}
                width={slot.width}
                height={slot.height}
                initialImageUrl={slot.houseAdImageUrl}
                initialTargetUrl={slot.houseAdTargetUrl}
              />
            )}
          </div>
        ))}
```

- [ ] **Step 3: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 4: Commit**

```bash
git add components/admin/HouseAdUploadForm.tsx app/admin/anuncios/page.tsx
git commit -m "feat: formulario de upload do anuncio da casa na pagina de anuncios do admin"
```

---

## Revisão final (depois de todas as 7 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo.
- [ ] Conferir que nenhum arquivo do marketplace de anunciantes (`PrivateAd`, `AdPurchase`,
  `AdvertiserProfile`, moderação, relatório em PDF) foi tocado por nenhuma task — só leitura,
  reaproveitando `validateImageDimensions` sem modificá-la.
- [ ] Conferir manualmente (leitura de código) que trocar a fonte de um slot pra longe de `HOUSE`
  e salvar realmente zera `houseAdImageUrl`/`houseAdTargetUrl` (Task 6) e que o
  `AdSlotRenderer` (Task 5) para de exibir o anúncio da casa nesse caso.
