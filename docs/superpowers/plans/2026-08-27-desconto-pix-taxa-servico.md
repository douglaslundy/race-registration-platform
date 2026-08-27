# Desconto PIX sobre a Taxa de Serviço — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar um desconto percentual, configurável (global + por evento), incidindo **exclusivamente sobre a Taxa de Serviço** quando o pagamento é via PIX, sem nunca alterar a Taxa da Plataforma nem o valor da inscrição.

**Architecture:** Um motor de cálculo puro novo (`lib/fees.ts`) vira a fonte única de verdade das taxas, usado pelo backend (`createCheckout`) e pelo frontend (`CheckoutForm`). O `Order` ganha um snapshot histórico (`serviceFeeOriginalAmount`, `pixDiscountPercent`, `pixDiscountAmount`); `Order.paymentFeeAmount` continua sendo a Taxa de Serviço **líquida** (cobrada), então todos os consumidores atuais (repasse, revenue-breakdown, resumo diário) seguem corretos sem alteração. Config global via `platform_settings`; config por evento via `Event.pixServiceFeeDiscountPercent Int?` (`null` = herda global, `0` = explicitamente sem desconto), admin-only.

**Tech Stack:** Next.js (App Router), TypeScript, Prisma 5 + PostgreSQL, Vitest, React Hook Form + Zod, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-27-desconto-pix-taxa-servico-design.md`

## Global Constraints

- **A Taxa da Plataforma (`Order.platformFeeAmount`, `Event.platformFeePercent`, `platform_settings["default_platform_fee"]`) NÃO pode ser alterada por esta feature** — nem fórmula, nem valor, nem base de cálculo. Só entra na composição do total.
- **Base do desconto PIX = exclusivamente `serviceFeeOriginal`.** Nunca `platformFee + serviceFee`, nunca `subtotal + platformFee + serviceFee`.
- Percentual de desconto é **inteiro `0–100`** (não basis points). `0` = sem desconto; rejeitar negativo e `> 100`.
- Herança: `Event.pixServiceFeeDiscountPercent === null` → usa global; `=== 0` → `0` (nunca cai pro global). Distinguir `null` de `0`.
- `service_fee_min` (piso) **continua sendo piso após o desconto**: `serviceFeeFinal = max(serviceFeeOriginal − desconto, serviceFeeMin)`.
- Instalações/eventos existentes: comportamento financeiro **idêntico** ao atual (global default `"0"`, coluna do evento default `null`).
- `total_backend == Order.totalAmount == amount enviado ao gateway == total recalculado no checkout`.
- Valores monetários sempre em **centavos** (`Int`). `formatCurrency(cents)` para exibir.
- Não usar `alert()` / `confirm()` / `window.prompt()` — usar `components/ui/ConfirmModal.tsx` / `ErrorModal.tsx` se precisar de modal (não deve precisar nesta feature).
- Testes: Vitest. `db` é auto-mockado em `tests/setup.ts`. Rodar `npx vitest run <arquivo>` para um arquivo; `npm test` para a suíte.
- Ao final: `npx vitest run` (suíte toda) + `npx tsc --noEmit` + `npm run build`, todos limpos.

---

### Task 1: Motor de cálculo puro `lib/fees.ts`

**Files:**
- Create: `lib/fees.ts`
- Test: `tests/unit/fees.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro, sem I/O, sem imports do projeto).
- Produces:
  - `resolveEffectivePixDiscountPercent(eventValue: number | null | undefined, globalValue: number): number`
  - `computeOrderAmounts(input: OrderAmountsInput): OrderAmounts`
  - `interface OrderAmountsInput { subtotal: number; platformFeePercent: number; defaultPlatformFee: number; serviceFeePercent: number; serviceFeeMin: number; pixDiscountPercent: number; isPix: boolean; }`
  - `interface OrderAmounts { subtotal: number; platformFee: number; serviceFeeOriginal: number; pixDiscountPercent: number; pixDiscountAmount: number; serviceFeeFinal: number; total: number; }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fees.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeOrderAmounts, resolveEffectivePixDiscountPercent } from "@/lib/fees";

// Cenário base da spec: subtotal R$100, plataforma 5% (=R$5), serviço 10% (=R$10), desconto PIX 20%.
const base = {
  subtotal: 10000,
  platformFeePercent: 500, // bps -> 5%
  defaultPlatformFee: 0,
  serviceFeePercent: 1000, // bps -> 10%
  serviceFeeMin: 0,
  pixDiscountPercent: 20,
};

describe("computeOrderAmounts", () => {
  it("cartão (não-PIX): sem desconto, taxa de serviço cheia", () => {
    const r = computeOrderAmounts({ ...base, isPix: false });
    expect(r.platformFee).toBe(500);
    expect(r.serviceFeeOriginal).toBe(1000);
    expect(r.serviceFeeFinal).toBe(1000);
    expect(r.pixDiscountAmount).toBe(0);
    expect(r.pixDiscountPercent).toBe(0);
    expect(r.total).toBe(11500);
  });

  it("PIX: desconto de 20% só sobre a taxa de serviço", () => {
    const r = computeOrderAmounts({ ...base, isPix: true });
    expect(r.platformFee).toBe(500);
    expect(r.serviceFeeOriginal).toBe(1000);
    expect(r.pixDiscountAmount).toBe(200);
    expect(r.serviceFeeFinal).toBe(800);
    expect(r.pixDiscountPercent).toBe(20);
    expect(r.total).toBe(11300);
  });

  it("VALIDAÇÃO CRÍTICA: a Taxa da Plataforma é idêntica em cartão e PIX", () => {
    const card = computeOrderAmounts({ ...base, isPix: false });
    const pix = computeOrderAmounts({ ...base, isPix: true });
    // Este teste deve falhar se o desconto PIX tocar a Taxa da Plataforma, direta ou indiretamente.
    expect(pix.platformFee).toBe(card.platformFee);
    expect(pix.platformFee).toBe(500);
  });

  it("piso da taxa de serviço continua sendo piso após o desconto", () => {
    const r = computeOrderAmounts({
      ...base,
      serviceFeeMin: 900, // piso R$9
      isPix: true,
    });
    expect(r.serviceFeeOriginal).toBe(1000);
    expect(r.serviceFeeFinal).toBe(900); // max(1000 - 200, 900)
    expect(r.pixDiscountAmount).toBe(100); // desconto EFETIVO, não 200
  });

  it("sem taxa de serviço configurada: desconto é zero mesmo via PIX", () => {
    const r = computeOrderAmounts({
      ...base,
      serviceFeePercent: 0,
      serviceFeeMin: 0,
      isPix: true,
    });
    expect(r.serviceFeeOriginal).toBe(0);
    expect(r.serviceFeeFinal).toBe(0);
    expect(r.pixDiscountAmount).toBe(0);
    expect(r.total).toBe(10500);
  });

  it("desconto PIX de 0% não altera nada", () => {
    const r = computeOrderAmounts({ ...base, pixDiscountPercent: 0, isPix: true });
    expect(r.serviceFeeFinal).toBe(1000);
    expect(r.pixDiscountAmount).toBe(0);
  });

  it("piso da Taxa da Plataforma (defaultPlatformFee) é respeitado e não é afetado pelo PIX", () => {
    const r = computeOrderAmounts({ ...base, defaultPlatformFee: 800, isPix: true });
    expect(r.platformFee).toBe(800); // max(500, 800)
  });
});

describe("resolveEffectivePixDiscountPercent", () => {
  it("evento null herda a global", () => {
    expect(resolveEffectivePixDiscountPercent(null, 20)).toBe(20);
  });
  it("evento undefined herda a global", () => {
    expect(resolveEffectivePixDiscountPercent(undefined, 20)).toBe(20);
  });
  it("evento 0 = sem desconto, NUNCA cai pro global", () => {
    expect(resolveEffectivePixDiscountPercent(0, 20)).toBe(0);
  });
  it("evento com valor próprio sobrepõe a global", () => {
    expect(resolveEffectivePixDiscountPercent(30, 20)).toBe(30);
  });
  it("clampa acima de 100 e abaixo de 0", () => {
    expect(resolveEffectivePixDiscountPercent(150, 0)).toBe(100);
    expect(resolveEffectivePixDiscountPercent(-5, 0)).toBe(0);
    expect(resolveEffectivePixDiscountPercent(null, 999)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/fees.test.ts`
