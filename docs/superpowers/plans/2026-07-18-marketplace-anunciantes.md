# Marketplace de anunciantes privados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empresas se cadastram como `ADVERTISER`, compram um `AdPlan`, e cadastram `PrivateAd`s
que ocupam com exclusividade uma das 5 posições do sub-projeto 3, com moderação manual, métricas
reaproveitando `AdMetricsSnapshot`, e relatório em PDF enviável por e-mail/WhatsApp.

**Architecture:** `Order` não é tocado (risco alto, usado em relatórios/repasses por todo o
sistema) — nova cadeia `AdvertiserProfile → AdPurchase → PrivateAd`, com `Payment` ganhando uma
segunda FK opcional (`adPurchaseId`) ao lado de `orderId` (que vira opcional). O gateway de
pagamento (`getPaymentProvider()`) já é 100% genérico — `CreatePaymentInput.orderId` é só uma
string de referência externa, não uma FK real, então funciona sem mudança.

**Tech Stack:** Next.js 15 App Router, Prisma, Vitest, `sharp` (já é dependência, usado pra
validar dimensão de imagem), `@react-pdf/renderer` (nova dependência, geração de PDF sem
navegador headless).

## Global Constraints

- `Order`/`lib/checkout.ts`/`Registration` **nunca são tocados** — toda a lógica nova vive em
  modelos e arquivos próprios.
- Posição (`AdSlot`) só pode ter 1 `PrivateAd` com `status=APPROVED` por vez — exclusividade,
  sem fila de espera.
- Todo `PrivateAd` nasce `PENDING_APPROVAL` — sem aprovação automática nesta versão.
- Rejeição não gera reembolso — anunciante mantém a vaga (dentro do prazo pago) e reenvia arte.
- Dimensão da arte validada no servidor (via `sharp`, lendo o arquivo de verdade), nunca só
  confiando em metadata do cliente.
- `ads_marketplace_enabled` (chave em `PlatformSetting`, padrão `"false"`) controla se o
  cadastro de anunciante fica acessível.
- Nunca usar `alert()`/`confirm()`/`prompt()` — usar `ConfirmModal`/`ErrorModal` (regra
  permanente do `CLAUDE.md`), especialmente na tela de moderação (rejeitar com motivo).

Spec completa: `docs/superpowers/specs/2026-07-18-marketplace-anunciantes-design.md`.

---

## Task 1: Schema — `ADVERTISER` + `AdvertiserProfile` + `AdPlan` + `AdPurchase` + `PrivateAd` + seed

**Files:**
- Modify: `prisma/schema.prisma` (enum `UserRole`, novos modelos, `Payment.orderId`/nova
  `adPurchaseId`, `AdSlot.privateAds`, `User.advertiserProfile`)
- Create: `prisma/migrations/20260718010000_add_advertiser_marketplace/migration.sql`

**Interfaces:**
- Produces: modelos `AdvertiserProfile`, `AdPlan`, `AdPurchase`, `PrivateAd`;
  `Payment.adPurchaseId String?`, `Payment.orderId` agora opcional; `UserRole` ganha
  `ADVERTISER` — consumidos por todas as tasks seguintes.

Sem banco de dev acessível — verificação só de sintaxe (`prisma validate`/`generate`).

- [ ] **Step 1: Editar `prisma/schema.prisma`**

No enum `UserRole`, adicionar `ADVERTISER`:

```prisma
enum UserRole {
  ATHLETE
  ORGANIZER
  ADMIN
  ASSISTANT
  ADVERTISER
}
```

No modelo `User`, adicionar a relação:

```prisma
  advertiserProfile AdvertiserProfile?
```

No modelo `Payment`, tornar `orderId` opcional e adicionar a segunda FK — encontrar a linha
atual `orderId String` e a relação `order Order @relation(...)`, trocar por:

```prisma
  orderId       String?
  adPurchaseId  String?
```

e a seção de relações do mesmo modelo, trocar `order Order @relation(fields: [orderId],
references: [id])` por:

```prisma
  order      Order?      @relation(fields: [orderId], references: [id])
  adPurchase AdPurchase? @relation(fields: [adPurchaseId], references: [id])
```

No modelo `AdSlot` (sub-projeto 3), adicionar:

```prisma
  privateAds PrivateAd[]
```

Novos modelos — inserir após `AdMetricsSnapshot`:

```prisma
model AdvertiserProfile {
  id           String   @id @default(cuid())
  userId       String   @unique
  companyName  String
  contactEmail String
  contactPhone String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user      User         @relation(fields: [userId], references: [id])
  purchases AdPurchase[]

  @@map("advertiser_profiles")
}

model AdPlan {
  id                   String   @id @default(cuid())
  name                 String
  priceAmount          Int
  durationDays         Int
  maxSimultaneousSlots Int
  active               Boolean  @default(true)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  purchases AdPurchase[]

  @@map("ad_plans")
}

model AdPurchase {
  id           String    @id @default(cuid())
  advertiserId String
  adPlanId     String
  status       String
  startAt      DateTime?
  endAt        DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  advertiser AdvertiserProfile @relation(fields: [advertiserId], references: [id])
  adPlan     AdPlan            @relation(fields: [adPlanId], references: [id])
  payments   Payment[]
  ads        PrivateAd[]

  @@map("ad_purchases")
}

model PrivateAd {
  id              String   @id @default(cuid())
  adPurchaseId    String
  adSlotId        String
  imageUrl        String
  targetUrl       String
  status          String
  rejectionReason String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  adPurchase AdPurchase @relation(fields: [adPurchaseId], references: [id])
  adSlot     AdSlot     @relation(fields: [adSlotId], references: [id])

  @@map("private_ads")
}
```

(Nota: `AdPurchase.payments` como lista, não 1:1 — mais simples no Prisma pra uma FK opcional
sem exigir `@unique`; a regra "no máximo 1 payment ativo por compra" fica garantida na lógica de
`createAdPlanCheckout`, não no schema.)

- [ ] **Step 2: Validar**

Run: `npx prisma validate` — esperado: válido.
Run: `npx prisma generate` — esperado: sucesso.

- [ ] **Step 3: Escrever a migração manualmente (com seed dos 3 planos)**

Criar `prisma/migrations/20260718010000_add_advertiser_marketplace/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ADVERTISER';

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "payments" ADD COLUMN "adPurchaseId" TEXT;

-- CreateTable
CREATE TABLE "advertiser_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertiser_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "advertiser_profiles_userId_key" ON "advertiser_profiles"("userId");

-- CreateTable
CREATE TABLE "ad_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceAmount" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "maxSimultaneousSlots" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_purchases" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "adPlanId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_ads" (
    "id" TEXT NOT NULL,
    "adPurchaseId" TEXT NOT NULL,
    "adSlotId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "private_ads_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_adPurchaseId_fkey" FOREIGN KEY ("adPurchaseId") REFERENCES "ad_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "advertiser_profiles" ADD CONSTRAINT "advertiser_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_purchases" ADD CONSTRAINT "ad_purchases_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertiser_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_purchases" ADD CONSTRAINT "ad_purchases_adPlanId_fkey" FOREIGN KEY ("adPlanId") REFERENCES "ad_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_ads" ADD CONSTRAINT "private_ads_adPurchaseId_fkey" FOREIGN KEY ("adPurchaseId") REFERENCES "ad_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_ads" ADD CONSTRAINT "private_ads_adSlotId_fkey" FOREIGN KEY ("adSlotId") REFERENCES "ad_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: 3 planos iniciais
INSERT INTO "ad_plans" ("id", "name", "priceAmount", "durationDays", "maxSimultaneousSlots", "active", "updatedAt") VALUES
  ('adplan_basico', 'Básico', 9900, 30, 1, true, CURRENT_TIMESTAMP),
  ('adplan_intermediario', 'Intermediário', 24900, 30, 3, true, CURRENT_TIMESTAMP),
  ('adplan_premium', 'Premium', 49900, 60, 5, true, CURRENT_TIMESTAMP);
```

