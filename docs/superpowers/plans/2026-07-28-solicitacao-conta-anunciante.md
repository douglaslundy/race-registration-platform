# Solicitação de conta de anunciante (pagamento antes da aprovação) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o autosserviço instantâneo de anunciante por um fluxo de solicitação com
pagamento prévio do plano e aprovação manual do admin — a conta só vira `ADVERTISER` depois que o
admin aprova a solicitação já paga.

**Architecture:** Reaproveita ao máximo a infraestrutura de pagamento de plano de anúncio já
existente (`createAdPlanCheckout`, gateway de pagamento, webhook). O papel do usuário nunca muda
sozinho — só o admin decide, via 2 rotas novas de aprovação/rejeição. Um novo status intermediário
(`AdPurchase.status = "PENDING_APPROVAL"`) substitui o salto direto `PENDING → PAID` quando quem
está comprando ainda não é `ADVERTISER`.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Zod, react-hook-form, Vitest.

## Global Constraints

- TDD em toda função de `lib/` e rota de API nova ou modificada. `db` já vem mockado globalmente
  via `tests/setup.ts` — não precisa de `vi.mock("@/lib/db")` em cada teste.
- Nunca usar `alert()`/`confirm()`/`window.prompt()` — reaproveitar `components/ui/ConfirmModal.tsx`
  (`showNoteField`/`noteRequired` pro motivo de rejeição) e `components/ui/ErrorModal.tsx`, mesmo
  padrão já usado em `PrivateAdModerationRow.tsx`.
- CNPJ/CPF e endereço são obrigatórios no formulário de solicitação; Instagram e Facebook são
  opcionais.
- Rejeição de uma solicitação **nunca apaga** o `AdvertiserProfile` — ele fica órfão (sem
  `AdPurchase` aprovado ativo) pra reaproveitar numa tentativa futura da mesma pessoa.
- `register-advertiser` (autosserviço instantâneo) é **removido** por completo — promoção manual
  pelo admin (`promoteToAdvertiser()`) continua existindo, fora de escopo deste plano.
- Papel do usuário (`role`) só muda pra `ADVERTISER` no momento em que o admin aprova — nunca antes.
- E-mails novos reaproveitam o padrão `layout()`/`sendMail()` já usado em
  `sendAdvertiserPromotionEmail` (`lib/email.ts`).
- Alerta imediato ao admin segue o padrão já estabelecido em
  `lib/alerts/cancellation-requested.ts` (settings próprias em `lib/alerts/alert-settings.ts`,
  dedupe via `claimAlert`/`unclaimAlert`, fire-and-forget que nunca lança).

---

## Parte A — Schema

### Task 1: Migração — campos novos em `AdvertiserProfile` e `AdPurchase`

**Files:**
- Modify: `prisma/schema.prisma` (models `AdvertiserProfile` e `AdPurchase`)
- Create: `prisma/migrations/20260728000000_add_advertiser_request_fields/migration.sql`

**Interfaces:**
- Produces: `AdvertiserProfile.document`/`address`/`instagram`/`facebook`,
  `AdPurchase.rejectionReason` — consumidos pelas Tasks 8, 9, 12, 13.

- [ ] **Step 1: Editar o schema**

Em `prisma/schema.prisma`, no `model AdvertiserProfile` (perto da linha 652), depois de
`contactPhone String`, adicionar:

```prisma
  document     String?
  address      String?
  instagram    String?
  facebook     String?
```

**Importante**: `document`/`address` são `String?` (nullable) no banco, não `String` — apesar de
serem obrigatórios no formulário de solicitação (decisão do usuário, aplicada via Zod na Task 8,
não no schema). Torná-los `NOT NULL` no banco quebraria 3 call sites existentes que criam
`AdvertiserProfile` sem esses campos e continuam fora de escopo deste plano:
`app/api/anunciante/profile/route.ts`, `app/api/auth/register-advertiser/route.ts` (só até a
Task 14 remover) e, mais importante, `lib/advertisers/promote.ts` (fluxo de promoção manual pelo
admin, que o plano exige continuar funcionando como está).

No `model AdPurchase` (perto da linha 682), depois de `status String`, adicionar:

```prisma
  rejectionReason String?
```

- [ ] **Step 2: Criar a migração**

Criar `prisma/migrations/20260728000000_add_advertiser_request_fields/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "advertiser_profiles"
  ADD COLUMN "document" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "instagram" TEXT,
  ADD COLUMN "facebook" TEXT;

-- AlterTable
ALTER TABLE "ad_purchases" ADD COLUMN "rejectionReason" TEXT;
```

- [ ] **Step 3: Rodar `npx prisma generate`**

Run: `npx prisma generate`
Expected: sem erros, client atualizado com os campos novos.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260728000000_add_advertiser_request_fields
git commit -m "feat: campos de documento/endereco/redes sociais no perfil de anunciante"
```

---

## Parte B — Confirmação de pagamento, alerta ao admin e reembolso

### Task 2: `lib/document-validation.ts` — valida CPF ou CNPJ

**Files:**
- Create: `lib/document-validation.ts`
- Test: `tests/lib-document-validation.test.ts`

**Interfaces:**
- Produces: `isValidDocument(raw: string): boolean` — consumido pela Task 8.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-document-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isValidDocument } from "@/lib/document-validation";

describe("isValidDocument", () => {
  it("aceita CPF válido (com ou sem formatação)", () => {
    expect(isValidDocument("111.444.777-35")).toBe(true);
    expect(isValidDocument("11144477735")).toBe(true);
  });

  it("rejeita CPF inválido", () => {
    expect(isValidDocument("111.111.111-11")).toBe(false);
    expect(isValidDocument("123.456.789-00")).toBe(false);
  });

  it("aceita CNPJ válido (com ou sem formatação)", () => {
    expect(isValidDocument("11.222.333/0001-81")).toBe(true);
    expect(isValidDocument("11222333000181")).toBe(true);
  });

  it("rejeita CNPJ inválido", () => {
    expect(isValidDocument("11.111.111/1111-11")).toBe(false);
  });

  it("rejeita string vazia ou com tamanho errado", () => {
    expect(isValidDocument("")).toBe(false);
    expect(isValidDocument("123")).toBe(false);
    expect(isValidDocument("123456789012345")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-document-validation.test.ts`
Expected: FAIL — `@/lib/document-validation` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/document-validation.ts`:

```ts
function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function isValidCpf(raw: string): boolean {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const dv1 = calcCheckDigit(digits, 9);
  const dv2 = calcCheckDigit(digits, 10);
  return dv1 === digits[9] && dv2 === digits[10];
}

function isValidCnpj(raw: string): boolean {
  const cnpj = onlyDigits(raw);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const digits = cnpj.split("").map(Number);
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const dv1 = calcCnpjCheckDigit(digits.slice(0, 12), weights1);
  const dv2 = calcCnpjCheckDigit(digits.slice(0, 12).concat(dv1), weights2);
  return dv1 === digits[12] && dv2 === digits[13];
}

