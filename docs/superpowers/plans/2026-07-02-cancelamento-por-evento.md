# Cancelamento por evento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma política de cancelamento configurável por evento (prazo, cancelamento automático vs. aprovação do organizador, contato de aviso), controlada por um interruptor global do admin que preserva o comportamento atual quando desligado.

**Architecture:** Um helper puro (`decideCancellationOutcome`) decide entre "segue como hoje" / "bloqueado por prazo" / "vira solicitação" e é consumido pela rota existente de cancelamento do atleta. Uma nova rota dá ao organizador o poder de aprovar/rejeitar solicitações pendentes. O interruptor global usa o padrão já existente de `PlatformSetting`. Os campos por evento são adicionados ao formulário de edição já existente, atrás desse mesmo interruptor.

**Tech Stack:** Next.js App Router (Server Components + Route Handlers), Prisma, Zod, react-hook-form, Vitest.

## Global Constraints

- Interruptor `cancellation_policy_enabled` (chave `PlatformSetting`), **desligado por padrão**. Desligado ⇒ a rota de cancelamento do atleta roda **exatamente como hoje**, ignorando todos os campos novos.
- Evento sem `cancellationDeadline` definido ⇒ cancelamento livre até o evento começar (comportamento atual), mesmo com o interruptor ligado.
- Evento com `cancellationRequiresApproval = false` (padrão) ⇒ cancelamento imediato, igual hoje.
- Aprovar/rejeitar uma solicitação de cancelamento **nunca** dispara estorno automático — o organizador aciona o botão "Estornar" (sub-projeto 4) manualmente se quiser.
- Disparo real de WhatsApp fica fora de escopo (aguarda sub-projeto 6). O campo de telefone só é salvo.
- Nenhuma mudança na tela de criação de evento — só na edição.
- Uma inscrição tem no máximo uma solicitação de cancelamento ativa por vez (guardada nela mesma, sem histórico).

---

## Task 1: Schema — novos campos e enum

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/setup.ts`

**Interfaces:**
- Produces: `RegistrationStatus.CANCELLATION_REQUESTED`; `Event.cancellationDeadline: Date | null`, `Event.cancellationRequiresApproval: boolean`, `Event.cancellationContactPhone: string | null`, `Event.cancellationContactEmail: string | null`; `Registration.cancellationReason: string | null`, `Registration.cancellationRequestedAt: Date | null`.

- [ ] **Step 1: Adicionar o novo valor ao enum `RegistrationStatus`**

Find (in `prisma/schema.prisma`):
```prisma
enum RegistrationStatus {
  PENDING_PAYMENT
  CONFIRMED
  CANCELLED
  TRANSFERRED
  WAITLISTED
}
```

Replace it with:
```prisma
enum RegistrationStatus {
  PENDING_PAYMENT
  CONFIRMED
  CANCELLED
  TRANSFERRED
  WAITLISTED
  CANCELLATION_REQUESTED
}
```

- [ ] **Step 2: Adicionar os campos novos ao `model Event`**

Find:
```prisma
  organizerContact   String?
  maxParticipants    Int?
  platformFeePercent Int           @default(1100) // basis points
  publishedAt        DateTime?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  organizer     OrganizerProfile @relation(fields: [organizerId], references: [id])
```

Replace it with:
```prisma
  organizerContact   String?
  maxParticipants    Int?
  platformFeePercent Int           @default(1100) // basis points
  publishedAt        DateTime?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  cancellationDeadline         DateTime?
  cancellationRequiresApproval Boolean   @default(false)
  cancellationContactPhone     String?
  cancellationContactEmail     String?

  organizer     OrganizerProfile @relation(fields: [organizerId], references: [id])
```

- [ ] **Step 3: Adicionar os campos novos ao `model Registration`**

Find:
```prisma
  status               RegistrationStatus @default(PENDING_PAYMENT)
  acceptedTermsAt      DateTime?
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt

  event        Event          @relation(fields: [eventId], references: [id])
```

Replace it with:
```prisma
  status               RegistrationStatus @default(PENDING_PAYMENT)
  acceptedTermsAt      DateTime?
  cancellationReason      String?
  cancellationRequestedAt DateTime?
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt

  event        Event          @relation(fields: [eventId], references: [id])
```

- [ ] **Step 4: Gerar o Prisma Client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sem erros. (Não rode `prisma db push` aqui — não há banco acessível nesta sessão; o `db push` acontece no ambiente de verificação manual da Task 9.)

- [ ] **Step 5: Verificar que o projeto compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a este schema (os campos ainda não são usados em nenhum código, então não deve haver erro nenhum).

- [ ] **Step 6: Adicionar `findFirst` ao mock de `registration` em `tests/setup.ts`**

O mock global de `db.registration` ainda não expõe `findFirst` (só é usado hoje pela rota de estorno, que não tem teste de rota dedicado). As Tasks 4 e 5 deste plano escrevem testes de rota que precisam desse método mockável.

Find (em `tests/setup.ts`):
```ts
    registration: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
```

Replace it with:
```ts
    registration: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
```

- [ ] **Step 7: Rodar a suíte de testes para confirmar que nada quebrou**

Run: `npx vitest run`
Expected: todos os testes existentes continuam passando (a mudança no mock só adiciona um método, não remove nenhum).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma tests/setup.ts
git commit -m "feat: adiciona campos de politica de cancelamento ao schema"
```

---

## Task 2: Interruptor global do admin

**Files:**
- Modify: `lib/settings.ts`
- Create: `components/admin/CancellationPolicyToggleForm.tsx`
- Modify: `app/admin/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `getSetting(key): Promise<string | null>` (já existe em `lib/settings.ts`).
- Produces: `getCancellationPolicyEnabled(): Promise<boolean>`, consumida pelas Tasks 4, 6 e 7.

- [ ] **Step 1: Adicionar o getter `getCancellationPolicyEnabled`**

Find (em `lib/settings.ts`):
```ts
export const getServiceFeeMin = cache(async (): Promise<number> => {
  const val = await getSetting("service_fee_min");
  return val ? parseInt(val, 10) : 0; // centavos, e.g. 97 = R$0,97
});
```

Replace it with:
```ts
export const getServiceFeeMin = cache(async (): Promise<number> => {
  const val = await getSetting("service_fee_min");
  return val ? parseInt(val, 10) : 0; // centavos, e.g. 97 = R$0,97
});

export const getCancellationPolicyEnabled = cache(async (): Promise<boolean> => {
  const val = await getSetting("cancellation_policy_enabled");
  return val === "true";
});
```

- [ ] **Step 2: Criar o formulário de toggle do admin**

Create `components/admin/CancellationPolicyToggleForm.tsx`:
```tsx
"use client";

import { useState } from "react";