Mesma observação da Task 1 do sub-projeto 3: `prisma db push` não roda `migration.sql` — o
seed dos 3 planos precisa de INSERT manual no deploy (anotar pra Task de verificação final).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260718010000_add_advertiser_marketplace
git commit -m "feat: add advertiser marketplace schema (AdvertiserProfile, AdPlan, AdPurchase, PrivateAd)"
```

---

## Task 2: `tests/setup.ts` — mocks dos novos modelos

**Files:**
- Modify: `tests/setup.ts`

- [ ] **Step 1: Adicionar ao objeto `db` mockado**, após a linha do `adMetricsSnapshot`:

```ts
    advertiserProfile: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    adPlan: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    adPurchase: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    privateAd: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
```

- [ ] **Step 2: Commit**

```bash
git add tests/setup.ts
git commit -m "test: add advertiser marketplace models to the global db mock"
```

---

## Task 3: Cadastro de anunciante — `/auth/cadastro-anunciante`

**Files:**
- Create: `app/api/auth/register-advertiser/route.ts`
- Create: `components/auth/RegisterAdvertiserForm.tsx`
- Create: `app/auth/cadastro-anunciante/page.tsx`
- Test: `tests/register-advertiser-route.test.ts`

**Interfaces:**
- Produces: `POST /api/auth/register-advertiser` cria `User(role=ADVERTISER)` +
  `AdvertiserProfile` numa transação.

Endpoint próprio (não reaproveita `/api/auth/register`, que é ATHLETE/ORGANIZER-específico com
zod `superRefine` só pra essas duas roles — misturar aumentaria a complexidade daquele arquivo
sem necessidade).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/register-advertiser-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed") } }));
vi.mock("@/lib/validate-email-domain", () => ({ hasValidMxRecord: vi.fn(async () => true) }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { POST } from "@/app/api/auth/register-advertiser/route";
import { getSetting } from "@/lib/settings";

const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/auth/register-advertiser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const validBody = {
  name: "Fulano",
  email: "empresa@example.com",
  password: "senha1234",
  companyName: "Empresa LTDA",
  contactEmail: "contato@empresa.com",
  contactPhone: "5511999999999",
};

describe("POST /api/auth/register-advertiser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSetting).mockResolvedValue("true");
    dbMock.user.findUnique.mockResolvedValue(null);
  });

  it("retorna 403 quando o marketplace de anúncios está desativado", async () => {
    vi.mocked(getSetting).mockResolvedValueOnce("false");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("retorna 400 com payload inválido", async () => {
    const res = await POST(makeRequest({ ...validBody, email: "invalido" }));
    expect(res.status).toBe(400);
  });

  it("retorna 409 quando o e-mail já existe", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "existing" });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
  });

  it("cria User(role=ADVERTISER) e AdvertiserProfile com sucesso", async () => {
    dbMock.user.create.mockResolvedValueOnce({ id: "user-1", name: "Fulano", email: "empresa@example.com", role: "ADVERTISER" });
    dbMock.advertiserProfile.create.mockResolvedValueOnce({ id: "adv-1" });

    const res = await POST(makeRequest(validBody));

    expect(dbMock.user.create).toHaveBeenCalledWith({
      data: { name: "Fulano", email: "empresa@example.com", passwordHash: "hashed", role: "ADVERTISER" },
      select: { id: true, name: true, email: true, role: true },
    });
    expect(dbMock.advertiserProfile.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        companyName: "Empresa LTDA",
        contactEmail: "contato@empresa.com",
        contactPhone: "5511999999999",
      },
    });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/register-advertiser-route.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar a rota**

Criar `app/api/auth/register-advertiser/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { hasValidMxRecord } from "@/lib/validate-email-domain";

const schema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  companyName: z.string().min(2).max(150),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8).max(20),
});