function calcCheckDigit(digits: number[], length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += digits[i] * (length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function calcCnpjCheckDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, digit, i) => acc + digit * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidDocument(raw: string): boolean {
  const digits = onlyDigits(raw);
  if (digits.length === 11) return isValidCpf(raw);
  if (digits.length === 14) return isValidCnpj(raw);
  return false;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-document-validation.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/document-validation.ts tests/lib-document-validation.test.ts
git commit -m "feat: isValidDocument valida CPF ou CNPJ com digito verificador"
```

---

### Task 3: `confirmAdPurchasePayment` — não vira `ADVERTISER` sem aprovação

**Files:**
- Modify: `lib/ads/ad-purchase-confirmation.ts`
- Modify: `tests/lib-ad-purchase-confirmation.test.ts`

**Interfaces:**
- Consumes: nenhuma nova.
- Produces: `ConfirmAdPurchaseResult.wentToPendingApproval?: boolean` — consumido pela Task 4.

- [ ] **Step 1: Ler o teste existente**

Ler `tests/lib-ad-purchase-confirmation.test.ts` por completo antes de editar — os casos
existentes (advertiser já com `role: "ADVERTISER"`) devem continuar passando exatamente como
estão, sem nenhuma mudança de asserção.

- [ ] **Step 2: Adicionar os testes que falham**

No arquivo `tests/lib-ad-purchase-confirmation.test.ts`, garantir que os mocks de
`payment.adPurchase.advertiser.user` já incluam `role: "ADVERTISER"` nos testes existentes (ajustar
se ainda não tiverem — sem isso os testes antigos vão quebrar depois do Step 3, já que o novo
branch depende desse campo). Adicionar os 2 testes novos:

```ts
  it("primeira compra de quem ainda não é ADVERTISER vai pra PENDING_APPROVAL, não pra PAID", async () => {
    const payment = {
      id: "payment-1",
      status: "PENDING",
      adPurchase: {
        id: "purchase-1",
        status: "PENDING",
        adPlan: { name: "Plano Básico", durationDays: 30 },
        advertiser: { user: { name: "Fulano", email: "fulano@example.com", role: "ATHLETE" } },
      },
    };

    const result = await confirmAdPurchasePayment(txMock, payment, "PAID");

    expect(txMock.adPurchase.update).toHaveBeenCalledWith({
      where: { id: "purchase-1" },
      data: { status: "PENDING_APPROVAL" },
    });
    expect(result).toEqual({
      changed: true,
      wentToPendingApproval: true,
      advertiserEmail: "fulano@example.com",
      advertiserName: "Fulano",
      planName: "Plano Básico",
    });
  });

  it("é idempotente: não repete a transição pra PENDING_APPROVAL se o webhook duplicar o evento", async () => {
    const payment = {
      id: "payment-1",
      status: "PENDING",
      adPurchase: {
        id: "purchase-1",
        status: "PENDING_APPROVAL",
        adPlan: { name: "Plano Básico", durationDays: 30 },
        advertiser: { user: { name: "Fulano", email: "fulano@example.com", role: "ATHLETE" } },
      },
    };

    const result = await confirmAdPurchasePayment(txMock, payment, "PAID");

    expect(txMock.adPurchase.update).not.toHaveBeenCalled();
    expect(result).toEqual({ changed: false });
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-ad-purchase-confirmation.test.ts`
Expected: FAIL — os 2 testes novos falham (o comportamento atual sempre vai pra `"PAID"`,
independente do `role`).

- [ ] **Step 4: Implementar**

Em `lib/ads/ad-purchase-confirmation.ts`, trocar a interface `AdPurchaseConfirmationPayment` (o
`user` dentro de `advertiser`) e a lógica do corpo da função:

```ts
import type { Prisma, PaymentStatus } from "@prisma/client";

interface AdPurchaseConfirmationPayment {
  id: string;
  status: string;
  adPurchase: {
    id: string;
    status: string;
    adPlan: { name: string; durationDays: number };
    advertiser: { user: { name: string; email: string; role: string } };
  };
}

interface ConfirmAdPurchaseResult {
  changed: boolean;
  wentToPendingApproval?: boolean;
  advertiserEmail?: string;
  advertiserName?: string;
  planName?: string;
  endAt?: Date;
}

/**
 * Confirma (ou apenas sincroniza o status de) um pagamento de compra de plano de anúncio
 * (`AdPurchase`). Chamado pelo webhook de pagamento quando `payment.adPurchaseId` está
 * preenchido — nunca toca em `Order`/`Registration`. Espelha o guard de status obsoleto/terminal
 * e o padrão de transação de `applyGatewayStatus` (lib/payment/sync-payment-status.ts): recebe o
 * `payment` já carregado e o `tx` da transação, só usa o client para escrever.
 *
 * Quem já é ADVERTISER comprando plano adicional/renovação vai direto pra "PAID" (comportamento
 * original). Quem ainda não é ADVERTISER (primeira solicitação, aguardando aprovação do admin) vai
 * pra "PENDING_APPROVAL" em vez de "PAID" — o papel do usuário só muda quando o admin aprova
 * (ver Task 12).
 */
export async function confirmAdPurchasePayment(
  tx: Prisma.TransactionClient,
  payment: AdPurchaseConfirmationPayment,
  newStatus: string,
): Promise<ConfirmAdPurchaseResult> {
  if (newStatus === payment.status) return { changed: false };
  if (payment.status === "REFUNDED" || payment.status === "CHARGEBACK") return { changed: false };

  await tx.payment.update({
    where: { id: payment.id },
    data: { status: newStatus as PaymentStatus },
  });

  if (newStatus !== "PAID") return { changed: false };
  if (payment.adPurchase.status === "PAID" || payment.adPurchase.status === "PENDING_APPROVAL") {
    return { changed: false }; // idempotente, webhook pode repetir
  }

  const isAlreadyAdvertiser = payment.adPurchase.advertiser.user.role === "ADVERTISER";

  if (!isAlreadyAdvertiser) {
    await tx.adPurchase.update({
      where: { id: payment.adPurchase.id },
      data: { status: "PENDING_APPROVAL" },
    });
    return {
      changed: true,
      wentToPendingApproval: true,
      advertiserEmail: payment.adPurchase.advertiser.user.email,
      advertiserName: payment.adPurchase.advertiser.user.name,
      planName: payment.adPurchase.adPlan.name,
    };
  }

  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + payment.adPurchase.adPlan.durationDays * 24 * 60 * 60 * 1000);

  await tx.adPurchase.update({
    where: { id: payment.adPurchase.id },
    data: { status: "PAID", startAt, endAt },
  });

  return {
    changed: true,
    advertiserEmail: payment.adPurchase.advertiser.user.email,
    advertiserName: payment.adPurchase.advertiser.user.name,
    planName: payment.adPurchase.adPlan.name,
    endAt,
  };
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-ad-purchase-confirmation.test.ts`
Expected: PASS (todos os testes, incluindo os já existentes ajustados no Step 2)

- [ ] **Step 6: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam — atenção especial a `tests/payment-webhook-ad-purchase.test.ts`,
que pode ter mocks de `confirmAdPurchasePayment`/`payment.adPurchase.advertiser.user` sem o campo
`role` — ajustar se necessário pra não quebrar.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/ads/ad-purchase-confirmation.ts tests/lib-ad-purchase-confirmation.test.ts
git commit -m "feat: primeira compra de anunciante vai para PENDING_APPROVAL, nao PAID direto"
```

---

### Task 4: `lib/alerts/advertiser-request-pending.ts` — alerta imediato ao admin

**Files:**
- Create: `lib/alerts/advertiser-request-pending.ts`
- Test: `tests/lib-advertiser-request-pending.test.ts`
- Modify: `lib/alerts/alert-settings.ts`
- Modify: `lib/email.ts`
- Modify: `app/api/webhooks/payment/route.ts:116-130` (região do `include`/`confirmAdPurchasePayment`)

**Interfaces:**
- Consumes: `confirmAdPurchasePayment` (Task 3, campo `wentToPendingApproval`), `claimAlert`/
  `unclaimAlert` (`lib/alerts/dedupe.ts`, já existentes), `sendWhatsAppMessage` (`lib/whatsapp.ts`,
  já existente).
- Produces: `notifyAdvertiserRequestPending(adPurchaseId: string): Promise<void>` — consumido pela
  Task 5 (wiring no webhook).

- [ ] **Step 1: Adicionar as settings do alerta**

Em `lib/alerts/alert-settings.ts`, depois da seção de `CancellationAlertSettings`
(perto da linha 90), adicionar:

```ts
export interface AdvertiserRequestAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
}

export async function getAdvertiserRequestAlertSettings(): Promise<AdvertiserRequestAlertSettings> {
  const [emailEnabled, whatsappEnabled] = await Promise.all([
    getSetting("alert_advertiser_request_email_enabled"),
    getSetting("alert_advertiser_request_whatsapp_enabled"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
  };
}
```

- [ ] **Step 2: Adicionar o e-mail em `lib/email.ts`**

Depois de `sendAdvertiserPromotionEmail` (perto da linha 354), adicionar:

```ts
/** E-mail pro admin avisando de uma nova solicitação de conta de anunciante aguardando aprovação. */
export async function sendAdvertiserRequestPendingEmail(params: {
  to: string;
  companyName: string;
  planName: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/admin/anunciantes/solicitacoes`;
  await sendMail({
    to: params.to,
    subject: `Nova solicitação de anunciante — ${appName}`,
    html: layout(
      appName,
      `<p>Uma nova solicitação de conta de anunciante chegou e está aguardando aprovação.</p>
       <p><strong>Empresa:</strong> ${params.companyName}<br/>
          <strong>Plano:</strong> ${params.planName}</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver solicitações pendentes</a></p>`
    ),
  });
}
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `tests/lib-advertiser-request-pending.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/alerts/alert-settings", () => ({ getAdvertiserRequestAlertSettings: vi.fn() }));
vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAdvertiserRequestPendingEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/alerts/dedupe", () => ({ claimAlert: vi.fn(), unclaimAlert: vi.fn() }));

import { notifyAdvertiserRequestPending } from "@/lib/alerts/advertiser-request-pending";
import { getAdvertiserRequestAlertSettings } from "@/lib/alerts/alert-settings";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAdvertiserRequestPendingEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { claimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const PURCHASE = {
  id: "purchase-1",
  advertiser: { companyName: "Empresa X" },
  adPlan: { name: "Plano Básico" },
};

describe("notifyAdvertiserRequestPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdvertiserRequestAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true });
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(claimAlert).mockResolvedValue(true);
    dbMock.adPurchase.findUnique.mockResolvedValue(PURCHASE);
    dbMock.user.findMany.mockResolvedValue([{ email: "admin@example.com", phone: "5511999999999" }]);
  });

  it("não faz nada se os 2 canais estiverem desligados", async () => {
    vi.mocked(getAdvertiserRequestAlertSettings).mockResolvedValueOnce({ emailEnabled: false, whatsappEnabled: false });
    await notifyAdvertiserRequestPending("purchase-1");
    expect(sendAdvertiserRequestPendingEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("envia e-mail e whatsapp pra todos os admins", async () => {
    await notifyAdvertiserRequestPending("purchase-1");

    expect(sendAdvertiserRequestPendingEmail).toHaveBeenCalledWith({
      to: "admin@example.com",
      companyName: "Empresa X",
      planName: "Plano Básico",
    });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      expect.stringContaining("Empresa X"),
    );
  });

  it("nunca lança, mesmo se o envio falhar", async () => {
    vi.mocked(sendAdvertiserRequestPendingEmail).mockRejectedValueOnce(new Error("smtp down"));
    await expect(notifyAdvertiserRequestPending("purchase-1")).resolves.toBeUndefined();
  });

  it("não faz nada se a compra não existir", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce(null);
    await notifyAdvertiserRequestPending("purchase-1");
    expect(sendAdvertiserRequestPendingEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-advertiser-request-pending.test.ts`
Expected: FAIL — `@/lib/alerts/advertiser-request-pending` não existe.

- [ ] **Step 4: Implementar**

Criar `lib/alerts/advertiser-request-pending.ts`:

```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAdvertiserRequestPendingEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAdvertiserRequestAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const ALERT_TYPE = "ADVERTISER_REQUEST_PENDING";

/**
 * Avisa todos os admins que uma nova solicitação de conta de anunciante (já paga) está
 * aguardando aprovação. Seguro para "fire-and-forget": nunca lança e ignora silenciosamente
 * canais desligados ou não configurados. Mesmo padrão de lib/alerts/cancellation-requested.ts.
 */
export async function notifyAdvertiserRequestPending(adPurchaseId: string): Promise<void> {
  try {
    const settings = await getAdvertiserRequestAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const purchase = await db.adPurchase.findUnique({
      where: { id: adPurchaseId },
      select: {
        id: true,
        advertiser: { select: { companyName: true } },
        adPlan: { select: { name: true } },
      },
    });
    if (!purchase) return;

    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { email: true, phone: true } });

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        for (const admin of admins) {
          const claimed = await claimAlert(ALERT_TYPE, "AdPurchase", `${adPurchaseId}:${admin.email}`, "EMAIL");
          if (!claimed) continue;
          try {
            await sendAdvertiserRequestPendingEmail({
              to: admin.email,
              companyName: purchase.advertiser.companyName,
              planName: purchase.adPlan.name,
            });
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, `${adPurchaseId}:${admin.email}`, "EMAIL");
            console.error("[notifyAdvertiserRequestPending] email failed for", admin.email, err);
          }
        }
      }
    }

    if (settings.whatsappEnabled) {
      for (const admin of admins) {
        if (!admin.phone) continue;
        const claimed = await claimAlert(ALERT_TYPE, "AdPurchase", `${adPurchaseId}:${admin.phone}`, "WHATSAPP");
        if (!claimed) continue;
        try {
          await sendWhatsAppMessage(
            admin.phone,
            `Nova solicitação de anunciante: ${purchase.advertiser.companyName} (plano ${purchase.adPlan.name}). Acesse o painel pra aprovar ou rejeitar.`,
          );
        } catch (err) {
          await unclaimAlert(ALERT_TYPE, `${adPurchaseId}:${admin.phone}`, "WHATSAPP");
          console.error("[notifyAdvertiserRequestPending] whatsapp failed for", admin.phone, err);
        }
      }
    }
  } catch (err) {
    console.error("[notifyAdvertiserRequestPending] failed:", err);
  }
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-advertiser-request-pending.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 6: Wire no webhook de pagamento**

Em `app/api/webhooks/payment/route.ts`, adicionar o import:

```ts
import { notifyAdvertiserRequestPending } from "@/lib/alerts/advertiser-request-pending";
```

Logo depois da chamada de `confirmAdPurchasePayment` dentro da transação (perto da linha 130),
adicionar (fora da transação, depois que ela resolver, já que envio de e-mail/whatsapp não deve
fazer parte da transação de banco):

```ts
    if (result.wentToPendingApproval) {
      await notifyAdvertiserRequestPending(adPurchase.id);
    }
```

Ler o arquivo completo antes de editar pra confirmar o formato exato da variável que guarda o
resultado da transação (`result`) e o escopo de `adPurchase.id` nesse ponto do arquivo.

- [ ] **Step 7: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add lib/alerts/advertiser-request-pending.ts lib/alerts/alert-settings.ts lib/email.ts \
  tests/lib-advertiser-request-pending.test.ts app/api/webhooks/payment/route.ts
git commit -m "feat: alerta imediato ao admin quando uma solicitacao de anunciante fica pendente"
```

---

### Task 5: `refundPayment()` — aceita reembolso de `AdPurchase`

**Files:**
- Modify: `lib/payment/refund-service.ts`
- Modify: `tests/refund-service.test.ts`

**Interfaces:**
- Consumes: nenhuma nova.
- Produces: `refundPayment()` continua com a mesma assinatura pública, mas aceita pagamentos com
  `adPurchaseId` preenchido (antes só aceitava `orderId`) — consumido pela Task 13.

- [ ] **Step 1: Ler o teste existente por completo**

Ler `tests/refund-service.test.ts` por completo antes de editar — os casos hoje existentes
(pagamento de `Order`) devem continuar passando sem nenhuma mudança de asserção. O código completo
do arquivo `lib/payment/refund-service.ts` (antes e depois desta mudança) já está no Step 4 abaixo.

- [ ] **Step 2: Adicionar os testes que falham**

No arquivo de teste existente, adicionar (usando o mesmo padrão de mock já usado nos testes
vizinhos daquele arquivo pra `getPaymentProvider`/`checkPaymentStatus`):

```ts
  it("estorna pagamento de AdPurchase e atualiza o status pra REJECTED_REFUNDED", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "payment-1",
      status: "PAID",
      providerPaymentId: "pp-1",
      orderId: null,
      adPurchaseId: "purchase-1",
      order: null,
      adPurchase: { id: "purchase-1", status: "REJECTED" },
    });
    // reaproveitar o mock de getPaymentProvider/checkPaymentStatus já configurado nos testes
    // vizinhos deste arquivo pra simular sucesso do estorno no gateway.

    const result = await refundPayment({ paymentId: "payment-1", initiatedByUserId: "admin-1" });

    expect(result.alreadySynced).toBe(false);
    expect(dbMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "payment-1" }, data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
  });

  it("lança quando o pagamento não tem nem order nem adPurchase associado", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "payment-1",
      status: "PAID",
      providerPaymentId: "pp-1",
      orderId: null,
      adPurchaseId: null,
      order: null,
      adPurchase: null,
    });

    await expect(
      refundPayment({ paymentId: "payment-1", initiatedByUserId: "admin-1" }),
    ).rejects.toThrow("Pagamento sem pedido ou compra de anúncio associado");
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/refund-service.test.ts`
Expected: FAIL — o guard atual (`if (!payment.order || !payment.orderId) throw ...`) rejeita o
caso de `AdPurchase` mesmo com o gateway confirmando o estorno.

- [ ] **Step 4: Implementar**

Trocar o arquivo inteiro `lib/payment/refund-service.ts` por (o `applyGatewayStatus` é
específico de `Order`/`Registration` — não dá pra chamar com um `AdPurchase`, então o branch de
"já estava estornado no gateway, só sincronizar" também precisa se ramificar; a atualização de
`order`/`registrations` no fim da função vira condicional a `order` existir; quem decide o que
fazer com `AdPurchase.status` depois do reembolso é quem chama `refundPayment()` — a Task 12 já
marca `status: "REJECTED"` antes de chamar o reembolso, então esta função não precisa tocar em
`AdPurchase` além de ler o `payment.adPurchaseId` pro `AuditLog`):

```ts
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { applyGatewayStatus } from "./sync-payment-status";

export interface RefundPaymentParams {
  paymentId: string;
  initiatedByUserId: string;
  reason?: string;
}

export interface RefundPaymentResult {
  alreadySynced: boolean;
}

export async function refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
  const payment = await db.payment.findUnique({
    where: { id: params.paymentId },
    include: { order: { include: { registrations: true } }, adPurchase: true },
  });

  if (!payment) throw new Error("Pagamento não encontrado");
  if (payment.status !== "PAID") throw new Error("Só é possível estornar pagamentos com status Pago");
  if (!payment.providerPaymentId) throw new Error("Pagamento sem referência no gateway");
  if (!payment.order && !payment.adPurchase) {
    throw new Error("Pagamento sem pedido ou compra de anúncio associado");
  }
  const order = payment.order;
  const orderId = payment.orderId;

  const provider = await getPaymentProvider();

  const { status: gatewayStatus } = await provider.checkPaymentStatus(payment.providerPaymentId);
  if (gatewayStatus === "REFUNDED" || gatewayStatus === "CHARGEBACK") {
    await db.$transaction(async (tx) => {
      if (order) {
        await applyGatewayStatus(tx, payment, order, order.registrations, gatewayStatus, "refund_check");
      } else {
        await tx.payment.update({ where: { id: payment.id }, data: { status: gatewayStatus } });
      }
    });
    return { alreadySynced: true };
  }

  const result = await provider.refundPayment({ providerPaymentId: payment.providerPaymentId });

  await db.$transaction(async (tx) => {
    await tx.refund.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        reason: params.reason,
        status: "PROCESSED",
        processedAt: new Date(),
        providerRefundId: result.providerRefundId,
        initiatedByUserId: params.initiatedByUserId,
      },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });

    if (order) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: "REFUNDED" },
      });

      for (const registration of order.registrations) {
        if (registration.status === "CONFIRMED") {
          await tx.registration.update({
            where: { id: registration.id },
            data: { status: "CANCELLED" },
          });
          await tx.ticketBatch.update({
            where: { id: registration.ticketBatchId },
            data: { soldCount: { decrement: 1 } },
          });
        }
      }
    }

    await tx.auditLog.create({
      data: {
        userId: params.initiatedByUserId,
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: payment.id,
        metadata: order
          ? { orderId, amount: payment.amount, reason: params.reason ?? null }
          : { adPurchaseId: payment.adPurchaseId, amount: payment.amount, reason: params.reason ?? null },
      },
    });
  });

  return { alreadySynced: false };
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/refund-service.test.ts`
Expected: PASS (todos os testes, incluindo os já existentes)

- [ ] **Step 6: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/payment/refund-service.ts tests/refund-service.test.ts
git commit -m "feat: refundPayment aceita estorno de pagamento de plano de anunciante"
```

---

### Task 6: E-mails de aprovação/rejeição de solicitação

**Files:**
- Modify: `lib/email.ts`
- Test: `tests/lib-email-advertiser-request.test.ts`

**Interfaces:**
- Produces: `sendAdvertiserRequestApprovedEmail(params)`, `sendAdvertiserRequestRejectedEmail(params)`
  — consumidos pelas Tasks 12 e 13.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-email-advertiser-request.test.ts` (mesmo padrão de mock de baixo nível já usado
em `tests/lib-email.test.ts` — `nodemailer`, `@/lib/smtp-settings`, `@/lib/message-logs` — pra
testar o HTML de verdade gerado por `layout()`, sem mockar `sendMail` diretamente):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock, verify: vi.fn() })) },
}));
vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/message-logs", () => ({ recordMessageLog: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppName: vi.fn() }));