export default function CancellationPolicyToggleForm({ currentEnabled }: { currentEnabled: boolean }) {
  const [enabled, setEnabled] = useState(currentEnabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(next: boolean) {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cancellation_policy_enabled", value: String(next) }),
    });
    if (res.ok) {
      setEnabled(next);
      setSaved(true);
    } else {
      setError("Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={saving}
          className="h-4 w-4"
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {enabled ? "Ativado" : "Desativado"}
        </span>
      </label>
      {saving && <span className="text-xs text-gray-500">Salvando…</span>}
      {saved && !saving && <span className="text-xs text-green-600">Salvo!</span>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Ligar o formulário na página de configurações**

Find (em `app/admin/configuracoes/page.tsx`):
```tsx
import BannerIntervalForm from "@/components/admin/BannerIntervalForm";
import { parseEnabledPaymentMethods } from "@/lib/payment-methods";
```

Replace it with:
```tsx
import BannerIntervalForm from "@/components/admin/BannerIntervalForm";
import CancellationPolicyToggleForm from "@/components/admin/CancellationPolicyToggleForm";
import { parseEnabledPaymentMethods } from "@/lib/payment-methods";
```

Find:
```tsx
import { getDefaultPlatformFee, getServiceFeePercent, getServiceFeeMin, getBannerInterval } from "@/lib/settings";
```

Replace it with:
```tsx
import { getDefaultPlatformFee, getServiceFeePercent, getServiceFeeMin, getBannerInterval, getCancellationPolicyEnabled } from "@/lib/settings";
```

Find:
```tsx
  const [events, appName, enabledPaymentMethods, paymentProvider, accessToken, webhookSecret, mpPublicKey, pagarmeApiKey, pagarmePublicKey, pagarmeWebhookPassword, recentLogs, storageConfig, defaultPlatformFee, serviceFeePercent, serviceFeeMin, bannerInterval, smtpConfig] = await Promise.all([
```

Replace it with:
```tsx
  const [events, appName, enabledPaymentMethods, paymentProvider, accessToken, webhookSecret, mpPublicKey, pagarmeApiKey, pagarmePublicKey, pagarmeWebhookPassword, recentLogs, storageConfig, defaultPlatformFee, serviceFeePercent, serviceFeeMin, bannerInterval, smtpConfig, cancellationPolicyEnabled] = await Promise.all([
```

Find:
```tsx
    getBannerInterval(),
    getSmtpConfig(),
  ]);
```

Replace it with:
```tsx
    getBannerInterval(),
    getSmtpConfig(),
    getCancellationPolicyEnabled(),
  ]);
```

Find:
```tsx
      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Storage de arquivos</h2>
```

Replace it with:
```tsx
      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Política de cancelamento por evento</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Quando ativado, os organizadores podem configurar prazo de cancelamento, exigência de aprovação e contato de
          aviso em cada evento (aba de edição do evento). Quando desativado, o cancelamento do atleta funciona como hoje
          (livre até o início do evento, sempre imediato).
        </p>
        <CancellationPolicyToggleForm currentEnabled={cancellationPolicyEnabled} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Storage de arquivos</h2>
```

- [ ] **Step 4: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add lib/settings.ts components/admin/CancellationPolicyToggleForm.tsx app/admin/configuracoes/page.tsx
git commit -m "feat: interruptor global de politica de cancelamento em admin/configuracoes"
```

---

## Task 3: Helper puro de decisão + testes

**Files:**
- Create: `lib/registrations/cancellation-policy.ts`
- Test: `tests/registration-cancellation-policy.test.ts`

**Interfaces:**
- Produces: `decideCancellationOutcome(params): CancellationDecision`, consumida pela Task 4.
  ```ts
  type CancellationDecision =
    | { outcome: "cancel_immediately" }
    | { outcome: "blocked_deadline_passed" }
    | { outcome: "requires_approval" };

  function decideCancellationOutcome(params: {
    policyEnabled: boolean;
    cancellationDeadline: Date | null;
    cancellationRequiresApproval: boolean;
    now: Date;
  }): CancellationDecision;
  ```

- [ ] **Step 1: Escrever os testes (falhando)**

Create `tests/registration-cancellation-policy.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decideCancellationOutcome } from "@/lib/registrations/cancellation-policy";

describe("decideCancellationOutcome", () => {
  it("cancela imediatamente quando o interruptor global está desligado, mesmo com prazo e aprovação configurados", () => {
    const result = decideCancellationOutcome({
      policyEnabled: false,
      cancellationDeadline: new Date("2020-01-01"),
      cancellationRequiresApproval: true,
      now: new Date("2026-01-01"),
    });
    expect(result).toEqual({ outcome: "cancel_immediately" });
  });

  it("cancela imediatamente quando ligado, sem prazo definido e sem exigir aprovação", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: null,
      cancellationRequiresApproval: false,
      now: new Date("2026-01-01"),
    });
    expect(result).toEqual({ outcome: "cancel_immediately" });
  });

  it("bloqueia quando ligado e o prazo já passou", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: new Date("2026-01-01T00:00:00Z"),
      cancellationRequiresApproval: false,
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect(result).toEqual({ outcome: "blocked_deadline_passed" });
  });

  it("não bloqueia quando o prazo ainda não chegou", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: new Date("2026-02-01T00:00:00Z"),
      cancellationRequiresApproval: false,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(result).toEqual({ outcome: "cancel_immediately" });
  });

  it("vira solicitação quando ligado e o evento exige aprovação", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: null,
      cancellationRequiresApproval: true,
      now: new Date("2026-01-01"),
    });
    expect(result).toEqual({ outcome: "requires_approval" });
  });

  it("prioriza o bloqueio por prazo sobre a exigência de aprovação", () => {
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: new Date("2026-01-01T00:00:00Z"),
      cancellationRequiresApproval: true,
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect(result).toEqual({ outcome: "blocked_deadline_passed" });
  });

  it("trata o prazo exatamente no limite (now === deadline) como já encerrado", () => {
    const deadline = new Date("2026-01-01T12:00:00Z");
    const result = decideCancellationOutcome({
      policyEnabled: true,
      cancellationDeadline: deadline,
      cancellationRequiresApproval: false,
      now: new Date(deadline),
    });
    expect(result).toEqual({ outcome: "blocked_deadline_passed" });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/registration-cancellation-policy.test.ts`
Expected: FAIL — `Cannot find module '@/lib/registrations/cancellation-policy'`.

- [ ] **Step 3: Implementar o helper**

Create `lib/registrations/cancellation-policy.ts`:
```ts
export type CancellationDecision =
  | { outcome: "cancel_immediately" }
  | { outcome: "blocked_deadline_passed" }
  | { outcome: "requires_approval" };

export function decideCancellationOutcome(params: {
  policyEnabled: boolean;
  cancellationDeadline: Date | null;
  cancellationRequiresApproval: boolean;
  now: Date;
}): CancellationDecision {
  if (!params.policyEnabled) {
    return { outcome: "cancel_immediately" };
  }

  if (params.cancellationDeadline && params.cancellationDeadline <= params.now) {
    return { outcome: "blocked_deadline_passed" };
  }

  if (params.cancellationRequiresApproval) {
    return { outcome: "requires_approval" };
  }

  return { outcome: "cancel_immediately" };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/registration-cancellation-policy.test.ts`
Expected: PASS — 7/7 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/registrations/cancellation-policy.ts tests/registration-cancellation-policy.test.ts
git commit -m "feat: helper puro de decisao de cancelamento por evento"
```

---

## Task 4: Rota de cancelamento do atleta (existente) + e-mail

**Files:**
- Modify: `app/api/registrations/[id]/cancel/route.ts` (rota sensível, alto cuidado — comportamento atual deve ser 100% preservado quando o interruptor está desligado)
- Modify: `lib/email.ts`
- Modify: `lib/notifications.ts`
- Modify: `lib/admin/labels.ts`
- Test: `tests/registration-cancel-route.test.ts`

**Interfaces:**
- Consumes: `decideCancellationOutcome` (Task 3), `getCancellationPolicyEnabled` (Task 2).
- Produces: `sendCancellationRequestedEmail(params)` em `lib/email.ts`; `notifyCancellationRequested(registrationId)` em `lib/notifications.ts`.

- [ ] **Step 1: Adicionar o template de e-mail**

Find (em `lib/email.ts`):
```ts
/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

Replace it with:
```ts
/** E-mail avisando o organizador que um atleta solicitou cancelamento (requer aprovação). */
export async function sendCancellationRequestedEmail(params: {
  to: string;
  athleteName: string;
  eventTitle?: string;
  reason: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Solicitação de cancelamento${params.eventTitle ? ` — ${params.eventTitle}` : ""}`,
    html: layout(
      appName,
      `<p>Olá,</p>
       <p><strong>${params.athleteName}</strong> solicitou o cancelamento da inscrição${params.eventTitle ? ` em <strong>${params.eventTitle}</strong>` : ""}.</p>
       <p><strong>Justificativa:</strong> ${params.reason}</p>
       <p>Acesse o painel do organizador para aprovar ou rejeitar esta solicitação.</p>`
    ),
  });
}

/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

- [ ] **Step 2: Adicionar a notificação fire-and-forget**

Find (em `lib/notifications.ts`):
```ts
import { db } from "./db";
import { getSmtpConfig, isSmtpReady } from "./smtp-settings";
import { sendRegistrationConfirmationEmail } from "./email";
```

Replace it with:
```ts
import { db } from "./db";
import { getSmtpConfig, isSmtpReady } from "./smtp-settings";
import { sendRegistrationConfirmationEmail, sendCancellationRequestedEmail } from "./email";
```

Find:
```ts
    await sendRegistrationConfirmationEmail({
      to: order.buyer.email,
      name: order.buyer.name,
      registrationId: order.registrations[0].id,
      eventTitle: order.event?.title,
    });
  } catch (err) {
    console.error("[notifyOrderConfirmed] failed:", err);
  }
}
```

Replace it with:
```ts
    await sendRegistrationConfirmationEmail({
      to: order.buyer.email,
      name: order.buyer.name,
      registrationId: order.registrations[0].id,
      eventTitle: order.event?.title,
    });
  } catch (err) {
    console.error("[notifyOrderConfirmed] failed:", err);
  }
}

/**
 * Avisa o e-mail de contato do evento que um atleta solicitou o cancelamento da inscrição.
 * Seguro para chamar em "fire-and-forget": não lança e ignora silenciosamente quando o
 * SMTP não está configurado ou o evento não tem e-mail de contato de cancelamento.
 */
export async function notifyCancellationRequested(registrationId: string): Promise<void> {
  try {
    const cfg = await getSmtpConfig();
    if (!isSmtpReady(cfg)) return;

    const registration = await db.registration.findUnique({
      where: { id: registrationId },
      select: {
        cancellationReason: true,
        athlete: { select: { name: true } },
        event: { select: { title: true, cancellationContactEmail: true } },
      },
    });

    if (!registration?.event.cancellationContactEmail) return;

    await sendCancellationRequestedEmail({
      to: registration.event.cancellationContactEmail,
      athleteName: registration.athlete.name,
      eventTitle: registration.event.title,
      reason: registration.cancellationReason ?? "",
    });
  } catch (err) {
    console.error("[notifyCancellationRequested] failed:", err);
  }
}
```

- [ ] **Step 3: Adicionar os novos rótulos de auditoria**

Find (em `lib/admin/labels.ts`):
```ts
  REGISTRATION_CANCELLED: "Inscrição cancelada",
```

Replace it with:
```ts
  REGISTRATION_CANCELLED: "Inscrição cancelada",
  REGISTRATION_CANCELLATION_REQUESTED: "Cancelamento solicitado",
  REGISTRATION_CANCELLATION_APPROVED: "Cancelamento aprovado",
  REGISTRATION_CANCELLATION_REJECTED: "Cancelamento rejeitado",
```

- [ ] **Step 4: Escrever os testes de rota (falhando)**

Create `tests/registration-cancel-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getCancellationPolicyEnabled } from "@/lib/settings";
import { POST } from "@/app/api/registrations/[id]/cancel/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getCancellationPolicyEnabled: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyCancellationRequested: vi.fn() }));