Expected: FAIL — `Cannot find module '@/lib/fees'` / `computeOrderAmounts is not a function`.

- [ ] **Step 3: Write the implementation**

Create `lib/fees.ts`:

```ts
/**
 * Motor de cálculo das taxas do pedido — fonte ÚNICA de verdade.
 * Módulo puro (sem I/O): usado pelo backend (createCheckout) e pelo frontend (CheckoutForm)
 * para que backend, checkout, valor persistido e valor enviado ao gateway sejam sempre iguais.
 *
 * Conceitos, mantidos SEMPRE separados:
 *  - Taxa da Plataforma: platformFee. Fórmula intocada por esta feature.
 *  - Taxa de Serviço: serviceFeeOriginal (antes do desconto) / serviceFeeFinal (cobrada).
 *  - Desconto PIX: incide EXCLUSIVAMENTE sobre serviceFeeOriginal.
 */

export function clampPercent(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.round(n);
}

/**
 * Percentual de desconto PIX efetivo para um evento.
 * - eventValue null/undefined  -> herda a global
 * - eventValue === 0            -> 0 (evento explicitamente sem desconto; nunca cai pro global)
 * - eventValue > 0              -> o valor do evento
 */
export function resolveEffectivePixDiscountPercent(
  eventValue: number | null | undefined,
  globalValue: number,
): number {
  if (eventValue === null || eventValue === undefined) return clampPercent(globalValue);
  return clampPercent(eventValue);
}

export interface OrderAmountsInput {
  /** centavos, já com o desconto de cupom aplicado */
  subtotal: number;
  /** basis points (Event.platformFeePercent) */
  platformFeePercent: number;
  /** centavos — piso global da Taxa da Plataforma */
  defaultPlatformFee: number;
  /** basis points (service_fee_percent) */
  serviceFeePercent: number;
  /** centavos (service_fee_min) — piso da Taxa de Serviço */
  serviceFeeMin: number;
  /** percentual inteiro 0–100, já resolvido (global vs. evento) */
  pixDiscountPercent: number;
  isPix: boolean;
}

export interface OrderAmounts {
  subtotal: number;
  /** Taxa da Plataforma — fórmula ATUAL, independe de isPix */
  platformFee: number;
  /** Taxa de Serviço antes do desconto PIX */
  serviceFeeOriginal: number;
  /** percentual efetivamente aplicado (0 se não-PIX ou sem desconto) */
  pixDiscountPercent: number;
  /** desconto efetivo em centavos = serviceFeeOriginal − serviceFeeFinal */
  pixDiscountAmount: number;
  /** Taxa de Serviço efetivamente cobrada */
  serviceFeeFinal: number;
  /** subtotal + platformFee + serviceFeeFinal */
  total: number;
}

export function computeOrderAmounts(i: OrderAmountsInput): OrderAmounts {
  // Taxa da Plataforma — cópia exata da fórmula atual de lib/checkout.ts + lib/format.ts.
  const platformFee = Math.max(
    Math.round((i.subtotal * i.platformFeePercent) / 10000),
    i.defaultPlatformFee,
  );

  // Taxa de Serviço original — cópia exata da fórmula atual de lib/checkout.ts.
  const serviceFeeConfigured = i.serviceFeePercent > 0 || i.serviceFeeMin > 0;
  const serviceFeeOriginal = serviceFeeConfigured
    ? Math.max(Math.round((i.subtotal * i.serviceFeePercent) / 10000), i.serviceFeeMin)
    : 0;

  const pct = clampPercent(i.pixDiscountPercent);
  const applyDiscount = i.isPix && pct > 0 && serviceFeeOriginal > 0;

  let serviceFeeFinal = serviceFeeOriginal;
  let pixDiscountAmount = 0;
  if (applyDiscount) {
    const rawDiscount = Math.round((serviceFeeOriginal * pct) / 100);
    serviceFeeFinal = Math.max(serviceFeeOriginal - rawDiscount, i.serviceFeeMin);
    pixDiscountAmount = serviceFeeOriginal - serviceFeeFinal;
  }

  return {
    subtotal: i.subtotal,
    platformFee,
    serviceFeeOriginal,
    pixDiscountPercent: applyDiscount ? pct : 0,
    pixDiscountAmount,
    serviceFeeFinal,
    total: i.subtotal + platformFee + serviceFeeFinal,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/fees.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add lib/fees.ts tests/unit/fees.test.ts
git commit -m "feat: motor de cálculo puro de taxas com desconto PIX sobre a Taxa de Serviço"
```

---

### Task 2: Migração de schema — `Event` e `Order`

**Files:**
- Modify: `prisma/schema.prisma` (model `Event` ~linha 285; model `Order` ~linha 415-431)
- Create: `prisma/migrations/20260827000000_add_pix_service_fee_discount/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces (campos Prisma novos, usados nas Tasks 3, 4, 8, 9, 10):
  - `Event.pixServiceFeeDiscountPercent: number | null`
  - `Order.serviceFeeOriginalAmount: number`
  - `Order.pixDiscountPercent: number` (default 0)
  - `Order.pixDiscountAmount: number` (default 0)

- [ ] **Step 1: Editar `prisma/schema.prisma` — model `Event`**

Logo abaixo de `platformFeePercent Int @default(1100) // basis points`, adicionar:

```prisma
  pixServiceFeeDiscountPercent Int? // percentual inteiro 0–100. null = herda config global; 0 = evento sem desconto PIX
```

- [ ] **Step 2: Editar `prisma/schema.prisma` — model `Order`**

No bloco de campos de valor do `Order`, logo abaixo de `paymentFeeAmount  Int         // centavos`, adicionar:

```prisma
  serviceFeeOriginalAmount Int      @default(0) // centavos — Taxa de Serviço antes do desconto PIX (paymentFeeAmount é a líquida)
  pixDiscountPercent       Int      @default(0) // percentual efetivo aplicado (0 se não-PIX)
  pixDiscountAmount         Int      @default(0) // centavos — desconto PIX efetivo concedido
```

- [ ] **Step 3: Criar o arquivo de migração**

Create `prisma/migrations/20260827000000_add_pix_service_fee_discount/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "events" ADD COLUMN "pixServiceFeeDiscountPercent" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "serviceFeeOriginalAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pixDiscountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pixDiscountAmount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: pedidos existentes nunca tiveram desconto; a Taxa de Serviço original é a que foi cobrada.
UPDATE "orders" SET "serviceFeeOriginalAmount" = "paymentFeeAmount";
```

- [ ] **Step 4: Regenerar o Prisma Client e checar tipos**

Run: `npx prisma generate`
Then: `npx tsc --noEmit`
Expected: `prisma generate` OK; `tsc` OK (nenhum arquivo usa os campos novos ainda, então não deve haver erro novo). Se houver erros pré-existentes não relacionados, anotar mas não corrigir aqui.

- [ ] **Step 5: Aplicar a migração no banco local (se acessível)**

