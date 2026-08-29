# Múltiplas contas Mercado Pago — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin cadastra N contas Mercado Pago (label + credenciais), define uma padrão global e pode sobrescrever a conta por evento; cada pagamento congela a conta que o processou para webhook e estorno sempre usarem a conta certa.

**Architecture:** Novo model `PaymentAccount`. `Event.paymentAccountId` (override, null = padrão) e `Payment.paymentAccountId` (congelado). Um resolver central (`lib/payment/account-resolver.ts`) decide a conta de um evento. `MercadoPagoProvider` recebe a conta no construtor; `getPaymentProvider(account?)` monta o provider amarrado. Webhook novo por conta (`/api/webhooks/payment/mp/[accountId]`) + shim no endpoint legado. Toda mutação de conta e o `backup/import` passam pelo mecanismo de 2FA por código já existente.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts` = middleware Node runtime), TypeScript, Prisma 5 + PostgreSQL, Vitest, Tailwind, SDK `mercadopago`.

**Spec:** `docs/superpowers/specs/2026-08-29-multiplas-contas-mercadopago-design.md`

## Global Constraints

- **Credenciais nunca voltam pro frontend.** GET de conta devolve só `label`, `isDefault`, `archivedAt`, `webhookUrl` e flags booleanas (`hasAccessToken`, `hasWebhookSecret`, `hasPublicKey`). Forms nunca pré-preenchem credencial; só enviam quando não-vazio. `accessToken`/`webhookSecret` mascarados pra `"***"` em `AuditLog.metadata`.
- **Nunca `alert()` / `confirm()` / `window.prompt()`** — usar `components/ui/ConfirmModal.tsx` / `components/ui/ErrorModal.tsx` / `components/ui/CodeVerificationModal.tsx` (ver `CLAUDE.md`).
- **Verificação de webhook fail-closed:** sem `webhookSecret` da conta → nenhum webhook aceito.
- **Sem regressão pro Pagar.me / sandbox:** `payment_provider != "mercadopago"` → comportamento idêntico ao de hoje.
- **Migração sem downtime:** `/api/webhooks/payment` continua funcionando (shim → conta padrão). Schema via **`prisma db push`** em produção — **nunca `prisma migrate deploy`** (`_prisma_migrations` de prod congelado desde 2026-07-08). O step de dados roda como script TS à parte.
- **2FA:** reusar `lib/security/sensitive-action-verification.ts` — só estender o union `SensitiveActionType` e `ACTION_LABEL`. Fluxo: `POST .../request-code` → `verifySensitiveActionCode` antes de qualquer efeito colateral. E-mail do código falhou → aborta.
- **Centavos em `Int`** em todo valor monetário.
- `prisma/migrations/` é gitignored → `git add -f` nos arquivos de migração.
- Só `"mercadopago"` importa; `PaymentAccount.provider` existe só pra não travar o schema.

---

## File Structure

**Novos:**
- `lib/payment/account-resolver.ts` — resolve a conta de um evento / a padrão / por id; `ResolvedPaymentAccount`, `NoPaymentAccountError`.
- `lib/payment/webhook-handler.ts` — `processPaymentWebhookEvent(...)` extraído do endpoint atual (compartilhado entre legado e por-conta).
- `app/api/webhooks/payment/mp/[accountId]/route.ts` — webhook por conta.
- `app/api/admin/payment-accounts/route.ts` — GET (lista) + POST (cria, 2FA).
- `app/api/admin/payment-accounts/request-code/route.ts` — pede código 2FA.
- `app/api/admin/payment-accounts/[id]/route.ts` — PATCH (edita, 2FA).
- `app/api/admin/payment-accounts/[id]/make-default/route.ts` — POST (2FA).
- `app/api/admin/payment-accounts/[id]/archive/route.ts` — POST + DELETE-style (archive/unarchive, 2FA).
- `app/api/admin/events/[id]/payment-account/route.ts` — POST (override, 2FA) + request-code.
- `app/api/admin/backup/import/request-code/route.ts` — pede código 2FA.
- `lib/payment/payment-accounts.ts` — CRUD/queries de `PaymentAccount` (usado pelas rotas admin e pelo resolver), `maskCredential`.
- `components/admin/PaymentAccountsManager.tsx` — card de gestão de contas.
- `components/admin/PaymentAccountFormModal.tsx` — modal criar/editar.
- `components/admin/EventPaymentAccountSelect.tsx` — select da conta no painel admin do evento.
- `prisma/migrations/<ts>_add_payment_accounts/migration.sql` — DDL.
- `prisma/backfill-payment-accounts.ts` — step de dados (script executável).

**Modificados:**
- `prisma/schema.prisma` — model + 2 FKs.
- `lib/payment/index.ts` — `getPaymentProvider(account?)`.
- `lib/payment/mercadopago.ts` — construtor com `account?`.
- `lib/payment/refund-service.ts` — conta congelada.
- `lib/payment/check-mp-status.ts` — 2º arg `accessToken?`.
- `lib/payment/reconciliation.ts` — provider por conta (cache).
- `lib/payment/cancel-pending-manually.ts` — conta do pagamento.
- `lib/security/sensitive-action-verification.ts` — 2 novos `SensitiveActionType`.
- `app/api/checkout/route.ts` — resolve + congela conta.
- `app/api/checkout-ads/route.ts` — conta padrão + congela.
- `app/api/checkout/card-config/route.ts` — `?eventId=`.
- `app/api/webhooks/payment/route.ts` — shim.
- `app/api/orders/[id]/status/route.ts` + `app/api/payments/mp-return/route.ts` — token da conta.
- `app/api/admin/backup/import/route.ts` — gate de 2FA.
- `components/checkout/CheckoutForm.tsx` — `card-config?eventId=`.
- `components/admin/PaymentGatewayForm.tsx` — remove os 3 campos `mp_*`.
- `app/admin/configuracoes/page.tsx` — monta o `PaymentAccountsManager`.
- `app/admin/assistentes/page.tsx` — actionKey `payment-accounts.manage` no catálogo.
- Painel admin de edição de evento — `EventPaymentAccountSelect`.

---

## Task 1: Schema `PaymentAccount` + FKs + migração DDL

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_payment_accounts/migration.sql`
- Test: `tests/payment-account-schema.test.ts`

**Interfaces:**
- Produces: model `PaymentAccount { id, label, provider, accessToken, webhookSecret, publicKey?, isDefault, archivedAt?, createdAt, updatedAt }`; `Event.paymentAccountId String?`; `Payment.paymentAccountId String?`.

- [ ] **Step 1: Adicionar o model e as relações ao schema**

Em `prisma/schema.prisma`, adicionar (perto de `model Payment`):

```prisma
model PaymentAccount {
  id            String    @id @default(cuid())
  label         String
  provider      String    @default("mercadopago")
  accessToken   String    @db.Text
  webhookSecret String    @db.Text
  publicKey     String?   @db.Text
  isDefault     Boolean   @default(false)
  archivedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  events   Event[]
  payments Payment[]

  @@index([isDefault])
  @@map("payment_accounts")
}
```

No `model Event`, adicionar campo + relação:

```prisma
  paymentAccountId String?
  paymentAccount   PaymentAccount? @relation(fields: [paymentAccountId], references: [id])
```

No `model Payment`, adicionar:

```prisma
  paymentAccountId String?
  paymentAccount   PaymentAccount? @relation(fields: [paymentAccountId], references: [id])
```

E no bloco de índices do `Payment`: `@@index([paymentAccountId])`.

- [ ] **Step 2: Gerar a migração SQL (sem aplicar em prod)**

```bash
npx prisma migrate dev --name add_payment_accounts --create-only
```

Isto cria `prisma/migrations/<ts>_add_payment_accounts/migration.sql`. Conferir que ele tem: `CREATE TABLE "payment_accounts"`, `ALTER TABLE "events" ADD COLUMN "paymentAccountId"`, `ALTER TABLE "payments" ADD COLUMN "paymentAccountId"`, as 3 FKs e os índices. Nenhum `DROP`.

- [ ] **Step 3: Aplicar localmente e regenerar o client**

```bash
npx prisma migrate dev --name add_payment_accounts
npx prisma generate
```

- [ ] **Step 4: Teste — o client conhece o model e os campos**

```ts
// tests/payment-account-schema.test.ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

describe("schema PaymentAccount", () => {
  it("PaymentAccount está no dmmf com os campos esperados", () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "PaymentAccount");
    expect(model).toBeDefined();
    const fields = model!.fields.map((f) => f.name);
    expect(fields).toEqual(
      expect.arrayContaining(["label", "provider", "accessToken", "webhookSecret", "publicKey", "isDefault", "archivedAt"]),
    );
  });

  it("Event e Payment têm paymentAccountId opcional", () => {
    for (const name of ["Event", "Payment"]) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;
      const field = model.fields.find((f) => f.name === "paymentAccountId")!;
      expect(field.isRequired).toBe(false);
    }
  });
});
```