const dbMock = db as any;
const authMock = vi.mocked(auth);
const policyMock = vi.mocked(getCancellationPolicyEnabled);

function makeRequest(body: unknown = {}) {
  return new Request("http://localhost/api/registrations/reg-1/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const baseRegistration = {
  id: "reg-1",
  status: "CONFIRMED",
  ticketBatchId: "tb-1",
  event: {
    startAt: new Date("2099-01-01"),
    title: "Corrida Teste",
    cancellationDeadline: null as Date | null,
    cancellationRequiresApproval: false,
    cancellationContactEmail: null as string | null,
  },
  order: { id: "ord-1", status: "PAID" },
};

describe("POST /api/registrations/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
  });

  it("cancela imediatamente quando o interruptor global está desligado (comportamento atual preservado)", async () => {
    policyMock.mockResolvedValue(false);
    dbMock.registration.findFirst.mockResolvedValueOnce(baseRegistration);
    const txRegistrationUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        order: { update: txOrderUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({ where: { id: "tb-1" }, data: { soldCount: { decrement: 1 } } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLED" }) }),
    );
  });

  it("bloqueia quando o interruptor está ligado e o prazo do evento já passou", async () => {
    policyMock.mockResolvedValue(true);
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...baseRegistration,
      event: { ...baseRegistration.event, cancellationDeadline: new Date("2020-01-01") },
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Prazo de cancelamento encerrado");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("exige justificativa quando o evento requer aprovação e nenhuma foi enviada", async () => {
    policyMock.mockResolvedValue(true);
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...baseRegistration,
      event: { ...baseRegistration.event, cancellationRequiresApproval: true },
    });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Justificativa obrigatória para solicitar o cancelamento");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("vira solicitação (sem tocar em Order/soldCount) quando o evento requer aprovação e a justificativa foi enviada", async () => {
    policyMock.mockResolvedValue(true);
    dbMock.registration.findFirst.mockResolvedValueOnce({
      ...baseRegistration,
      event: { ...baseRegistration.event, cancellationRequiresApproval: true, cancellationContactEmail: "org@example.com" },
    });
    const txRegistrationUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(makeRequest({ reason: "Contusão no joelho" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("CANCELLATION_REQUESTED");
    expect(txRegistrationUpdate).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: expect.objectContaining({ status: "CANCELLATION_REQUESTED", cancellationReason: "Contusão no joelho" }),
    });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLATION_REQUESTED" }) }),
    );
  });

  it("retorna 404 quando a inscrição não pertence ao atleta autenticado", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(404);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/registration-cancel-route.test.ts`
Expected: FAIL — a rota atual não lê `getCancellationPolicyEnabled` nem aceita corpo, então os testes de bloqueio/solicitação falham (o de "desligado" pode passar por acidente, os demais não).

- [ ] **Step 6: Modificar a rota**

Find (arquivo inteiro de `app/api/registrations/[id]/cancel/route.ts`):
```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, athleteUserId: session.user.id },
    include: {
      event: { select: { startAt: true, title: true } },
      order: { select: { id: true, status: true } },
    },
  });

  if (!registration) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  if (registration.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Somente inscrições confirmadas podem ser canceladas" }, { status: 400 });
  }

  if (new Date(registration.event.startAt) <= new Date()) {
    return NextResponse.json({ error: "Não é possível cancelar após o início do evento" }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    await tx.registration.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    await tx.order.update({
      where: { id: registration.order.id },
      data: { status: "CANCELLED" },
    });

    await tx.ticketBatch.update({
      where: { id: registration.ticketBatchId },
      data: { soldCount: { decrement: 1 } },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_CANCELLED",
        entityType: "Registration",
        entityId: id,
        metadata: { eventTitle: registration.event.title, orderId: registration.order.id },
      },
    });
  });

  return NextResponse.json({ success: true });
}
```

Replace it with:
```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCancellationPolicyEnabled } from "@/lib/settings";
import { decideCancellationOutcome } from "@/lib/registrations/cancellation-policy";
import { notifyCancellationRequested } from "@/lib/notifications";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const registration = await db.registration.findFirst({
    where: { id, athleteUserId: session.user.id },
    include: {
      event: {
        select: {
          startAt: true,
          title: true,
          cancellationDeadline: true,
          cancellationRequiresApproval: true,
          cancellationContactEmail: true,
        },
      },
      order: { select: { id: true, status: true } },
    },
  });

  if (!registration) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  if (registration.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Somente inscrições confirmadas podem ser canceladas" }, { status: 400 });
  }

  if (new Date(registration.event.startAt) <= new Date()) {
    return NextResponse.json({ error: "Não é possível cancelar após o início do evento" }, { status: 400 });
  }

  const policyEnabled = await getCancellationPolicyEnabled();
  const decision = decideCancellationOutcome({
    policyEnabled,
    cancellationDeadline: registration.event.cancellationDeadline,
    cancellationRequiresApproval: registration.event.cancellationRequiresApproval,
    now: new Date(),
  });

  if (decision.outcome === "blocked_deadline_passed") {
    return NextResponse.json({ error: "Prazo de cancelamento encerrado" }, { status: 400 });
  }

  if (decision.outcome === "requires_approval") {
    if (!reason) {
      return NextResponse.json({ error: "Justificativa obrigatória para solicitar o cancelamento" }, { status: 400 });
    }

    await db.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id },
        data: {
          status: "CANCELLATION_REQUESTED",
          cancellationReason: reason,
          cancellationRequestedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "REGISTRATION_CANCELLATION_REQUESTED",
          entityType: "Registration",
          entityId: id,
          metadata: { eventTitle: registration.event.title, reason },
        },
      });
    });

    void notifyCancellationRequested(id);

    return NextResponse.json({ success: true, status: "CANCELLATION_REQUESTED" });
  }

  await db.$transaction(async (tx) => {
    await tx.registration.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    await tx.order.update({
      where: { id: registration.order.id },
      data: { status: "CANCELLED" },
    });

    await tx.ticketBatch.update({
      where: { id: registration.ticketBatchId },
      data: { soldCount: { decrement: 1 } },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_CANCELLED",
        entityType: "Registration",
        entityId: id,
        metadata: { eventTitle: registration.event.title, orderId: registration.order.id },
      },
    });
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/registration-cancel-route.test.ts`
Expected: PASS — 5/5 testes.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: todos os testes passam (nenhuma regressão nos testes existentes de checkout/webhook que também usam `Registration`).

- [ ] **Step 9: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add app/api/registrations/[id]/cancel/route.ts lib/email.ts lib/notifications.ts lib/admin/labels.ts tests/registration-cancel-route.test.ts
git commit -m "feat: rota de cancelamento do atleta respeita politica de cancelamento por evento"
```

---

## Task 5: Rota de decisão do organizador (aprovar/rejeitar)

**Files:**
- Create: `app/api/organizer/registrations/[id]/cancellation-decision/route.ts`
- Test: `tests/organizer-cancellation-decision-route.test.ts`

**Interfaces:**
- Produces: `POST /api/organizer/registrations/[id]/cancellation-decision` com corpo `{ decision: "APPROVE" | "REJECT" }`, consumida pela Task 8 (UI).

- [ ] **Step 1: Escrever os testes (falhando)**

Create `tests/organizer-cancellation-decision-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { POST } from "@/app/api/organizer/registrations/[id]/cancellation-decision/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const dbMock = db as any;
const authMock = vi.mocked(auth);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/cancellation-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/registrations/[id]/cancellation-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a um evento deste organizador (fronteira de segurança)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(404);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizer: { userId: "organizer-1" } } } }),
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a inscrição não está com solicitação pendente (evita decremento duplo)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      id: "reg-1",
      status: "CANCELLED",
      ticketBatchId: "tb-1",
      orderId: "ord-1",
    });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("APPROVE cancela a inscrição, o pedido e decrementa soldCount uma única vez", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      id: "reg-1",
      status: "CANCELLATION_REQUESTED",
      ticketBatchId: "tb-1",
      orderId: "ord-1",
    });
    const txRegistrationUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txTicketBatchUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        order: { update: txOrderUpdate },
        ticketBatch: { update: txTicketBatchUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CANCELLED" } });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "ord-1" }, data: { status: "CANCELLED" } });
    expect(txTicketBatchUpdate).toHaveBeenCalledTimes(1);
    expect(txTicketBatchUpdate).toHaveBeenCalledWith({ where: { id: "tb-1" }, data: { soldCount: { decrement: 1 } } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLATION_APPROVED" }) }),
    );
  });

  it("REJECT volta a inscrição para CONFIRMED sem tocar em Order ou soldCount", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({
      id: "reg-1",
      status: "CANCELLATION_REQUESTED",
      ticketBatchId: "tb-1",
      orderId: "ord-1",
    });
    const txRegistrationUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        registration: { update: txRegistrationUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(makeRequest({ decision: "REJECT" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "REGISTRATION_CANCELLATION_REJECTED" }) }),
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/organizer-cancellation-decision-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/organizer/registrations/[id]/cancellation-decision/route'`.

- [ ] **Step 3: Implementar a rota**

Create `app/api/organizer/registrations/[id]/cancellation-decision/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: { id: true, status: true, ticketBatchId: true, orderId: true },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  if (registration.status !== "CANCELLATION_REQUESTED") {
    return NextResponse.json(
      { error: "Esta inscrição não possui uma solicitação de cancelamento pendente" },
      { status: 400 },
    );
  }

  if (parsed.data.decision === "APPROVE") {
    await db.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id },
        data: { status: "CANCELLED" },
      });

      await tx.order.update({
        where: { id: registration.orderId },
        data: { status: "CANCELLED" },
      });

      await tx.ticketBatch.update({
        where: { id: registration.ticketBatchId },
        data: { soldCount: { decrement: 1 } },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "REGISTRATION_CANCELLATION_APPROVED",
          entityType: "Registration",
          entityId: id,
        },
      });
    });
  } else {
    await db.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id },
        data: { status: "CONFIRMED" },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "REGISTRATION_CANCELLATION_REJECTED",
          entityType: "Registration",
          entityId: id,
        },
      });
    });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/organizer-cancellation-decision-route.test.ts`
Expected: PASS — 5/5 testes.

- [ ] **Step 5: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/organizer/registrations/[id]/cancellation-decision/route.ts tests/organizer-cancellation-decision-route.test.ts
git commit -m "feat: rota de aprovacao/rejeicao de cancelamento pelo organizador"
```

---

## Task 6: UI do atleta (botão + página de detalhe)

**Files:**
- Modify: `components/dashboard/CancelRegistrationButton.tsx`
- Modify: `app/dashboard/inscricoes/[id]/page.tsx`

**Interfaces:**
- Consumes: `getCancellationPolicyEnabled` (Task 2). Rota `POST /api/registrations/[id]/cancel` já aceita `{ reason?: string }` (Task 4).

Este componente e página não têm testes automatizados no repositório (nenhum componente React tem teste hoje — convenção existente); a verificação é manual na Task 9.

- [ ] **Step 1: Adicionar campo de justificativa e prop `requiresApproval` ao botão**

Find (arquivo inteiro de `components/dashboard/CancelRegistrationButton.tsx`):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelRegistrationButton({ registrationId }: { registrationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    setLoading(true);
    const res = await fetch(`/api/registrations/${registrationId}/cancel`, { method: "POST" });
    if (res.ok) {
      router.refresh();
    } else {
      alert("Erro ao cancelar inscrição. Tente novamente.");
    }
    setLoading(false);
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="flex-1 flex gap-2">
        <button onClick={handleCancel} disabled={loading} className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
          {loading ? "Cancelando..." : "Confirmar cancelamento"}
        </button>
        <button onClick={() => setConfirming(false)} className="btn-secondary text-sm px-3">
          Voltar
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="flex-1 btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
      Cancelar inscrição
    </button>
  );
}
```

Replace it with:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelRegistrationButton({
  registrationId,
  requiresApproval = false,
}: {
  registrationId: string;
  requiresApproval?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    setLoading(true);
    const res = await fetch(`/api/registrations/${registrationId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    if (res.ok) {
      if (requiresApproval) {
        setRequested(true);
      } else {
        router.refresh();
      }
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Erro ao cancelar inscrição. Tente novamente.");
    }
    setLoading(false);
    setConfirming(false);
  }

  if (requested) {
    return (
      <p className="flex-1 text-sm text-center text-gray-600 dark:text-gray-400">
        Solicitação enviada — aguardando aprovação do organizador
      </p>
    );
  }

  if (confirming) {
    return (
      <div className="flex-1 flex flex-col gap-2">
        {requiresApproval && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Justifique o motivo do cancelamento"
            className="input-field text-sm"
            rows={3}
          />
        )}
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={loading || (requiresApproval && !reason.trim())}
            className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Enviando..." : "Confirmar cancelamento"}
          </button>
          <button onClick={() => setConfirming(false)} className="btn-secondary text-sm px-3">
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="flex-1 btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
      Cancelar inscrição
    </button>
  );
}
```

- [ ] **Step 2: Atualizar a página de detalhe da inscrição**

Find (em `app/dashboard/inscricoes/[id]/page.tsx`):
```tsx
import PixPaymentCard from "@/components/dashboard/PixPaymentCard";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Detalhe da Inscrição" };

import { BADGE } from "@/lib/badge-colors";

const STATUS_INFO: Record<string, { label: string; color: string; icon: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: `${BADGE.yellow} border border-yellow-200 dark:border-yellow-800`, icon: "⏳" },
  CONFIRMED:       { label: "Inscrição confirmada", color: `${BADGE.green} border border-green-200 dark:border-green-800`, icon: "✅" },
  CANCELLED:       { label: "Inscrição cancelada", color: `${BADGE.red} border border-red-200 dark:border-red-800`, icon: "❌" },
  TRANSFERRED:     { label: "Inscrição transferida", color: `${BADGE.blue} border border-blue-200 dark:border-blue-800`, icon: "🔄" },
  WAITLISTED:      { label: "Lista de espera", color: `${BADGE.gray} border border-gray-200 dark:border-gray-600`, icon: "🕐" },
};
```

Replace it with:
```tsx
import PixPaymentCard from "@/components/dashboard/PixPaymentCard";
import { getCancellationPolicyEnabled } from "@/lib/settings";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Detalhe da Inscrição" };

import { BADGE } from "@/lib/badge-colors";

const STATUS_INFO: Record<string, { label: string; color: string; icon: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: `${BADGE.yellow} border border-yellow-200 dark:border-yellow-800`, icon: "⏳" },
  CONFIRMED:       { label: "Inscrição confirmada", color: `${BADGE.green} border border-green-200 dark:border-green-800`, icon: "✅" },
  CANCELLED:       { label: "Inscrição cancelada", color: `${BADGE.red} border border-red-200 dark:border-red-800`, icon: "❌" },
  TRANSFERRED:     { label: "Inscrição transferida", color: `${BADGE.blue} border border-blue-200 dark:border-blue-800`, icon: "🔄" },
  WAITLISTED:      { label: "Lista de espera", color: `${BADGE.gray} border border-gray-200 dark:border-gray-600`, icon: "🕐" },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: `${BADGE.orange} border border-orange-200 dark:border-orange-800`, icon: "🕓" },
};
```

Find:
```tsx
  const registration = await db.registration.findFirst({
    where: { id, athleteUserId: session.user.id },
    include: {
      event: {
        select: {
          title: true, slug: true, startAt: true, kitPickupAt: true,
          venueName: true, addressLine: true, city: true, state: true,
          organizerContact: true,
        },
      },
```

Replace it with:
```tsx
  const registration = await db.registration.findFirst({
    where: { id, athleteUserId: session.user.id },
    include: {
      event: {
        select: {
          title: true, slug: true, startAt: true, kitPickupAt: true,
          venueName: true, addressLine: true, city: true, state: true,
          organizerContact: true, cancellationDeadline: true, cancellationRequiresApproval: true,
        },
      },
```

Find:
```tsx
  const statusInfo = STATUS_INFO[registration.status] ?? STATUS_INFO.PENDING_PAYMENT;
  const isPending = registration.status === "PENDING_PAYMENT";
  const isConfirmed = registration.status === "CONFIRMED";
  const canCancel = isConfirmed && new Date(registration.event.startAt) > new Date();
```

Replace it with:
```tsx
  const statusInfo = STATUS_INFO[registration.status] ?? STATUS_INFO.PENDING_PAYMENT;
  const isPending = registration.status === "PENDING_PAYMENT";
  const isConfirmed = registration.status === "CONFIRMED";
  const policyEnabled = await getCancellationPolicyEnabled();
  const deadlinePassed = Boolean(
    policyEnabled && registration.event.cancellationDeadline && new Date(registration.event.cancellationDeadline) <= new Date(),
  );
  const requiresApproval = policyEnabled && registration.event.cancellationRequiresApproval;
  const canCancel = isConfirmed && new Date(registration.event.startAt) > new Date() && !deadlinePassed;
```

Find:
```tsx
        {canCancel && (
          <CancelRegistrationButton registrationId={registration.id} />
        )}
```

Replace it with:
```tsx
        {canCancel && (
          <CancelRegistrationButton registrationId={registration.id} requiresApproval={requiresApproval} />
        )}
```

- [ ] **Step 3: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/CancelRegistrationButton.tsx app/dashboard/inscricoes/[id]/page.tsx
git commit -m "feat: UI do atleta respeita prazo e exigencia de aprovacao no cancelamento"
```

---

## Task 7: Formulário de edição do evento (organizador)

**Files:**
- Modify: `components/organizer/EditEventForm.tsx`
- Modify: `app/organizador/eventos/[id]/editar/page.tsx`
- Modify: `app/api/events/[id]/route.ts`

**Interfaces:**
- Consumes: `getCancellationPolicyEnabled` (Task 2).

Sem testes automatizados de UI (convenção existente). O PATCH da rota `app/api/events/[id]/route.ts` é validado via typecheck + verificação manual (Task 9); não há teste de rota hoje para este arquivo.

- [ ] **Step 1: Adicionar os campos ao schema/tipos/valores padrão do formulário**

Find (em `components/organizer/EditEventForm.tsx`):
```tsx
const schema = z.object({
  title: z.string().min(3, "Mínimo 3 caracteres"),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]),
  startAt: z.string().min(1, "Informe a data"),
  kitPickupAt: z.string().optional(),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2, "Informe a cidade"),
  state: z.string().length(2, "UF com 2 letras"),
  maxParticipants: z.number().int().nonnegative().optional().nullable(),
  organizerContact: z.string().optional(),
  regulationText: z.string().optional().nullable(),
});
```

Replace it with:
```tsx
const schema = z.object({
  title: z.string().min(3, "Mínimo 3 caracteres"),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]),
  startAt: z.string().min(1, "Informe a data"),
  kitPickupAt: z.string().optional(),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2, "Informe a cidade"),
  state: z.string().length(2, "UF com 2 letras"),
  maxParticipants: z.number().int().nonnegative().optional().nullable(),
  organizerContact: z.string().optional(),
  regulationText: z.string().optional().nullable(),
  cancellationDeadline: z.string().optional(),
  cancellationRequiresApproval: z.boolean().optional(),
  cancellationContactPhone: z.string().optional(),
  cancellationContactEmail: z.string().optional(),
});
```

Find:
```tsx
type EventData = {
  id: string;
  title: string;
  description?: string | null;
  modality: string;
  startAt: Date | string;
  kitPickupAt?: Date | string | null;
  venueName?: string | null;
  addressLine?: string | null;
  city: string;
  state: string;
  maxParticipants?: number | null;
  organizerContact?: string | null;
  bannerUrl?: string | null;
  listBannerUrl?: string | null;
  regulationUrl?: string | null;
  regulationText?: string | null;
};