Run: `npx prisma migrate deploy`
Expected: aplica `20260827000000_add_pix_service_fee_discount`. Se o banco não estiver acessível neste ambiente, pular — a suíte usa `db` mockado. Registrar no commit que a migração precisa rodar no deploy (`prisma migrate deploy` no `deploy.sh`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260827000000_add_pix_service_fee_discount/migration.sql
git commit -m "feat: schema do desconto PIX (Event.pixServiceFeeDiscountPercent + snapshot no Order)"
```

---

### Task 3: Cálculo e persistência no checkout (backend ponta a ponta)

**Files:**
- Modify: `lib/settings.ts` (adicionar getter)
- Modify: `lib/checkout.ts` (`CheckoutInput`, `CheckoutResult`, `createCheckout`)
- Modify: `app/api/checkout/route.ts` (passar `isPix`, metadata de auditoria)
- Modify: `app/api/admin/settings/route.ts` (validar o novo `key`)
- Test: `tests/unit/checkout-pix-discount.test.ts` (novo)
- Test: `tests/checkout-route.test.ts` (estender — `CheckoutResult` mockado ganha campos)
- Test: `tests/admin-settings-route.test.ts` (novo, se não existir; senão estender)

**Interfaces:**
- Consumes: `computeOrderAmounts`, `resolveEffectivePixDiscountPercent` (Task 1); campos do `Order`/`Event` (Task 2).
- Produces:
  - `lib/settings.ts`: `getPixServiceFeeDiscountPercent(): Promise<number>`
  - `CheckoutInput` ganha `isPix?: boolean`
  - `CheckoutResult` ganha `serviceFeeOriginalAmount: number`, `paymentFeeAmount: number`, `pixDiscountAmount: number`, `pixDiscountPercent: number`

- [ ] **Step 1: Adicionar o getter em `lib/settings.ts`**

Logo abaixo de `getServiceFeeMin` (~linha 57), adicionar:

```ts
export const getPixServiceFeeDiscountPercent = cache(async (): Promise<number> => {
  const val = await getSetting("pix_service_fee_discount_percent");
  const n = val ? parseInt(val, 10) : 0; // percentual inteiro 0–100
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 100 ? 100 : n;
});
```

- [ ] **Step 2: Escrever o teste de unidade do `createCheckout` (falhando)**

Create `tests/unit/checkout-pix-discount.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

const dbMock = db as any;

const ticketBatch = { id: "batch-1", active: true, soldCount: 0, capacity: 10, priceAmount: 10000 };

function makeTx(eventOverrides: Record<string, unknown> = {}) {
  const event = {
    id: "event-1",
    status: "REGISTRATIONS_OPEN",
    platformFeePercent: 500, // 5%
    pixServiceFeeDiscountPercent: null,
    allowProxyRegistration: false,
    ...eventOverrides,
  };
  return {
    ticketBatch: {
      findUnique: vi.fn().mockResolvedValue(ticketBatch),
      findMany: vi.fn().mockResolvedValue([ticketBatch]),
      update: vi.fn().mockResolvedValue({}),
    },
    event: { findUnique: vi.fn().mockResolvedValue(event) },
    eventRoute: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    eventCategory: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    coupon: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    order: { create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "order-1", ...data })) },
    registration: { create: vi.fn().mockResolvedValue({ id: "reg-1" }) },
  };
}

describe("createCheckout — desconto PIX sobre a Taxa de Serviço", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // service_fee_percent = 1000 bps (10%), service_fee_min = 0, pix discount global = 20
    dbMock.platformSetting.findUnique.mockImplementation(async ({ where }: any) => {
      const map: Record<string, string> = {
        default_platform_fee: "0",
        service_fee_percent: "1000",
        service_fee_min: "0",
        pix_service_fee_discount_percent: "20",
      };
      return where.key in map ? { key: where.key, value: map[where.key] } : null;
    });
  });

  it("PIX: grava serviço original, desconto e líquida separados; total com desconto", async () => {
    const tx = makeTx();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "u1",
      athleteUserId: "u1",
      isPix: true,
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.platformFeeAmount).toBe(500);
    expect(orderData.serviceFeeOriginalAmount).toBe(1000);
    expect(orderData.pixDiscountAmount).toBe(200);
    expect(orderData.pixDiscountPercent).toBe(20);
    expect(orderData.paymentFeeAmount).toBe(800); // LÍQUIDA
    expect(orderData.totalAmount).toBe(11300);
    expect(result.totalAmount).toBe(11300);
    expect(result.pixDiscountAmount).toBe(200);
  });

  it("cartão (isPix false): taxa de serviço cheia, desconto zero, plataforma idêntica", async () => {
    const tx = makeTx();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "u1",
      athleteUserId: "u1",
      isPix: false,
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.platformFeeAmount).toBe(500); // IDÊNTICA ao caso PIX
    expect(orderData.serviceFeeOriginalAmount).toBe(1000);
    expect(orderData.paymentFeeAmount).toBe(1000);
    expect(orderData.pixDiscountAmount).toBe(0);
    expect(orderData.pixDiscountPercent).toBe(0);
    expect(orderData.totalAmount).toBe(11500);
  });

  it("evento com pixServiceFeeDiscountPercent = 0 ignora a global > 0", async () => {
    const tx = makeTx({ pixServiceFeeDiscountPercent: 0 });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "u1",
      athleteUserId: "u1",
      isPix: true,
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.pixDiscountAmount).toBe(0);
    expect(orderData.paymentFeeAmount).toBe(1000);
  });

  it("evento com pixServiceFeeDiscountPercent próprio sobrepõe a global", async () => {
    const tx = makeTx({ pixServiceFeeDiscountPercent: 50 });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "u1",
      athleteUserId: "u1",
      isPix: true,
    });

    const orderData = tx.order.create.mock.calls[0][0].data;
    expect(orderData.pixDiscountAmount).toBe(500);
    expect(orderData.paymentFeeAmount).toBe(500);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/checkout-pix-discount.test.ts`
Expected: FAIL — `isPix` ignorado, `orderData.serviceFeeOriginalAmount` é `undefined`.

- [ ] **Step 4: Implementar em `lib/checkout.ts`**

No topo, ajustar imports:

```ts
import { computeOrderAmounts, resolveEffectivePixDiscountPercent } from "./fees";
```

(Manter `import { calculatePlatformFee } from "./format";` — ainda usado? Após esta mudança **não**. Remover `calculatePlatformFee` do import se ficar sem uso.)

`CheckoutInput` — adicionar campo:

```ts
  couponCode?: string;
  isPix?: boolean;
```

`CheckoutResult` — adicionar campos:

```ts
export interface CheckoutResult {
  orderId: string;
  registrationId: string;
  subtotalAmount: number;
  totalAmount: number;
  discountAmount: number;
  platformFeeAmount: number;
  serviceFeeOriginalAmount: number;
  paymentFeeAmount: number;
  pixDiscountAmount: number;
  pixDiscountPercent: number;
  proxyAthleteInvite?: { userId: string; name: string; email: string };
}
```

No início de `createCheckout`, junto às outras settings (linhas 44-49):

```ts
  const pixDiscountStr = await getSetting("pix_service_fee_discount_percent");
  const globalPixDiscount = pixDiscountStr ? parseInt(pixDiscountStr, 10) : 0;
```

Substituir o bloco de cálculo (linhas atuais 170-177):

```ts
    const subtotal = batch.priceAmount - discountAmount;
    const percentFee = calculatePlatformFee(subtotal, event.platformFeePercent);
    const platformFee = Math.max(percentFee, defaultPlatformFee);
    const rawServiceFee = Math.round((subtotal * serviceFeePercent) / 10000);
    const paymentFee = (serviceFeePercent > 0 || serviceFeeMin > 0)
      ? Math.max(rawServiceFee, serviceFeeMin)
      : 0;
    const total = subtotal + platformFee + paymentFee;
```

por:

```ts
    const subtotal = batch.priceAmount - discountAmount;
    const effectivePixDiscount = resolveEffectivePixDiscountPercent(
      event.pixServiceFeeDiscountPercent,
      globalPixDiscount,
    );
    const amounts = computeOrderAmounts({
      subtotal,
      platformFeePercent: event.platformFeePercent,
      defaultPlatformFee,
      serviceFeePercent,
      serviceFeeMin,
      pixDiscountPercent: effectivePixDiscount,
      isPix: input.isPix ?? false,
    });