import { sendAdvertiserRequestApprovedEmail, sendAdvertiserRequestRejectedEmail } from "@/lib/email";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { getAppName } from "@/lib/settings";

const smtpConfig = { host: "smtp.example.com", port: 587, user: "u", pass: "p", from: "noreply@example.com", secure: false };

describe("sendAdvertiserRequestApprovedEmail / sendAdvertiserRequestRejectedEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getAppName).mockResolvedValue("Circuito das Corridas");
    sendMailMock.mockResolvedValue({ messageId: "msg-1" });
  });

  it("envia e-mail de aprovação com o nome do plano", async () => {
    await sendAdvertiserRequestApprovedEmail({ to: "empresa@example.com", name: "Fulano", planName: "Plano Básico" });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "empresa@example.com",
        subject: expect.stringContaining("aprovada"),
        html: expect.stringContaining("Plano Básico"),
      }),
    );
  });

  it("envia e-mail de rejeição com o motivo e menção ao reembolso", async () => {
    await sendAdvertiserRequestRejectedEmail({ to: "empresa@example.com", name: "Fulano", reason: "Dados inconsistentes" });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "empresa@example.com",
        subject: expect.stringContaining("não aprovada"),
        html: expect.stringContaining("Dados inconsistentes"),
      }),
    );
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).toMatch(/estorn|reembols/i);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-email-advertiser-request.test.ts`
Expected: FAIL — as 2 funções não existem em `lib/email.ts`.

- [ ] **Step 3: Implementar**

Em `lib/email.ts`, depois de `sendAdvertiserRequestPendingEmail` (criada na Task 4), adicionar:

```ts
/** E-mail pro anunciante avisando que a solicitação de conta foi aprovada. */
export async function sendAdvertiserRequestApprovedEmail(params: {
  to: string;
  name: string;
  planName: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/anunciante`;
  await sendMail({
    to: params.to,
    subject: `Sua solicitação de anunciante foi aprovada — ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Sua solicitação de conta de anunciante (plano <strong>${params.planName}</strong>) foi
          <strong>aprovada</strong>! Sua conta já está liberada como anunciante.</p>
       <p>Use seu login e senha de sempre para acessar o painel de anunciante:</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Acessar painel do anunciante</a></p>`
    ),
  });
}

/** E-mail pro anunciante avisando que a solicitação de conta foi rejeitada (com estorno). */
export async function sendAdvertiserRequestRejectedEmail(params: {
  to: string;
  name: string;
  reason: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Sua solicitação de anunciante não foi aprovada — ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Sua solicitação de conta de anunciante não foi aprovada.</p>
       <p><strong>Motivo:</strong> ${params.reason}</p>
       <p>O valor pago já foi estornado automaticamente e deve aparecer no seu extrato em alguns
          dias úteis, conforme o meio de pagamento utilizado.</p>`
    ),
  });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-email-advertiser-request.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts tests/lib-email-advertiser-request.test.ts