export default function EditEventForm({ event }: { event: EventData }) {
```

Replace it with:
```tsx
type EventData = {
  id: string;
  title: string;
  description?: string | null;
  modality: string;
  startAt: Date | string;
  kitPickupAt?: Date | string | null;
  venueName?: string | null;
  addressLine?: string | null;
  city: string;
  state: string;
  maxParticipants?: number | null;
  organizerContact?: string | null;
  bannerUrl?: string | null;
  listBannerUrl?: string | null;
  regulationUrl?: string | null;
  regulationText?: string | null;
  cancellationDeadline?: Date | string | null;
  cancellationRequiresApproval?: boolean;
  cancellationContactPhone?: string | null;
  cancellationContactEmail?: string | null;
};

export default function EditEventForm({
  event,
  cancellationPolicyEnabled = false,
}: {
  event: EventData;
  cancellationPolicyEnabled?: boolean;
}) {
```

Find:
```tsx
      maxParticipants: event.maxParticipants ?? 0,
      organizerContact: event.organizerContact ?? "",
      regulationText: event.regulationText ?? "",
    },
  });
```

Replace it with:
```tsx
      maxParticipants: event.maxParticipants ?? 0,
      organizerContact: event.organizerContact ?? "",
      regulationText: event.regulationText ?? "",
      cancellationDeadline: event.cancellationDeadline ? toDatetimeLocal(event.cancellationDeadline) : "",
      cancellationRequiresApproval: event.cancellationRequiresApproval ?? false,
      cancellationContactPhone: event.cancellationContactPhone ?? "",
      cancellationContactEmail: event.cancellationContactEmail ?? "",
    },
  });