```

Substituir o `tx.order.create` `data` (linhas atuais 180-190):

```ts
      data: {
        buyerUserId: input.buyerUserId,
        eventId: input.eventId,
        subtotalAmount: subtotal,
        platformFeeAmount: amounts.platformFee,
        paymentFeeAmount: amounts.serviceFeeFinal,
        serviceFeeOriginalAmount: amounts.serviceFeeOriginal,
        pixDiscountPercent: amounts.pixDiscountPercent,
        pixDiscountAmount: amounts.pixDiscountAmount,
        totalAmount: amounts.total,
        discountAmount,
        couponId,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
```

Substituir o `return` final (linhas atuais 217-225):

```ts
    return {
      orderId: order.id,
      registrationId: registration.id,
      subtotalAmount: subtotal,
      totalAmount: amounts.total,
      discountAmount,
      platformFeeAmount: amounts.platformFee,
      serviceFeeOriginalAmount: amounts.serviceFeeOriginal,
      paymentFeeAmount: amounts.serviceFeeFinal,
      pixDiscountAmount: amounts.pixDiscountAmount,
      pixDiscountPercent: amounts.pixDiscountPercent,
      proxyAthleteInvite,
    };
```

- [ ] **Step 5: Implementar em `app/api/checkout/route.ts`**

Na chamada de `createCheckout` (linha ~76), adicionar `isPix`:

```ts
    checkout = await createCheckout({
      ...checkoutData,
      routeId: emptyStringToUndefined(checkoutData.routeId) as string | undefined,
      categoryId: emptyStringToUndefined(checkoutData.categoryId) as string | undefined,
      shirtSize: checkoutData.shirtSize as ShirtSize | undefined,
      buyerUserId: session.user.id,
      athleteUserId: session.user.id,
      isPix: paymentMethod === "PIX",
    });
```

No `db.auditLog.create` do `CHECKOUT_INITIATED` (linha ~227), estender metadata:

```ts
      metadata: { paymentMethod, totalAmount: checkout.totalAmount, pixDiscountAmount: checkout.pixDiscountAmount },
```

- [ ] **Step 6: Validação no `app/api/admin/settings/route.ts`**

Depois do `parsed` OK e antes do `try`, adicionar validação específica do novo key:

```ts
  if (parsed.data.key === "pix_service_fee_discount_percent") {
    const n = Number(parsed.data.value);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return NextResponse.json(
        { error: "Desconto PIX deve ser um inteiro entre 0 e 100" },
        { status: 400 },
      );
    }
  }
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/unit/checkout-pix-discount.test.ts tests/checkout-route.test.ts tests/unit/checkout-coupon.test.ts`
Expected: `checkout-pix-discount` PASS. `checkout-route` e `checkout-coupon` podem quebrar por `CheckoutResult` mockado incompleto ou expectativas de `order.create`.

- [ ] **Step 8: Corrigir os testes existentes que quebraram**

Em `tests/checkout-route.test.ts`: todo `vi.mocked(createCheckout).mockResolvedValueOnce({...})` precisa dos campos novos. Adicionar a cada objeto:

```ts
      serviceFeeOriginalAmount: 0,
      paymentFeeAmount: 0,
      pixDiscountAmount: 0,
      pixDiscountPercent: 0,
```

Em `tests/unit/checkout-coupon.test.ts`: o `tx.order.create` mock retorna `{ id: "order-1" }`. As asserções checam `result.platformFeeAmount`, `result.totalAmount` etc. — continuam válidas (o cenário não tem taxa de serviço nem PIX). Se alguma asserção de `tx.order.create` conferir o `data` exato, trocar por `expect.objectContaining`. Rodar e ajustar só o que falhar.

- [ ] **Step 9: Run test to verify all pass**

Run: `npx vitest run tests/unit/checkout-pix-discount.test.ts tests/checkout-route.test.ts tests/unit/checkout-coupon.test.ts tests/unit/checkout-proxy-athlete.test.ts tests/unit/checkout-notes.test.ts tests/unit/checkout-shirt-size-restriction.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/settings.ts lib/checkout.ts app/api/checkout/route.ts app/api/admin/settings/route.ts tests/
git commit -m "feat: aplica e persiste o desconto PIX sobre a Taxa de Serviço no checkout"
```

---

### Task 4: Configuração por evento (API + UI admin + duplicação)

**Files:**
- Modify: `app/api/admin/events/[id]/fee/route.ts`
- Modify: `components/admin/SetPlatformFeeForm.tsx`
- Modify: `app/admin/configuracoes/page.tsx` (o `select` de `events` já traz `platformFeePercent`; adicionar `pixServiceFeeDiscountPercent`)
- Modify: `app/api/events/[id]/duplicate/route.ts` (copiar o campo)
- Test: `tests/admin-event-fee-route.test.ts` (estender)
- Test: `tests/event-duplicate-route.test.ts` (estender)

**Interfaces:**
- Consumes: `Event.pixServiceFeeDiscountPercent` (Task 2).
- Produces: `PATCH /api/admin/events/[id]/fee` aceita `{ pixServiceFeeDiscountPercent?: number | null }` (isolado ou junto de `platformFeePercent`).

- [ ] **Step 1: Escrever os testes (falhando) em `tests/admin-event-fee-route.test.ts`**

Adicionar ao `describe`:

```ts
  it("atualiza o desconto PIX por evento (valor explícito)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await PATCH(makeRequest({ pixServiceFeeDiscountPercent: 25 }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { pixServiceFeeDiscountPercent: 25 },
    });
  });

  it("aceita pixServiceFeeDiscountPercent = null (herda a global)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await PATCH(makeRequest({ pixServiceFeeDiscountPercent: null }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { pixServiceFeeDiscountPercent: null },
    });
  });

  it("rejeita desconto PIX > 100", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await PATCH(makeRequest({ pixServiceFeeDiscountPercent: 150 }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(res.status).toBe(400);
    expect(dbMock.event.update).not.toHaveBeenCalled();
  });

  it("atualiza só a taxa da plataforma sem tocar no desconto PIX", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await PATCH(makeRequest({ platformFeePercent: 800 }), {
      params: Promise.resolve({ id: "event-1" }),
    });

    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { platformFeePercent: 800 },
    });
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/admin-event-fee-route.test.ts`
Expected: os 4 novos casos FAIL (schema atual só aceita `platformFeePercent`).

- [ ] **Step 3: Reescrever `app/api/admin/events/[id]/fee/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";

const schema = z
  .object({
    platformFeePercent: z.number().int().min(0).max(5000).optional(),
    pixServiceFeeDiscountPercent: z.number().int().min(0).max(100).nullable().optional(),
  })
  .refine(
    (d) => d.platformFeePercent !== undefined || d.pixServiceFeeDiscountPercent !== undefined,
    { message: "Nenhum campo para atualizar" },
  );

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("events.set-fee");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data: {
    platformFeePercent?: number;
    pixServiceFeeDiscountPercent?: number | null;
  } = {};
  if (parsed.data.platformFeePercent !== undefined) {
    data.platformFeePercent = parsed.data.platformFeePercent;
  }
  if (parsed.data.pixServiceFeeDiscountPercent !== undefined) {
    data.pixServiceFeeDiscountPercent = parsed.data.pixServiceFeeDiscountPercent;
  }

  const event = await db.event.update({ where: { id }, data });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_FEE_UPDATED",
      entityType: "Event",
      entityId: id,
      metadata: data,
    },
  });

  return NextResponse.json({ event });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/admin-event-fee-route.test.ts`
Expected: PASS (novos + antigos; o teste antigo "retorna 400 para payload inválido" com `platformFeePercent: -1` continua 400).

- [ ] **Step 5: `components/admin/SetPlatformFeeForm.tsx` — campo do desconto PIX**

Estender a interface e o form:

```tsx
interface EventFee {
  id: string;
  title: string;
  platformFeePercent: number;
  pixServiceFeeDiscountPercent: number | null;
  status: string;
}