export async function POST(req: NextRequest) {
  const enabled = await getSetting("ads_marketplace_enabled");
  if (enabled !== "true") {
    return NextResponse.json({ error: "Cadastro de anunciantes não está disponível no momento" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, password, companyName, contactEmail, contactPhone } = parsed.data;

  if (!(await hasValidMxRecord(email))) {
    return NextResponse.json({ error: "Domínio de e-mail inválido ou inexistente" }, { status: 400 });
  }

  const exists = await db.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await db.user.create({
    data: { name, email, passwordHash, role: "ADVERTISER" },
    select: { id: true, name: true, email: true, role: true },
  });

  await db.advertiserProfile.create({
    data: { userId: user.id, companyName, contactEmail, contactPhone },
  });

  return NextResponse.json({ user }, { status: 201 });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/register-advertiser-route.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Criar o formulário e a página (sem teste — zero testes de UI no repo)**

Criar `components/auth/RegisterAdvertiserForm.tsx` (mesmo padrão de `RegisterForm.tsx`, campos
`name/email/password/companyName/contactEmail/contactPhone`, `fetch` pro endpoint desta task,
redireciona pra `/auth/login?registered=1` em caso de sucesso).

Criar `app/auth/cadastro-anunciante/page.tsx` (server component simples, título + `<
RegisterAdvertiserForm />`, mesmo layout de `app/auth/cadastro/page.tsx` se existir — verificar
o arquivo real de referência antes de implementar).

- [ ] **Step 6: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/api/auth/register-advertiser components/auth/RegisterAdvertiserForm.tsx app/auth/cadastro-anunciante tests/register-advertiser-route.test.ts
git commit -m "feat: add advertiser self-registration flow"
```

---

## Task 4: `lib/checkout-ads.ts` — checkout do plano de anúncio

**Files:**
- Create: `lib/checkout-ads.ts`
- Test: `tests/lib-checkout-ads.test.ts`

**Interfaces:**
- Produces: `createAdPlanCheckout(advertiserId: string, adPlanId: string): Promise<{
  adPurchaseId: string; totalAmount: number }>` — consumido pela Task 5.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-checkout-ads.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createAdPlanCheckout } from "@/lib/checkout-ads";

const dbMock = db as any;

describe("createAdPlanCheckout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lança erro quando o plano não existe ou está inativo", async () => {
    dbMock.adPlan.findUnique.mockResolvedValueOnce(null);
    await expect(createAdPlanCheckout("adv-1", "plan-1")).rejects.toThrow("Plano não encontrado");
  });

  it("lança erro quando o plano está desativado", async () => {
    dbMock.adPlan.findUnique.mockResolvedValueOnce({ id: "plan-1", active: false, priceAmount: 9900 });
    await expect(createAdPlanCheckout("adv-1", "plan-1")).rejects.toThrow("Plano não encontrado");
  });

  it("cria AdPurchase(status=PENDING) e retorna o id + valor total", async () => {
    dbMock.adPlan.findUnique.mockResolvedValueOnce({ id: "plan-1", active: true, priceAmount: 9900 });
    dbMock.adPurchase.create.mockResolvedValueOnce({ id: "purchase-1" });

    const result = await createAdPlanCheckout("adv-1", "plan-1");

    expect(dbMock.adPurchase.create).toHaveBeenCalledWith({
      data: { advertiserId: "adv-1", adPlanId: "plan-1", status: "PENDING" },
    });
    expect(result).toEqual({ adPurchaseId: "purchase-1", totalAmount: 9900 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-checkout-ads.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `lib/checkout-ads.ts`:

```ts
import { db } from "./db";

export interface AdPlanCheckoutResult {
  adPurchaseId: string;
  totalAmount: number;
}

export async function createAdPlanCheckout(advertiserId: string, adPlanId: string): Promise<AdPlanCheckoutResult> {
  const plan = await db.adPlan.findUnique({ where: { id: adPlanId } });
  if (!plan || !plan.active) {
    throw new Error("Plano não encontrado");
  }

  const purchase = await db.adPurchase.create({
    data: { advertiserId, adPlanId, status: "PENDING" },
  });

  return { adPurchaseId: purchase.id, totalAmount: plan.priceAmount };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-checkout-ads.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add lib/checkout-ads.ts tests/lib-checkout-ads.test.ts
git commit -m "feat: add ad plan checkout module"
```

---

## Task 5: `POST /api/checkout-ads` — cria a compra e o pagamento

**Files:**
- Create: `app/api/checkout-ads/route.ts`
- Test: `tests/checkout-ads-route.test.ts`

**Interfaces:**
- Consumes: `createAdPlanCheckout` (Task 4), `getPaymentProvider()` (`lib/payment`, já existe).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/checkout-ads-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/checkout-ads", () => ({ createAdPlanCheckout: vi.fn() }));
vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));

import { POST } from "@/app/api/checkout-ads/route";
import { createAdPlanCheckout } from "@/lib/checkout-ads";
import { getPaymentProvider } from "@/lib/payment";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/checkout-ads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/checkout-ads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await POST(makeRequest({ adPlanId: "plan-1", paymentMethod: "PIX" }));
    expect(res.status).toBe(401);
  });

  it("retorna 403 para quem não é ADVERTISER", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ adPlanId: "plan-1", paymentMethod: "PIX" }));
    expect(res.status).toBe(403);
  });

  it("cria a compra, chama o gateway e grava o Payment com adPurchaseId", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ADVERTISER", name: "Fulano", email: "f@example.com" } } as any);
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "adv-1" });
    vi.mocked(createAdPlanCheckout).mockResolvedValueOnce({ adPurchaseId: "purchase-1", totalAmount: 9900 });
    const createPayment = vi.fn().mockResolvedValueOnce({
      providerPaymentId: "pp-1",
      status: "PENDING",
      pixQrCodeText: "00020101...",
    });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ createPayment } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(makeRequest({ adPlanId: "plan-1", paymentMethod: "PIX" }));

    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "purchase-1",
      amount: 9900,
      method: "PIX",
    }));
    expect(dbMock.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ adPurchaseId: "purchase-1", amount: 9900 }),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/checkout-ads-route.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/checkout-ads/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAdPlanCheckout } from "@/lib/checkout-ads";
import { getPaymentProvider } from "@/lib/payment";

const schema = z.object({
  adPlanId: z.string().min(1),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
  cardToken: z.string().optional(),
  cardBrand: z.string().optional(),
  installments: z.number().int().min(1).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  }
  if (session.user.role !== "ADVERTISER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });
  if (!advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  let checkout;
  try {
    checkout = await createAdPlanCheckout(advertiser.id, parsed.data.adPlanId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao processar compra";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const provider = await getPaymentProvider();
  const idempotencyKey = `${checkout.adPurchaseId}_${parsed.data.paymentMethod}_${randomUUID()}`;

  const paymentResult = await provider.createPayment({
    orderId: checkout.adPurchaseId,
    amount: checkout.totalAmount,
    method: parsed.data.paymentMethod,
    idempotencyKey,
    buyer: { name: session.user.name, email: session.user.email },
    description: `Compra de plano de anúncio`,
    cardToken: parsed.data.cardToken,
    cardBrand: parsed.data.cardBrand,
    installments: parsed.data.installments,
  });

  await db.payment.create({
    data: {
      adPurchaseId: checkout.adPurchaseId,
      provider: (await import("@/lib/payment-settings")).getPaymentProviderSetting ? await (await import("@/lib/payment-settings")).getPaymentProviderSetting() : "sandbox",
      providerPaymentId: paymentResult.providerPaymentId,
      method: parsed.data.paymentMethod,
      status: paymentResult.status,
      amount: checkout.totalAmount,
      pixQrCodeText: paymentResult.pixQrCodeText,
      boletoUrl: paymentResult.boletoUrl,
      expiresAt: paymentResult.expiresAt,
      rawPayload: {},
      idempotencyKey,
    },
  });

  return NextResponse.json({
    adPurchaseId: checkout.adPurchaseId,
    status: paymentResult.status,
    pixQrCode: paymentResult.pixQrCode,
    pixQrCodeText: paymentResult.pixQrCodeText,
    boletoUrl: paymentResult.boletoUrl,
    checkoutUrl: paymentResult.checkoutUrl,
  });
}
```

> **Nota pro implementador:** a linha do `provider:` no `db.payment.create` acima está
> deliberadamente feia (import dinâmico duplicado) — LIMPE isso: no topo do arquivo, importe
> `import { getPaymentProviderSetting } from "@/lib/payment-settings";` normalmente, chame
> `const providerKey = await getPaymentProviderSetting();` uma vez antes do `db.payment.create`,
> e use `provider: providerKey` no `data`. O trecho acima é só pra deixar claro que o campo
> `Payment.provider` (obrigatório no schema) precisa vir de algum lugar — use o mesmo helper que
> `app/api/checkout/route.ts` já usa pra isso.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/checkout-ads-route.test.ts`
Expected: PASS (3/3)

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add app/api/checkout-ads tests/checkout-ads-route.test.ts
git commit -m "feat: add ad plan checkout API route"
```

---

## Task 6: Webhook de pagamento — branch pra `AdPurchase`

**Files:**
- Modify: `app/api/webhooks/payment/route.ts`
- Create: `lib/ads/ad-purchase-confirmation.ts` (e-mail de confirmação da compra)
- Test: `tests/payment-webhook-ad-purchase.test.ts` (novo, focado só no branch novo — não duplica
  os testes já existentes do webhook de registration)

**Interfaces:**
- Produces: `confirmAdPurchasePayment(paymentId: string, status: string): Promise<void>` em
  `lib/ads/ad-purchase-confirmation.ts` — marca `AdPurchase` como `PAID` apenas quando
  `status === "PAID"`, calcula `startAt`/`endAt`, envia e-mail; para outros status, só
  atualiza `Payment.status` e retorna.

- [ ] **Step 1: Ler o arquivo atual por completo**

Ler `app/api/webhooks/payment/route.ts` e `lib/payment/sync-payment-status.ts` inteiros antes de
editar — este webhook já tem lógica não-trivial pra pagamentos de inscrição (Mercado Pago status
fetch, `applyGatewayStatus`); a mudança precisa ser aditiva, sem alterar o comportamento
existente pra pagamentos de `Order`.

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/payment-webhook-ad-purchase.test.ts` cobrindo especificamente: quando
`db.payment.findFirst` (buscado por `providerPaymentId`) retorna uma linha com `adPurchaseId`
preenchido e `orderId` nulo, o webhook NÃO deve chamar `applyGatewayStatus` (que assume
`payment.order`/`registrations`), e SIM chamar uma nova função dedicada
(`confirmAdPurchasePayment` ou equivalente) que atualiza `AdPurchase.status`. Escrever o teste
mockando `db.payment.findFirst` pra esse cenário e afirmando que o `AdPurchase` é atualizado.
Siga o padrão de mock já usado nos testes de webhook existentes deste projeto (se houver um
arquivo de teste pro webhook de pagamento hoje, leia-o primeiro pra reaproveitar os mocks de
`getPaymentProvider`/`verifyWebhookSignature`/`parseWebhookPayload`).

- [ ] **Step 3: Implementar**

Em `app/api/webhooks/payment/route.ts`, o `db.payment.findFirst` que hoje faz
`include: { order: { include: { registrations: true, buyer: ... } } }` precisa também trazer
`adPurchase: { include: { advertiser: { include: { user: true } }, adPlan: true } }`. Logo após
resolver `payment`, branch:

```ts
if (payment.adPurchaseId) {
  await confirmAdPurchasePayment(payment.id, newPaymentStatus);
  return NextResponse.json({ ok: true });
}
// ...fluxo existente de Order/Registration segue exatamente igual abaixo
```

Criar `lib/ads/ad-purchase-confirmation.ts`:

```ts
import { db } from "../db";
import { sendAdPurchaseConfirmationEmail } from "../email";

export async function confirmAdPurchasePayment(paymentId: string, status: string): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { adPurchase: { include: { advertiser: { include: { user: true } }, adPlan: true } } },
  });
  if (!payment?.adPurchase) return;

  await db.payment.update({ where: { id: paymentId }, data: { status } });

  if (status !== "PAID") return;
  if (payment.adPurchase.status === "PAID") return; // idempotente, webhook pode repetir

  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + payment.adPurchase.adPlan.durationDays * 24 * 60 * 60 * 1000);

  await db.adPurchase.update({
    where: { id: payment.adPurchase.id },
    data: { status: "PAID", startAt, endAt },
  });

  await sendAdPurchaseConfirmationEmail({
    to: payment.adPurchase.advertiser.user.email,
    name: payment.adPurchase.advertiser.user.name,
    planName: payment.adPurchase.adPlan.name,
    endAt,
  });
}
```

Adicionar `sendAdPurchaseConfirmationEmail` em `lib/email.ts` (mesmo padrão das outras funções
do arquivo — usa `sendMail` internamente, então já fica logado pelo `MessageLog` do
sub-projeto 2 automaticamente, sem trabalho extra):

```ts
export async function sendAdPurchaseConfirmationEmail(params: {
  to: string;
  name: string;
  planName: string;
  endAt: Date;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Plano de anúncio confirmado — ${params.planName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Seu plano <strong>${params.planName}</strong> foi confirmado! Já pode cadastrar seus
       anúncios no painel do anunciante.</p>
       <p>Validade até: <strong>${params.endAt.toLocaleDateString("pt-BR")}</strong></p>`
    ),
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/payment-webhook-ad-purchase.test.ts`
Expected: PASS

Run: `npx vitest run` — rodar a suíte inteira aqui, não só o arquivo novo, já que este webhook
tem testes existentes cobrindo o fluxo de `Order` que **não podem regredir**.
Expected: sem regressão em nenhum teste pré-existente de webhook/pagamento.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/payment/route.ts lib/ads/ad-purchase-confirmation.ts lib/email.ts tests/payment-webhook-ad-purchase.test.ts
git commit -m "feat: handle ad purchase payments in the payment webhook"
```

---

## Task 7: Painel do anunciante — layout + nav + `/anunciante/planos`

**Files:**
- Create: `app/anunciante/layout.tsx`
- Create: `components/advertiser/AdvertiserNav.tsx`
- Create: `app/anunciante/planos/page.tsx`
- Create: `app/anunciante/page.tsx` (dashboard simples: compras ativas + link pra planos)

**Interfaces:**
- Consumes: `requireAuth`/verificação de role ADVERTISER (mesmo padrão de `app/dashboard/
  layout.tsx`, que já checa `session.user.role`).

Sem teste automatizado (páginas, zero testes de página no repo). Verificação: `tsc` + Task final.

- [ ] **Step 1: Layout**

Criar `app/anunciante/layout.tsx` — mesmo padrão de `app/dashboard/layout.tsx`: `requireAuth()`,
redireciona pra `/acesso-negado` se `session.user.role !== "ADVERTISER"`, renderiza
`<AdvertiserNav>` + `{children}`.

Criar `components/advertiser/AdvertiserNav.tsx` — mesmo padrão visual de `OrganizerNav.tsx`
(links: Dashboard `/anunciante`, Planos `/anunciante/planos`, Meus Anúncios
`/anunciante/anuncios`, Meus Dados).

- [ ] **Step 2: `/anunciante/planos`**

Lista `AdPlan` com `active=true` (`db.adPlan.findMany({where: {active: true}})`), cada um com
nome/preço/duração/posições + botão "Assinar" (client component que faz `POST
/api/checkout-ads` com `paymentMethod` fixo em PIX nesta primeira versão — sem seletor de método
de pagamento, pra não inflar o escopo desta tela; se precisar de cartão/boleto depois, é uma
extensão pequena e isolada) e mostra o QR code/link de pagamento retornado.

- [ ] **Step 3: `/anunciante` (dashboard)**

Lista as `AdPurchase` do anunciante logado (via `AdvertiserProfile`) com status e vagas
usadas/disponíveis, link pra "Cadastrar anúncio" quando há vaga livre numa compra `PAID` ativa.

- [ ] **Step 4: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add app/anunciante components/advertiser
git commit -m "feat: add advertiser dashboard, nav, and plans page"
```

---

## Task 8: `lib/ads/private-ads.ts` — disponibilidade de posição + validação de dimensão

**Files:**
- Create: `lib/ads/private-ads.ts`
- Test: `tests/lib-private-ads.test.ts`

**Interfaces:**
- Produces: `listAvailableSlotsForAdvertiser(): Promise<AdSlotRow[]>` (posições sem
  `PrivateAd APPROVED` ativo), `hasAvailableSlotInPurchase(adPurchaseId: string):
  Promise<boolean>`, `validateImageDimensions(buffer: Buffer, expectedWidth: number,
  expectedHeight: number): Promise<boolean>` (via `sharp`) — consumidos pela Task 9.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-private-ads.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listAvailableSlotsForAdvertiser, hasAvailableSlotInPurchase } from "@/lib/ads/private-ads";

const dbMock = db as any;

describe("listAvailableSlotsForAdvertiser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna só posições sem PrivateAd APPROVED ativo", async () => {
    dbMock.adSlot.findMany.mockResolvedValueOnce([{ id: "slot-1", key: "A" }]);

    const result = await listAvailableSlotsForAdvertiser();

    expect(dbMock.adSlot.findMany).toHaveBeenCalledWith({
      where: { privateAds: { none: { status: "APPROVED" } } },
      orderBy: { key: "asc" },
    });
    expect(result).toEqual([{ id: "slot-1", key: "A" }]);
  });
});