git commit -m "feat: e-mails de aprovacao e rejeicao da solicitacao de anunciante"
```

---

## Parte C — Solicitação + pagamento (rota pública)

### Task 7: `lib/advertisers/request-advertiser.ts` — cria/reaproveita conta e perfil

**Files:**
- Create: `lib/advertisers/request-advertiser.ts`
- Test: `tests/lib-request-advertiser.test.ts`

**Interfaces:**
- Consumes: `hasValidMxRecord` (`lib/validate-email-domain.ts`, já existente), `isValidDocument`
  (Task 2).
- Produces: `requestAdvertiserAccount(input): Promise<RequestAdvertiserResult>` — consumido pela
  Task 8.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-request-advertiser.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/validate-email-domain", () => ({ hasValidMxRecord: vi.fn() }));

import { requestAdvertiserAccount } from "@/lib/advertisers/request-advertiser";
import { hasValidMxRecord } from "@/lib/validate-email-domain";

const dbMock = db as any;

const PROFILE_INPUT = {
  companyName: "Empresa X",
  document: "111.444.777-35",
  address: "Rua Teste, 123",
  contactEmail: "contato@empresa.com",
  contactPhone: "11999999999",
  instagram: "@empresax",
  facebook: null,
};

describe("requestAdvertiserAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasValidMxRecord).mockResolvedValue(true);
  });

  it("cria conta nova (ATHLETE) + AdvertiserProfile quando não há sessão", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(dbMock));
    dbMock.user.create.mockResolvedValueOnce({ id: "user-1", email: "novo@example.com" });
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce(null);
    dbMock.advertiserProfile.create.mockResolvedValueOnce({ id: "adv-1" });

    const result = await requestAdvertiserAccount({
      existingUserId: null,
      newAccount: { name: "Fulano", email: "novo@example.com", password: "senha1234" },
      profile: PROFILE_INPUT,
    });

    expect(result).toEqual({ ok: true, userId: "user-1", advertiserId: "adv-1" });
    expect(dbMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "novo@example.com", role: "ATHLETE" }) }),
    );
  });

  it("retorna erro quando o e-mail da conta nova já existe", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "existing" });

    const result = await requestAdvertiserAccount({
      existingUserId: null,
      newAccount: { name: "Fulano", email: "ja-existe@example.com", password: "senha1234" },
      profile: PROFILE_INPUT,
    });

    expect(result).toEqual({ ok: false, error: "E-mail já cadastrado", status: 409 });
  });

  it("retorna erro quando o documento (CPF/CNPJ) é inválido", async () => {
    const result = await requestAdvertiserAccount({
      existingUserId: null,
      newAccount: { name: "Fulano", email: "novo@example.com", password: "senha1234" },
      profile: { ...PROFILE_INPUT, document: "000.000.000-00" },
    });

    expect(result).toEqual({ ok: false, error: "CPF ou CNPJ inválido", status: 400 });
  });

  it("reaproveita usuário já logado (não cria conta nova, não cria AdvertiserProfile duplicado)", async () => {
    dbMock.advertiserProfile.findUnique.mockResolvedValueOnce({ id: "adv-existente" });
    dbMock.advertiserProfile.update.mockResolvedValueOnce({ id: "adv-existente" });

    const result = await requestAdvertiserAccount({
      existingUserId: "user-logado",
      newAccount: null,
      profile: PROFILE_INPUT,
    });

    expect(result).toEqual({ ok: true, userId: "user-logado", advertiserId: "adv-existente" });
    expect(dbMock.advertiserProfile.update).toHaveBeenCalledWith({
      where: { id: "adv-existente" },
      data: expect.objectContaining({ companyName: "Empresa X" }),
    });
    expect(dbMock.advertiserProfile.create).not.toHaveBeenCalled();
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-request-advertiser.test.ts`
Expected: FAIL — `@/lib/advertisers/request-advertiser` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/advertisers/request-advertiser.ts`:

```ts
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { hasValidMxRecord } from "@/lib/validate-email-domain";
import { isValidDocument } from "@/lib/document-validation";

