# Reenvio Manual de Notificação de Pagamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que organizador e admin reenviem manualmente (e-mail + WhatsApp) o aviso de que
uma inscrição foi cancelada por pagamento não identificado, com um texto que deixa isso explícito e
convida o atleta a se inscrever de novo.

**Architecture:** `notifyPaymentError` (já existente, disparado automaticamente pelo webhook/cron)
ganha uma opção para pular a deduplicação; duas rotas novas (organizador e admin) resolvem a
inscrição → pagamento expirado/cancelado e chamam essa função com a opção ativada; um botão
compartilhado aparece nas duas telas de inscritos quando aplicável.

**Tech Stack:** Next.js App Router (route handlers), Prisma, Vitest.

## Global Constraints

- `notifyPaymentError(paymentId, options?)` com `options.bypassDedupe === true` ignora
  `claimAlert`/`unclaimAlert` — os 3 chamadores existentes (webhook, `orders/[id]/status`,
  `expire-payments`) continuam chamando sem o segundo argumento, comportamento inalterado.
- Texto novo (e-mail e WhatsApp) usado tanto no disparo automático quanto no manual — mesmo
  template para os dois.
- As duas rotas novas só agem sobre o pagamento mais recente do pedido com status `EXPIRED` ou
  `CANCELLED` (`orderBy: createdAt desc`, já que esses pagamentos não têm `paidAt`); sem isso,
  retornam 400.
- Cada rota grava `AuditLog` com `action: "PAYMENT_ERROR_NOTIFICATION_RESENT"`,
  `entityType: "Payment"`, `userId` de quem disparou.
- O botão na tela de inscritos do admin (hoje somente leitura) é uma exceção deliberada e restrita
  a essa ação específica — não abre precedente para os outros botões (estornar, aprovar/rejeitar
  cancelamento, confirmar manualmente), que continuam fora do admin.
- Spec completa em
  `docs/superpowers/specs/2026-07-04-reenvio-manual-notificacao-pagamento-design.md`.

---

### Task 1: Templates novos e `bypassDedupe` em `notifyPaymentError`

**Files:**
- Modify: `lib/email.ts` (`sendPaymentErrorEmail`)
- Modify: `lib/alerts/payment-error.ts`
- Modify: `tests/alert-payment-error.test.ts`

**Interfaces:**
- Produces: `notifyPaymentError(paymentId: string, options?: { bypassDedupe?: boolean }):
  Promise<void>` — usada pelas Tasks 2 e 3 (chamadores existentes continuam funcionando sem o
  segundo argumento).
- Produces: `sendPaymentErrorEmail(params: { to: string; name: string; eventTitle: string;
  eventSlug: string })` — troca `orderId` por `eventSlug` (o link do e-mail muda de
  `/dashboard/inscricoes` para `/eventos/{slug}`, a página pública do evento, já que o CTA agora é
  "faça uma nova inscrição").

- [ ] **Step 1: Atualizar `tests/alert-payment-error.test.ts` (falhando)**

Substitua o `paymentFixture` e ajuste os testes existentes que checam o payload do e-mail; adicione
2 testes novos para `bypassDedupe`. Substitua o conteúdo do arquivo por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendPaymentErrorEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getPaymentErrorAlertSettings: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  claimAlert: vi.fn(),
  unclaimAlert: vi.fn(),
}));

import { notifyPaymentError } from "@/lib/alerts/payment-error";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const paymentFixture = {
  order: {
    id: "order-1",
    event: { title: "Corrida Teste", slug: "corrida-teste" },
    buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
  },
};