describe("hasAvailableSlotInPurchase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna true quando o número de anúncios ativos é menor que o limite do plano", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      adPlan: { maxSimultaneousSlots: 3 },
      ads: [{ status: "APPROVED" }, { status: "PENDING_APPROVAL" }],
    });
    expect(await hasAvailableSlotInPurchase("purchase-1")).toBe(true);
  });

  it("retorna false quando o limite já foi atingido", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      adPlan: { maxSimultaneousSlots: 1 },
      ads: [{ status: "APPROVED" }],
    });
    expect(await hasAvailableSlotInPurchase("purchase-1")).toBe(false);
  });

  it("EXPIRED e REJECTED não contam pro limite", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      adPlan: { maxSimultaneousSlots: 1 },
      ads: [{ status: "EXPIRED" }, { status: "REJECTED" }],
    });
    expect(await hasAvailableSlotInPurchase("purchase-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-private-ads.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `lib/ads/private-ads.ts`:

```ts
import sharp from "sharp";
import { db } from "../db";

export async function listAvailableSlotsForAdvertiser() {
  return db.adSlot.findMany({
    where: { privateAds: { none: { status: "APPROVED" } } },
    orderBy: { key: "asc" },
  });
}

const ACTIVE_STATUSES = ["APPROVED", "PENDING_APPROVAL"];

export async function hasAvailableSlotInPurchase(adPurchaseId: string): Promise<boolean> {
  const purchase = await db.adPurchase.findUnique({
    where: { id: adPurchaseId },
    include: { adPlan: true, ads: true },
  });
  if (!purchase) return false;

  const activeCount = purchase.ads.filter((ad) => ACTIVE_STATUSES.includes(ad.status)).length;
  return activeCount < purchase.adPlan.maxSimultaneousSlots;
}

export async function validateImageDimensions(
  buffer: Buffer,
  expectedWidth: number,
  expectedHeight: number,
): Promise<boolean> {
  const metadata = await sharp(buffer).metadata();
  return metadata.width === expectedWidth && metadata.height === expectedHeight;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-private-ads.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add lib/ads/private-ads.ts tests/lib-private-ads.test.ts
git commit -m "feat: add private ad slot availability and image dimension validation"
```

---

## Task 9: `POST /api/anunciante/ads` — cadastro do anúncio + `/anunciante/anuncios/novo`

**Files:**
- Create: `app/api/anunciante/ads/route.ts`
- Create: `app/anunciante/anuncios/novo/page.tsx`
- Create: `components/advertiser/PrivateAdForm.tsx`
- Test: `tests/advertiser-ads-route.test.ts`

**Interfaces:**
- Consumes: `hasAvailableSlotInPurchase`, `validateImageDimensions` (Task 8).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/advertiser-ads-route.test.ts` cobrindo: 401 sem sessão, 403 pra quem não é
ADVERTISER, 400 quando a compra não tem vaga disponível (`hasAvailableSlotInPurchase` retorna
`false`), 400 quando a dimensão da imagem não bate com a posição escolhida
(`validateImageDimensions` retorna `false`, sem chamar `db.privateAd.create`), 201 com sucesso
(cria `PrivateAd(status=PENDING_APPROVAL)`). Mockar `@/lib/ads/private-ads` inteiro e simular o
upload via um `FormData` com um `File` de teste (usar um buffer pequeno qualquer, já que
`validateImageDimensions` está mockada e não processa o buffer de verdade no teste).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/advertiser-ads-route.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar a rota**

Criar `app/api/anunciante/ads/route.ts` — `POST`, autentica (`role === "ADVERTISER"`), lê
`multipart/form-data` (`adPurchaseId`, `adSlotId`, `targetUrl`, `image` como `File`), valida:
1. `hasAvailableSlotInPurchase(adPurchaseId)` — 400 se `false`.
2. Busca o `AdSlot` pelo `adSlotId`, confirma que está entre `listAvailableSlotsForAdvertiser()`
   — 400 "Posição indisponível" se não estiver.
3. `validateImageDimensions(buffer, slot.width, slot.height)` — 400 "Dimensão da imagem deve
   ser {width}x{height}px" se `false`.
4. Faz upload do buffer pro Supabase (mesmo mecanismo de `app/api/upload/route.ts`, mas escrito
   direto aqui — chamar dimensão ANTES de subir o arquivo, pra não deixar arquivo órfão no
   storage se a validação falhar).
5. `db.privateAd.create({data: {adPurchaseId, adSlotId, imageUrl, targetUrl, status:
   "PENDING_APPROVAL"}})`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/advertiser-ads-route.test.ts`
Expected: PASS

- [ ] **Step 5: UI (sem teste automatizado)**

Criar `components/advertiser/PrivateAdForm.tsx` (client component: select de `AdPurchase` com
vaga livre, select de posição disponível — mostrando a dimensão exigida ao lado de cada opção,
input de arquivo, input de URL de destino, submit via `FormData`).

Criar `app/anunciante/anuncios/novo/page.tsx` (server component: busca as compras `PAID` do
anunciante com vaga livre + `listAvailableSlotsForAdvertiser()`, passa pro form. Se a lista de
compras com vaga livre vier vazia, `redirect("/anunciante/planos")` do `next/navigation` — caso
de borda da spec: anunciante sem `AdPurchase` paga com vaga não pode acessar esta tela).

- [ ] **Step 6: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/api/anunciante/ads app/anunciante/anuncios components/advertiser/PrivateAdForm.tsx tests/advertiser-ads-route.test.ts
git commit -m "feat: add private ad creation flow for advertisers"
```

---

## Task 10: `AdSlotRenderer` — branch `PRIVATE` + rastreio de impressão

**Files:**
- Modify: `components/ads/AdSlotRenderer.tsx` (Task 4 do sub-projeto 3, já aprovado)
- Create: `lib/ads/private-ad-metrics.ts`
- Test: `tests/lib-private-ad-metrics.test.ts`

**Interfaces:**
- Produces: `recordImpression(adSlotId: string): Promise<void>` e `recordClick(adSlotId:
  string): Promise<void>` (ambas fazem upsert em `AdMetricsSnapshot`, `increment: 1` no campo
  correspondente, best-effort/nunca lançam) — `recordImpression` é consumido por
  `AdSlotRenderer` nesta mesma task, `recordClick` é consumido pela Task 11 (clique).

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/lib-private-ad-metrics.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { recordImpression } from "@/lib/ads/private-ad-metrics";

const dbMock = db as any;

describe("recordImpression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("faz upsert incrementando impressions na linha do dia (data zerada, sem hora)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockResolvedValueOnce({});

    await recordImpression("slot-1");

    const call = dbMock.adMetricsSnapshot.upsert.mock.calls[0][0];
    expect(call.where.adSlotId_date.adSlotId).toBe("slot-1");
    expect(call.where.adSlotId_date.date.getUTCHours()).toBe(0);
    expect(call.create).toEqual({
      adSlotId: "slot-1",
      date: call.where.adSlotId_date.date,
      impressions: 1,
      clicks: 0,
      estimatedRevenueMicros: 0n,
      currency: "BRL",
    });
    expect(call.update).toEqual({ impressions: { increment: 1 } });
  });

  it("nunca lança erro (best-effort — falha de log de métrica não pode derrubar a exibição do anúncio)", async () => {
    dbMock.adMetricsSnapshot.upsert.mockRejectedValueOnce(new Error("db down"));
    await expect(recordImpression("slot-1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-private-ad-metrics.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `lib/ads/private-ad-metrics.ts`:

```ts
import { db } from "../db";

function todayUtcMidnight(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function recordImpression(adSlotId: string): Promise<void> {
  try {
    const date = todayUtcMidnight();
    await db.adMetricsSnapshot.upsert({
      where: { adSlotId_date: { adSlotId, date } },
      create: { adSlotId, date, impressions: 1, clicks: 0, estimatedRevenueMicros: 0n, currency: "BRL" },
      update: { impressions: { increment: 1 } },
    });
  } catch {
    // Best-effort — nunca deve quebrar a exibição do anúncio.
  }
}

export async function recordClick(adSlotId: string): Promise<void> {
  try {
    const date = todayUtcMidnight();
    await db.adMetricsSnapshot.upsert({
      where: { adSlotId_date: { adSlotId, date } },
      create: { adSlotId, date, impressions: 0, clicks: 1, estimatedRevenueMicros: 0n, currency: "BRL" },
      update: { clicks: { increment: 1 } },
    });
  } catch {
    // Best-effort — nunca deve quebrar o redirect.
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-private-ad-metrics.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Adicionar o branch `PRIVATE` em `AdSlotRenderer.tsx`**

Ler o arquivo atual primeiro (curto, da Task 4 do sub-projeto 3). Adicionar, ao lado do branch
`source === "GOOGLE"` já existente:

```tsx
if (slot.source === "PRIVATE") {
  const ad = await db.privateAd.findFirst({ where: { adSlotId: slot.id, status: "APPROVED" } });
  if (!ad) return null;
  await recordImpression(slot.id);
  return (
    <a href={`/api/ads/click/${ad.id}`} style={{ display: "inline-block", width: slot.width, height: slot.height }}>
      <img src={ad.imageUrl} alt="" width={slot.width} height={slot.height} style={{ objectFit: "cover" }} />
    </a>
  );
}
```

(Import `db` de `@/lib/db` e `recordImpression` de `@/lib/ads/private-ad-metrics` no topo do
arquivo — o componente já é `async`, sem mudança de assinatura.)

- [ ] **Step 6: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add components/ads/AdSlotRenderer.tsx lib/ads/private-ad-metrics.ts tests/lib-private-ad-metrics.test.ts
git commit -m "feat: render approved private ads and track impressions"
```

---

## Task 11: `GET /api/ads/click/[privateAdId]` — rastreio de clique + redirect

**Files:**
- Create: `app/api/ads/click/[privateAdId]/route.ts`
- Test: `tests/ads-click-route.test.ts`

**Interfaces:**
- Consumes: `recordClick` (Task 10).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/ads-click-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/ads/private-ad-metrics", () => ({ recordClick: vi.fn() }));

import { GET } from "@/app/api/ads/click/[privateAdId]/route";
import { recordClick } from "@/lib/ads/private-ad-metrics";

const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/ads/click/ad-1") as any;
}

describe("GET /api/ads/click/[privateAdId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redireciona pra targetUrl e registra o clique quando o anúncio existe e está aprovado", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", adSlotId: "slot-1", targetUrl: "https://empresa.com", status: "APPROVED" });

    const res = await GET(makeRequest(), { params: Promise.resolve({ privateAdId: "ad-1" }) });

    expect(recordClick).toHaveBeenCalledWith("slot-1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://empresa.com");
  });

  it("retorna 404 quando o anúncio não existe", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ privateAdId: "ad-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o anúncio existe mas não está mais aprovado", async () => {
    dbMock.privateAd.findUnique.mockResolvedValueOnce({ id: "ad-1", adSlotId: "slot-1", targetUrl: "https://empresa.com", status: "EXPIRED" });
    const res = await GET(makeRequest(), { params: Promise.resolve({ privateAdId: "ad-1" }) });
    expect(res.status).toBe(404);
    expect(recordClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/ads-click-route.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/ads/click/[privateAdId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordClick } from "@/lib/ads/private-ad-metrics";

export async function GET(_req: Request, { params }: { params: Promise<{ privateAdId: string }> }) {
  const { privateAdId } = await params;
  const ad = await db.privateAd.findUnique({ where: { id: privateAdId } });

  if (!ad || ad.status !== "APPROVED") {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  await recordClick(ad.adSlotId);
  return NextResponse.redirect(ad.targetUrl);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/ads-click-route.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add app/api/ads/click tests/ads-click-route.test.ts
git commit -m "feat: add private ad click tracking and redirect route"
```

---

## Task 12: Moderação — `/admin/anuncios/moderacao`

**Files:**
- Create: `app/api/admin/ads/private/[id]/approve/route.ts`
- Create: `app/api/admin/ads/private/[id]/reject/route.ts`
- Create: `app/admin/anuncios/moderacao/page.tsx`
- Create: `components/admin/PrivateAdModerationRow.tsx`
- Test: `tests/admin-ad-moderation-routes.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores além do schema.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-ad-moderation-routes.test.ts` cobrindo as 2 rotas: 403 pra quem não é admin,
200 aprovando (`db.privateAd.update` com `status: "APPROVED"`), 400 ao rejeitar sem
`rejectionReason`, 200 rejeitando com motivo (`status: "REJECTED", rejectionReason: "..."`).
Mesmo padrão de `tests/admin-ad-slots-route.test.ts` (Task 7 do sub-projeto 3) — `requireAdmin`,
não `requirePermission` (mesma decisão de admin-only sem delegação a assistente).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/admin-ad-moderation-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar as 2 rotas**

`app/api/admin/ads/private/[id]/approve/route.ts` — `POST`, admin-only, `db.privateAd.update({
where: {id}, data: {status: "APPROVED"}})`.

`app/api/admin/ads/private/[id]/reject/route.ts` — `POST`, admin-only, body `{reason: string}`
validado com zod (`min(1)`), `db.privateAd.update({where: {id}, data: {status: "REJECTED",
rejectionReason: reason}})`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/admin-ad-moderation-routes.test.ts`
Expected: PASS

- [ ] **Step 5: UI (sem teste automatizado)**

Criar `components/admin/PrivateAdModerationRow.tsx` (client component: mostra a imagem, link de
destino, empresa; botão "Aprovar" chama a rota de aprovação direto; botão "Rejeitar" abre
`ConfirmModal` com `showNoteField noteRequired` — **nunca `prompt()` nativo**, chama a rota de
rejeição com a nota como `reason`).

Criar `app/admin/anuncios/moderacao/page.tsx` (`requireAdmin`, lista `PrivateAd` com
`status=PENDING_APPROVAL`, renderiza `<PrivateAdModerationRow>` por item).

- [ ] **Step 6: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/ads/private app/admin/anuncios/moderacao components/admin/PrivateAdModerationRow.tsx tests/admin-ad-moderation-routes.test.ts
git commit -m "feat: add private ad moderation queue"
```

---

## Task 13: Cron `expire-private-ads`

**Files:**
- Create: `lib/ads/expire-private-ads.ts`
- Create: `app/api/cron/expire-private-ads/route.ts`
- Test: `tests/lib-expire-private-ads.test.ts`, `tests/cron-expire-private-ads-route.test.ts`

**Interfaces:**
- Produces: `expirePrivateAds(): Promise<{ expired: number }>`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-expire-private-ads.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { expirePrivateAds } from "@/lib/ads/expire-private-ads";

const dbMock = db as any;

describe("expirePrivateAds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca como EXPIRED os PrivateAd cuja AdPurchase já venceu, sem tocar nos outros status", async () => {
    dbMock.privateAd.updateMany.mockResolvedValueOnce({ count: 3 });

    const result = await expirePrivateAds();

    expect(dbMock.privateAd.updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["APPROVED", "PENDING_APPROVAL"] },
        adPurchase: { endAt: { lt: expect.any(Date) } },
      },
      data: { status: "EXPIRED" },
    });
    expect(result).toEqual({ expired: 3 });
  });
});
```

Criar `tests/cron-expire-private-ads-route.test.ts` — mesmo padrão exato de
`tests/cron-ad-metrics-sync-route.test.ts` (sub-projeto 3, Task 14): 401 com secret errado, 200
chamando `expirePrivateAds()` e retornando `{expired}`.

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run tests/lib-expire-private-ads.test.ts tests/cron-expire-private-ads-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Criar `lib/ads/expire-private-ads.ts`:

```ts
import { db } from "../db";