- [ ] **Step 5: Rodar o teste**

Run: `npx vitest run tests/payment-account-schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma tests/payment-account-schema.test.ts
git add -f prisma/migrations/
git commit -m "feat(schema): model PaymentAccount + Event/Payment.paymentAccountId"
```

---

## Task 2: Step de dados da migração (backfill)

**Files:**
- Create: `prisma/backfill-payment-accounts.ts`
- Test: `tests/backfill-payment-accounts.test.ts`

**Interfaces:**
- Consumes: model `PaymentAccount` (Task 1).
- Produces: `export async function backfillPaymentAccounts(prisma: PrismaClient): Promise<{ created: boolean; backfilled: number }>`.

- [ ] **Step 1: Teste — cria a conta principal + backfill quando há token; idempotente; nada sem token**

```ts
// tests/backfill-payment-accounts.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { backfillPaymentAccounts } from "@/../prisma/backfill-payment-accounts";

function makePrisma(overrides: any = {}) {
  return {
    platformSetting: { findMany: vi.fn().mockResolvedValue([]) },
    paymentAccount: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "acc_1" }),
    },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 42 }) },
    ...overrides,
  } as any;
}

beforeEach(() => vi.clearAllMocks());

it("com mp_access_token: cria 'Mercado Pago Principal' default e faz backfill dos pagamentos MP", async () => {
  const prisma = makePrisma({
    platformSetting: {
      findMany: vi.fn().mockResolvedValue([
        { key: "mp_access_token", value: "TOKEN" },
        { key: "mp_webhook_secret", value: "SECRET" },
        { key: "mp_public_key", value: "PUB" },
      ]),
    },
  });
  const res = await backfillPaymentAccounts(prisma);
  expect(prisma.paymentAccount.create).toHaveBeenCalledWith({
    data: { label: "Mercado Pago Principal", accessToken: "TOKEN", webhookSecret: "SECRET", publicKey: "PUB", isDefault: true },
  });
  expect(prisma.payment.updateMany).toHaveBeenCalledWith({
    where: { provider: "mercadopago", paymentAccountId: null },
    data: { paymentAccountId: "acc_1" },
  });
  expect(res).toEqual({ created: true, backfilled: 42 });
});

it("sem mp_access_token: não cria conta nenhuma", async () => {
  const prisma = makePrisma();
  const res = await backfillPaymentAccounts(prisma);
  expect(prisma.paymentAccount.create).not.toHaveBeenCalled();
  expect(res).toEqual({ created: false, backfilled: 0 });
});

it("idempotente: se já existe conta default, não recria", async () => {
  const prisma = makePrisma({
    platformSetting: { findMany: vi.fn().mockResolvedValue([{ key: "mp_access_token", value: "TOKEN" }]) },
    paymentAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acc_existing" }), create: vi.fn() },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  });
  const res = await backfillPaymentAccounts(prisma);
  expect(prisma.paymentAccount.create).not.toHaveBeenCalled();
  expect(res.created).toBe(false);
});
```

- [ ] **Step 2: Rodar — falha (função não existe)**

Run: `npx vitest run tests/backfill-payment-accounts.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
// prisma/backfill-payment-accounts.ts
import { PrismaClient } from "@prisma/client";

export async function backfillPaymentAccounts(
  prisma: Pick<PrismaClient, "platformSetting" | "paymentAccount" | "payment">,
): Promise<{ created: boolean; backfilled: number }> {
  const existing = await prisma.paymentAccount.findFirst({ where: { isDefault: true } });
  if (existing) return { created: false, backfilled: 0 };

  const settings = await prisma.platformSetting.findMany({
    where: { key: { in: ["mp_access_token", "mp_webhook_secret", "mp_public_key"] } },
  });
  const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const accessToken = (byKey["mp_access_token"] ?? "").trim();
  if (!accessToken) return { created: false, backfilled: 0 };

  const account = await prisma.paymentAccount.create({
    data: {
      label: "Mercado Pago Principal",
      accessToken,
      webhookSecret: (byKey["mp_webhook_secret"] ?? "").trim(),
      publicKey: (byKey["mp_public_key"] ?? "").trim() || null,
      isDefault: true,
    },
  });
  const { count } = await prisma.payment.updateMany({
    where: { provider: "mercadopago", paymentAccountId: null },
    data: { paymentAccountId: account.id },
  });
  return { created: true, backfilled: count };
}

// Executável direto: `npx tsx prisma/backfill-payment-accounts.ts`
if (require.main === module) {
  const prisma = new PrismaClient();
  backfillPaymentAccounts(prisma)
    .then((r) => { console.log("[backfill-payment-accounts]", r); return prisma.$disconnect(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Rodar — passa**

Run: `npx vitest run tests/backfill-payment-accounts.test.ts`
Expected: PASS

- [ ] **Step 5: Rodar o backfill no banco local**

```bash
npx tsx prisma/backfill-payment-accounts.ts
```

Se o `.env` local tiver `mp_access_token` na tabela de settings, cria a conta; senão loga `{ created: false }`. Ambos OK.

- [ ] **Step 6: Commit**

```bash
git add prisma/backfill-payment-accounts.ts tests/backfill-payment-accounts.test.ts
git commit -m "feat(payment): script de backfill — Mercado Pago Principal + paymentAccountId dos pagamentos"
```

---

## Task 3: `lib/payment/account-resolver.ts`

**Files:**
- Create: `lib/payment/account-resolver.ts`
- Create: `lib/payment/payment-accounts.ts`
- Test: `tests/payment-account-resolver.test.ts`

**Interfaces:**
- Consumes: model `PaymentAccount` (Task 1).
- Produces:
  - `interface ResolvedPaymentAccount { id: string; accessToken: string; webhookSecret: string; publicKey: string | null; label: string; archived: boolean }`
  - `class NoPaymentAccountError extends Error`
  - `async function resolveEventPaymentAccount(eventId: string): Promise<ResolvedPaymentAccount>`
  - `async function getDefaultPaymentAccount(): Promise<ResolvedPaymentAccount>`
  - `async function getPaymentAccountById(id: string): Promise<ResolvedPaymentAccount>`
  - Em `payment-accounts.ts`: `function toResolved(row): ResolvedPaymentAccount`, `function maskCredential(v: string | null | undefined): string | null` (`v ? "***" : null`).

- [ ] **Step 1: Teste**

```ts
// tests/payment-account-resolver.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  resolveEventPaymentAccount,
  getDefaultPaymentAccount,
  getPaymentAccountById,
  NoPaymentAccountError,
} from "@/lib/payment/account-resolver";

const dbMock = db as any;
const ACC = { id: "acc_1", label: "Principal", accessToken: "T", webhookSecret: "S", publicKey: "P", archivedAt: null };

beforeEach(() => vi.clearAllMocks());

it("evento com override → a conta do override", async () => {
  dbMock.event.findUnique.mockResolvedValueOnce({ paymentAccountId: "acc_2", paymentAccount: { ...ACC, id: "acc_2" } });
  const r = await resolveEventPaymentAccount("ev_1");
  expect(r.id).toBe("acc_2");
});

it("evento sem override → a conta default", async () => {
  dbMock.event.findUnique.mockResolvedValueOnce({ paymentAccountId: null, paymentAccount: null });
  dbMock.paymentAccount.findFirst.mockResolvedValueOnce(ACC);
  const r = await resolveEventPaymentAccount("ev_1");
  expect(r.id).toBe("acc_1");
  expect(dbMock.paymentAccount.findFirst).toHaveBeenCalledWith({ where: { isDefault: true, archivedAt: null } });
});

it("sem conta default → NoPaymentAccountError", async () => {
  dbMock.event.findUnique.mockResolvedValueOnce({ paymentAccountId: null, paymentAccount: null });
  dbMock.paymentAccount.findFirst.mockResolvedValueOnce(null);
  await expect(resolveEventPaymentAccount("ev_1")).rejects.toBeInstanceOf(NoPaymentAccountError);
});

it("getPaymentAccountById acha conta arquivada e marca archived", async () => {
  dbMock.paymentAccount.findUnique.mockResolvedValueOnce({ ...ACC, archivedAt: new Date() });
  const r = await getPaymentAccountById("acc_1");
  expect(r.archived).toBe(true);
});

it("getPaymentAccountById inexistente → NoPaymentAccountError", async () => {
  dbMock.paymentAccount.findUnique.mockResolvedValueOnce(null);
  await expect(getPaymentAccountById("nope")).rejects.toBeInstanceOf(NoPaymentAccountError);
});
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/payment-account-resolver.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `payment-accounts.ts`**