export interface AdvertiserProfileInput {
  companyName: string;
  document: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  instagram?: string | null;
  facebook?: string | null;
}

export interface RequestAdvertiserInput {
  existingUserId: string | null;
  newAccount: { name: string; email: string; password: string } | null;
  profile: AdvertiserProfileInput;
}

export type RequestAdvertiserResult =
  | { ok: true; userId: string; advertiserId: string }
  | { ok: false; error: string; status: number };

/**
 * Cria (visitante anônimo) ou reaproveita (sessão já logada) a conta do usuário, e cria ou
 * atualiza o AdvertiserProfile correspondente — nunca muda o `role` do usuário aqui (isso só
 * acontece quando o admin aprova a solicitação, ver Task 12). Se o perfil já existir (ex.:
 * tentativa anterior rejeitada, perfil ficou órfão), atualiza os dados em vez de duplicar.
 */
export async function requestAdvertiserAccount(
  input: RequestAdvertiserInput,
): Promise<RequestAdvertiserResult> {
  if (!isValidDocument(input.profile.document)) {
    return { ok: false, error: "CPF ou CNPJ inválido", status: 400 };
  }

  let userId: string;

  if (input.existingUserId) {
    userId = input.existingUserId;
  } else {
    if (!input.newAccount) {
      return { ok: false, error: "Dados da conta são obrigatórios", status: 400 };
    }

    if (!(await hasValidMxRecord(input.newAccount.email))) {
      return { ok: false, error: "Domínio de e-mail inválido ou inexistente", status: 400 };
    }

    const exists = await db.user.findUnique({ where: { email: input.newAccount.email } });
    if (exists) {
      return { ok: false, error: "E-mail já cadastrado", status: 409 };
    }

    const passwordHash = await bcrypt.hash(input.newAccount.password, 12);
    const user = await db.user.create({
      data: {
        name: input.newAccount.name,
        email: input.newAccount.email,
        passwordHash,
        role: "ATHLETE",
      },
      select: { id: true },
    });
    userId = user.id;
  }

  const existingProfile = await db.advertiserProfile.findUnique({ where: { userId } });

  const profileData = {
    companyName: input.profile.companyName,
    document: input.profile.document,
    address: input.profile.address,
    contactEmail: input.profile.contactEmail,
    contactPhone: input.profile.contactPhone,
    instagram: input.profile.instagram ?? null,
    facebook: input.profile.facebook ?? null,
  };

  const advertiserProfile = existingProfile
    ? await db.advertiserProfile.update({ where: { id: existingProfile.id }, data: profileData })
    : await db.advertiserProfile.create({ data: { userId, ...profileData } });

  return { ok: true, userId, advertiserId: advertiserProfile.id };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-request-advertiser.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/advertisers/request-advertiser.ts tests/lib-request-advertiser.test.ts
git commit -m "feat: requestAdvertiserAccount cria ou reaproveita conta e perfil de anunciante"
```

---

### Task 8: `POST /api/anunciante/solicitar` — solicitação + checkout num só passo

**Files:**
- Create: `app/api/anunciante/solicitar/route.ts`
- Test: `tests/anunciante-solicitar-route.test.ts`

**Interfaces:**
- Consumes: `requestAdvertiserAccount` (Task 7), `createAdPlanCheckout` (`lib/checkout-ads.ts`, já
  existente), `getPaymentProvider`/`getPaymentProviderSetting` (já existentes).
- Produces: `POST /api/anunciante/solicitar` — body `{ newAccount?: {name,email,password},
  profile: {...}, adPlanId: string, paymentMethod: "PIX"|"CREDIT_CARD"|"BOLETO", cardToken?,
  cardBrand?, installments? }` → `200 { adPurchaseId, status, pixQrCode?, pixQrCodeText?,
  boletoUrl?, checkoutUrl? }` — consumido pela Task 9.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/anunciante-solicitar-route.test.ts` (reaproveitar o padrão exato de mock de
`getPaymentProvider`/`getPaymentProviderSetting` já usado em `tests/checkout-ads-route.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/advertisers/request-advertiser", () => ({ requestAdvertiserAccount: vi.fn() }));
vi.mock("@/lib/checkout-ads", () => ({ createAdPlanCheckout: vi.fn() }));
vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({ getPaymentProviderSetting: vi.fn() }));

import { POST } from "@/app/api/anunciante/solicitar/route";
import { requestAdvertiserAccount } from "@/lib/advertisers/request-advertiser";
import { createAdPlanCheckout } from "@/lib/checkout-ads";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentProviderSetting } from "@/lib/payment-settings";

const authMock = vi.mocked(auth);
const dbMock = db as any;

const PROFILE = {
  companyName: "Empresa X",
  document: "111.444.777-35",
  address: "Rua Teste, 123",
  contactEmail: "contato@empresa.com",
  contactPhone: "11999999999",
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/anunciante/solicitar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/anunciante/solicitar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue(null as any);
  });

  it("retorna 400 quando visitante anônimo não envia dados de conta nova", async () => {
    const res = await POST(makeRequest({ profile: PROFILE, adPlanId: "plan-1", paymentMethod: "PIX" }));
    expect(res.status).toBe(400);
    expect(requestAdvertiserAccount).not.toHaveBeenCalled();
  });

  it("retorna erro da conta/perfil quando requestAdvertiserAccount falha", async () => {
    vi.mocked(requestAdvertiserAccount).mockResolvedValueOnce({ ok: false, error: "E-mail já cadastrado", status: 409 });

    const res = await POST(makeRequest({
      newAccount: { name: "Fulano", email: "ja@existe.com", password: "senha1234" },
      profile: PROFILE, adPlanId: "plan-1", paymentMethod: "PIX",
    }));

    expect(res.status).toBe(409);
    expect(createAdPlanCheckout).not.toHaveBeenCalled();
  });

  it("cria conta+perfil+compra e chama o gateway com sucesso (visitante anônimo)", async () => {
    vi.mocked(requestAdvertiserAccount).mockResolvedValueOnce({ ok: true, userId: "user-1", advertiserId: "adv-1" });
    vi.mocked(createAdPlanCheckout).mockResolvedValueOnce({ adPurchaseId: "purchase-1", totalAmount: 9900 });
    const createPayment = vi.fn().mockResolvedValueOnce({ providerPaymentId: "pp-1", status: "PENDING", pixQrCodeText: "00020101..." });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ createPayment } as any);
    vi.mocked(getPaymentProviderSetting).mockResolvedValueOnce("MERCADO_PAGO" as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(makeRequest({
      newAccount: { name: "Fulano", email: "novo@example.com", password: "senha1234" },
      profile: PROFILE, adPlanId: "plan-1", paymentMethod: "PIX",
    }));

    expect(createAdPlanCheckout).toHaveBeenCalledWith("adv-1", "plan-1");
    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ orderId: "purchase-1", amount: 9900, method: "PIX" }));
    expect(dbMock.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ adPurchaseId: "purchase-1" }) });
    expect(res.status).toBe(200);
  });

  it("reaproveita a sessão já logada, ignora newAccount se enviado por engano", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-logado", name: "Fulano", email: "fulano@example.com", role: "ATHLETE" } } as any);
    vi.mocked(requestAdvertiserAccount).mockResolvedValueOnce({ ok: true, userId: "user-logado", advertiserId: "adv-2" });
    vi.mocked(createAdPlanCheckout).mockResolvedValueOnce({ adPurchaseId: "purchase-2", totalAmount: 4900 });
    const createPayment = vi.fn().mockResolvedValueOnce({ providerPaymentId: "pp-2", status: "PENDING" });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ createPayment } as any);
    vi.mocked(getPaymentProviderSetting).mockResolvedValueOnce("MERCADO_PAGO" as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-2" });

    const res = await POST(makeRequest({ profile: PROFILE, adPlanId: "plan-2", paymentMethod: "PIX" }));

    expect(requestAdvertiserAccount).toHaveBeenCalledWith(
      expect.objectContaining({ existingUserId: "user-logado", newAccount: null }),
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/anunciante-solicitar-route.test.ts`
Expected: FAIL — a rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/anunciante/solicitar/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requestAdvertiserAccount } from "@/lib/advertisers/request-advertiser";
import { createAdPlanCheckout } from "@/lib/checkout-ads";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentProviderSetting } from "@/lib/payment-settings";
import type { PaymentMethod } from "@prisma/client";