export default function SetPlatformFeeForm({ event }: { event: EventFee }) {
  const [value, setValue] = useState(event.platformFeePercent);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // "" = herdar a global; senão, percentual inteiro 0–100
  const [pixDiscount, setPixDiscount] = useState(
    event.pixServiceFeeDiscountPercent === null ? "" : String(event.pixServiceFeeDiscountPercent),
  );
  const [savingPix, setSavingPix] = useState(false);
  const [savedPix, setSavedPix] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/admin/events/${event.id}/fee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platformFeePercent: value }),
    });
    if (res.ok) setSaved(true);
    setSaving(false);
  }

  async function handleSavePix() {
    const parsed = pixDiscount.trim() === "" ? null : Number(pixDiscount);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 100)) {
      setPixError("0 a 100, ou vazio para herdar o padrão");
      return;
    }
    setSavingPix(true);
    setSavedPix(false);
    setPixError(null);
    const res = await fetch(`/api/admin/events/${event.id}/fee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pixServiceFeeDiscountPercent: parsed }),
    });
    if (res.ok) setSavedPix(true);
    else setPixError("Erro ao salvar");
    setSavingPix(false);
  }

  return (
    <div className="border rounded-lg p-3 dark:border-gray-700 space-y-2">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{event.title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{EVENT_STATUS_LABEL[event.status] ?? event.status}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => { setValue(Number(e.target.value)); setSaved(false); }}
            min={0}
            max={5000}
            step={100}
            className="input-field w-24 text-sm py-1"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">{(value / 100).toFixed(1)}% plataforma</span>
          <button onClick={handleSave} disabled={saving} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
            {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400 w-40">Desconto PIX na Taxa de Serviço</label>
        <input
          type="number"
          value={pixDiscount}
          onChange={(e) => { setPixDiscount(e.target.value); setSavedPix(false); }}
          min={0}
          max={100}
          step={1}
          placeholder="padrão"
          className="input-field w-24 text-sm py-1"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {pixDiscount.trim() === "" ? "usa o padrão da plataforma" : `${pixDiscount}% só na Taxa de Serviço`}
        </span>
        <button onClick={handleSavePix} disabled={savingPix} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
          {savingPix ? "Salvando…" : savedPix ? "Salvo!" : "Salvar"}
        </button>
        {pixError && <span className="text-xs text-red-600">{pixError}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `app/admin/configuracoes/page.tsx` — trazer o campo no `select`**

No `db.event.findMany` (~linha 33-37), o `select` passa a incluir:

```ts
      select: { id: true, title: true, platformFeePercent: true, pixServiceFeeDiscountPercent: true, status: true },
```

Atualizar o texto do card "Taxa da plataforma por evento" (~linha 102-105) para mencionar que o segundo campo é o desconto PIX exclusivo da Taxa de Serviço:

```tsx
        <h2 className="font-semibold text-lg dark:text-gray-100">Taxas por evento</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          <strong>Taxa da plataforma</strong>: percentual pago pelo inscrito, em pontos base (1100 = 11%).{" "}
          <strong>Desconto PIX na Taxa de Serviço</strong>: reduz apenas a Taxa de Serviço quando o pagamento é via PIX —
          nunca afeta a Taxa da Plataforma nem o valor da inscrição. Deixe vazio para usar o padrão global. Alterações valem só para novos pedidos.
        </p>
```

- [ ] **Step 7: `app/api/events/[id]/duplicate/route.ts` — copiar o campo**

No `tx.event.create` `data` (~linha 53), adicionar após `platformFeePercent: event.platformFeePercent,`:

```ts
        pixServiceFeeDiscountPercent: event.pixServiceFeeDiscountPercent,
```

- [ ] **Step 8: `tests/event-duplicate-route.test.ts` — asserção do campo copiado**

Localizar o teste que verifica o `tx.event.create` (ou o mock do `event` retornado por `db.event.findFirst`). Adicionar `pixServiceFeeDiscountPercent: 15` ao evento de origem mockado e assertar:

```ts
    expect(txMock.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pixServiceFeeDiscountPercent: 15 }),
      }),
    );
```

(Se o teste atual usa `db.$transaction` real do setup, seguir o padrão já existente no arquivo — só adicionar o campo ao mock de origem e a asserção.)

- [ ] **Step 9: Run tests**

Run: `npx vitest run tests/admin-event-fee-route.test.ts tests/event-duplicate-route.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add app/api/admin/events/ components/admin/SetPlatformFeeForm.tsx app/admin/configuracoes/page.tsx app/api/events/ tests/
git commit -m "feat: configuração do desconto PIX por evento (admin) + duplicação de evento"
```

---

### Task 5: Configuração global (UI) — `ServiceFeeForm`

**Files:**
- Modify: `components/admin/ServiceFeeForm.tsx`
- Modify: `app/admin/configuracoes/page.tsx` (buscar `getPixServiceFeeDiscountPercent`, passar a prop, ajustar copy)

**Interfaces:**
- Consumes: `getPixServiceFeeDiscountPercent` (Task 3); rota `POST /api/admin/settings` com `key: "pix_service_fee_discount_percent"` (Task 3).
- Produces: nada (UI).

- [ ] **Step 1: `components/admin/ServiceFeeForm.tsx` — novo campo**

Adicionar prop `currentPixDiscount: number` e um terceiro bloco de campo, no mesmo padrão dos existentes:

```tsx
export default function ServiceFeeForm({
  currentPercent,
  currentMin,
  currentPixDiscount,
}: {
  currentPercent: number;
  currentMin: number;
  currentPixDiscount: number;
}) {
  // ...estado existente...
  const [pixDiscount, setPixDiscount] = useState(currentPixDiscount);
  const [savingPix, setSavingPix] = useState(false);
  const [savedPix, setSavedPix] = useState(false);

  async function handleSavePixDiscount() {
    if (!Number.isInteger(pixDiscount) || pixDiscount < 0 || pixDiscount > 100) {
      setError("Desconto PIX deve ser um inteiro entre 0 e 100");
      return;
    }
    setSavingPix(true); setSavedPix(false); setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "pix_service_fee_discount_percent", value: String(pixDiscount) }),
    });
    if (res.ok) setSavedPix(true); else setError("Erro ao salvar");
    setSavingPix(false);
  }
```

E, no JSX, após o bloco "Valor mínimo" e antes do `{error && ...}`:

```tsx
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Desconto PIX sobre a Taxa de Serviço (%)
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Reduz apenas a Taxa de Serviço quando o pagamento é via PIX. Não afeta a Taxa da Plataforma
          nem o valor da inscrição. 0 = sem desconto.
        </p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={pixDiscount}
              onChange={(e) => { setPixDiscount(Number(e.target.value)); setSavedPix(false); }}
              min={0}
              max={100}
              step={1}
              className="input-field w-24 text-sm py-1"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
          </div>
          <button onClick={handleSavePixDiscount} disabled={savingPix} className="btn-primary py-1 px-3 text-sm disabled:opacity-50">
            {savingPix ? "Salvando…" : savedPix ? "Salvo!" : "Salvar"}
          </button>
        </div>
      </div>
```

- [ ] **Step 2: `app/admin/configuracoes/page.tsx` — buscar e passar**

Import (~linha 22):

```ts
import { getDefaultPlatformFee, getServiceFeePercent, getServiceFeeMin, getPixServiceFeeDiscountPercent, getBannerInterval, getCancellationPolicyEnabled } from "@/lib/settings";
```

No `Promise.all`, adicionar `getPixServiceFeeDiscountPercent()` ao array e o nome à desestruturação (`pixServiceFeeDiscount`).

Passar a prop:

```tsx
        <ServiceFeeForm currentPercent={serviceFeePercent} currentMin={serviceFeeMin} currentPixDiscount={pixServiceFeeDiscount} />
```

- [ ] **Step 3: Verificar tipos e build parcial**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add components/admin/ServiceFeeForm.tsx app/admin/configuracoes/page.tsx
git commit -m "feat: configuração global do desconto PIX sobre a Taxa de Serviço"
```

---

### Task 6: Frontend do checkout — recálculo e linha de desconto

**Files:**
- Modify: `components/checkout/CheckoutForm.tsx`
- Modify: `app/(public)/inscricao/[slug]/page.tsx` (resolver o efetivo e passar a prop)
- Modify: `lib/settings.ts` — nada (getter já existe da Task 3)

**Interfaces:**
- Consumes: `computeOrderAmounts` (Task 1); `resolveEffectivePixDiscountPercent`, `getPixServiceFeeDiscountPercent` (Tasks 1/3); `Event.pixServiceFeeDiscountPercent` via `getEventBySlug` (retorna o evento inteiro por `include`, campo já vem).
- Produces: `CheckoutForm` ganha prop `pixServiceFeeDiscountPercent?: number` (default 0).

- [ ] **Step 1: `app/(public)/inscricao/[slug]/page.tsx` — resolver e passar**

Import:

```ts
import { getDefaultPlatformFee, getServiceFeePercent, getServiceFeeMin, getPixServiceFeeDiscountPercent, getAppName } from "@/lib/settings";
import { resolveEffectivePixDiscountPercent } from "@/lib/fees";
```