export async function expirePrivateAds(): Promise<{ expired: number }> {
  const result = await db.privateAd.updateMany({
    where: {
      status: { in: ["APPROVED", "PENDING_APPROVAL"] },
      adPurchase: { endAt: { lt: new Date() } },
    },
    data: { status: "EXPIRED" },
  });
  return { expired: result.count };
}
```

Criar `app/api/cron/expire-private-ads/route.ts` (idêntico em estrutura a
`app/api/cron/ad-metrics-sync/route.ts`, mesmo header `x-cron-secret`/`CRON_SECRET`, chamando
`expirePrivateAds()` em vez de `syncAdMetrics`).

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npx vitest run tests/lib-expire-private-ads.test.ts tests/cron-expire-private-ads-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ads/expire-private-ads.ts app/api/cron/expire-private-ads tests/lib-expire-private-ads.test.ts tests/cron-expire-private-ads-route.test.ts
git commit -m "feat: add cron to expire private ads past their purchase end date"
```

---

## Task 14: `/admin/anuncios/planos` — CRUD de `AdPlan`

**Files:**
- Create: `app/api/admin/ads/plans/route.ts` (GET lista + POST cria)
- Create: `app/api/admin/ads/plans/[id]/route.ts` (PATCH edita/desativa)
- Create: `app/admin/anuncios/planos/page.tsx`
- Create: `components/admin/AdPlanForm.tsx`
- Test: `tests/admin-ad-plans-routes.test.ts`