const profileSchema = z.object({
  companyName: z.string().min(2).max(150),
  document: z.string().min(11).max(18),
  address: z.string().min(5).max(200),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8).max(20),
  instagram: z.string().max(100).optional().nullable(),
  facebook: z.string().max(100).optional().nullable(),
});

const schema = z.object({
  newAccount: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8),
  }).optional(),
  profile: profileSchema,
  adPlanId: z.string().min(1),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
  cardToken: z.string().optional(),
  cardBrand: z.string().optional(),
  installments: z.number().int().min(1).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!session?.user && !parsed.data.newAccount) {
    return NextResponse.json({ error: "Dados da conta são obrigatórios" }, { status: 400 });
  }

  const accountResult = await requestAdvertiserAccount({
    existingUserId: session?.user?.id ?? null,
    newAccount: session?.user ? null : parsed.data.newAccount!,
    profile: parsed.data.profile,
  });

  if (!accountResult.ok) {
    return NextResponse.json({ error: accountResult.error }, { status: accountResult.status });
  }

  let checkout;
  try {
    checkout = await createAdPlanCheckout(accountResult.advertiserId, parsed.data.adPlanId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao processar solicitação";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const buyerName = session?.user?.name ?? parsed.data.newAccount?.name ?? parsed.data.profile.companyName;
  const buyerEmail = session?.user?.email ?? parsed.data.newAccount?.email ?? parsed.data.profile.contactEmail;

  const provider = await getPaymentProvider();
  const idempotencyKey = `${checkout.adPurchaseId}_${parsed.data.paymentMethod}_${randomUUID()}`;

  const paymentResult = await provider.createPayment({
    orderId: checkout.adPurchaseId,
    amount: checkout.totalAmount,
    method: parsed.data.paymentMethod,
    idempotencyKey,
    buyer: { name: buyerName, email: buyerEmail },
    description: `Solicitação de conta de anunciante — plano`,
    cardToken: parsed.data.cardToken,
    cardBrand: parsed.data.cardBrand,
    installments: parsed.data.installments,
  });

  const providerKey = await getPaymentProviderSetting();

  await db.payment.create({
    data: {
      adPurchaseId: checkout.adPurchaseId,
      provider: providerKey,
      providerPaymentId: paymentResult.providerPaymentId,
      method: parsed.data.paymentMethod as PaymentMethod,
      status: paymentResult.status,
      amount: checkout.totalAmount,
      pixQrCodeText: paymentResult.pixQrCodeText,
      boletoUrl: paymentResult.boletoUrl,
      expiresAt: paymentResult.expiresAt ? new Date(paymentResult.expiresAt) : null,
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

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/anunciante-solicitar-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/anunciante/solicitar/route.ts tests/anunciante-solicitar-route.test.ts
git commit -m "feat: rota unica de solicitacao + checkout de conta de anunciante"
```

---

## Parte D — UI pública

### Task 9: `components/advertiser/RequestAdvertiserForm.tsx`

**Files:**
- Create: `components/advertiser/RequestAdvertiserForm.tsx`

**Interfaces:**
- Consumes: `POST /api/anunciante/solicitar` (Task 8).

Sem teste automatizado (Client Component, convenção do projeto).

- [ ] **Step 1: Implementar**

Criar `components/advertiser/RequestAdvertiserForm.tsx`:

```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";

const schema = z.object({
  name: z.string().min(2, "Nome muito curto").optional(),
  email: z.string().email("E-mail inválido").optional(),
  password: z.string().min(8, "Mínimo 8 caracteres").optional(),
  companyName: z.string().min(2, "Nome muito curto"),
  document: z.string().min(11, "CPF ou CNPJ inválido"),
  address: z.string().min(5, "Endereço muito curto"),
  contactEmail: z.string().email("E-mail de contato inválido"),
  contactPhone: z.string().min(8, "Telefone inválido"),
  instagram: z.string().optional(),
  facebook: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function RequestAdvertiserForm({
  adPlanId,
  isLoggedIn,
}: {
  adPlanId: string;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setError(null);

    const newAccount = isLoggedIn
      ? undefined
      : { name: data.name!, email: data.email!, password: data.password! };

    const res = await fetch("/api/anunciante/solicitar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newAccount,
        profile: {
          companyName: data.companyName,
          document: data.document,
          address: data.address,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          instagram: data.instagram || null,
          facebook: data.facebook || null,
        },
        adPlanId,
        paymentMethod: "PIX",
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Erro ao enviar solicitação");
      return;
    }

    router.push("/anuncie/enviado");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!isLoggedIn && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Seu nome *</label>
            <input {...register("name")} className="input-field" placeholder="Seu nome" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de acesso *</label>
            <input type="email" {...register("email")} className="input-field" placeholder="seu@email.com" />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha *</label>
            <input type="password" {...register("password")} className="input-field" placeholder="Mínimo 8 caracteres" />
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Razão social / nome fantasia *</label>
        <input {...register("companyName")} className="input-field" />
        {errors.companyName && <p className="text-red-500 text-xs mt-1">{errors.companyName.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ ou CPF *</label>
        <input {...register("document")} className="input-field" placeholder="00.000.000/0000-00" />
        {errors.document && <p className="text-red-500 text-xs mt-1">{errors.document.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Endereço *</label>
        <input {...register("address")} className="input-field" placeholder="Rua, número, cidade/UF" />
        {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de contato comercial *</label>
        <input type="email" {...register("contactEmail")} className="input-field" placeholder="contato@empresa.com" />
        {errors.contactEmail && <p className="text-red-500 text-xs mt-1">{errors.contactEmail.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Telefone de contato *</label>
        <input type="tel" {...register("contactPhone")} className="input-field" placeholder="(11) 99999-9999" />
        {errors.contactPhone && <p className="text-red-500 text-xs mt-1">{errors.contactPhone.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Instagram (opcional)</label>
        <input {...register("instagram")} className="input-field" placeholder="@suaempresa" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Facebook (opcional)</label>
        <input {...register("facebook")} className="input-field" placeholder="facebook.com/suaempresa" />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? "Enviando..." : "Solicitar conta de anunciante e pagar"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/advertiser/RequestAdvertiserForm.tsx
git commit -m "feat: formulario de solicitacao de conta de anunciante"
```

---

### Task 10: `app/(public)/anuncie/page.tsx` — página pública de planos

**IMPORTANTE — achado da autorrevisão do plano**: `app/anuncie/layout.tsx` NÃO existe, mas
`app/anunciante/layout.tsx` **existe e exige `session.user.role === "ADVERTISER"` pra qualquer
página sob `/anunciante/*`** (`redirect("/acesso-negado")` caso contrário). Por isso as páginas
novas desta task **não podem** ficar sob `/anunciante/*` — ficam em `app/(public)/anuncie/` (grupo
de rotas já usado por outras páginas genuinamente públicas como `/eventos`, `/termos`), resolvendo
pra URL `/anuncie` (sem gate de autenticação — confirmar em `app/(public)/layout.tsx` que só
compõe `Header`/`Footer`, sem `requireAuth()`).

**Files:**
- Create: `app/(public)/anuncie/page.tsx`
- Create: `app/(public)/anuncie/enviado/page.tsx`

**Interfaces:**
- Consumes: `RequestAdvertiserForm` (Task 9).

Sem teste automatizado (Server Component, convenção do projeto).

- [ ] **Step 1: Implementar a página de planos**

Criar `app/(public)/anuncie/page.tsx`:

```tsx
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import RequestAdvertiserForm from "@/components/advertiser/RequestAdvertiserForm";

export const metadata: Metadata = { title: "Anuncie no site" };
export const dynamic = "force-dynamic";

export default async function AnunciePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user) && session?.user.role !== "ADVERTISER";

  const plans = await db.adPlan.findMany({ where: { active: true }, orderBy: { priceAmount: "asc" } });

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Anuncie no site</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Escolha um plano, envie os dados da sua empresa e faça o pagamento. Sua conta de
          anunciante é liberada assim que aprovarmos a solicitação.
        </p>
      </div>

      {plans.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">Nenhum plano disponível no momento.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="card space-y-2">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="text-2xl font-bold text-primary-700 dark:text-primary-400">
                {formatCurrency(plan.priceAmount)}
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>Duração: {plan.durationDays} dias</li>
                <li>Posições simultâneas: {plan.maxSimultaneousSlots}</li>
              </ul>
            </div>
          ))}
        </div>
      )}

      {plans.length > 0 && (
        <div className="card max-w-2xl">
          <h2 className="text-lg font-semibold mb-4">Dados da solicitação</h2>
          <RequestAdvertiserForm adPlanId={plans[0].id} isLoggedIn={isLoggedIn} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implementar a página de confirmação**

Criar `app/(public)/anuncie/enviado/page.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Solicitação enviada" };

export default function SolicitacaoEnviadaPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
      <h1 className="text-2xl font-bold">Solicitação enviada!</h1>
      <p className="text-gray-600 dark:text-gray-400">
        Recebemos sua solicitação e seu pagamento está sendo processado. Assim que confirmarmos o
        pagamento, sua solicitação entra em análise — você recebe um e-mail assim que for aprovada
        ou rejeitada.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo (aceitável a falha conhecida de `/sitemap.xml` por falta de acesso ao banco
neste ambiente de dev, se ocorrer — não é bloqueante, mesma limitação já documentada em sessões
anteriores).

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/anuncie/page.tsx" "app/(public)/anuncie/enviado/page.tsx"
git commit -m "feat: pagina publica de solicitacao de conta de anunciante"
```

---

## Parte E — Aprovação/rejeição pelo admin

### Task 11: `POST /api/admin/anunciantes/[purchaseId]/approve`

**Files:**
- Create: `app/api/admin/anunciantes/[purchaseId]/approve/route.ts`
- Test: `tests/admin-anunciantes-approve-route.test.ts`

**Interfaces:**
- Consumes: `sendAdvertiserRequestApprovedEmail` (Task 6).
- Produces: `POST /api/admin/anunciantes/:purchaseId/approve` → `200 { ok: true }` — consumido
  pela Task 13.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-anunciantes-approve-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAdvertiserRequestApprovedEmail: vi.fn() }));

import { POST } from "@/app/api/admin/anunciantes/[purchaseId]/approve/route";
import { sendAdvertiserRequestApprovedEmail } from "@/lib/email";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/admin/anunciantes/purchase-1/approve", { method: "POST" }) as any;
}

describe("POST /api/admin/anunciantes/[purchaseId]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando a compra não existe ou não está PENDING_APPROVAL", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(404);
  });

  it("aprova: marca PAID com startAt/endAt, muda role pra ADVERTISER e envia e-mail", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      adPlan: { name: "Plano Básico", durationDays: 30 },
      advertiser: { userId: "user-1", user: { name: "Fulano", email: "fulano@example.com" } },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ purchaseId: "purchase-1" }) });

    expect(dbMock.adPurchase.update).toHaveBeenCalledWith({
      where: { id: "purchase-1" },
      data: expect.objectContaining({ status: "PAID" }),
    });
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "ADVERTISER" },
    });
    expect(sendAdvertiserRequestApprovedEmail).toHaveBeenCalledWith({
      to: "fulano@example.com",
      name: "Fulano",
      planName: "Plano Básico",
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-anunciantes-approve-route.test.ts`
Expected: FAIL — a rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/admin/anunciantes/[purchaseId]/approve/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendAdvertiserRequestApprovedEmail } from "@/lib/email";

export async function POST(req: NextRequest, { params }: { params: Promise<{ purchaseId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { purchaseId } = await params;

  const purchase = await db.adPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      adPlan: { select: { name: true, durationDays: true } },
      advertiser: { select: { userId: true, user: { select: { name: true, email: true } } } },
    },
  });
  if (!purchase || purchase.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
  }

  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + purchase.adPlan.durationDays * 24 * 60 * 60 * 1000);

  await db.adPurchase.update({ where: { id: purchaseId }, data: { status: "PAID", startAt, endAt } });
  await db.user.update({ where: { id: purchase.advertiser.userId }, data: { role: "ADVERTISER" } });

  try {
    await sendAdvertiserRequestApprovedEmail({
      to: purchase.advertiser.user.email,
      name: purchase.advertiser.user.name,
      planName: purchase.adPlan.name,
    });
  } catch (err) {
    console.error("[admin/anunciantes/approve] falha ao enviar e-mail:", err);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-anunciantes-approve-route.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/anunciantes/[purchaseId]/approve/route.ts tests/admin-anunciantes-approve-route.test.ts
git commit -m "feat: rota de aprovacao da solicitacao de anunciante pelo admin"
```

---

### Task 12: `POST /api/admin/anunciantes/[purchaseId]/reject`

**Files:**
- Create: `app/api/admin/anunciantes/[purchaseId]/reject/route.ts`
- Test: `tests/admin-anunciantes-reject-route.test.ts`

**Interfaces:**
- Consumes: `refundPayment` (Task 5), `sendAdvertiserRequestRejectedEmail` (Task 6).
- Produces: `POST /api/admin/anunciantes/:purchaseId/reject` — body `{ reason: string }` →
  `200 { ok: true }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-anunciantes-reject-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAdvertiserRequestRejectedEmail: vi.fn() }));

import { POST } from "@/app/api/admin/anunciantes/[purchaseId]/reject/route";
import { refundPayment } from "@/lib/payment/refund-service";
import { sendAdvertiserRequestRejectedEmail } from "@/lib/email";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/anunciantes/purchase-1/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/anunciantes/[purchaseId]/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ reason: "motivo" }), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 400 sem motivo", async () => {
    const res = await POST(makeRequest({}), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando a compra não existe ou não está PENDING_APPROVAL", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ reason: "Dados inconsistentes" }), { params: Promise.resolve({ purchaseId: "purchase-1" }) });
    expect(res.status).toBe(404);
  });

  it("rejeita: marca REJECTED com motivo, estorna o pagamento e envia e-mail", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      advertiser: { user: { name: "Fulano", email: "fulano@example.com" } },
      payments: [{ id: "payment-1" }],
    });

    const res = await POST(makeRequest({ reason: "Dados inconsistentes" }), { params: Promise.resolve({ purchaseId: "purchase-1" }) });

    expect(dbMock.adPurchase.update).toHaveBeenCalledWith({
      where: { id: "purchase-1" },
      data: { status: "REJECTED", rejectionReason: "Dados inconsistentes" },
    });
    expect(refundPayment).toHaveBeenCalledWith({ paymentId: "payment-1", initiatedByUserId: "admin-1", reason: "Dados inconsistentes" });
    expect(sendAdvertiserRequestRejectedEmail).toHaveBeenCalledWith({
      to: "fulano@example.com",
      name: "Fulano",
      reason: "Dados inconsistentes",
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-anunciantes-reject-route.test.ts`
Expected: FAIL — a rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/admin/anunciantes/[purchaseId]/reject/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";
import { sendAdvertiserRequestRejectedEmail } from "@/lib/email";

const schema = z.object({ reason: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ purchaseId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { purchaseId } = await params;

  const purchase = await db.adPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      advertiser: { select: { user: { select: { name: true, email: true } } } },
      payments: { select: { id: true }, where: { status: "PAID" }, take: 1 },
    },
  });
  if (!purchase || purchase.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
  }

  await db.adPurchase.update({
    where: { id: purchaseId },
    data: { status: "REJECTED", rejectionReason: parsed.data.reason },
  });

  const payment = purchase.payments[0];
  if (payment) {
    try {
      await refundPayment({ paymentId: payment.id, initiatedByUserId: session.user.id, reason: parsed.data.reason });
    } catch (err) {
      console.error("[admin/anunciantes/reject] falha ao estornar pagamento:", err);
    }
  }

  try {
    await sendAdvertiserRequestRejectedEmail({
      to: purchase.advertiser.user.email,
      name: purchase.advertiser.user.name,
      reason: parsed.data.reason,
    });
  } catch (err) {
    console.error("[admin/anunciantes/reject] falha ao enviar e-mail:", err);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-anunciantes-reject-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/anunciantes/[purchaseId]/reject/route.ts tests/admin-anunciantes-reject-route.test.ts
git commit -m "feat: rota de rejeicao da solicitacao de anunciante pelo admin, com estorno"
```

---

### Task 13: Tela de admin — solicitações pendentes

**Files:**
- Create: `app/admin/anunciantes/solicitacoes/page.tsx`
- Create: `components/admin/AdvertiserRequestRow.tsx`
- Modify: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/anunciantes/[purchaseId]/approve` (Task 11), `POST
  /api/admin/anunciantes/[purchaseId]/reject` (Task 12).

Sem teste automatizado (Server Component + Client Component, convenção do projeto).

- [ ] **Step 1: Criar o componente da linha**

Criar `components/admin/AdvertiserRequestRow.tsx` (mesmo padrão de
`components/admin/PrivateAdModerationRow.tsx` — `ConfirmModal`/`ErrorModal`, nunca dialog nativo):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

interface Props {
  purchaseId: string;
  companyName: string;
  document: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  instagram: string | null;
  facebook: string | null;
  planName: string;
}

export default function AdvertiserRequestRow({
  purchaseId,
  companyName,
  document,
  address,
  contactEmail,
  contactPhone,
  instagram,
  facebook,
  planName,
}: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleApprove() {
    setLoading(true);
    const res = await fetch(`/api/admin/anunciantes/${purchaseId}/approve`, { method: "POST" });
    setLoading(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao aprovar solicitação.");
  }

  async function handleReject(reason?: string) {
    setLoading(true);
    const res = await fetch(`/api/admin/anunciantes/${purchaseId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setLoading(false);
    setRejecting(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao rejeitar solicitação.");
  }

  return (
    <div className="py-4 first:pt-0 last:pb-0 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{companyName} <span className="text-xs text-gray-500">— {planName}</span></p>
          <p className="text-xs text-gray-500">{document} — {address}</p>
          <p className="text-xs text-gray-500">{contactEmail} — {contactPhone}</p>
          {(instagram || facebook) && (
            <p className="text-xs text-gray-500">
              {instagram && <span>Instagram: {instagram} </span>}
              {facebook && <span>Facebook: {facebook}</span>}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={handleApprove} disabled={loading} className="btn-primary py-1.5 px-3 text-sm disabled:opacity-50">
            {loading ? "Processando..." : "Aprovar"}
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={loading}
            className="btn-secondary py-1.5 px-3 text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
          >
            Rejeitar
          </button>
        </div>
      </div>

      <ConfirmModal
        open={rejecting}
        title="Rejeitar solicitação de anunciante"
        message="Informe o motivo da rejeição. O valor pago será estornado automaticamente e o solicitante verá esse motivo por e-mail."
        confirmLabel="Rejeitar"
        tone="danger"
        loading={loading}
        showNoteField
        noteRequired
        notePlaceholder="Motivo da rejeição"
        onConfirm={handleReject}
        onCancel={() => setRejecting(false)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Criar a página**

Criar `app/admin/anunciantes/solicitacoes/page.tsx`:

```tsx
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import AdvertiserRequestRow from "@/components/admin/AdvertiserRequestRow";

export const metadata: Metadata = { title: "Solicitações de Anunciante — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAdvertiserRequestsPage() {
  await requireAdmin();

  const purchases = await db.adPurchase.findMany({
    where: { status: "PENDING_APPROVAL" },
    orderBy: { createdAt: "asc" },
    include: { advertiser: true, adPlan: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Solicitações de Anunciante</h1>
        <p className="text-sm text-gray-500">Contas de anunciante aguardando aprovação (já pagas).</p>
      </div>

      <div className="card divide-y dark:divide-gray-700">
        {purchases.length === 0 && (
          <p className="text-sm text-gray-500 py-4">Nenhuma solicitação pendente.</p>
        )}
        {purchases.map((purchase) => (
          <AdvertiserRequestRow
            key={purchase.id}
            purchaseId={purchase.id}
            companyName={purchase.advertiser.companyName}
            document={purchase.advertiser.document}
            address={purchase.advertiser.address}
            contactEmail={purchase.advertiser.contactEmail}
            contactPhone={purchase.advertiser.contactPhone}
            instagram={purchase.advertiser.instagram}
            facebook={purchase.advertiser.facebook}
            planName={purchase.adPlan.name}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Link no menu do Admin**

Em `components/admin/AdminNav.tsx`, adicionar (perto do link "Anúncios", linha ~13-14 — ler o
arquivo antes de editar pra confirmar o texto exato dos links vizinhos):

```tsx
          <Link href="/admin/anunciantes/solicitacoes" className="hover:text-gray-300">Solicitações</Link>
```

- [ ] **Step 4: Rodar `tsc --noEmit` e o build**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 5: Commit**

```bash
git add app/admin/anunciantes/solicitacoes/page.tsx components/admin/AdvertiserRequestRow.tsx \
  components/admin/AdminNav.tsx
git commit -m "feat: tela de admin pra aprovar ou rejeitar solicitacoes de anunciante"
```

---

## Parte F — Remoção do autosserviço instantâneo

### Task 14: Remover `register-advertiser` e redirecionar o link antigo

**Files:**
- Delete: `app/api/auth/register-advertiser/route.ts`
- Delete: `components/auth/RegisterAdvertiserForm.tsx`
- Delete: `tests/register-advertiser-route.test.ts`
- Modify: `app/auth/cadastro-anunciante/page.tsx`
- Modify: `components/layout/Footer.tsx`
- Modify: `app/admin/configuracoes/page.tsx:157`

**Interfaces:**
- Nenhuma nova — só remoção/redirecionamento.

- [ ] **Step 1: Remover os arquivos do autosserviço antigo**

```bash
git rm app/api/auth/register-advertiser/route.ts
git rm components/auth/RegisterAdvertiserForm.tsx
git rm tests/register-advertiser-route.test.ts
```

- [ ] **Step 2: Redirecionar a URL antiga pra nova**

Trocar todo o conteúdo de `app/auth/cadastro-anunciante/page.tsx` por:

```tsx
import { redirect } from "next/navigation";

export default function CadastroAnunciantePage() {
  redirect("/anuncie");
}
```

- [ ] **Step 3: Atualizar o link do rodapé**

Em `components/layout/Footer.tsx` (linha 18), trocar:

```tsx
              <li><Link href="/auth/cadastro-anunciante" className="hover:text-white transition-colors">Anuncie no site</Link></li>
```

por:

```tsx
              <li><Link href="/anuncie" className="hover:text-white transition-colors">Anuncie no site</Link></li>
```

- [ ] **Step 4: Atualizar o texto de ajuda em Admin → Configurações**

Em `app/admin/configuracoes/page.tsx` (perto da linha 157), atualizar o texto que menciona
`/auth/cadastro-anunciante` pra refletir a nova URL `/anuncie` — ler o parágrafo completo antes de
editar pra manter o resto do texto coerente.

- [ ] **Step 5: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam (o arquivo de teste removido não aparece mais na suíte).

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 6: Commit**

```bash
git add app/auth/cadastro-anunciante/page.tsx components/layout/Footer.tsx app/admin/configuracoes/page.tsx
git commit -m "feat: remove autosservico instantaneo de anunciante, redireciona pro fluxo novo"
```

---

## Revisão final (depois de todas as 14 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo.
- [ ] Conferir que o papel do usuário (`role`) **nunca** muda pra `ADVERTISER` fora da rota de
  aprovação (Task 11) e da promoção manual já existente (`promoteToAdvertiser`, fora de escopo).
- [ ] Conferir que rejeitar uma solicitação **nunca apaga** o `AdvertiserProfile`.
- [ ] Conferir que `refundPayment()` continua funcionando pro caso de `Order`/`Registration`
  (nenhuma regressão nos testes já existentes daquele arquivo).
- [ ] Conferir que não sobrou nenhuma referência a `register-advertiser`/`RegisterAdvertiserForm`
  no código (`grep -rn "register-advertiser\|RegisterAdvertiserForm" app/ components/ lib/`).
- [ ] Conferir manualmente (leitura de código) que `POST /api/anunciante/solicitar` nunca deixa
  passar um documento (CPF/CNPJ) inválido nem um e-mail de conta nova já cadastrado.
- [ ] Conferir que o e-mail de aprovação/rejeição e o alerta imediato ao admin não lançam exceção
  não tratada que derrube a rota de aprovação/rejeição (sempre `try/catch` ao redor do envio).