```ts
// lib/payment/payment-accounts.ts
import type { PaymentAccount } from "@prisma/client";
import type { ResolvedPaymentAccount } from "./account-resolver";

export function toResolved(row: PaymentAccount): ResolvedPaymentAccount {
  return {
    id: row.id,
    accessToken: row.accessToken,
    webhookSecret: row.webhookSecret,
    publicKey: row.publicKey ?? null,
    label: row.label,
    archived: row.archivedAt !== null,
  };
}

export function maskCredential(v: string | null | undefined): string | null {
  return v ? "***" : null;
}
```

- [ ] **Step 4: Implementar `account-resolver.ts`**

```ts
// lib/payment/account-resolver.ts
import { db } from "@/lib/db";
import { toResolved } from "./payment-accounts";

export interface ResolvedPaymentAccount {
  id: string;
  accessToken: string;
  webhookSecret: string;
  publicKey: string | null;
  label: string;
  archived: boolean;
}

export class NoPaymentAccountError extends Error {
  constructor(msg = "Nenhuma conta Mercado Pago configurada") {
    super(msg);
    this.name = "NoPaymentAccountError";
  }
}

export async function getDefaultPaymentAccount(): Promise<ResolvedPaymentAccount> {
  const row = await db.paymentAccount.findFirst({ where: { isDefault: true, archivedAt: null } });
  if (!row) throw new NoPaymentAccountError();
  return toResolved(row);
}

export async function getPaymentAccountById(id: string): Promise<ResolvedPaymentAccount> {
  const row = await db.paymentAccount.findUnique({ where: { id } });
  if (!row) throw new NoPaymentAccountError(`Conta de pagamento ${id} não encontrada`);
  return toResolved(row);
}

export async function resolveEventPaymentAccount(eventId: string): Promise<ResolvedPaymentAccount> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { paymentAccountId: true, paymentAccount: true },
  });
  if (event?.paymentAccount) return toResolved(event.paymentAccount);
  return getDefaultPaymentAccount();
}
```

- [ ] **Step 5: Rodar — passa**

Run: `npx vitest run tests/payment-account-resolver.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/payment/account-resolver.ts lib/payment/payment-accounts.ts tests/payment-account-resolver.test.ts
git commit -m "feat(payment): account-resolver — conta de um evento / padrão / por id"
```

---

## Task 4: `MercadoPagoProvider` amarrado à conta + `getPaymentProvider(account?)`

**Files:**
- Modify: `lib/payment/mercadopago.ts`
- Modify: `lib/payment/index.ts`
- Test: `tests/payment-mercadopago-account.test.ts`

**Interfaces:**
- Consumes: `ResolvedPaymentAccount` (Task 3).
- Produces:
  - `new MercadoPagoProvider(account?: ResolvedPaymentAccount)`
  - `getPaymentProvider(account?: ResolvedPaymentAccount): Promise<PaymentProvider>`

- [ ] **Step 1: Teste — provider usa token/secret da conta; sem conta usa a setting global**

```ts
// tests/payment-mercadopago-account.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn().mockResolvedValue({ id: 999, status: "approved", fee_details: [] });
vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation((opts) => ({ __opts: opts })),
  Payment: vi.fn().mockImplementation(() => ({ create, get: vi.fn(), cancel: vi.fn() })),
  PaymentRefund: vi.fn().mockImplementation(() => ({ create: vi.fn().mockResolvedValue({ id: 1 }) })),
}));
vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("GLOBAL_TOKEN"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue("GLOBAL_SECRET"),
}));

import { MercadoPagoConfig } from "mercadopago";
import { MercadoPagoProvider } from "@/lib/payment/mercadopago";

beforeEach(() => vi.clearAllMocks());

const ACC = { id: "acc_1", accessToken: "ACC_TOKEN", webhookSecret: "ACC_SECRET", publicKey: null, label: "x", archived: false };

it("com conta: usa o accessToken da conta", async () => {
  const p = new MercadoPagoProvider(ACC);
  await p.createPayment({ orderId: "o1", amount: 1000, method: "PIX", idempotencyKey: "k", buyer: { name: "A B", email: "a@b.c" }, description: "d" });
  expect(vi.mocked(MercadoPagoConfig)).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "ACC_TOKEN" }));
});

it("sem conta: cai no token global (retrocompat Pagar.me/legado)", async () => {
  const p = new MercadoPagoProvider();
  await p.createPayment({ orderId: "o1", amount: 1000, method: "PIX", idempotencyKey: "k", buyer: { name: "A B", email: "a@b.c" }, description: "d" });
  expect(vi.mocked(MercadoPagoConfig)).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "GLOBAL_TOKEN" }));
});

it("verifyWebhookSignature usa o secret da conta", async () => {
  const p = new MercadoPagoProvider(ACC);
  // secret errado → não valida (não lança, retorna false)
  const ok = await p.verifyWebhookSignature('{"data":{"id":"1"}}', "ts=1,v1=deadbeef");
  expect(ok).toBe(false);
});
```

- [ ] **Step 2: Rodar — falha (construtor não aceita arg)**

Run: `npx vitest run tests/payment-mercadopago-account.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar em `lib/payment/mercadopago.ts`**

Adicionar o construtor e trocar `getClient()` / `verifyWebhookSignature` / os pontos que hoje chamam `getMercadoPagoAccessToken()` direto (há um dentro de `createPayment` no branch de cartão, para o lookup do `card_tokens`):

```ts
export class MercadoPagoProvider implements PaymentProvider {
  constructor(private account?: ResolvedPaymentAccount) {}

  private async accessToken(): Promise<string> {
    if (this.account) return this.account.accessToken;
    const t = await getMercadoPagoAccessToken();
    if (!t) throw new Error("MP_ACCESS_TOKEN não configurado");
    return t;
  }

  private async webhookSecret(): Promise<string | null> {
    return this.account ? this.account.webhookSecret : getMercadoPagoWebhookSecret();
  }

  private async getClient() {
    return new MercadoPagoConfig({ accessToken: await this.accessToken(), options: { timeout: 10000 } });
  }
  // ... trocar `const client = await getClient();` por `const client = await this.getClient();`
  // ... no branch de cartão, trocar `const accessToken = await getMercadoPagoAccessToken();`
  //     por `const accessToken = await this.accessToken();`
  // ... em verifyWebhookSignature, trocar `const secret = await getMercadoPagoWebhookSecret();`
  //     por `const secret = await this.webhookSecret();`
}
```

Remover a função `getClient()` de módulo (virou método). Importar `ResolvedPaymentAccount` de `./account-resolver`.

- [ ] **Step 4: Implementar em `lib/payment/index.ts`**

```ts
import type { ResolvedPaymentAccount } from "./account-resolver";

export async function getPaymentProvider(account?: ResolvedPaymentAccount): Promise<PaymentProvider> {
  const provider = await getPaymentProviderSetting();
  if (provider === "sandbox") return new SandboxPaymentProvider();
  if (provider === "mercadopago") return new MercadoPagoProvider(account);
  if (provider === "pagarme") return new PagarMeProvider();
  throw new Error(`Payment provider "${provider}" not implemented`);
}
```

- [ ] **Step 5: Rodar — passa; rodar a suíte de pagamento**

Run: `npx vitest run tests/payment-mercadopago-account.test.ts tests/payment-mercadopago-create.test.ts tests/payment-mercadopago-status.test.ts tests/payment-mercadopago-refund.test.ts`
Expected: PASS (as suítes existentes continuam verdes — elas chamam `new MercadoPagoProvider()` sem arg)

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/payment/mercadopago.ts lib/payment/index.ts tests/payment-mercadopago-account.test.ts
git commit -m "feat(payment): MercadoPagoProvider recebe a conta no construtor"
```

---

## Task 5: Checkout congela a conta

**Files:**
- Modify: `app/api/checkout/route.ts:95-116` (região do `providerKey` / `getPaymentProvider`) e `:201-216` (criação do `Payment`)
- Modify: `app/api/checkout-ads/route.ts:47,62`
- Modify: `app/api/checkout/card-config/route.ts`
- Modify: `components/checkout/CheckoutForm.tsx:153`
- Test: `tests/checkout-payment-account.test.ts` (novo), ajustar `tests/checkout-route.test.ts` se precisar

**Interfaces:**
- Consumes: `resolveEventPaymentAccount`, `getDefaultPaymentAccount`, `NoPaymentAccountError` (Task 3); `getPaymentProvider(account?)` (Task 4).

- [ ] **Step 1: Teste — `Payment.paymentAccountId` = conta resolvida do evento; sem conta → 503**