**Interfaces:**
- Nenhuma consumida de tasks anteriores além do schema.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-ad-plans-routes.test.ts` cobrindo: `POST` cria (`admin-only`, zod valida
`name/priceAmount/durationDays/maxSimultaneousSlots` todos obrigatórios e positivos), `PATCH`
edita campos parciais (mesmo padrão de `PATCH /api/admin/ads/slots/[id]` da Task 7 do
sub-projeto 3 — `parsed.data` repassado sem reconstrução).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/admin-ad-plans-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar as 2 rotas**

`app/api/admin/ads/plans/route.ts`: `GET` (`requireAdmin` via checagem `role==="ADMIN"`, lista
todos os planos incluindo inativos) + `POST` (zod: `name string, priceAmount int positive,
durationDays int positive, maxSimultaneousSlots int positive`, cria com `active: true`).

`app/api/admin/ads/plans/[id]/route.ts`: `PATCH` (zod: todos os campos opcionais incluindo
`active: boolean`, repassa `parsed.data` direto pro `update`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/admin-ad-plans-routes.test.ts`
Expected: PASS

- [ ] **Step 5: UI (sem teste automatizado)**

Criar `components/admin/AdPlanForm.tsx` (client component, mesmo padrão de
`AdSlotEditForm.tsx` — campos do plano + toggle `active`).