No `Promise.all` (~linha 74), adicionar `getPixServiceFeeDiscountPercent()` e o nome (`globalPixDiscount`) à desestruturação.

Antes do `return`, calcular:

```ts
  const pixServiceFeeDiscountPercent = resolveEffectivePixDiscountPercent(
    event.pixServiceFeeDiscountPercent,
    globalPixDiscount,
  );
```

Passar ao form:

```tsx
        serviceFeeMin={serviceFeeMin}
        pixServiceFeeDiscountPercent={pixServiceFeeDiscountPercent}
        appName={appName}
```

- [ ] **Step 2: `components/checkout/CheckoutForm.tsx` — trocar o cálculo local**

Import no topo:

```ts
import { computeOrderAmounts } from "@/lib/fees";
```

Remover as funções locais `calcPlatformFee` e `calcServiceFee` (linhas ~76-85).

Adicionar a prop na assinatura e no tipo:

```tsx
  serviceFeeMin = 0,
  pixServiceFeeDiscountPercent = 0,
  appName,
```

```tsx
  serviceFeeMin?: number;
  pixServiceFeeDiscountPercent?: number;
  appName?: string;
```

**Card de lote** (~linha 431-441) — trocar o cálculo de exibição (sem PIX, pois o método ainda não foi escolhido nesse ponto):

```tsx
                  {(() => {
                    const a = computeOrderAmounts({
                      subtotal: b.priceAmount,
                      platformFeePercent,
                      defaultPlatformFee,
                      serviceFeePercent,
                      serviceFeeMin,
                      pixDiscountPercent: pixServiceFeeDiscountPercent,
                      isPix: false,
                    });
                    return (
                      <span>
                        +{formatCurrency(a.platformFee)} taxa da plataforma
                        {a.serviceFeeOriginal > 0 && <> · +{formatCurrency(a.serviceFeeOriginal)} taxa de serviço</>}
                        {pixServiceFeeDiscountPercent > 0 && a.serviceFeeOriginal > 0 && (
                          <> · {pixServiceFeeDiscountPercent}% off na taxa de serviço via PIX</>
                        )}
                      </span>
                    );
                  })()}
```

**Bloco de dados do cartão** (`amount` passado a `MPCardForm` / `PagarMeCardForm`, ~linha 587-600) — trocar as duas IIFE por:

```tsx
                  (() => {
                    const sub = couponPreview?.subtotalAmount ?? (selectedBatch?.priceAmount ?? 0);
                    return computeOrderAmounts({
                      subtotal: sub,
                      platformFeePercent,
                      defaultPlatformFee,
                      serviceFeePercent,
                      serviceFeeMin,
                      pixDiscountPercent: pixServiceFeeDiscountPercent,
                      isPix: false, // cartão nunca tem desconto PIX
                    }).total;
                  })()
```

**Bloco de resumo** (~linha 627-661) — substituir a IIFE inteira por:

```tsx
        {(() => {
          const effectiveSubtotal = couponPreview?.subtotalAmount ?? (selectedBatch?.priceAmount ?? 0);
          const a = computeOrderAmounts({
            subtotal: effectiveSubtotal,
            platformFeePercent,
            defaultPlatformFee,
            serviceFeePercent,
            serviceFeeMin,
            pixDiscountPercent: pixServiceFeeDiscountPercent,
            isPix: selectedPaymentMethod === "PIX",
          });
          return (
            <div className="space-y-1 text-sm mb-4">
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Inscrição</span>
                <span>{formatCurrency(selectedBatch?.priceAmount ?? 0)}</span>
              </div>
              {couponPreview && couponPreview.discountAmount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Desconto ({couponPreview.code})</span>
                  <span>-{formatCurrency(couponPreview.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>+Taxa da plataforma</span>
                <span>{formatCurrency(a.platformFee)}</span>
              </div>
              {a.serviceFeeOriginal > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>+Taxa de serviço de ingresso</span>
                  <span>{formatCurrency(a.serviceFeeOriginal)}</span>
                </div>
              )}
              {a.pixDiscountAmount > 0 && (
                <div className="flex flex-col text-green-600">
                  <div className="flex justify-between">
                    <span>Desconto PIX na taxa de serviço</span>
                    <span>-{formatCurrency(a.pixDiscountAmount)}</span>
                  </div>
                  <span className="text-xs text-green-600/80">{a.pixDiscountPercent}% de desconto via PIX</span>
                </div>
              )}
              <div className="flex justify-between items-center text-lg font-bold border-t dark:border-gray-700 pt-2 mt-1">
                <span>Total</span>
                <span className="text-primary-600">{formatCurrency(a.total)}</span>
              </div>
            </div>
          );
        })()}
```

Nota: o resumo recomputa a cada render a partir de `selectedPaymentMethod` — alternar Cartão↔PIX nunca acumula desconto (sem estado derivado).

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos. (Não há teste de UI — convenção do projeto.)

- [ ] **Step 4: Build de produção parcial**

Run: `npm run build`
Expected: build limpo (checa server components e client bundle).

- [ ] **Step 5: Commit**

```bash
git add components/checkout/CheckoutForm.tsx "app/(public)/inscricao/[slug]/page.tsx"
git commit -m "feat: checkout recalcula e mostra o desconto PIX subordinado à Taxa de Serviço"
```

---

### Task 7: Mensagem na página pública do evento

**Files:**
- Modify: `app/(public)/eventos/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getPixServiceFeeDiscountPercent` (Task 3), `resolveEffectivePixDiscountPercent` (Task 1), `event.pixServiceFeeDiscountPercent` (via `getEventBySlug`, já retorna).
- Produces: nada.

- [ ] **Step 1: Buscar e resolver o desconto efetivo**

Import (~linha 13-18):

```ts
import {
  getAppName,
  getDefaultPlatformFee,
  getServiceFeePercent,
  getServiceFeeMin,
  getPixServiceFeeDiscountPercent,
} from "@/lib/settings";
import { resolveEffectivePixDiscountPercent } from "@/lib/fees";
```

No `Promise.all` (~linha 63-71), adicionar `getPixServiceFeeDiscountPercent()` e o nome `globalPixDiscount` à desestruturação.

Após `if (!event) notFound();`:

```ts
  const pixServiceFeeDiscount = resolveEffectivePixDiscountPercent(
    event.pixServiceFeeDiscountPercent,
    globalPixDiscount,
  );
```

- [ ] **Step 2: Renderizar a mensagem dentro do bloco da Taxa de Serviço**

No bloco "Taxas aplicadas" (~linha 248-254), dentro do `{(serviceFeePercent > 0 || serviceFeeMin > 0) && (...)}`, logo após o `<p>` da Taxa de serviço:

```tsx
                {(serviceFeePercent > 0 || serviceFeeMin > 0) && (
                  <>
                    <p>
                      Taxa de serviço:
                      {serviceFeePercent > 0 ? ` ${(serviceFeePercent / 100).toFixed(1)}%` : ""}
                      {serviceFeeMin > 0 && ` (mín. ${formatCurrency(serviceFeeMin)})`}
                    </p>
                    {pixServiceFeeDiscount > 0 && (
                      <p className="text-green-600 dark:text-green-400">
                        {pixServiceFeeDiscount}% de desconto na Taxa de Serviço para pagamento via PIX
                      </p>
                    )}
                  </>
                )}
```