```ts
// tests/checkout-payment-account.test.ts
// Segue o padrão de tests/checkout-route.test.ts (mocka @/lib/checkout, @/lib/payment,
// @/lib/payment/account-resolver, @/lib/db, @/lib/auth). Asserções:
//  - resolveEventPaymentAccount chamado com o eventId do checkout
//  - db.payment.create recebe data.paymentAccountId === conta.id
//  - resolveEventPaymentAccount lança NoPaymentAccountError → resposta 503
```

(O implementer copia a estrutura de mocks de `tests/checkout-route.test.ts` — não repetir aqui. As 3 asserções acima são o contrato.)

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/checkout-payment-account.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar no `checkout/route.ts`**

Trocar a região que resolve o provider:

```ts
const providerKey = await getPaymentProviderSetting();
let account: import("@/lib/payment/account-resolver").ResolvedPaymentAccount | undefined;
if (providerKey === "mercadopago") {
  try {
    account = await resolveEventPaymentAccount(checkoutData.eventId);
  } catch (e) {
    if (e instanceof NoPaymentAccountError) {
      return NextResponse.json(
        { error: "Gateway de pagamento não configurado. Acesse Admin → Configurações." },
        { status: 503 },
      );
    }
    throw e;
  }
}
// (bloco antigo que checava getMercadoPagoAccessToken/getPagarMeApiKey: manter o do Pagar.me,
//  remover o do mercadopago — o resolver já cobre)
const provider = await getPaymentProvider(account);
```

Na criação do `Payment` (as duas — a do branch CANCELLED e a normal): adicionar `paymentAccountId: account?.id ?? null`.

- [ ] **Step 4: Implementar no `checkout-ads/route.ts`**

```ts
const providerKey = await getPaymentProviderSetting();
let account: ResolvedPaymentAccount | undefined;
if (providerKey === "mercadopago") {
  try { account = await getDefaultPaymentAccount(); }
  catch (e) {
    if (e instanceof NoPaymentAccountError)
      return NextResponse.json({ error: "Gateway de pagamento não configurado." }, { status: 503 });
    throw e;
  }
}
const provider = await getPaymentProvider(account);
// ... no db.payment.create: paymentAccountId: account?.id ?? null
```

Fazer o mesmo em `app/api/anunciante/solicitar/route.ts:76` (mesma criação de pagamento de anúncio).

- [ ] **Step 5: Implementar `card-config` + `CheckoutForm`**

`app/api/checkout/card-config/route.ts`:

```ts
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const provider = await getPaymentProviderSetting();
  const eventId = new URL(req.url).searchParams.get("eventId");

  let publicKey: string | null = null;
  if (provider === "mercadopago") {
    if (eventId) {
      try { publicKey = (await resolveEventPaymentAccount(eventId)).publicKey; }
      catch { publicKey = null; }
    } else {
      publicKey = await getMercadoPagoPublicKey();
    }
  } else if (provider === "pagarme") {
    publicKey = await getPagarMePublicKey();
  }
  return NextResponse.json({ provider, publicKey });
}
```

`components/checkout/CheckoutForm.tsx:153`: `fetch(\`/api/checkout/card-config?eventId=\${event.id}\`)`.

- [ ] **Step 6: Rodar testes + typecheck**

Run: `npx vitest run tests/checkout-payment-account.test.ts tests/checkout-route.test.ts tests/payments-mp-return-route.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit
git add app/api/checkout/route.ts app/api/checkout-ads/route.ts app/api/anunciante/solicitar/route.ts app/api/checkout/card-config/route.ts components/checkout/CheckoutForm.tsx tests/checkout-payment-account.test.ts
git commit -m "feat(checkout): resolve e congela a conta MP no Payment"
```

---

## Task 6: `webhook-handler.ts` — extrair o processamento

**Files:**
- Create: `lib/payment/webhook-handler.ts`
- Modify: `app/api/webhooks/payment/route.ts` (passa a chamar o handler extraído)
- Test: `tests/payment-webhook-handler.test.ts` (novo); `tests/webhook-payment-alerts.test.ts` e `tests/payment-webhook-ad-purchase.test.ts` continuam verdes

**Interfaces:**
- Produces: `async function processPaymentWebhookEvent(event: ParsedWebhookEvent): Promise<{ handled: boolean }>` onde
  `ParsedWebhookEvent = { providerPaymentId: string; status: PaymentWebhookPayload["status"]; paidAt?: string; gatewayFeeAmount?: number; rawPayload: Record<string, unknown>; accountId?: string }`.
  `accountId` (quando vem do endpoint por-conta) faz o handler exigir `payment.paymentAccountId === accountId`.

- [ ] **Step 1: Teste**

```ts
// tests/payment-webhook-handler.test.ts
// Mocka @/lib/db, @/lib/payment/sync-payment-status, @/lib/notifications, @/lib/alerts/*.
// Casos:
//  - payment não encontrado → { handled: false }
//  - accountId informado e payment.paymentAccountId != accountId → { handled: false }, applyGatewayStatus NÃO chamado
//  - accountId informado e bate → applyGatewayStatus chamado
//  - status PAID → notifyOrderConfirmed; CANCELLED/EXPIRED → notifyPaymentError
//  - adPurchaseId presente → confirmAdPurchasePayment (não passa por applyGatewayStatus de Order)
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/payment-webhook-handler.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar** — mover o corpo do `POST` de `app/api/webhooks/payment/route.ts` a partir de `const payment = await db.payment.findFirst(...)` (linha ~113) até o fim para `processPaymentWebhookEvent`. A única mudança de lógica: logo após achar o `payment`, se `event.accountId && payment.paymentAccountId && payment.paymentAccountId !== event.accountId` → `console.warn(...)` e `return { handled: false }`.

```ts
// lib/payment/webhook-handler.ts
import { db } from "@/lib/db";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { notifyPaymentError } from "@/lib/alerts/payment-error";
import { confirmAdPurchasePayment } from "@/lib/ads/ad-purchase-confirmation";
import { sendAdPurchaseConfirmationEmail } from "@/lib/email";
import { notifyAdvertiserRequestPending } from "@/lib/alerts/advertiser-request-pending";
import type { PaymentWebhookPayload } from "./types";

export interface ParsedWebhookEvent {
  providerPaymentId: string;
  status: PaymentWebhookPayload["status"];
  paidAt?: string;
  gatewayFeeAmount?: number;
  rawPayload: Record<string, unknown>;
  accountId?: string;
}

export async function processPaymentWebhookEvent(event: ParsedWebhookEvent): Promise<{ handled: boolean }> {
  const payment = await db.payment.findFirst({
    where: { providerPaymentId: event.providerPaymentId },
    include: {
      order: { include: { registrations: true, buyer: { select: { name: true, email: true } } } },
      adPurchase: { include: { advertiser: { include: { user: true } }, adPlan: true } },
    },
  });
  if (!payment) return { handled: false };

  if (event.accountId && payment.paymentAccountId && payment.paymentAccountId !== event.accountId) {
    console.warn(`[webhook] pagamento ${payment.id} pertence à conta ${payment.paymentAccountId}, webhook veio de ${event.accountId} — ignorado`);
    return { handled: false };
  }

  // ... resto idêntico ao que está hoje no route.ts (branch adPurchase, branch order,
  //     applyGatewayStatus, notifyOrderConfirmed/notifyPaymentError) ...
  return { handled: true };
}
```

`app/api/webhooks/payment/route.ts` passa a: fazer parse/assinatura como hoje e chamar `await processPaymentWebhookEvent({ ...parsedStatus, accountId: undefined })`.

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run tests/payment-webhook-handler.test.ts tests/webhook-payment-alerts.test.ts tests/payment-webhook-ad-purchase.test.ts tests/payment-webhook-signature.test.ts tests/order-status-alerts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/payment/webhook-handler.ts app/api/webhooks/payment/route.ts tests/payment-webhook-handler.test.ts
git commit -m "refactor(payment): extrai processPaymentWebhookEvent do endpoint de webhook"
```

---

## Task 7: Webhook por conta `/api/webhooks/payment/mp/[accountId]`

**Files:**
- Create: `app/api/webhooks/payment/mp/[accountId]/route.ts`
- Modify: `app/api/webhooks/payment/route.ts` (shim MP → conta padrão)
- Test: `tests/payment-webhook-per-account.test.ts`

**Interfaces:**
- Consumes: `getPaymentAccountById` (Task 3), `getPaymentProvider(account)` (Task 4), `processPaymentWebhookEvent` (Task 6), `getDefaultPaymentAccount` (Task 3).

- [ ] **Step 1: Teste**