Criar `app/admin/anuncios/planos/page.tsx` (`requireAdmin`, lista todos os planos com
`<AdPlanForm>` por linha, formulário de criação de novo plano no topo).

- [ ] **Step 6: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/ads/plans app/admin/anuncios/planos components/admin/AdPlanForm.tsx tests/admin-ad-plans-routes.test.ts
git commit -m "feat: add admin CRUD for ad plans"
```

---

## Task 15: Toggle `ads_marketplace_enabled`

**Files:**
- Modify: `app/admin/configuracoes/page.tsx` (localizar a seção de toggles de plataforma
  existente e seguir o mesmo padrão — ler o arquivo primeiro pra confirmar a estrutura real)
- Create: `components/admin/AdsMarketplaceToggle.tsx` (mesmo padrão de outros toggles booleanos
  já existentes nessa página — reaproveitar um componente existente se já houver um genérico de
  "toggle de configuração booleana")

Sem teste automatizado (toggle simples reaproveitando `POST /api/admin/settings` já testado).

- [ ] **Step 1: Ler `app/admin/configuracoes/page.tsx` por completo** pra entender o padrão
  exato de card/toggle já usado ali antes de adicionar um novo.

- [ ] **Step 2: Implementar** — seguir exatamente o padrão encontrado no Step 1 (provavelmente
  um checkbox client component postando pra `/api/admin/settings` com `key:
  "ads_marketplace_enabled", value: "true"/"false"`, mesmo padrão de
  `GoogleAdSenseClientIdForm.tsx` do sub-projeto 3, adaptado pra um toggle booleano em vez de
  texto).

- [ ] **Step 3: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/admin/configuracoes components/admin/AdsMarketplaceToggle.tsx
git commit -m "feat: add admin toggle for the advertiser marketplace"
```

---

## Task 16: PDF do relatório — `@react-pdf/renderer`

**Files:**
- Modify: `package.json` (nova dependência)
- Create: `lib/ads/generate-ad-report-pdf.tsx`
- Test: `tests/generate-ad-report-pdf.test.ts`

**Interfaces:**
- Produces: `generateAdReportPdf(params: {companyName: string; adLabel: string; periodStart:
  Date; periodEnd: Date; impressions: number; clicks: number}): Promise<Buffer>` — consumido
  pela Task 18.

> **Nota pro implementador:** instalar a dependência primeiro (`npm install @react-pdf/renderer`
> — confirmar a versão mais recente estável no momento; não há internet-dependent nesta parte,
> `npm install` já resolve). Este é o primeiro uso de geração de PDF real no projeto — a API do
> `@react-pdf/renderer` (`renderToBuffer`, componentes `Document`/`Page`/`View`/`Text`) é estável
> e bem documentada publicamente; transcrever o padrão abaixo com confiança.

- [ ] **Step 1: Instalar a dependência**

Run: `npm install @react-pdf/renderer`

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/generate-ad-report-pdf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateAdReportPdf } from "@/lib/ads/generate-ad-report-pdf";