```

- [ ] **Step 2: Enviar os campos novos no submit**

Find:
```tsx
        kitPickupAt: data.kitPickupAt ? new Date(data.kitPickupAt).toISOString() : null,
        bannerUrl,
        listBannerUrl,
        regulationUrl,
        regulationText: data.regulationText || null,
      }),
    });
```

Replace it with:
```tsx
        kitPickupAt: data.kitPickupAt ? new Date(data.kitPickupAt).toISOString() : null,
        bannerUrl,
        listBannerUrl,
        regulationUrl,
        regulationText: data.regulationText || null,
        cancellationDeadline: data.cancellationDeadline ? new Date(data.cancellationDeadline).toISOString() : null,
        cancellationRequiresApproval: data.cancellationRequiresApproval ?? false,
        cancellationContactPhone: data.cancellationContactPhone || null,
        cancellationContactEmail: data.cancellationContactEmail || null,
      }),
    });
```

- [ ] **Step 3: Adicionar a seção visual, atrás do interruptor global**

Find:
```tsx
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="flex gap-3">
```

Replace it with:
```tsx
      {cancellationPolicyEnabled && (
        <div className="border-t pt-5 dark:border-gray-700 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Política de cancelamento</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Deixe o prazo em branco para permitir cancelamento livre até o início do evento (padrão).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prazo final para cancelamento</label>
              <input type="datetime-local" {...register("cancellationDeadline")} className="input w-full" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" {...register("cancellationRequiresApproval")} className="h-4 w-4" />
                Cancelamento requer aprovação do organizador
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone de contato (WhatsApp)</label>
              <input {...register("cancellationContactPhone")} className="input w-full" placeholder="+55 11 91234-5678" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail de contato</label>
              <input {...register("cancellationContactEmail")} className="input w-full" placeholder="cancelamentos@organizador.com" />
            </div>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="flex gap-3">
```

- [ ] **Step 4: Atualizar a página de edição para buscar e repassar os campos novos**

Find (arquivo inteiro de `app/organizador/eventos/[id]/editar/page.tsx`):
```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import EditEventForm from "@/components/organizer/EditEventForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Editar Evento" };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: {
      id: true, title: true, description: true, modality: true,
      startAt: true, kitPickupAt: true, venueName: true, addressLine: true,
      city: true, state: true, maxParticipants: true, organizerContact: true,
      bannerUrl: true, listBannerUrl: true, regulationUrl: true, regulationText: true,
    },
  });

  if (!event) notFound();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/organizador/eventos/${id}`} className="hover:text-primary-600">← Voltar ao evento</Link>
      </div>
      <h1 className="text-2xl font-bold">Editar evento</h1>
      <EditEventForm event={event} />
    </div>
  );
}
```