(A linha da Taxa da Plataforma logo acima **não muda**.)

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: limpo.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/eventos/[slug]/page.tsx"
git commit -m "feat: página pública do evento anuncia o desconto PIX na Taxa de Serviço"
```

---

### Task 8: Relatório financeiro admin (tela + CSV) — breakdown original / desconto / líquida

**Files:**
- Modify: `app/api/admin/report/export/route.ts`
- Modify: `app/admin/relatorio/page.tsx`
- Test: `tests/admin-report-route.test.ts` (estender)

**Interfaces:**
- Consumes: `Order.serviceFeeOriginalAmount`, `Order.pixDiscountAmount` (Task 2), gravados pela Task 3.
- Produces: nada.

- [ ] **Step 1: Escrever o teste (falhando) em `tests/admin-report-route.test.ts`**

No teste "exports the financial summary as csv", ajustar o mock do `order.aggregate` e adicionar asserções:

```ts
    dbMock.order.aggregate.mockResolvedValueOnce({
      _count: { id: 2 },
      _sum: {
        platformFeeAmount: 2200,
        paymentFeeAmount: 800,
        subtotalAmount: 18000,
        serviceFeeOriginalAmount: 1000,
        pixDiscountAmount: 200,
      },
    });
    // ...
    expect(csv).toContain('"Taxa de serviço (original)"');
    expect(csv).toMatch(/R\$\s?10,00/);
    expect(csv).toContain('"Desconto PIX concedido"');
    expect(csv).toMatch(/-R\$\s?2,00/);
    expect(csv).toContain('"Taxa de serviço (líquida)"');
    expect(csv).toMatch(/R\$\s?8,00/);
    expect(csv).toContain('"Taxa da plataforma"'); // inalterada
```

Nos demais testes do arquivo que mockam `order.aggregate` com `_sum: { platformFeeAmount: 0 }`, acrescentar `serviceFeeOriginalAmount: 0, pixDiscountAmount: 0, paymentFeeAmount: 0, subtotalAmount: 0` para não dar `undefined` (o `?? 0` cobre, mas explicitar mantém o teste claro).

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/admin-report-route.test.ts`
Expected: FAIL nas novas asserções de string.

- [ ] **Step 3: `app/api/admin/report/export/route.ts` — 3 linhas**

No `db.order.aggregate` `_sum` (~linha 36), adicionar:

```ts
        _sum: { platformFeeAmount: true, paymentFeeAmount: true, subtotalAmount: true, serviceFeeOriginalAmount: true, pixDiscountAmount: true },
```

Após `const serviceFeeActual = ...` (~linha 52):

```ts
  const serviceFeeOriginal = platformFeeAgg._sum.serviceFeeOriginalAmount ?? 0;
  const pixDiscountTotal = platformFeeAgg._sum.pixDiscountAmount ?? 0;
```

Na array `rows` (~linha 56-69), substituir a linha `["Taxa de serviço", formatCurrency(serviceFeeActual)],` por:

```ts
    ["Taxa de serviço (original)", formatCurrency(serviceFeeOriginal)],
    ["Desconto PIX concedido", `-${formatCurrency(pixDiscountTotal)}`],
    ["Taxa de serviço (líquida)", formatCurrency(serviceFeeActual)],
```

(A linha `["Taxa da plataforma", formatCurrency(platformFeeActual)],` permanece exatamente igual.)

- [ ] **Step 4: `app/admin/relatorio/page.tsx` — card de detalhe**

No `db.order.aggregate` `_sum` (~linha 67), adicionar `serviceFeeOriginalAmount: true, pixDiscountAmount: true`.

Após o cálculo de `revenueBreakdown` (~linha 120):

```ts
  const serviceFeeOriginalTotal = platformFeeAgg._sum.serviceFeeOriginalAmount ?? 0;
  const pixDiscountTotal = platformFeeAgg._sum.pixDiscountAmount ?? 0;
```

Logo após `<RevenueBreakdownCard breakdown={revenueBreakdown} variant="admin" />` (~linha 165):

```tsx
      {pixDiscountTotal > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold mb-1">Taxa de Serviço — detalhe do desconto PIX</h2>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">Taxa de serviço (original)</span>
            <span className="font-medium">{formatCurrency(serviceFeeOriginalTotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-green-600">
            <span>− Desconto PIX concedido</span>
            <span>-{formatCurrency(pixDiscountTotal)}</span>
          </div>
          <div className="flex justify-between text-sm border-t dark:border-gray-700 pt-2">
            <span className="font-semibold">= Taxa de serviço (líquida)</span>
            <span className="font-bold">{formatCurrency(serviceFeeOriginalTotal - pixDiscountTotal)}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-2 mt-1">
            O desconto PIX incide apenas sobre a Taxa de Serviço. A Taxa da Plataforma não é afetada.
          </p>
        </div>
      )}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/admin-report-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/report/export/route.ts app/admin/relatorio/page.tsx tests/admin-report-route.test.ts
git commit -m "feat: relatório financeiro admin separa Taxa de Serviço original, desconto PIX e líquida"
```

---

### Task 9: Detalhe do pagamento (tela + export CSV)

**Files:**
- Modify: `app/api/admin/payments/[id]/export/route.ts`
- Modify: `app/admin/pagamentos/[id]/page.tsx`
- Test: `tests/admin-payment-detail-export.test.ts` (estender)

**Interfaces:**
- Consumes: `Order.serviceFeeOriginalAmount`, `Order.pixDiscountPercent`, `Order.pixDiscountAmount` (Task 2). Ambos os arquivos buscam o `order` por `include` — campos já vêm.
- Produces: nada.

- [ ] **Step 1: Escrever o teste (falhando) em `tests/admin-payment-detail-export.test.ts`**

Localizar o teste que monta o `payment` mockado com `order`. Adicionar ao `order`:

```ts
        serviceFeeOriginalAmount: 1000,
        pixDiscountPercent: 20,
        pixDiscountAmount: 200,
        paymentFeeAmount: 800,
```

E asserções no CSV:

```ts
    expect(csv).toContain("Taxa de serviço (original)");
    expect(csv).toMatch(/R\$\s?10,00/);
    expect(csv).toContain("Desconto PIX na Taxa de Serviço");
    expect(csv).toContain("Desconto PIX (%)");
    expect(csv).toContain("20%");
    expect(csv).toContain("Taxa de serviço (líquida)");
    expect(csv).toMatch(/R\$\s?8,00/);
```

(Se não existir teste no arquivo cobrindo o corpo do CSV, criar um novo `it(...)` seguindo o padrão de auth dos outros testes do arquivo.)

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/admin-payment-detail-export.test.ts`
Expected: FAIL nas novas asserções.

- [ ] **Step 3: `app/api/admin/payments/[id]/export/route.ts` — linhas condicionais**

Substituir a linha `["Taxa de serviço", formatCurrency(payment.order.paymentFeeAmount)],` (~linha 55) por:

```ts
    ...(payment.order.pixDiscountAmount > 0
      ? ([
          ["Taxa de serviço (original)", formatCurrency(payment.order.serviceFeeOriginalAmount)],
          ["Desconto PIX na Taxa de Serviço", `-${formatCurrency(payment.order.pixDiscountAmount)}`],
          ["Desconto PIX (%)", `${payment.order.pixDiscountPercent}%`],
          ["Taxa de serviço (líquida)", formatCurrency(payment.order.paymentFeeAmount)],
        ] as Array<[string, string]>)
      : ([["Taxa de serviço", formatCurrency(payment.order.paymentFeeAmount)]] as Array<[string, string]>)),
```

(A linha `["Taxa plataforma", formatCurrency(payment.order.platformFeeAmount)],` permanece.)

- [ ] **Step 4: `app/admin/pagamentos/[id]/page.tsx` — 3 linhas na tela**

Substituir o bloco (~linha 162-165):

```tsx
            <div className="flex justify-between text-xs text-gray-400">
              <span>Taxa de serviço</span>
              <span>{formatCurrency(order.paymentFeeAmount)}</span>
            </div>