describe("notifyPaymentError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false });

    await notifyPaymentError("payment-1");

    expect(dbMock.payment.findUnique).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pagamento não é encontrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(null);

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
  });

  it("envia e-mail e reivindica o alerta", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(claimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "Payment", "payment-1", "EMAIL");
    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", eventSlug: "corrida-teste" }),
    );
  });

  it("não reenvia por e-mail quando outra execução já reivindicou o alerta", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
  });

  it("libera a reivindicação quando o envio de e-mail falha, para permitir nova tentativa depois", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await notifyPaymentError("payment-1");

    expect(unclaimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "payment-1", "EMAIL");
  });

  it("pula o WhatsApp sem quebrar quando o atleta não tem telefone cadastrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.payment.findUnique.mockResolvedValueOnce({
      order: { ...paymentFixture.order, buyer: { ...paymentFixture.order.buyer, athleteProfile: null } },
    });

    await notifyPaymentError("payment-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("nunca lança exceção, mesmo se o e-mail falhar", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyPaymentError("payment-1")).resolves.toBeUndefined();
  });

  it("com bypassDedupe: envia por e-mail mesmo que claimAlert diria não (nem chama claimAlert)", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1", { bypassDedupe: true });

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com" }),
    );
  });

  it("com bypassDedupe: não chama unclaimAlert se o envio falhar (nada foi reivindicado)", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await notifyPaymentError("payment-1", { bypassDedupe: true });

    expect(unclaimAlert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/alert-payment-error.test.ts`
Expected: FAIL — `sendPaymentErrorEmail` ainda espera `orderId`, não `eventSlug`; `bypassDedupe`
ainda não existe.

- [ ] **Step 3: Atualizar `sendPaymentErrorEmail` em `lib/email.ts`**

Troque a função inteira por:

```ts
export async function sendPaymentErrorEmail(params: {
  to: string;
  name: string;
  eventTitle: string;
  eventSlug: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/eventos/${params.eventSlug}`;
  await sendMail({
    to: params.to,
    subject: `Inscrição cancelada — pagamento não identificado — ${params.eventTitle}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Não conseguimos identificar o pagamento da sua inscrição em <strong>${params.eventTitle}</strong>, por isso ela foi cancelada.</p>
       <p>Não fique de fora! Faça agora mesmo uma nova inscrição e venha participar conosco.</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Fazer nova inscrição</a></p>`
    ),
  });
}
```

- [ ] **Step 4: Reescrever `lib/alerts/payment-error.ts`**

```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "./dedupe";

const ALERT_TYPE = "PAYMENT_ERROR";

export async function notifyPaymentError(
  paymentId: string,
  options?: { bypassDedupe?: boolean },
): Promise<void> {
  try {
    const settings = await getPaymentErrorAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        order: {
          select: {
            id: true,
            event: { select: { title: true, slug: true } },
            buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
          },
        },
      },
    });

    if (!payment) return;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const eventUrl = `${baseUrl}/eventos/${payment.order.event.slug}`;

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      const claimed = options?.bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Payment", paymentId, "EMAIL");
      if (isSmtpReady(cfg) && claimed) {
        try {
          await sendPaymentErrorEmail({
            to: payment.order.buyer.email,
            name: payment.order.buyer.name,
            eventTitle: payment.order.event.title,
            eventSlug: payment.order.event.slug,
          });
        } catch (err) {
          if (!options?.bypassDedupe) await unclaimAlert(ALERT_TYPE, paymentId, "EMAIL");
          throw err;
        }
      }
    }

    if (settings.whatsappEnabled && payment.order.buyer.athleteProfile?.phone) {
      const claimed = options?.bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Payment", paymentId, "WHATSAPP");
      if (claimed) {
        try {
          await sendWhatsAppMessage(
            payment.order.buyer.athleteProfile.phone,
            `Sua inscrição em "${payment.order.event.title}" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${eventUrl}`,
          );
        } catch (err) {
          if (!options?.bypassDedupe) await unclaimAlert(ALERT_TYPE, paymentId, "WHATSAPP");
          throw err;
        }
      }
    }
  } catch (err) {
    console.error("[notifyPaymentError] failed:", err);
  }
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/alert-payment-error.test.ts`
Expected: PASS (9 testes)

- [ ] **Step 6: Rodar a suíte inteira e o `tsc`**

Run: `npx vitest run && npx tsc --noEmit`
Expected: todos os testes passam; `tsc` sem erros (os 3 chamadores existentes de
`notifyPaymentError` continuam passando só `paymentId`, compatível com o novo segundo parâmetro
opcional).

- [ ] **Step 7: Commit**

```bash
git add lib/email.ts lib/alerts/payment-error.ts tests/alert-payment-error.test.ts
git commit -m "feat: novo texto de aviso de pagamento nao identificado e opcao de pular deduplicacao"
```

---

### Task 2: Rota de reenvio para o organizador

**Files:**
- Create: `app/api/organizer/registrations/[id]/resend-payment-notification/route.ts`
- Create: `tests/organizer-resend-payment-notification-route.test.ts`

**Interfaces:**
- Consumes: `notifyPaymentError(paymentId, { bypassDedupe: true })` da Task 1.
- Produces: `POST` retorna `{ success: true }` (200), `{ error }` (403/404/400) — consumido pela
  Task 4.

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `tests/organizer-resend-payment-notification-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/resend-payment-notification/route";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/organizer/registrations/reg-1/resend-payment-notification", {
    method: "POST",
  }) as any;
}

const registrationFixture = {
  id: "reg-1",
  order: { payments: [{ id: "payment-1" }] },
};

describe("POST /api/organizer/registrations/[id]/resend-payment-notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a um evento deste organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há pagamento expirado/cancelado para essa inscrição", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ id: "reg-1", order: { payments: [] } });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("chama notifyPaymentError com bypassDedupe e grava auditoria", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizer: { userId: "organizer-1" } } },
      }),
    );
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1", { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "organizer-1",
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Payment",
        entityId: "payment-1",
      }),
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/organizer-resend-payment-notification-route.test.ts`
Expected: FAIL — o módulo da rota ainda não existe.

- [ ] **Step 3: Criar a rota**

Crie `app/api/organizer/registrations/[id]/resend-payment-notification/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    include: {
      order: {
        include: {
          payments: { where: { status: { in: ["EXPIRED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Nenhum pagamento expirado/cancelado encontrado para esta inscrição" }, { status: 400 });
  }

  await notifyPaymentError(payment.id, { bypassDedupe: true });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
      entityType: "Payment",
      entityId: payment.id,
      metadata: { registrationId: id },
    },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/organizer-resend-payment-notification-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte inteira e o `tsc`**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/organizer/registrations/\[id\]/resend-payment-notification/route.ts tests/organizer-resend-payment-notification-route.test.ts
git commit -m "feat: rota do organizador para reenviar notificacao de pagamento nao identificado"
```

---

### Task 3: Rota de reenvio para o admin

**Files:**
- Create: `app/api/admin/registrations/[id]/resend-payment-notification/route.ts`
- Create: `tests/admin-resend-payment-notification-route.test.ts`

**Interfaces:**
- Consumes: `notifyPaymentError(paymentId, { bypassDedupe: true })` da Task 1.
- Produces: mesma resposta da Task 2 (`{ success: true }` / `{ error }`), consumida pela Task 4.

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `tests/admin-resend-payment-notification-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { POST } from "@/app/api/admin/registrations/[id]/resend-payment-notification/route";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/admin/registrations/reg-1/resend-payment-notification", {
    method: "POST",
  }) as any;
}

const registrationFixture = {
  id: "reg-1",
  order: { payments: [{ id: "payment-1" }] },
};

describe("POST /api/admin/registrations/[id]/resend-payment-notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin (inclusive organizador)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não existe", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há pagamento expirado/cancelado para essa inscrição", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ id: "reg-1", order: { payments: [] } });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(notifyPaymentError).not.toHaveBeenCalled();
  });

  it("chama notifyPaymentError com bypassDedupe e grava auditoria, sem filtrar por organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1" } }),
    );
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1", { bypassDedupe: true });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "admin-1",
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Payment",
        entityId: "payment-1",
      }),
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/admin-resend-payment-notification-route.test.ts`
Expected: FAIL — o módulo da rota ainda não existe.

- [ ] **Step 3: Criar a rota**

Crie `app/api/admin/registrations/[id]/resend-payment-notification/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id },
    include: {
      order: {
        include: {
          payments: { where: { status: { in: ["EXPIRED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Nenhum pagamento expirado/cancelado encontrado para esta inscrição" }, { status: 400 });
  }

  await notifyPaymentError(payment.id, { bypassDedupe: true });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
      entityType: "Payment",
      entityId: payment.id,
      metadata: { registrationId: id },
    },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/admin-resend-payment-notification-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte inteira e o `tsc`**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/registrations/\[id\]/resend-payment-notification/route.ts tests/admin-resend-payment-notification-route.test.ts
git commit -m "feat: rota do admin para reenviar notificacao de pagamento nao identificado"
```

---

### Task 4: Botão compartilhado e integração nas duas telas de inscritos

**Files:**
- Create: `components/registrations/ResendPaymentNotificationButton.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`
- Modify: `app/admin/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Consumes: `POST /api/organizer/registrations/[id]/resend-payment-notification` (Task 2) e
  `POST /api/admin/registrations/[id]/resend-payment-notification` (Task 3).

- [ ] **Step 1: Criar o botão**

Crie `components/registrations/ResendPaymentNotificationButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ResendPaymentNotificationButton({ endpoint }: { endpoint: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleResend() {
    setLoading(true);
    const res = await fetch(endpoint, { method: "POST" });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao reenviar notificação.");
    setLoading(false);
  }

  return (
    <button
      onClick={handleResend}
      disabled={loading}
      className="text-xs text-blue-600 hover:underline disabled:opacity-50"
    >
      {loading ? "Reenviando..." : "Reenviar notificação"}
    </button>
  );
}
```

- [ ] **Step 2: Adicionar o botão ao `renderActions` da tela do organizador**

Em `app/organizador/eventos/[id]/inscritos/page.tsx`, adicione o import:

```ts
import ResendPaymentNotificationButton from "@/components/registrations/ResendPaymentNotificationButton";
```

Troque o `renderActions` existente:

```tsx
          renderActions={(r) => {
            const payment = r.order.payments[0];
            return (
              <>
                {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                {r.status === "CANCELLATION_REQUESTED" && <CancellationDecisionButtons registrationId={r.id} />}
                {r.status === "PENDING_PAYMENT" && <ManualConfirmButton registrationId={r.id} />}
              </>
            );
          }}
```

por:

```tsx
          renderActions={(r) => {
            const payment = r.order.payments[0];
            return (
              <>
                {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                {r.status === "CANCELLATION_REQUESTED" && <CancellationDecisionButtons registrationId={r.id} />}
                {r.status === "PENDING_PAYMENT" && <ManualConfirmButton registrationId={r.id} />}
                {(payment?.status === "EXPIRED" || payment?.status === "CANCELLED") && (
                  <ResendPaymentNotificationButton
                    endpoint={`/api/organizer/registrations/${r.id}/resend-payment-notification`}
                  />
                )}
              </>
            );
          }}
```

- [ ] **Step 3: Adicionar `renderActions` (primeiro uso) à tela do admin**

Em `app/admin/eventos/[id]/inscritos/page.tsx`, adicione o import:

```ts
import ResendPaymentNotificationButton from "@/components/registrations/ResendPaymentNotificationButton";
```

Troque:

```tsx
        <RegistrationsTable registrations={registrations} />
```

por:

```tsx
        <RegistrationsTable
          registrations={registrations}
          renderActions={(r) => {
            const payment = r.order.payments[0];
            if (payment?.status === "EXPIRED" || payment?.status === "CANCELLED") {
              return (
                <ResendPaymentNotificationButton
                  endpoint={`/api/admin/registrations/${r.id}/resend-payment-notification`}
                />
              );
            }
            return null;
          }}
        />
```

- [ ] **Step 4: Rodar `tsc` e a suíte inteira**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sem erros, todos os testes passam.

- [ ] **Step 5: Verificação manual no navegador**

Suba `npm run dev`, acesse as duas telas de inscritos (organizador e admin) com um evento que tenha
uma inscrição cujo pagamento esteja `EXPIRED` ou `CANCELLED`, e confirme: o botão "Reenviar
notificação" aparece só nessas linhas, some quando não há pagamento expirado/cancelado, e clicar
nele completa sem erro (verifique nos logs do servidor se `notifyPaymentError` rodou, já que o envio
real de e-mail/WhatsApp depende de SMTP/WhatsApp configurados no ambiente).

- [ ] **Step 6: Commit**

```bash
git add components/registrations/ResendPaymentNotificationButton.tsx app/organizador/eventos/\[id\]/inscritos/page.tsx app/admin/eventos/\[id\]/inscritos/page.tsx
git commit -m "feat: botao de reenvio manual de notificacao nas telas de inscritos"
```