```ts
// tests/payment-webhook-per-account.test.ts
// Mocka @/lib/payment/account-resolver, @/lib/payment, @/lib/payment/webhook-handler,
// e o fetch global (fetchMPPaymentStatus).
// Casos:
//  - accountId inexistente (getPaymentAccountById lança) → 404
//  - assinatura inválida (provider.verifyWebhookSignature → false) → 401, handler NÃO chamado
//  - assinatura válida → processPaymentWebhookEvent chamado com accountId = params.accountId, status real re-consultado
//  - shim legado: POST /api/webhooks/payment com payload MP → resolve getDefaultPaymentAccount e chama o handler
//  - shim legado: payload Pagar.me → caminho inalterado (teste existente segue verde)
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/payment-webhook-per-account.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `mp/[accountId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getPaymentAccountById, NoPaymentAccountError } from "@/lib/payment/account-resolver";
import { getPaymentProvider } from "@/lib/payment";
import { processPaymentWebhookEvent } from "@/lib/payment/webhook-handler";
import { extractGatewayFeeAmount } from "@/lib/payment/mercadopago";

const MP_STATUS_MAP: Record<string, "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK"> = {
  approved: "PAID", cancelled: "CANCELLED", refunded: "REFUNDED",
  charged_back: "CHARGEBACK", rejected: "CANCELLED", expired: "EXPIRED",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  let account;
  try { account = await getPaymentAccountById(accountId); }
  catch (e) {
    if (e instanceof NoPaymentAccountError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw e;
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-signature") ?? req.headers.get("x-webhook-signature") ?? "";
  const provider = await getPaymentProvider(account);
  if (!(await provider.verifyWebhookSignature(rawBody, signature))) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Payload inválido" }, { status: 400 }); }

  const action = String(payload.action ?? "");
  const mpPaymentId = String((payload.data as Record<string, unknown>)?.id ?? "");
  if (!mpPaymentId) return NextResponse.json({ ok: true });

  let status: "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK" = "CANCELLED";
  let paidAt: string | undefined;
  let gatewayFeeAmount: number | undefined;
  if (action === "payment.updated" || action === "payment.created") {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      status = MP_STATUS_MAP[data.status] ?? "CANCELLED";
      paidAt = data.date_approved ?? undefined;
      gatewayFeeAmount = data.status === "approved" ? extractGatewayFeeAmount(data) : undefined;
    }
  } else {
    status = MP_STATUS_MAP[String(payload.status ?? "pending")] ?? "CANCELLED";
  }

  await processPaymentWebhookEvent({
    providerPaymentId: mpPaymentId, status, paidAt, gatewayFeeAmount, rawPayload: payload, accountId,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Implementar o shim** em `app/api/webhooks/payment/route.ts` — no branch MP, antes de chamar o handler:

```ts
// MP: usa a conta padrão (durante a migração o painel do MP ainda aponta pra cá)
try {
  const account = await getDefaultPaymentAccount();
  console.warn(`[webhook] endpoint legado usado — migrar o painel da conta ${account.label} para /api/webhooks/payment/mp/${account.id}`);
  // passa accountId undefined no handler (não força o match, é o caminho de compat)
} catch (e) {
  if (!(e instanceof NoPaymentAccountError)) throw e;
  // sem conta cadastrada → segue no caminho antigo com a setting global
}
```

(O shim NÃO passa `accountId` pro handler — o match só vale pro endpoint novo.)

- [ ] **Step 5: Rodar testes**

Run: `npx vitest run tests/payment-webhook-per-account.test.ts tests/payment-webhook-signature.test.ts tests/webhook-payment-alerts.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "app/api/webhooks/payment/mp/[accountId]/route.ts" app/api/webhooks/payment/route.ts tests/payment-webhook-per-account.test.ts
git commit -m "feat(payment): webhook por conta MP + shim no endpoint legado"
```

---

## Task 8: Estorno + conciliação + status usam a conta congelada

**Files:**
- Modify: `lib/payment/refund-service.ts:30`
- Modify: `lib/payment/check-mp-status.ts`
- Modify: `app/api/orders/[id]/status/route.ts:36-38`, `app/api/payments/mp-return/route.ts:39`
- Modify: `lib/payment/reconciliation.ts`
- Modify: `lib/payment/cancel-pending-manually.ts:26`
- Test: `tests/payment-refund-account.test.ts` (novo); `tests/payment-mercadopago-refund.test.ts` verde

**Interfaces:**
- Consumes: `getPaymentAccountById` (Task 3), `getPaymentProvider(account?)` (Task 4).

- [ ] **Step 1: Teste — refund usa a conta congelada, inclusive arquivada; sem conta → fallback global**

```ts
// tests/payment-refund-account.test.ts
// Mocka @/lib/db, @/lib/payment, @/lib/payment/account-resolver, @/lib/payment/sync-payment-status.
// Casos:
//  - payment.paymentAccountId = "acc_1" (arquivada) → getPaymentAccountById("acc_1") chamado,
//    getPaymentProvider chamado COM essa conta
//  - payment.paymentAccountId = null (pagamento antigo) → getPaymentProvider chamado SEM conta
//  - payment.provider = "pagarme" → getPaymentProvider SEM conta (nunca resolve PaymentAccount)
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/payment-refund-account.test.ts`
Expected: FAIL

- [ ] **Step 3: `refund-service.ts`**

```ts
const payment = await db.payment.findUnique({
  where: { id: params.paymentId },
  include: { order: { include: { registrations: true } }, adPurchase: true },
});
// ... validações ...
let account;
if (payment.provider === "mercadopago" && payment.paymentAccountId) {
  account = await getPaymentAccountById(payment.paymentAccountId);
}
const provider = await getPaymentProvider(account);
```

- [ ] **Step 4: `check-mp-status.ts`**

```ts
export async function checkMPPaymentStatus(
  providerPaymentId: string,
  accessToken?: string,
): Promise<"PAID" | "CANCELLED" | null> {
  const token = accessToken ?? (await getMercadoPagoAccessToken());
  if (!token) return null;
  // ... resto igual
}
```

Chamadores (`orders/[id]/status`, `payments/mp-return`): ambos já têm o `payment` — resolver a conta:

```ts
// orders/[id]/status/route.ts — dentro do bloco mercadopago:
const acc = payment.paymentAccountId
  ? await getPaymentAccountById(payment.paymentAccountId).catch(() => null)
  : null;
const mpStatus = await checkMPPaymentStatus(payment.providerPaymentId, acc?.accessToken);
```

`mp-return`: idem — busca o `payment` (`order.payments[0]`) e resolve.

- [ ] **Step 5: `reconciliation.ts`** — cache de provider por conta:

```ts
const providerCache = new Map<string | null, PaymentProvider>();
async function providerFor(payment: { provider: string; paymentAccountId: string | null }): Promise<PaymentProvider> {
  const key = payment.provider === "mercadopago" ? payment.paymentAccountId : null;
  if (!providerCache.has(key)) {
    const account = key ? await getPaymentAccountById(key).catch(() => undefined) : undefined;
    providerCache.set(key, await getPaymentProvider(account));
  }
  return providerCache.get(key)!;
}
```

E cada loop de `checkPendingMismatches` / `checkPaidMismatches` / `checkLateApprovalMismatches` passa a resolver o provider por pagamento (as queries desses helpers já retornam `provider` e agora incluem `paymentAccountId` no `select`). Passar `providerFor` pra dentro deles em vez do `provider` único.

- [ ] **Step 6: `cancel-pending-manually.ts`** — mesma resolução: busca `payment.paymentAccountId`, `getPaymentAccountById`, `getPaymentProvider(account)`.

- [ ] **Step 7: Rodar testes + typecheck**

Run: `npx vitest run tests/payment-refund-account.test.ts tests/payment-mercadopago-refund.test.ts tests/organizer-reconciliation-route.test.ts tests/orders-status-route.test.ts tests/payments-mp-return-route.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit
git add lib/payment/refund-service.ts lib/payment/check-mp-status.ts lib/payment/reconciliation.ts lib/payment/cancel-pending-manually.ts app/api/orders/[id]/status/route.ts app/api/payments/mp-return/route.ts tests/payment-refund-account.test.ts
git commit -m "feat(payment): estorno/conciliação/status usam a conta congelada do pagamento"
```

---

## Task 9: 2FA — novos tipos de ação sensível

**Files:**
- Modify: `lib/security/sensitive-action-verification.ts:7,15-19`
- Test: `tests/sensitive-action-verification.test.ts` (adicionar casos)

**Interfaces:**
- Produces: `SensitiveActionType` passa a incluir `"PAYMENT_ACCOUNT_CHANGE"` e `"BACKUP_IMPORT"`; `ACTION_LABEL` cobre os dois.

- [ ] **Step 1: Teste**

```ts
it("aceita PAYMENT_ACCOUNT_CHANGE e BACKUP_IMPORT com label pt-BR", async () => {
  // request + verify roundtrip pra PAYMENT_ACCOUNT_CHANGE, targetId "acc_1"
  // assert: e-mail enviado com actionLabel "Confirmação de alteração de conta de pagamento"
});
```

- [ ] **Step 2: Rodar — falha (tipo não existe)**

Run: `npx vitest run tests/sensitive-action-verification.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
export type SensitiveActionType =
  | "PAYMENT_REFUND"
  | "REGISTRATION_CANCELLATION_REFUND"
  | "REGISTRATION_CANCEL_CONFIRMED"
  | "PAYMENT_ACCOUNT_CHANGE"
  | "BACKUP_IMPORT";

const ACTION_LABEL: Record<SensitiveActionType, string> = {
  PAYMENT_REFUND: "Confirmação de estorno de pagamento",
  REGISTRATION_CANCELLATION_REFUND: "Confirmação de aprovação de cancelamento com estorno",
  REGISTRATION_CANCEL_CONFIRMED: "Confirmação de cancelamento de inscrição confirmada",
  PAYMENT_ACCOUNT_CHANGE: "Confirmação de alteração de conta de pagamento",
  BACKUP_IMPORT: "Confirmação de importação de backup",
};
```

- [ ] **Step 4: Rodar — passa** (`npx vitest run tests/sensitive-action-verification.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add lib/security/sensitive-action-verification.ts tests/sensitive-action-verification.test.ts
git commit -m "feat(2fa): tipos PAYMENT_ACCOUNT_CHANGE e BACKUP_IMPORT"
```

---

## Task 10: `lib/payment/payment-accounts.ts` — CRUD + invariante do default

**Files:**
- Modify: `lib/payment/payment-accounts.ts` (criado no Task 3)
- Test: `tests/payment-accounts-crud.test.ts`

**Interfaces:**
- Produces:
  - `async function listPaymentAccounts(): Promise<PaymentAccountDto[]>` — `PaymentAccountDto = { id, label, isDefault, archivedAt, hasAccessToken, hasWebhookSecret, hasPublicKey, webhookUrl }`
  - `async function createPaymentAccount(input: { label; accessToken; webhookSecret; publicKey?: string | null }): Promise<{ id: string }>` — primeira conta vira `isDefault: true`
  - `async function updatePaymentAccount(id, patch: { label?; accessToken?; webhookSecret?; publicKey? }): Promise<void>` — credencial só sobrescrita se não-vazia
  - `async function makeDefaultPaymentAccount(id): Promise<void>` — transação (rebaixa a antiga); lança se arquivada
  - `async function setPaymentAccountArchived(id, archived: boolean): Promise<void>` — lança ao arquivar a default

- [ ] **Step 1: Teste**

```ts
// tests/payment-accounts-crud.test.ts — mocka @/lib/db
// Casos:
//  - listPaymentAccounts: nunca devolve accessToken/webhookSecret; webhookUrl = `${APP_URL}/api/webhooks/payment/mp/${id}`
//  - createPaymentAccount: quando count()===0 → isDefault true; senão false
//  - updatePaymentAccount: patch com accessToken "" → NÃO inclui accessToken no data; com valor → inclui
//  - makeDefaultPaymentAccount: $transaction com updateMany({isDefault:false}) + update({id, isDefault:true})
//  - makeDefaultPaymentAccount de conta arquivada → throw
//  - setPaymentAccountArchived(id, true) numa conta isDefault → throw "promova outra conta antes"
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/payment-accounts-crud.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar** (acrescentar ao `payment-accounts.ts`)

```ts
import { db } from "@/lib/db";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";

export interface PaymentAccountDto {
  id: string; label: string; isDefault: boolean; archivedAt: Date | null;
  hasAccessToken: boolean; hasWebhookSecret: boolean; hasPublicKey: boolean; webhookUrl: string;
}

export async function listPaymentAccounts(): Promise<PaymentAccountDto[]> {
  const rows = await db.paymentAccount.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({
    id: r.id, label: r.label, isDefault: r.isDefault, archivedAt: r.archivedAt,
    hasAccessToken: !!r.accessToken, hasWebhookSecret: !!r.webhookSecret, hasPublicKey: !!r.publicKey,
    webhookUrl: `${APP_URL()}/api/webhooks/payment/mp/${r.id}`,
  }));
}

export async function createPaymentAccount(input: {
  label: string; accessToken: string; webhookSecret: string; publicKey?: string | null;
}): Promise<{ id: string }> {
  const count = await db.paymentAccount.count();
  const row = await db.paymentAccount.create({
    data: {
      label: input.label.trim(),
      accessToken: input.accessToken.trim(),
      webhookSecret: input.webhookSecret.trim(),
      publicKey: input.publicKey?.trim() || null,
      isDefault: count === 0,
    },
  });
  return { id: row.id };
}

export async function updatePaymentAccount(id: string, patch: {
  label?: string; accessToken?: string; webhookSecret?: string; publicKey?: string | null;
}): Promise<void> {
  const data: Record<string, string | null> = {};
  if (patch.label?.trim()) data.label = patch.label.trim();
  if (patch.accessToken?.trim()) data.accessToken = patch.accessToken.trim();
  if (patch.webhookSecret?.trim()) data.webhookSecret = patch.webhookSecret.trim();
  if (patch.publicKey !== undefined) data.publicKey = patch.publicKey?.trim() || null;
  await db.paymentAccount.update({ where: { id }, data });
}

export async function makeDefaultPaymentAccount(id: string): Promise<void> {
  const acc = await db.paymentAccount.findUnique({ where: { id } });
  if (!acc) throw new Error("Conta não encontrada");
  if (acc.archivedAt) throw new Error("Não é possível tornar padrão uma conta arquivada");
  await db.$transaction([
    db.paymentAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    db.paymentAccount.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export async function setPaymentAccountArchived(id: string, archived: boolean): Promise<void> {
  const acc = await db.paymentAccount.findUnique({ where: { id } });
  if (!acc) throw new Error("Conta não encontrada");
  if (archived && acc.isDefault) throw new Error("Promova outra conta a padrão antes de arquivar esta");
  await db.paymentAccount.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
}
```

- [ ] **Step 4: Rodar — passa** (`npx vitest run tests/payment-accounts-crud.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add lib/payment/payment-accounts.ts tests/payment-accounts-crud.test.ts
git commit -m "feat(payment): CRUD de PaymentAccount com invariante da conta padrão"
```

---

## Task 11: Rotas admin `/api/admin/payment-accounts` (com 2FA)

**Files:**
- Create: `app/api/admin/payment-accounts/route.ts`, `app/api/admin/payment-accounts/request-code/route.ts`, `app/api/admin/payment-accounts/[id]/route.ts`, `app/api/admin/payment-accounts/[id]/make-default/route.ts`, `app/api/admin/payment-accounts/[id]/archive/route.ts`
- Modify: `app/admin/assistentes/page.tsx` (actionKey `payment-accounts.manage`)
- Test: `tests/admin-payment-accounts-route.test.ts`

**Interfaces:**
- Consumes: `checkAdminOnlyApiPermission` (`lib/auth/rbac`), `requestSensitiveActionCode` / `verifySensitiveActionCode` (Task 9), `listPaymentAccounts` / `createPaymentAccount` / `updatePaymentAccount` / `makeDefaultPaymentAccount` / `setPaymentAccountArchived` (Task 10), `maskCredential` (Task 3).

- [ ] **Step 1: Teste**

```ts
// tests/admin-payment-accounts-route.test.ts — mocka @/lib/auth, @/lib/payment/payment-accounts,
// @/lib/security/sensitive-action-verification, @/lib/db (pra auditLog).
// Casos:
//  - GET não-admin → 403; admin → lista (sem credenciais no corpo)
//  - POST sem verificationId/code → 400
//  - POST com código inválido (verify → {ok:false}) → 400
//  - POST com código válido → createPaymentAccount chamado, auditLog PAYMENT_ACCOUNT_CREATED
//    com metadata.accessToken === "***"
//  - PATCH [id] mesma checagem de 2FA
//  - make-default / archive: 2FA; archive da default (setPaymentAccountArchived lança) → 400 com a msg
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/admin-payment-accounts-route.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `request-code/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;
  const body = await req.json().catch(() => ({}));
  const targetId = typeof body.targetId === "string" && body.targetId ? body.targetId : "new";
  const result = await requestSensitiveActionCode({
    userId: check.session.user.id, actionType: "PAYMENT_ACCOUNT_CHANGE", targetId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
```

- [ ] **Step 4: Implementar as rotas de ação**

Helper local em cada rota (ou um `lib/security/verify-2fa-body.ts` compartilhado — o implementer decide):

```ts
async function verify2fa(session, targetId: string, body: any) {
  if (typeof body.verificationId !== "string" || typeof body.code !== "string") {
    return { ok: false as const, response: NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 }) };
  }
  const v = await verifySensitiveActionCode({
    verificationId: body.verificationId, userId: session.user.id,
    actionType: "PAYMENT_ACCOUNT_CHANGE", targetId, code: body.code,
  });
  if (!v.ok) return { ok: false as const, response: NextResponse.json({ error: v.error, attemptsRemaining: v.attemptsRemaining }, { status: 400 }) };
  return { ok: true as const };
}
```

- `route.ts`: `GET` → `listPaymentAccounts()`. `POST` → valida `label`/`accessToken`/`webhookSecret` obrigatórios, `verify2fa(session, "new", body)`, `createPaymentAccount(...)`, `auditLog` `PAYMENT_ACCOUNT_CREATED` (`metadata: { label, accessToken: maskCredential(body.accessToken), webhookSecret: maskCredential(body.webhookSecret) }`).
- `[id]/route.ts` `PATCH` → `verify2fa(session, id, body)`, `updatePaymentAccount(id, {...})`, audit `PAYMENT_ACCOUNT_UPDATED`.
- `[id]/make-default/route.ts` `POST` → `verify2fa(session, id, body)`, `makeDefaultPaymentAccount(id)` (try/catch → 400), audit `PAYMENT_ACCOUNT_DEFAULT_CHANGED`.
- `[id]/archive/route.ts` `POST` → body `{ archived: boolean, verificationId, code }`, `verify2fa`, `setPaymentAccountArchived(id, archived)` (try/catch → 400), audit `PAYMENT_ACCOUNT_ARCHIVED` / `_UNARCHIVED`.

Todas: `checkAdminOnlyApiPermission("payment-accounts.manage")` no topo.

- [ ] **Step 5: actionKey no catálogo** — em `app/admin/assistentes/page.tsx`, no `ADMIN_EVENT_ACTIONS`:

```ts
  { key: "payment-accounts.manage", label: "Gerenciar contas Mercado Pago" },
```

- [ ] **Step 6: Rodar testes + typecheck + build**

Run: `npx vitest run tests/admin-payment-accounts-route.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/payment-accounts app/admin/assistentes/page.tsx tests/admin-payment-accounts-route.test.ts
git commit -m "feat(admin): rotas de contas Mercado Pago com 2FA"
```

---

## Task 12: Override de conta por evento + 2FA no backup/import

**Files:**
- Create: `app/api/admin/events/[id]/payment-account/route.ts` (+ `request-code`)
- Create: `app/api/admin/backup/import/request-code/route.ts`
- Modify: `app/api/admin/backup/import/route.ts:351-360`
- Test: `tests/admin-event-payment-account-route.test.ts`, `tests/admin-backup-import-2fa.test.ts`

**Interfaces:**
- Consumes: `checkAdminOnlyApiPermission`, `requestSensitiveActionCode` / `verifySensitiveActionCode` (Task 9), `db.paymentAccount` / `db.event`.

- [ ] **Step 1: Teste**

```ts
// tests/admin-event-payment-account-route.test.ts
//  - POST sem 2FA → 400
//  - POST { paymentAccountId: "acc_x", verificationId, code } válido, acc_x existe e não-arquivada
//    → db.event.update({ where:{id}, data:{ paymentAccountId: "acc_x" } }), audit EVENT_PAYMENT_ACCOUNT_CHANGED
//  - paymentAccountId: null → volta pro default (data.paymentAccountId = null)
//  - acc_x arquivada → 400
// tests/admin-backup-import-2fa.test.ts
//  - POST /api/admin/backup/import sem { verificationId, code } → 400, nada apagado
//  - com código inválido → 400
//  - request-code retorna verificationId
```

- [ ] **Step 2: Rodar — falha**

Run: `npx vitest run tests/admin-event-payment-account-route.test.ts tests/admin-backup-import-2fa.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `events/[id]/payment-account/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (typeof body.verificationId !== "string" || typeof body.code !== "string") {
    return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
  }
  const v = await verifySensitiveActionCode({
    verificationId: body.verificationId, userId: check.session.user.id,
    actionType: "PAYMENT_ACCOUNT_CHANGE", targetId: id, code: body.code,
  });
  if (!v.ok) return NextResponse.json({ error: v.error, attemptsRemaining: v.attemptsRemaining }, { status: 400 });

  const accountId: string | null = body.paymentAccountId ?? null;
  if (accountId !== null) {
    const acc = await db.paymentAccount.findUnique({ where: { id: accountId } });
    if (!acc || acc.archivedAt) return NextResponse.json({ error: "Conta inválida ou arquivada" }, { status: 400 });
  }
  await db.event.update({ where: { id }, data: { paymentAccountId: accountId } });
  await db.auditLog.create({
    data: { userId: check.session.user.id, action: "EVENT_PAYMENT_ACCOUNT_CHANGED", entityType: "Event", entityId: id, metadata: { paymentAccountId: accountId } },
  });
  return NextResponse.json({ ok: true });
}
```

`request-code` irmão: `requestSensitiveActionCode({ actionType: "PAYMENT_ACCOUNT_CHANGE", targetId: id })`.

- [ ] **Step 4: `backup/import/route.ts`** — logo após o check de admin:

```ts
const body0 = await req.clone().json().catch(() => ({}));  // o corpo real do backup é lido depois; aqui só o 2FA
// OU: o front manda { verificationId, code } no header/query e o arquivo no body — o implementer
// escolhe o mais simples dado como o form de import monta o request hoje. Se hoje é multipart,
// pegar verificationId/code de req.headers ("x-verification-id" / "x-verification-code").
```

Regra: sem `verificationId`/`code` válidos (`verifySensitiveActionCode({ actionType: "BACKUP_IMPORT", targetId: "backup" })`) → 400 antes de qualquer `deleteMany`/`createMany`. `request-code` novo em `app/api/admin/backup/import/request-code/route.ts`.

- [ ] **Step 5: Rodar testes**

Run: `npx vitest run tests/admin-event-payment-account-route.test.ts tests/admin-backup-import-2fa.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/events/[id]/payment-account app/api/admin/backup/import tests/admin-event-payment-account-route.test.ts tests/admin-backup-import-2fa.test.ts
git commit -m "feat(admin): override de conta por evento + 2FA no backup/import"
```

---

## Task 13: UI admin — `PaymentAccountsManager` + strip do `PaymentGatewayForm` + select no evento

**Files:**
- Create: `components/admin/PaymentAccountsManager.tsx`, `components/admin/PaymentAccountFormModal.tsx`, `components/admin/EventPaymentAccountSelect.tsx`
- Modify: `app/admin/configuracoes/page.tsx`, `components/admin/PaymentGatewayForm.tsx`
- Modify: painel admin de edição de evento (localizar: `grep -rl "SetPlatformFeeForm\|events/\[id\]" app/admin` — a página que edita um evento no admin)
- Test: sem teste de UI (convenção do projeto). Rodar `npm run build`.

**Interfaces:**
- Consumes: rotas do Task 11 e 12; `useSensitiveActionVerification` (`lib/hooks/use-sensitive-action-verification`), `CodeVerificationModal`, `ConfirmModal`, `ErrorModal`.

- [ ] **Step 1: `PaymentAccountFormModal.tsx`** — modal com campos `label`, `accessToken` (password, placeholder "deixe em branco para manter"), `webhookSecret` (idem), `publicKey`. Mostra o `webhookUrl` da conta (quando editando) num bloco destacado com botão "Copiar". `onSubmit(values)` → o pai dispara o fluxo de 2FA.

- [ ] **Step 2: `PaymentAccountsManager.tsx`** — recebe `accounts: PaymentAccountDto[]` (server component busca via `listPaymentAccounts()`). Tabela: label, ⭐ default, badge "Arquivada", status (`Token ✓ / Webhook ✓ / Public key —`). Botões: "Nova conta", e por linha "Editar" / "Tornar padrão" / "Arquivar"/"Desarquivar". Cada ação:
  1. abre `ConfirmModal` (ou direto o form pra criar/editar);
  2. no confirm, usa `useSensitiveActionVerification({ requestCodeEndpoint, confirmEndpoint })` com o `targetId` certo (`"new"` pra criar, `id` pra o resto) — o hook aceita `requestCodeEndpoint` que faz POST com `{ targetId }` no corpo;
  3. `CodeVerificationModal` pro código;
  4. `submitCode(code, extraPayload)` manda o payload da ação junto.
  Reusar exatamente o padrão de `components/admin/RefundPaymentButton.tsx`.

  > NOTA de implementação: o hook `useSensitiveActionVerification` hoje faz o request-code sem corpo. Se ele não aceitar um `body` no request-code, estender o hook pra aceitar `requestCodeBody?: object` (mudança retrocompatível — os usos atuais não passam nada). Verificar em `lib/hooks/use-sensitive-action-verification.ts`.

- [ ] **Step 3: `app/admin/configuracoes/page.tsx`** — `import { listPaymentAccounts }`, buscar no `Promise.all`, renderizar `<PaymentAccountsManager accounts={paymentAccounts} />` num card novo "Contas Mercado Pago" logo antes/depois do `PaymentGatewayForm`. Remover do `Promise.all` os `getSetting("mp_access_token"|"mp_webhook_secret"|"mp_public_key")` e as props correspondentes passadas ao `PaymentGatewayForm`.

- [ ] **Step 4: `components/admin/PaymentGatewayForm.tsx`** — remover os campos `accessToken` / `webhookSecret` / `mpPublicKey` e as props `accessTokenConfigured` / `webhookSecretConfigured` / `mpPublicKeyConfigured`. O bloco `if (provider === "mercadopago")` do `handleSubmit` só salva `payment_provider`. Adicionar uma linha: *"As credenciais do Mercado Pago ficam em **Contas Mercado Pago**."* Pagar.me inalterado.

- [ ] **Step 5: `EventPaymentAccountSelect.tsx` + painel do evento** — select com `accounts` não-arquivadas + opção `""` = "(padrão da plataforma: <labelDefault>)". `value` = `event.paymentAccountId ?? ""`. Ao mudar e salvar → fluxo de 2FA (request-code em `/api/admin/events/[id]/payment-account/request-code`, confirm em `/api/admin/events/[id]/payment-account` com `{ paymentAccountId }`). Se `event.paymentAccount?.archivedAt` → aviso "conta arquivada" acima do select. Inserir o componente na página admin de edição do evento.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`

- [ ] **Step 7: Commit**

```bash
git add components/admin/PaymentAccountsManager.tsx components/admin/PaymentAccountFormModal.tsx components/admin/EventPaymentAccountSelect.tsx app/admin/configuracoes/page.tsx components/admin/PaymentGatewayForm.tsx lib/hooks/use-sensitive-action-verification.ts
git commit -m "feat(admin): UI de contas Mercado Pago + select de conta no evento"
```

---

## Task 14: Verificação final + PROGRESSO

**Files:**
- Modify: `PROGRESSO.md`, `docs/superpowers/specs/2026-08-29-multiplas-contas-mercadopago-design.md` (marcar §5 conforme coberto)

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run`
Expected: tudo verde. Corrigir mocks de testes existentes que quebraram por: (a) `getPaymentProvider` agora aceitar arg (não deve quebrar — arg opcional); (b) `Payment.paymentAccountId` no `select` de testes que fazem `toHaveBeenCalledWith` estrito no `db.payment.create`; (c) `card-config` mudou de assinatura.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: limpo.

- [ ] **Step 3: Revisão adversarial (grep) — registrar cada check no report**

- `grep -rn "getMercadoPagoAccessToken\|getMercadoPagoWebhookSecret\|getMercadoPagoPublicKey" lib/ app/` — só em `lib/payment-settings.ts` (definição), `lib/payment/mercadopago.ts` (fallback sem conta), `lib/payment/check-mp-status.ts` (fallback), e o `card-config` (branch sem eventId). **Nenhum uso novo** em rota de checkout/webhook por conta.
- `grep -rn "new MercadoPagoProvider()" lib/ app/` — só onde é fallback intencional (shim legado, refund de pagamento sem conta).
- `grep -rn "accessToken\|webhookSecret" app/api/admin/payment-accounts` — nunca num `NextResponse.json` de resposta; só em `maskCredential(...)` no audit.
- Webhook por conta: sem `webhookSecret` da conta → `verifyWebhookSignature` retorna false → 401 (fail-closed). Confirmar.
- `Payment.paymentAccountId` é gravado em TODOS os `db.payment.create` de MP (checkout, checkout-ads, anunciante/solicitar).
- Migração: rodar `backfillPaymentAccounts` 2x seguidas num banco de teste → 2ª vez `{ created: false }`.
- Pagar.me: `grep` nos testes `payment-webhook-pagarme*` e `payment-mercadopago*` — todos verdes, zero mudança de comportamento.

- [ ] **Step 4: PROGRESSO.md** — nova entrada no topo: sub-projeto B concluído, arquivos principais, resultado de `vitest`/`tsc`/`build`. **PRÓXIMA TAREFA:** deploy (`git pull` → `docker build` → `prisma db push` do schema → `npx tsx prisma/backfill-payment-accounts.ts` dentro do container → restart), e depois o roteiro operacional do §6 da spec (admin migra o webhook da conta principal no painel do MP, cadastra as outras contas). Depois: sub-projeto C.

- [ ] **Step 5: Commit**

```bash
git add PROGRESSO.md docs/superpowers/specs/2026-08-29-multiplas-contas-mercadopago-design.md
git commit -m "docs: conclui sub-projeto B (múltiplas contas Mercado Pago) — verificação + PROGRESSO"
```

---

## Self-Review

**1. Spec coverage:**

| Spec (seção) | Task |
|---|---|
| §1.1 `PaymentAccount` model | Task 1 |
| §1.2 `Event.paymentAccountId` | Task 1 |
| §1.3 `Payment.paymentAccountId` congelado | Task 1 (schema) + Task 5 (grava no checkout) |
| §1.4 migração + backfill "Mercado Pago Principal" | Task 1 (DDL) + Task 2 (dados) |
| §1.5 `account-resolver` (`resolveEventPaymentAccount`/`getDefaultPaymentAccount`/`getPaymentAccountById`/`NoPaymentAccountError`) | Task 3 |
| §2.1 `getPaymentProvider(account?)` + `MercadoPagoProvider(account?)` | Task 4 |
| §2.2 checkout resolve+congela; card-config `?eventId`; checkout-ads default | Task 5 |
| §2.3 webhook `/mp/[accountId]` (404/401/match de conta) | Task 7 (+ handler no Task 6) |
| §2.4 shim legado | Task 7 |
| §2.5 estorno pela conta congelada | Task 8 |
| §2.6 `check-mp-status` + conciliação por conta | Task 8 |
| §3.1 2FA `PAYMENT_ACCOUNT_CHANGE` / `BACKUP_IMPORT` | Task 9 |
| §3.2 rotas `/api/admin/payment-accounts` (GET/POST/PATCH/make-default/archive) + actionKey | Task 10 (lib) + Task 11 (rotas) |
| §3.3 override por evento com 2FA | Task 12 |
| §3.4 2FA no backup/import | Task 12 |
| §3.5 UI: `PaymentAccountsManager`, strip `PaymentGatewayForm`, select no evento | Task 13 |
| §4 casos de borda (sem default → 503; accountId inválido → 404; webhook de outra conta → ignora; conta arquivada; primeira conta = default; make-default de arquivada → 400) | Tasks 3, 7, 10, 11 (testes) |
| §5 testes | Tasks 1–13 (cada uma) + Task 14 (suíte) |
| §6 migração operacional | Task 14 Step 4 (documenta no PROGRESSO) |
| §7 fora de escopo | não implementado (correto) |

Sem lacunas.

**2. Placeholder scan:** Os pontos onde o plano diz "o implementer copia a estrutura de mocks de `tests/checkout-route.test.ts`" (Task 5 Step 1) e "o implementer escolhe o mais simples dado como o form de import monta o request" (Task 12 Step 4) são decisões de implementação legítimas com o contrato explícito ao lado (as 3 asserções / a regra "sem código → 400 antes de qualquer deleteMany"). Task 13 não tem código completo porque é UI sem teste — os componentes a criar, suas props e o padrão a reusar (`RefundPaymentButton.tsx`) estão nomeados.

**3. Type consistency:**
- `ResolvedPaymentAccount` — definido Task 3, consumido Tasks 4, 5, 7, 8 com os mesmos campos (`id`, `accessToken`, `webhookSecret`, `publicKey`, `label`, `archived`).
- `NoPaymentAccountError` — Task 3; capturado Tasks 5, 7, 8.
- `getPaymentProvider(account?)` — Task 4; usado Tasks 5, 7, 8.
- `MercadoPagoProvider(account?)` — Task 4.
- `processPaymentWebhookEvent(event)` / `ParsedWebhookEvent` (com `accountId?`) — Task 6; usado Task 7.
- `SensitiveActionType` += `PAYMENT_ACCOUNT_CHANGE` / `BACKUP_IMPORT` — Task 9; usado Tasks 11, 12.
- `PaymentAccountDto` — Task 10; usado Task 11 (GET) e Task 13 (UI).
- `listPaymentAccounts` / `createPaymentAccount` / `updatePaymentAccount` / `makeDefaultPaymentAccount` / `setPaymentAccountArchived` / `maskCredential` — Task 10 (`maskCredential` no Task 3); usados Task 11.
- actionKey `payment-accounts.manage` — Task 11; consumido Task 11 e Task 12.
- `checkMPPaymentStatus(id, accessToken?)` — Task 8; assinatura retrocompatível.

Sem inconsistências.