Replace it with:
```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import EditEventForm from "@/components/organizer/EditEventForm";
import { getCancellationPolicyEnabled } from "@/lib/settings";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Editar Evento" };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const [event, cancellationPolicyEnabled] = await Promise.all([
    db.event.findFirst({
      where: { id, organizer: { userId: session.user.id } },
      select: {
        id: true, title: true, description: true, modality: true,
        startAt: true, kitPickupAt: true, venueName: true, addressLine: true,
        city: true, state: true, maxParticipants: true, organizerContact: true,
        bannerUrl: true, listBannerUrl: true, regulationUrl: true, regulationText: true,
        cancellationDeadline: true, cancellationRequiresApproval: true,
        cancellationContactPhone: true, cancellationContactEmail: true,
      },
    }),
    getCancellationPolicyEnabled(),
  ]);

  if (!event) notFound();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/organizador/eventos/${id}`} className="hover:text-primary-600">← Voltar ao evento</Link>
      </div>
      <h1 className="text-2xl font-bold">Editar evento</h1>
      <EditEventForm event={event} cancellationPolicyEnabled={cancellationPolicyEnabled} />
    </div>
  );
}
```

- [ ] **Step 5: Aceitar os campos novos no PATCH da API**

Find (em `app/api/events/[id]/route.ts`):
```ts
const updateEventSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]).optional(),
  startAt: z.string().datetime().optional(),
  kitPickupAt: z.string().datetime().optional().nullable(),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2).optional(),
  state: z.string().length(2).optional(),
  maxParticipants: z.number().int().nonnegative().optional().nullable(),
  organizerContact: z.string().optional().nullable(),
  bannerUrl: z.string().url().optional().nullable(),
  listBannerUrl: z.string().url().optional().nullable(),
  regulationUrl: z.string().url().optional().nullable(),
  regulationText: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "UNDER_REVIEW"]).optional(),
});
```

Replace it with:
```ts
const updateEventSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]).optional(),
  startAt: z.string().datetime().optional(),
  kitPickupAt: z.string().datetime().optional().nullable(),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2).optional(),
  state: z.string().length(2).optional(),
  maxParticipants: z.number().int().nonnegative().optional().nullable(),
  organizerContact: z.string().optional().nullable(),
  bannerUrl: z.string().url().optional().nullable(),
  listBannerUrl: z.string().url().optional().nullable(),
  regulationUrl: z.string().url().optional().nullable(),
  regulationText: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "UNDER_REVIEW"]).optional(),
  cancellationDeadline: z.string().datetime().optional().nullable(),
  cancellationRequiresApproval: z.boolean().optional(),
  cancellationContactPhone: z.string().optional().nullable(),
  cancellationContactEmail: z.string().optional().nullable(),
});
```

Find:
```ts
      ...(parsed.data.kitPickupAt !== undefined ? { kitPickupAt: parsed.data.kitPickupAt ? new Date(parsed.data.kitPickupAt) : null } : {}),
    },
  });