```

por:

```tsx
            {order.pixDiscountAmount > 0 ? (
              <>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Taxa de serviço (original)</span>
                  <span>{formatCurrency(order.serviceFeeOriginalAmount)}</span>
                </div>
                <div className="flex justify-between text-xs text-green-600">
                  <span>Desconto PIX ({order.pixDiscountPercent}%)</span>
                  <span>-{formatCurrency(order.pixDiscountAmount)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Taxa de serviço (líquida)</span>
                  <span>{formatCurrency(order.paymentFeeAmount)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-xs text-gray-400">
                <span>Taxa de serviço</span>
                <span>{formatCurrency(order.paymentFeeAmount)}</span>
              </div>
            )}
```

- [ ] **Step 5: Run tests + tipos**

Run: `npx vitest run tests/admin-payment-detail-export.test.ts && npx tsc --noEmit`
Expected: PASS / limpo.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/payments/ app/admin/pagamentos/ tests/admin-payment-detail-export.test.ts
git commit -m "feat: detalhe do pagamento mostra Taxa de Serviço original, desconto PIX e líquida"
```

---

### Task 10: Comprovante do atleta + descrição da variável de template

**Files:**
- Modify: `app/dashboard/inscricoes/[id]/page.tsx`
- Modify: `lib/templates/variables.ts` (só a `description` de `taxa_servico`)

**Interfaces:**
- Consumes: `Order.serviceFeeOriginalAmount`, `Order.pixDiscountAmount` (Task 2).
- Produces: nada.

- [ ] **Step 1: `app/dashboard/inscricoes/[id]/page.tsx` — select + linhas**

No `select` do `order` (~linha 47-57), adicionar:

```ts
          serviceFeeOriginalAmount: true,
          pixDiscountAmount: true,
```

Substituir o bloco (~linha 200-205):

```tsx
          {registration.order.paymentFeeAmount > 0 && (
            <div className="flex justify-between">
              <span>Taxa de serviço de ingresso</span>
              <span>+ {formatCurrency(registration.order.paymentFeeAmount)}</span>
            </div>
          )}
```

por:

```tsx
          {registration.order.pixDiscountAmount > 0 ? (
            <>
              <div className="flex justify-between">
                <span>Taxa de serviço original</span>
                <span>+ {formatCurrency(registration.order.serviceFeeOriginalAmount)}</span>
              </div>
              <div className="flex justify-between text-green-600">
                <span>Desconto PIX na taxa de serviço</span>
                <span>- {formatCurrency(registration.order.pixDiscountAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Taxa de serviço de ingresso</span>
                <span>+ {formatCurrency(registration.order.paymentFeeAmount)}</span>
              </div>
            </>
          ) : (
            registration.order.paymentFeeAmount > 0 && (
              <div className="flex justify-between">
                <span>Taxa de serviço de ingresso</span>
                <span>+ {formatCurrency(registration.order.paymentFeeAmount)}</span>
              </div>
            )
          )}
```

- [ ] **Step 2: `lib/templates/variables.ts` — descrição precisa**

Linha ~94, trocar a `description` da variável `taxa_servico`:

```ts
  { name: "taxa_servico", label: "Taxa de serviço", category: "Plataforma", description: "Soma de Order.paymentFeeAmount no período (Taxa de Serviço já líquida, com o desconto PIX aplicado quando houver), formatada em R$. Só disponível no resumo diário do administrador.", sample: "R$ 45,00" },
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: limpo.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/inscricoes/ lib/templates/variables.ts
git commit -m "feat: comprovante do atleta detalha o desconto PIX na Taxa de Serviço"
```

---

### Task 11: Verificação final, relatório técnico e PROGRESSO

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-desconto-pix-taxa-servico-design.md` (marcar critérios de aceite; a seção 10 "Entrega técnica final" já está preenchida no spec)
- Modify: `PROGRESSO.md`

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run`
Expected: tudo verde. Se algo quebrou por causa dos campos novos do `Order`/`CheckoutResult` em testes não tocados, corrigir adicionando os campos aos mocks (nunca desabilitar teste).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Build de produção**

Run: `npm run build`
Expected: build limpo (server + client).

- [ ] **Step 4: Lint (se o projeto tiver script)**

Run: `npm run lint` (se existir em `package.json`; senão pular)
Expected: sem erros novos.

- [ ] **Step 5: Revisão adversarial rápida (checklist do spec §9)**

Conferir manualmente, relendo os diffs:
- [ ] `platformFeeAmount` nunca é lido/escrito com base no desconto PIX (grep `pixDiscount` — nenhum resultado perto de `platformFee`).
- [ ] `computeOrderAmounts` é a única fórmula de taxa no backend e no frontend (grep `platformFeePercent) / 10000` — só em `lib/fees.ts`).
- [ ] Nenhum ponto soma `platformFee + serviceFee` antes de aplicar o desconto.
- [ ] `Order.serviceFeeOriginalAmount` nunca é sobrescrito pelo valor líquido.
- [ ] Alternância de método no checkout recomputa do zero (sem `useState` derivado de `computeOrderAmounts`).
- [ ] `resolveEffectivePixDiscountPercent(0, global)` → 0 em todos os call sites.
- [ ] Migração não tem `NOT NULL` sem default sobre tabela populada; backfill roda na mesma migração.
- [ ] Estorno (`refund-service.ts`) não foi tocado e continua usando `payment.amount`.

- [ ] **Step 6: Atualizar `PROGRESSO.md`**

Substituir a seção "Última atualização (2026-08-27 ... spec escrita ...)" por uma nova marcando a implementação concluída: o que foi feito, arquivos, resultado de `vitest`/`tsc`/`build`, e **PRÓXIMA TAREFA**: push + `deploy.sh` na VPS (com `prisma migrate deploy` — há migração de schema nova), aguardando autorização explícita do usuário.

- [ ] **Step 7: Commit final**

```bash
git add PROGRESSO.md docs/superpowers/specs/2026-08-27-desconto-pix-taxa-servico-design.md
git commit -m "docs: conclui desconto PIX sobre a Taxa de Serviço (implementação + verificação)"
```

---

## Self-Review

**1. Spec coverage:**

| Spec (seção) | Task |
|---|---|
| §2 auditoria/mapeamento | já no spec; verificada na Task 11 §5 |
| §3.1 migração `Event`/`Order` | Task 2 |
| §3.2 backfill | Task 2 Step 3 |
| §3.3 config global (setting + getter + rota + UI) | Tasks 3 (getter+rota), 5 (UI) |
| §3.4 config por evento (rota + UI + admin-only) | Task 4 |
| §4 motor `lib/fees.ts` | Task 1 |
| §4.1 backend `createCheckout` + rota | Task 3 |
| §4.2 frontend `CheckoutForm` | Task 6 |
| §5 página pública evento + host do checkout | Tasks 7 (eventos/[slug]), 6 (inscricao/[slug]) |
| §6.1 consumidores sem alteração | verificado Task 11 §5 (nenhuma task os toca) |
| §6.2 relatório admin | Task 8 |
| §6.2 export pagamento | Task 9 |
| §6.2 comprovante atleta | Task 10 |
| §6.1 variável `{taxa_servico}` descrição | Task 10 Step 2 |
| §7 duplicate copia o campo | Task 4 Step 7 |
| §8 testes | Tasks 1, 3, 4, 8, 9; suíte Task 11 |
| §9 critérios de aceite | Task 11 §5 |
| §10 entrega técnica final | já preenchida no spec |
| §11 fora de escopo | respeitado (nenhuma task toca repasse, resumo diário, RevenueBreakdownCard, export de inscrições, estorno) |

Sem lacunas.

**2. Placeholder scan:** Nenhum "TBD"/"TODO"/"handle edge cases". Onde digo "seguir o padrão já existente no arquivo" (Task 4 Step 8, Task 9 Step 1) é porque os testes de duplicação/export têm estilos de mock específicos que devem ser lidos no momento — o comportamento esperado e as asserções estão explícitos.

**3. Type consistency:**
- `computeOrderAmounts` / `OrderAmounts` / `OrderAmountsInput` — nomes idênticos em Tasks 1, 3, 6.
- `resolveEffectivePixDiscountPercent(eventValue, globalValue)` — assinatura idêntica em Tasks 1, 3, 6, 7.
- `getPixServiceFeeDiscountPercent()` — Tasks 3, 5, 6, 7.
- `CheckoutResult` campos novos (`serviceFeeOriginalAmount`, `paymentFeeAmount`, `pixDiscountAmount`, `pixDiscountPercent`) — definidos Task 3, consumidos por mocks em Task 3 Step 8.
- Campos Prisma (`Event.pixServiceFeeDiscountPercent`, `Order.serviceFeeOriginalAmount`, `Order.pixDiscountPercent`, `Order.pixDiscountAmount`) — definidos Task 2, usados Tasks 3, 4, 8, 9, 10 com os mesmos nomes.
- `Order.paymentFeeAmount` mantém o significado "líquida" em todas as tasks.

Sem inconsistências.