describe("generateAdReportPdf", () => {
  it("gera um Buffer não vazio começando com a assinatura de arquivo PDF", async () => {
    const buffer = await generateAdReportPdf({
      companyName: "Empresa LTDA",
      adLabel: "Abaixo do banner — página de eventos",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-18T00:00:00.000Z"),
      impressions: 1500,
      clicks: 42,
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run tests/generate-ad-report-pdf.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar**

Criar `lib/ads/generate-ad-report-pdf.tsx`:

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 12 },
  title: { fontSize: 18, marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  label: { color: "#555" },
});

export interface AdReportPdfParams {
  companyName: string;
  adLabel: string;
  periodStart: Date;
  periodEnd: Date;
  impressions: number;
  clicks: number;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

export async function generateAdReportPdf(params: AdReportPdfParams): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Relatório de anúncio</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Empresa</Text>
          <Text>{params.companyName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Posição</Text>
          <Text>{params.adLabel}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Período</Text>
          <Text>{formatDate(params.periodStart)} a {formatDate(params.periodEnd)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Impressões</Text>
          <Text>{params.impressions.toLocaleString("pt-BR")}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Cliques</Text>
          <Text>{params.clicks.toLocaleString("pt-BR")}</Text>
        </View>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run tests/generate-ad-report-pdf.test.ts`
Expected: PASS (1/1)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/ads/generate-ad-report-pdf.tsx tests/generate-ad-report-pdf.test.ts
git commit -m "feat: add PDF ad report generation"
```

---

## Task 17: Anexo em e-mail + envio de documento por WhatsApp

**Files:**
- Modify: `lib/email.ts` (parâmetro `attachments` em `sendMail`)
- Modify: `lib/whatsapp/evolution-client.ts` (nova função `sendMediaMessage`)
- Modify: `lib/whatsapp.ts` (nova função `sendWhatsAppDocument`)
- Test: `tests/lib-email.test.ts` (estender), `tests/whatsapp-evolution-client.test.ts`
  (estender), `tests/whatsapp.test.ts` (estender)

**Interfaces:**
- Produces: `sendMail(opts: {..., attachments?: {filename: string; content: Buffer}[]})`,
  `sendWhatsAppDocument(phone: string, base64Pdf: string, filename: string, caption: string):
  Promise<void>` — consumidos pela Task 18.

> **Nota pro implementador**: formato exato do payload de mídia da Evolution API não validado
> contra instância real nesta sessão — mesma ressalva já registrada pro webhook de leitura no
> sub-projeto 2. Seguir o formato documentado publicamente abaixo; se divergir ao testar com
> conta real, ajustar só `sendMediaMessage`.

- [ ] **Step 1: Estender `tests/lib-email.test.ts`** — adicionar um teste confirmando que, quando
  `sendMail` recebe `attachments`, eles são repassados pro `transporter.sendMail` (verificar
  `sendMailMock` foi chamado com `attachments` no objeto).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-email.test.ts`
Expected: FAIL no teste novo.

- [ ] **Step 3: Implementar em `lib/email.ts`**

Na assinatura de `sendMail`, adicionar `attachments?: { filename: string; content: Buffer }[]`
ao tipo do parâmetro `opts`, e repassar `attachments: opts.attachments` no objeto passado pro
`transporter.sendMail(...)` (nodemailer já suporta esse campo nativamente — só passthrough).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-email.test.ts`
Expected: PASS

- [ ] **Step 5: Estender `tests/whatsapp-evolution-client.test.ts`** — novo `describe("
  sendMediaMessage")` com 2 testes: monta a requisição certa (`POST
  /message/sendMedia/{instance}` com `{number, mediatype: "document", media: base64Pdf,
  fileName: filename, caption}`), lança erro em status de falha (mesmo padrão de
  `sendTextMessage`).

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `npx vitest run tests/whatsapp-evolution-client.test.ts`
Expected: FAIL nos 2 testes novos.

- [ ] **Step 7: Implementar em `lib/whatsapp/evolution-client.ts`**

```ts
export async function sendMediaMessage(
  config: WhatsAppConfig,
  phone: string,
  base64Media: string,
  fileName: string,
  caption: string,
): Promise<void> {
  const { status, body } = await evolutionFetch(config, `/message/sendMedia/${config.instanceName}`, {
    method: "POST",
    body: { number: phone, mediatype: "document", media: base64Media, fileName, caption },
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao enviar mídia: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `npx vitest run tests/whatsapp-evolution-client.test.ts`
Expected: PASS

- [ ] **Step 9: Estender `tests/whatsapp.test.ts`** — novo `describe("sendWhatsAppDocument")`
  espelhando exatamente os 4 testes de `sendWhatsAppMessage` (não configurado → erro sem chamar
  o cliente; sucesso → chama `sendMediaMessage` com os parâmetros certos, sem log em
  `MessageLog` nesta função — o registro de mensagem de relatório fica só no `AuditLog`/
  registro de envio da Task 18, não precisa duplicar no `MessageLog` genérico; falha → relança o
  erro original).

- [ ] **Step 10: Rodar e confirmar que falha, depois implementar em `lib/whatsapp.ts`, depois
  confirmar que passa**

```ts
export async function sendWhatsAppDocument(
  phone: string,
  base64Pdf: string,
  filename: string,
  caption: string,
): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }
  await sendMediaMessage(config, phone, base64Pdf, filename, caption);
}
```

(Importar `sendMediaMessage` junto de `sendTextMessage` no topo do arquivo.)

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add lib/email.ts lib/whatsapp.ts lib/whatsapp/evolution-client.ts tests/lib-email.test.ts tests/whatsapp-evolution-client.test.ts tests/whatsapp.test.ts
git commit -m "feat: add PDF attachment support to email and WhatsApp document sending"
```

---

## Task 18: `/admin/anuncios/privados/[id]` — detalhe + envio de relatório

**Files:**
- Create: `lib/ads/private-ad-report.ts`
- Create: `app/api/admin/ads/private/[id]/send-report/route.ts`
- Create: `app/admin/anuncios/privados/[id]/page.tsx`
- Test: `tests/lib-private-ad-report.test.ts`, `tests/admin-ad-send-report-route.test.ts`

**Interfaces:**
- Consumes: `generateAdReportPdf` (Task 16), `sendMail` com `attachments` e
  `sendWhatsAppDocument` (Task 17).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-private-ad-report.test.ts` — testa uma função `buildAdReportData(privateAdId:
string)` que busca o `PrivateAd` + `AdSlot` (pra label/dimensão) + soma `AdMetricsSnapshot` do
período (`adPurchase.startAt` até `min(now, adPurchase.endAt)`) + dados de contato do
`AdvertiserProfile` via `adPurchase.advertiser`.

Criar `tests/admin-ad-send-report-route.test.ts` — `POST` com body `{channel: "email" |
"whatsapp"}`: admin-only, gera o PDF (mock `generateAdReportPdf`), envia por e-mail
(`sendMail` com `attachments`, usando `advertiser.contactEmail`) ou WhatsApp
(`sendWhatsAppDocument`, usando `advertiser.contactPhone`, PDF em base64), retorna 200. `channel`
inválido → 400.

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run tests/lib-private-ad-report.test.ts tests/admin-ad-send-report-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Criar `lib/ads/private-ad-report.ts` com `buildAdReportData`, agregando os `AdMetricsSnapshot`
do período (reaproveitar o padrão de soma já usado em `lib/ads/ad-metrics.ts` do sub-projeto 3).

Criar `app/api/admin/ads/private/[id]/send-report/route.ts`: monta os dados via
`buildAdReportData`, gera o PDF via `generateAdReportPdf`, e por canal:
- `email`: `sendMail({to: advertiser.contactEmail, subject: "Relatório do seu anúncio", html:
  "...", attachments: [{filename: "relatorio.pdf", content: pdfBuffer}]})`.
- `whatsapp`: `sendWhatsAppDocument(advertiser.contactPhone, pdfBuffer.toString("base64"),
  "relatorio.pdf", "Segue o relatório do seu anúncio")`.

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npx vitest run tests/lib-private-ad-report.test.ts tests/admin-ad-send-report-route.test.ts`
Expected: PASS

- [ ] **Step 5: UI (sem teste automatizado)**

Criar `app/admin/anuncios/privados/[id]/page.tsx` — `requireAdmin`, mostra a imagem, dados da
empresa, métricas do período, botão "Baixar PDF" (link direto pra um endpoint GET que retorna o
PDF — pode reaproveitar `buildAdReportData`+`generateAdReportPdf` num pequeno
`app/api/admin/ads/private/[id]/report.pdf/route.ts` com `Content-Type: application/pdf`), e
dois botões "Enviar por e-mail"/"Enviar por WhatsApp" chamando a rota desta task.

- [ ] **Step 6: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/ads/private-ad-report.ts app/api/admin/ads/private app/admin/anuncios/privados tests/lib-private-ad-report.test.ts tests/admin-ad-send-report-route.test.ts
git commit -m "feat: add private ad report detail page with PDF download and send-report action"
```

---

## Task 19: Coluna "Fonte" na tela de métricas (sub-projeto 3) + nav

**Files:**
- Modify: `lib/ads/ad-metrics.ts` (Task 15 do sub-projeto 3 — incluir `source` no retorno)
- Modify: `app/admin/anuncios/metricas/page.tsx` (Task 15 do sub-projeto 3 — nova coluna)
- Modify: `components/admin/AdminNav.tsx` (link "Anúncios" já existe do sub-projeto 3 — sem
  mudança adicional necessária, os novos itens ficam dentro de `/admin/anuncios` já linkado)
- Modify: `components/advertiser/AdvertiserNav.tsx` (já criado na Task 7 — conferir que os links
  cobrem `/anunciante/anuncios/novo`)

Sem teste automatizado pra UI. `listAdMetricsSummary` (lib) ganha 1 teste novo.

- [ ] **Step 1: Escrever o teste que falha** para `listAdMetricsSummary` incluindo `source` no
  retorno (`tests/lib-ad-metrics.test.ts`, estender o teste existente pra afirmar
  `result[0].source === slot.source`).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-ad-metrics.test.ts`
Expected: FAIL no teste estendido.

- [ ] **Step 3: Implementar** — em `lib/ads/ad-metrics.ts`, incluir `source: slot.source` no
  objeto retornado por `listAdMetricsSummary`. Em `app/admin/anuncios/metricas/page.tsx`,
  adicionar uma coluna "Fonte" na tabela mostrando "Google"/"Privado"/"—" (`slot.source ??
  "—"`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-ad-metrics.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add lib/ads/ad-metrics.ts app/admin/anuncios/metricas/page.tsx
git commit -m "feat: show ad source (Google/Private) in the metrics summary table"
```

---

## Task 20: Verificação final

**Files:** nenhum

- [ ] **Step 1: Suíte completa e type-check**

Run: `npx vitest run`
Expected: todos os testes passando (baseline + os novos desta feature).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 2: Checklist de verificação manual (registrar como pendência — banco de dev
  inacessível, mesma situação dos sub-projetos anteriores)**

- [ ] Cadastro de anunciante bloqueado com `ads_marketplace_enabled=false`, liberado quando
  `true`.
- [ ] Fluxo completo de compra de plano (PIX sandbox) até `AdPurchase.status=PAID`.
- [ ] Cadastro de anúncio: posição ocupada não aparece na lista; dimensão errada é rejeitada.
- [ ] Moderação: aprovar/rejeitar funcionam, anúncio aprovado aparece na posição no site
  público, rejeitado não.
- [ ] Clique registra métrica e redireciona corretamente.
- [ ] Cron de expiração libera a posição depois do prazo.
- [ ] Geração de PDF abre corretamente num leitor de PDF.
- [ ] Envio por e-mail chega com o PDF anexado.
- [ ] Envio por WhatsApp — só pode ser testado de verdade com uma instância conectada
  (pendência conhecida, mesma situação dos sub-projetos 2 e 3).

- [ ] **Step 3: Atualizar `PROGRESSO.md`**

Marcar o sub-projeto 4 (e os 4 sub-projetos da sessão) como implementados, registrar os commits,
e **lembrar o usuário que agora é a hora do deploy único** combinado no início da sessão —
migração de 3 sub-projetos (`MessageLog`, `AdSlot`/`AdMetricsSnapshot`, marketplace de
anunciantes) + seeds manuais (5 `AdSlot` + 3 `AdPlan`) + env vars
(`WHATSAPP_WEBHOOK_SECRET`, `GOOGLE_ADS_OAUTH_CLIENT_ID`/`SECRET`) + nova dependência
`@react-pdf/renderer` no build da imagem Docker.

```bash
git add PROGRESSO.md
git commit -m "docs: record completion of the advertiser marketplace sub-project"
```