```

Replace it with:
```ts
      ...(parsed.data.kitPickupAt !== undefined ? { kitPickupAt: parsed.data.kitPickupAt ? new Date(parsed.data.kitPickupAt) : null } : {}),
      ...(parsed.data.cancellationDeadline !== undefined ? { cancellationDeadline: parsed.data.cancellationDeadline ? new Date(parsed.data.cancellationDeadline) : null } : {}),
    },
  });
```

- [ ] **Step 6: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: todos os testes passam (nenhum teste existente cobre este PATCH, então nenhuma regressão esperada).

- [ ] **Step 8: Commit**

```bash
git add components/organizer/EditEventForm.tsx app/organizador/eventos/[id]/editar/page.tsx app/api/events/[id]/route.ts
git commit -m "feat: organizador configura politica de cancelamento na edicao do evento"
```

---

## Task 8: Tabela de inscritos do organizador (badge + aprovar/rejeitar)

**Files:**
- Create: `components/organizer/CancellationDecisionButtons.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Consumes: `POST /api/organizer/registrations/[id]/cancellation-decision` (Task 5).

Sem testes automatizados de UI (convenção existente); verificação manual na Task 9.

- [ ] **Step 1: Criar os botões de decisão**

Create `components/organizer/CancellationDecisionButtons.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancellationDecisionButtons({ registrationId }: { registrationId: string }) {
  const [loading, setLoading] = useState<"APPROVE" | "REJECT" | null>(null);
  const router = useRouter();

  async function handleDecision(decision: "APPROVE" | "REJECT") {
    setLoading(decision);
    const res = await fetch(`/api/organizer/registrations/${registrationId}/cancellation-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao processar a decisão.");
    setLoading(null);
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleDecision("APPROVE")}
        disabled={loading !== null}
        className="text-xs text-green-600 hover:underline disabled:opacity-50"
      >
        {loading === "APPROVE" ? "Aprovando..." : "Aprovar"}
      </button>
      <button
        onClick={() => handleDecision("REJECT")}
        disabled={loading !== null}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {loading === "REJECT" ? "Rejeitando..." : "Rejeitar"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Adicionar o status novo ao mapa e ligar os botões na tabela**

Find (em `app/organizador/eventos/[id]/inscritos/page.tsx`):
```tsx
import RefundRegistrationButton from "@/components/organizer/RefundRegistrationButton";

export const metadata: Metadata = { title: "Inscritos" };

import { BADGE } from "@/lib/badge-colors";

const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED:       { label: "Confirmada", color: BADGE.green },
  CANCELLED:       { label: "Cancelada", color: BADGE.red },
  TRANSFERRED:     { label: "Transferida", color: BADGE.blue },
  WAITLISTED:      { label: "Lista de espera", color: BADGE.gray },
};
```

Replace it with:
```tsx
import RefundRegistrationButton from "@/components/organizer/RefundRegistrationButton";
import CancellationDecisionButtons from "@/components/organizer/CancellationDecisionButtons";

export const metadata: Metadata = { title: "Inscritos" };

import { BADGE } from "@/lib/badge-colors";

const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED:       { label: "Confirmada", color: BADGE.green },
  CANCELLED:       { label: "Cancelada", color: BADGE.red },
  TRANSFERRED:     { label: "Transferida", color: BADGE.blue },
  WAITLISTED:      { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
};
```

Find:
```tsx
                    <td className="py-2">
                      {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                    </td>
```

Replace it with:
```tsx
                    <td className="py-2">
                      <div className="flex flex-col gap-1">
                        {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                        {r.status === "CANCELLATION_REQUESTED" && <CancellationDecisionButtons registrationId={r.id} />}
                      </div>
                    </td>
```

- [ ] **Step 3: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/organizer/CancellationDecisionButtons.tsx app/organizador/eventos/[id]/inscritos/page.tsx
git commit -m "feat: organizador aprova ou rejeita solicitacoes de cancelamento na tabela de inscritos"
```

---

## Task 9: Verificação manual no ambiente descartável de VPS

**Files:** nenhum (só verificação).

- [ ] **Step 1: Preparar o ambiente**

Seguir o padrão já usado nos sub-projetos anteriores: clone git em `/home/lundy/sistema_inscricoes_corridas` na VPS `192.168.0.115`, container `postgres:16-alpine` descartável na porta 15432, app rodando via `docker run node:20-bookworm-slim ... npm run dev`. Depois do `git pull`, rodar **`npx prisma db push` seguido de `npx prisma generate`** e **reiniciar o servidor dev** (lição operacional do sub-projeto 4: `db push` sozinho não atualiza o Prisma Client já carregado pelo processo em execução). Rodar `npm run db:seed` se o banco for novo.

- [ ] **Step 2: Interruptor desligado — nada muda**

Login como atleta em um evento futuro com inscrição `CONFIRMED`. Confirmar que o botão "Cancelar inscrição" aparece sem campo de justificativa e que o cancelamento é imediato, exatamente como antes desta mudança. Confirmar em `/admin/configuracoes` que o toggle "Política de cancelamento por evento" existe e está desligado por padrão.

- [ ] **Step 3: Ligar o interruptor e configurar um evento com prazo expirado**

Como admin, ligar o toggle em `/admin/configuracoes`. Como organizador, editar um evento e configurar `cancellationDeadline` no passado (sem exigir aprovação). Como o atleta dono de uma inscrição `CONFIRMED` nesse evento, abrir a página de detalhe da inscrição e confirmar que o botão "Cancelar inscrição" **não aparece** (via SQL, também vale conferir uma chamada direta à rota retornando 400 "Prazo de cancelamento encerrado").

- [ ] **Step 4: Prazo futuro, sem exigir aprovação — cancelamento automático**

Configurar `cancellationDeadline` no futuro em outro evento, `cancellationRequiresApproval = false`. Confirmar que o atleta consegue cancelar normalmente e a inscrição vai direto para `CANCELLED` (Order cancelado, soldCount decrementado, AuditLog `REGISTRATION_CANCELLED`).

- [ ] **Step 5: Fluxo completo de aprovação**

Configurar um evento com `cancellationRequiresApproval = true` e um `cancellationContactEmail` válido (usar SMTP de teste já configurado nas sessões anteriores, se disponível, para confirmar o disparo do e-mail; caso não esteja configurado, confirmar que a ausência de SMTP não quebra a requisição — falha silenciosa esperada). Como atleta, cancelar informando uma justificativa: confirmar que a resposta é "Solicitação enviada — aguardando aprovação do organizador", que o status vira `CANCELLATION_REQUESTED` no banco, e que `Order`/`soldCount` **não** mudam. Como organizador, abrir `/organizador/eventos/[id]/inscritos`, confirmar o badge "Cancelamento solicitado" e os botões "Aprovar"/"Rejeitar". Testar "Rejeitar" primeiro (volta para `CONFIRMED`, vaga nunca foi liberada) e depois, em uma segunda solicitação, testar "Aprovar" (vira `CANCELLED`, `Order` cancelado, `soldCount` decrementado uma única vez).

- [ ] **Step 6: Encerrar o ambiente**

`docker kill`/`docker rm -f` nos containers de teste, conforme padrão dos sub-projetos anteriores.

- [ ] **Step 7: Relatar ao usuário**

Resumir o que foi verificado, quaisquer achados menores (backlog, não bloqueantes), e aguardar autorização explícita antes de qualquer push/deploy em produção — a alteração toca uma rota de produção sensível (`app/api/registrations/[id]/cancel/route.ts`) e o schema do banco.
