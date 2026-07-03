# Conciliação de Pagamentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o organizador confirme manualmente uma inscrição pendente (com justificativa obrigatória), exibir o código de transação do gateway na tabela de inscritos, e implementar uma rotina de conciliação que compara o status local dos pagamentos com o status real no gateway — sinalizando divergências (nunca corrigindo sozinha) via alerta para o admin.

**Architecture:** A interface `PaymentProvider` ganha um método `checkPaymentStatus`. Uma nova rotina pura (`reconcilePayments`) varre `Payment`s pendentes, consulta o gateway configurado, e retorna divergências sem escrever no banco. Um novo módulo de alerta (fora do sistema de deduplicação por entidade do catálogo de alertas, já que é um resumo por execução) notifica os admins. Três rotas disparam a rotina: cron automático, botão manual do admin (plataforma toda), botão manual do organizador (só os eventos dele). A confirmação manual e o código de transação vivem na tabela de inscritos já existente.

**Tech Stack:** Next.js App Router, Prisma, Vitest, TypeScript.

## Global Constraints

- Conciliação **nunca escreve no banco** — só sinaliza divergências.
- Confirmação manual exige justificativa (mínimo 5 caracteres após `trim()`), só permitida em inscrições `PENDING_PAYMENT`, escopada ao evento do organizador.
- Alerta de divergência vai por e-mail para todo usuário com papel `ADMIN` (via `User.email`) e por WhatsApp via um novo campo `User.phone` (pulando quem não tiver telefone).
- O botão manual do admin roda sobre a plataforma toda e **não** dispara o alerta (o admin já vê o resultado na tela). O botão manual do organizador roda só sobre os eventos dele e **dispara** o alerta para o admin se houver divergência (além de mostrar o resultado na tela do próprio organizador).
- Nenhum componente React tem teste automatizado (convenção já estabelecida).

---

## Task 1: Schema — campo `User.phone`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `User.phone: string | null` — consumido pelas Tasks 4, 7.

- [ ] **Step 1: Adicionar o campo**

Find (em `prisma/schema.prisma`):
```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  passwordHash  String?
  name          String
  role          UserRole  @default(ATHLETE)
  active        Boolean   @default(true)
  uiDensity     String    @default("comfortable")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  athleteProfile   AthleteProfile?
  organizerProfile OrganizerProfile?
  orders           Order[]
  registrations    Registration[]
  auditLogs        AuditLog[]
  sessions         Session[]
  accounts         Account[]
  createdCoupons   Coupon[]          @relation("CouponCreator")
  refundsInitiated Refund[]

  @@map("users")
}
```

Replace it with:
```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  passwordHash  String?
  name          String
  phone         String?
  role          UserRole  @default(ATHLETE)
  active        Boolean   @default(true)
  uiDensity     String    @default("comfortable")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  athleteProfile   AthleteProfile?
  organizerProfile OrganizerProfile?
  orders           Order[]
  registrations    Registration[]
  auditLogs        AuditLog[]
  sessions         Session[]
  accounts         Account[]
  createdCoupons   Coupon[]          @relation("CouponCreator")
  refundsInitiated Refund[]

  @@map("users")
}
```

- [ ] **Step 2: Gerar o Prisma Client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sem erros. (Não rode `prisma db push` — sem banco acessível nesta sessão; isso acontece na verificação manual, Task 9.)

- [ ] **Step 3: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: adiciona campo phone ao usuario"
```

---

## Task 2: `PaymentProvider.checkPaymentStatus` (3 provedores)

**Files:**
- Modify: `lib/payment/types.ts`
- Modify: `lib/payment/sandbox.ts`
- Modify: `lib/payment/mercadopago.ts`
- Modify: `lib/payment/pagarme.ts`
- Test: `tests/payment-mercadopago-status.test.ts`
- Test: `tests/payment-pagarme-status.test.ts`
- Test: `tests/payment-sandbox-status.test.ts`

**Interfaces:**
- Produces: `PaymentStatusCheck = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK"`; `PaymentProvider.checkPaymentStatus(providerPaymentId: string): Promise<PaymentStatusCheck>` — consumido pela Task 3.

- [ ] **Step 1: Adicionar o tipo e o método à interface**

Find (em `lib/payment/types.ts`):
```ts
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload;
}
```

Replace it with:
```ts
export type PaymentStatusCheck = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK";

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload;
  checkPaymentStatus(providerPaymentId: string): Promise<PaymentStatusCheck>;
}
```

- [ ] **Step 2: Escrever os testes do Sandbox (falhando)**

Create `tests/payment-sandbox-status.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SandboxPaymentProvider } from "@/lib/payment/sandbox";

describe("SandboxPaymentProvider.checkPaymentStatus", () => {
  it("sempre retorna PENDING (não há gateway real para consultar)", async () => {
    const provider = new SandboxPaymentProvider();
    const result = await provider.checkPaymentStatus("sandbox_abc");
    expect(result).toBe("PENDING");
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha, depois implementar o Sandbox**

Run: `npx vitest run tests/payment-sandbox-status.test.ts`
Expected: FAIL — `checkPaymentStatus is not a function`.

Find (em `lib/payment/sandbox.ts`):
```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
} from "./types";
```

Replace it with:
```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
  PaymentStatusCheck,
} from "./types";
```

Find:
```ts
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload {
    return {
      providerPaymentId: String(payload.id),
      status: String(payload.status) as PaymentWebhookPayload["status"],
      paidAt: payload.paid_at ? String(payload.paid_at) : undefined,
      rawPayload: payload,
    };
  }
}
```

Replace it with:
```ts
  parseWebhookPayload(payload: Record<string, unknown>): PaymentWebhookPayload {
    return {
      providerPaymentId: String(payload.id),
      status: String(payload.status) as PaymentWebhookPayload["status"],
      paidAt: payload.paid_at ? String(payload.paid_at) : undefined,
      rawPayload: payload,
    };
  }

  async checkPaymentStatus(_providerPaymentId: string): Promise<PaymentStatusCheck> {
    return "PENDING";
  }
}
```

- [ ] **Step 4: Rodar os testes do Sandbox e confirmar que passam**

Run: `npx vitest run tests/payment-sandbox-status.test.ts`
Expected: PASS — 1/1 teste.

- [ ] **Step 5: Escrever os testes do Mercado Pago (falhando)**

Create `tests/payment-mercadopago-status.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: vi.fn().mockImplementation(() => ({})),
  Payment: vi.fn().mockImplementation(() => ({ get: getMock })),
  PaymentRefund: vi.fn(),
}));

vi.mock("@/lib/payment-settings", () => ({
  getMercadoPagoAccessToken: vi.fn().mockResolvedValue("test-token"),
  getMercadoPagoWebhookSecret: vi.fn().mockResolvedValue(""),
}));

import { MercadoPagoProvider } from "@/lib/payment/mercadopago";

describe("MercadoPagoProvider.checkPaymentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mapeia 'approved' para PAID", async () => {
    getMock.mockResolvedValueOnce({ status: "approved" });
    const provider = new MercadoPagoProvider();
    const result = await provider.checkPaymentStatus("123456");
    expect(getMock).toHaveBeenCalledWith({ id: "123456" });
    expect(result).toBe("PAID");
  });

  it("mapeia 'cancelled' para CANCELLED", async () => {
    getMock.mockResolvedValueOnce({ status: "cancelled" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("CANCELLED");
  });

  it("mapeia 'rejected' para CANCELLED", async () => {
    getMock.mockResolvedValueOnce({ status: "rejected" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("CANCELLED");
  });

  it("mapeia 'refunded' para REFUNDED", async () => {
    getMock.mockResolvedValueOnce({ status: "refunded" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("REFUNDED");
  });

  it("mapeia 'charged_back' para CHARGEBACK", async () => {
    getMock.mockResolvedValueOnce({ status: "charged_back" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("CHARGEBACK");
  });

  it("mapeia 'expired' para EXPIRED", async () => {
    getMock.mockResolvedValueOnce({ status: "expired" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("EXPIRED");
  });

  it("mapeia qualquer outro status (ex.: 'in_process') para PENDING", async () => {
    getMock.mockResolvedValueOnce({ status: "in_process" });
    const provider = new MercadoPagoProvider();
    expect(await provider.checkPaymentStatus("123456")).toBe("PENDING");
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha, depois implementar o Mercado Pago**

Run: `npx vitest run tests/payment-mercadopago-status.test.ts`
Expected: FAIL — `checkPaymentStatus is not a function`.

Find (em `lib/payment/mercadopago.ts`):
```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
} from "./types";
```

Replace it with:
```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
  PaymentStatusCheck,
} from "./types";
```

Find:
```ts
    return {
      providerPaymentId: id,
      status: mpToStatus[status] ?? "CANCELLED",
      rawPayload: payload,
    };
  }
}
```

Replace it with:
```ts
    return {
      providerPaymentId: id,
      status: mpToStatus[status] ?? "CANCELLED",
      rawPayload: payload,
    };
  }

  async checkPaymentStatus(providerPaymentId: string): Promise<PaymentStatusCheck> {
    const client = await getClient();
    const paymentApi = new Payment(client);
    const res = await paymentApi.get({ id: providerPaymentId });
    const statusMap: Record<string, PaymentStatusCheck> = {
      approved: "PAID",
      cancelled: "CANCELLED",
      rejected: "CANCELLED",
      refunded: "REFUNDED",
      charged_back: "CHARGEBACK",
      expired: "EXPIRED",
    };
    return statusMap[String(res.status)] ?? "PENDING";
  }
}
```

- [ ] **Step 7: Rodar os testes do Mercado Pago e confirmar que passam**

Run: `npx vitest run tests/payment-mercadopago-status.test.ts`
Expected: PASS — 7/7 testes.

- [ ] **Step 8: Escrever os testes do Pagar.me (falhando)**

Create `tests/payment-pagarme-status.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment-settings", () => ({
  getPagarMeApiKey: vi.fn().mockResolvedValue("test-key"),
  getPagarMeWebhookPassword: vi.fn().mockResolvedValue(""),
}));

import { PagarMeProvider } from "@/lib/payment/pagarme";

describe("PagarMeProvider.checkPaymentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("faz GET em /charges/{id} e mapeia 'paid' para PAID", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "paid" }) });
    const provider = new PagarMeProvider();
    const result = await provider.checkPaymentStatus("ch_123");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.pagar.me/core/v5/charges/ch_123",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toBe("PAID");
  });

  it("mapeia 'overpaid' para PAID", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "overpaid" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("PAID");
  });

  it("mapeia 'refunded' para REFUNDED", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "refunded" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("REFUNDED");
  });

  it("mapeia 'chargedback' para CHARGEBACK", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "chargedback" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("CHARGEBACK");
  });

  it("mapeia 'failed' para CANCELLED", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "failed" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("CANCELLED");
  });

  it("mapeia qualquer outro status (ex.: 'pending') para PENDING", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "pending" }) });
    const provider = new PagarMeProvider();
    expect(await provider.checkPaymentStatus("ch_123")).toBe("PENDING");
  });

  it("lança erro quando a chamada falha", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" });
    const provider = new PagarMeProvider();
    await expect(provider.checkPaymentStatus("ch_123")).rejects.toThrow("Pagar.me 404");
  });
});
```

- [ ] **Step 9: Rodar e confirmar que falha, depois implementar o Pagar.me**

Run: `npx vitest run tests/payment-pagarme-status.test.ts`
Expected: FAIL — `checkPaymentStatus is not a function`.

Find (em `lib/payment/pagarme.ts`):
```ts
const CHARGE_STATUS_MAP: Record<string, PaymentWebhookPayload["status"]> = {
  paid: "PAID",
  overpaid: "PAID",
  failed: "CANCELLED",
  canceled: "CANCELLED",
  chargedback: "CHARGEBACK",
  refunded: "REFUNDED",
  pending: "EXPIRED",
  waiting_payment: "EXPIRED",
};
```

Replace it with:
```ts
const CHARGE_STATUS_MAP: Record<string, PaymentWebhookPayload["status"]> = {
  paid: "PAID",
  overpaid: "PAID",
  failed: "CANCELLED",
  canceled: "CANCELLED",
  chargedback: "CHARGEBACK",
  refunded: "REFUNDED",
  pending: "EXPIRED",
  waiting_payment: "EXPIRED",
};

// Mapeamento dedicado para consulta de status em tempo real (diferente do mapa acima, que é
// específico para o contexto de webhook — ali "pending" é tratado como EXPIRED porque um webhook
// chegando com esse status é incomum; aqui "pending" é um status normal em trânsito).
const CHECK_STATUS_MAP: Record<string, PaymentStatusCheck> = {
  paid: "PAID",
  overpaid: "PAID",
  refunded: "REFUNDED",
  chargedback: "CHARGEBACK",
  failed: "CANCELLED",
  canceled: "CANCELLED",
};
```

Find:
```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
} from "./types";
```

Replace it with:
```ts
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentWebhookPayload,
  RefundPaymentInput,
  RefundPaymentResult,
  PaymentStatusCheck,
} from "./types";
```

Find:
```ts
    return {
      providerPaymentId: id,
      status,
      paidAt: status === "PAID" ? new Date().toISOString() : undefined,
      rawPayload: payload,
    };
  }
}
```

Replace it with:
```ts
    return {
      providerPaymentId: id,
      status,
      paidAt: status === "PAID" ? new Date().toISOString() : undefined,
      rawPayload: payload,
    };
  }

  async checkPaymentStatus(providerPaymentId: string): Promise<PaymentStatusCheck> {
    const res = await fetch(`${BASE_URL}/charges/${providerPaymentId}`, {
      method: "GET",
      headers: { Authorization: await authHeader() },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Pagar.me ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    return CHECK_STATUS_MAP[String(data.status)] ?? "PENDING";
  }
}
```

- [ ] **Step 10: Rodar os testes do Pagar.me e confirmar que passam**

Run: `npx vitest run tests/payment-pagarme-status.test.ts`
Expected: PASS — 7/7 testes.

- [ ] **Step 11: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros (o `SandboxPaymentProvider`/`MercadoPagoProvider`/`PagarMeProvider` continuam implementando `PaymentProvider` corretamente com o método novo).

- [ ] **Step 12: Commit**

```bash
git add lib/payment/types.ts lib/payment/sandbox.ts lib/payment/mercadopago.ts lib/payment/pagarme.ts tests/payment-sandbox-status.test.ts tests/payment-mercadopago-status.test.ts tests/payment-pagarme-status.test.ts
git commit -m "feat: adiciona checkPaymentStatus aos 3 provedores de pagamento"
```

---

## Task 3: Configuração + rotina de conciliação

**Files:**
- Modify: `lib/alerts/alert-settings.ts`
- Create: `lib/payment/reconciliation.ts`
- Test: `tests/payment-reconciliation.test.ts`

**Interfaces:**
- Consumes: `PaymentProvider.checkPaymentStatus` (Task 2).
- Produces: `ReconciliationAlertSettings { emailEnabled, whatsappEnabled, minutesThreshold }`, `getReconciliationAlertSettings(): Promise<ReconciliationAlertSettings>` — consumido pelas Tasks 4, 5, 8; `PaymentMismatch { paymentId, orderId, eventTitle, localStatus, gatewayStatus }`, `reconcilePayments(options?: { organizerUserId?: string }): Promise<{ checked: number; mismatches: PaymentMismatch[] }>` — consumido pelas Tasks 4, 5.

- [ ] **Step 1: Adicionar o getter de configuração**

Find (em `lib/alerts/alert-settings.ts`):
```ts
export async function getPaymentErrorAlertSettings(): Promise<PaymentErrorAlertSettings> {
  const [emailEnabled, whatsappEnabled] = await Promise.all([
    getSetting("alert_payment_error_email_enabled"),
    getSetting("alert_payment_error_whatsapp_enabled"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
  };
}
```

Replace it with:
```ts
export async function getPaymentErrorAlertSettings(): Promise<PaymentErrorAlertSettings> {
  const [emailEnabled, whatsappEnabled] = await Promise.all([
    getSetting("alert_payment_error_email_enabled"),
    getSetting("alert_payment_error_whatsapp_enabled"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
  };
}

export interface ReconciliationAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  minutesThreshold: number;
}

export async function getReconciliationAlertSettings(): Promise<ReconciliationAlertSettings> {
  const [emailEnabled, whatsappEnabled, minutesThreshold] = await Promise.all([
    getSetting("alert_reconciliation_email_enabled"),
    getSetting("alert_reconciliation_whatsapp_enabled"),
    getSetting("alert_reconciliation_minutes_threshold"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
    minutesThreshold: minutesThreshold ? parseInt(minutesThreshold, 10) : 15,
  };
}
```

- [ ] **Step 2: Escrever os testes de `reconcilePayments` (falhando)**

Create `tests/payment-reconciliation.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getReconciliationAlertSettings: vi.fn() }));

import { reconcilePayments } from "@/lib/payment/reconciliation";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const paymentFixture = {
  id: "payment-1",
  providerPaymentId: "mp-1",
  status: "PENDING",
  order: { id: "order-1", event: { title: "Corrida Teste" } },
};

describe("reconcilePayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
  });

  it("consulta pagamentos PENDING mais antigos que o limiar", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments();

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING", providerPaymentId: { not: null }, createdAt: { lte: expect.any(Date) } }),
      }),
    );
  });

  it("filtra por organizador quando organizerUserId é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments({ organizerUserId: "org-1" });

    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ order: { event: { organizer: { userId: "org-1" } } } }),
      }),
    );
  });

  it("não filtra por organizador quando organizerUserId não é informado", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus: vi.fn() } as any);

    await reconcilePayments();

    const call = dbMock.payment.findMany.mock.calls[0][0];
    expect(call.where.order).toBeUndefined();
  });

  it("detecta divergência quando o status do gateway é diferente do local", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([paymentFixture]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
    } as any);

    const result = await reconcilePayments();

    expect(result).toEqual({
      checked: 1,
      mismatches: [
        { paymentId: "payment-1", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID" },
      ],
    });
  });

  it("não reporta nada quando o status do gateway bate com o local", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([paymentFixture]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PENDING"),
    } as any);

    const result = await reconcilePayments();

    expect(result).toEqual({ checked: 1, mismatches: [] });
  });

  it("nunca escreve no banco, mesmo quando encontra divergência", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([paymentFixture]);
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      checkPaymentStatus: vi.fn().mockResolvedValueOnce("PAID"),
    } as any);

    await reconcilePayments();

    expect(dbMock.payment.update).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("continua processando os demais pagamentos quando um falha ao consultar o gateway", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([
      { ...paymentFixture, id: "payment-1" },
      { ...paymentFixture, id: "payment-2", providerPaymentId: "mp-2" },
    ]);
    const checkPaymentStatus = vi.fn()
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValueOnce("PAID");
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({ checkPaymentStatus } as any);

    const result = await reconcilePayments();

    expect(checkPaymentStatus).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      checked: 2,
      mismatches: [
        { paymentId: "payment-2", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID" },
      ],
    });
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/payment-reconciliation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/payment/reconciliation'`.

- [ ] **Step 4: Implementar `reconcilePayments`**

Create `lib/payment/reconciliation.ts`:
```ts
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";

export interface PaymentMismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
}

export async function reconcilePayments(options?: { organizerUserId?: string }): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const settings = await getReconciliationAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const payments = await db.payment.findMany({
    where: {
      status: "PENDING",
      providerPaymentId: { not: null },
      createdAt: { lte: cutoff },
      ...(options?.organizerUserId
        ? { order: { event: { organizer: { userId: options.organizerUserId } } } }
        : {}),
    },
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      order: { select: { id: true, event: { select: { title: true } } } },
    },
  });

  const provider = await getPaymentProvider();
  const mismatches: PaymentMismatch[] = [];

  for (const payment of payments) {
    try {
      const gatewayStatus = await provider.checkPaymentStatus(payment.providerPaymentId as string);
      if (gatewayStatus !== payment.status) {
        mismatches.push({
          paymentId: payment.id,
          orderId: payment.order.id,
          eventTitle: payment.order.event.title,
          localStatus: payment.status,
          gatewayStatus,
        });
      }
    } catch (err) {
      console.error("[reconcilePayments] failed to check payment", payment.id, err);
    }
  }

  return { checked: payments.length, mismatches };
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/payment-reconciliation.test.ts`
Expected: PASS — 7/7 testes.

- [ ] **Step 6: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/alerts/alert-settings.ts lib/payment/reconciliation.ts tests/payment-reconciliation.test.ts
git commit -m "feat: rotina de conciliacao de pagamentos (somente leitura)"
```

---

## Task 4: Alerta de divergências de conciliação

**Files:**
- Modify: `lib/email.ts`
- Create: `lib/alerts/reconciliation.ts`
- Test: `tests/alert-reconciliation.test.ts`

**Interfaces:**
- Consumes: `PaymentMismatch`, `getReconciliationAlertSettings` (Task 3).
- Produces: `sendReconciliationMismatchEmail(params)` em `lib/email.ts`; `notifyReconciliationMismatches(mismatches: PaymentMismatch[]): Promise<void>` — consumido pela Task 5.

- [ ] **Step 1: Adicionar o template de e-mail**

Find (em `lib/email.ts`):
```ts
/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

Replace it with:
```ts
/** E-mail avisando o admin sobre divergências encontradas na conciliação de pagamentos. */
export async function sendReconciliationMismatchEmail(params: {
  to: string;
  mismatches: { paymentId: string; orderId: string; eventTitle: string; localStatus: string; gatewayStatus: string }[];
}): Promise<void> {
  const appName = await getAppName();
  const rows = params.mismatches
    .map(
      (m) =>
        `<tr><td>${m.eventTitle}</td><td>${m.orderId}</td><td>${m.localStatus}</td><td>${m.gatewayStatus}</td></tr>`,
    )
    .join("");
  await sendMail({
    to: params.to,
    subject: `Conciliação de pagamentos — ${params.mismatches.length} divergência(s) encontrada(s)`,
    html: layout(
      appName,
      `<p>A rotina de conciliação encontrou divergências entre o status local e o status no gateway de pagamento:</p>
       <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
         <thead><tr><th>Evento</th><th>Pedido</th><th>Status local</th><th>Status no gateway</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
       <p>Nenhuma correção automática foi feita — revise manualmente em Admin → Conciliação.</p>`
    ),
  });
}

/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

- [ ] **Step 2: Escrever os testes (falhando)**

Create `tests/alert-reconciliation.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendReconciliationMismatchEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getReconciliationAlertSettings: vi.fn(),
}));

import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendReconciliationMismatchEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const mismatchFixture = [
  { paymentId: "payment-1", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID" },
];

describe("notifyReconciliationMismatches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("não faz nada quando não há divergências", async () => {
    await notifyReconciliationMismatches([]);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 15 });

    await notifyReconciliationMismatches(mismatchFixture);

    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });

  it("envia e-mail para todo usuário com papel ADMIN", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValueOnce([
      { email: "admin1@example.com", phone: null },
      { email: "admin2@example.com", phone: "5511999999999" },
    ]);

    await notifyReconciliationMismatches(mismatchFixture);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "ADMIN" } }));
    expect(sendReconciliationMismatchEmail).toHaveBeenCalledTimes(2);
    expect(sendReconciliationMismatchEmail).toHaveBeenCalledWith({ to: "admin1@example.com", mismatches: mismatchFixture });
  });

  it("pula o WhatsApp para admins sem telefone cadastrado", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValueOnce([
      { email: "admin1@example.com", phone: null },
      { email: "admin2@example.com", phone: "5511999999999" },
    ]);

    await notifyReconciliationMismatches(mismatchFixture);

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
  });

  it("nunca lança exceção, mesmo se o e-mail falhar", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValueOnce([{ email: "admin1@example.com", phone: null }]);
    vi.mocked(sendReconciliationMismatchEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyReconciliationMismatches(mismatchFixture)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/alert-reconciliation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/alerts/reconciliation'`.

- [ ] **Step 4: Implementar `notifyReconciliationMismatches`**

Create `lib/alerts/reconciliation.ts`:
```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendReconciliationMismatchEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getReconciliationAlertSettings } from "./alert-settings";
import type { PaymentMismatch } from "@/lib/payment/reconciliation";

export async function notifyReconciliationMismatches(mismatches: PaymentMismatch[]): Promise<void> {
  if (mismatches.length === 0) return;

  try {
    const settings = await getReconciliationAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const admins = await db.user.findMany({
      where: { role: "ADMIN" },
      select: { email: true, phone: true },
    });

    if (settings.emailEnabled) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        for (const admin of admins) {
          try {
            await sendReconciliationMismatchEmail({ to: admin.email, mismatches });
          } catch (err) {
            console.error("[notifyReconciliationMismatches] email failed for", admin.email, err);
          }
        }
      }
    }

    if (settings.whatsappEnabled) {
      for (const admin of admins) {
        if (!admin.phone) continue;
        try {
          await sendWhatsAppMessage(
            admin.phone,
            `Conciliação de pagamentos encontrou ${mismatches.length} divergência(s). Acesse /admin/conciliacao para revisar.`,
          );
        } catch (err) {
          console.error("[notifyReconciliationMismatches] whatsapp failed for", admin.phone, err);
        }
      }
    }
  } catch (err) {
    console.error("[notifyReconciliationMismatches] failed:", err);
  }
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/alert-reconciliation.test.ts`
Expected: PASS — 6/6 testes.

- [ ] **Step 6: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/email.ts lib/alerts/reconciliation.ts tests/alert-reconciliation.test.ts
git commit -m "feat: alerta de divergencias de conciliacao para o admin"
```

---

## Task 5: Rotas de disparo (cron, admin, organizador)

**Files:**
- Create: `app/api/cron/reconciliation/route.ts`
- Create: `app/api/admin/reconciliation/route.ts`
- Create: `app/api/organizer/reconciliation/route.ts`
- Test: `tests/cron-reconciliation-route.test.ts`
- Test: `tests/admin-reconciliation-route.test.ts`
- Test: `tests/organizer-reconciliation-route.test.ts`

**Interfaces:**
- Consumes: `reconcilePayments` (Task 3), `notifyReconciliationMismatches` (Task 4).
- Produces: `POST /api/cron/reconciliation`, `POST /api/admin/reconciliation`, `POST /api/organizer/reconciliation` — todas retornam `{ checked: number; mismatches: PaymentMismatch[] }` — consumidas pela Task 8 (UI).

- [ ] **Step 1: Escrever os testes do cron (falhando)**

Create `tests/cron-reconciliation-route.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));
vi.mock("@/lib/alerts/reconciliation", () => ({ notifyReconciliationMismatches: vi.fn() }));

import { POST } from "@/app/api/cron/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/reconciliation", { method: "POST", headers }) as any;
}

describe("POST /api/cron/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("retorna 401 quando o segredo não bate", async () => {
    const res = await POST(makeRequest({ "x-cron-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação e não dispara alerta quando não há divergências", async () => {
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 3, mismatches: [] });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ checked: 3, mismatches: [] });
    expect(notifyReconciliationMismatches).not.toHaveBeenCalled();
  });

  it("dispara o alerta quando há divergências", async () => {
    const mismatches = [{ paymentId: "p1", orderId: "o1", eventTitle: "Corrida", localStatus: "PENDING", gatewayStatus: "PAID" }];
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 1, mismatches });

    await POST(makeRequest({ "x-cron-secret": "test-secret" }));

    expect(notifyReconciliationMismatches).toHaveBeenCalledWith(mismatches);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha, depois implementar a rota de cron**

Run: `npx vitest run tests/cron-reconciliation-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/cron/reconciliation/route'`.

Create `app/api/cron/reconciliation/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const result = await reconcilePayments();
  if (result.mismatches.length > 0) {
    void notifyReconciliationMismatches(result.mismatches);
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 3: Rodar os testes do cron e confirmar que passam**

Run: `npx vitest run tests/cron-reconciliation-route.test.ts`
Expected: PASS — 3/3 testes.

- [ ] **Step 4: Escrever os testes do admin (falhando)**

Create `tests/admin-reconciliation-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));

import { POST } from "@/app/api/admin/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";

const authMock = vi.mocked(auth);

describe("POST /api/admin/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação sem filtro de organizador e retorna o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 5, mismatches: [] });

    const res = await POST();
    const body = await res.json();

    expect(reconcilePayments).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 5, mismatches: [] });
  });
});
```

- [ ] **Step 5: Rodar e confirmar que falha, depois implementar a rota do admin**

Run: `npx vitest run tests/admin-reconciliation-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/reconciliation/route'`.

Create `app/api/admin/reconciliation/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reconcilePayments } from "@/lib/payment/reconciliation";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await reconcilePayments();
  return NextResponse.json(result);
}
```

- [ ] **Step 6: Rodar os testes do admin e confirmar que passam**

Run: `npx vitest run tests/admin-reconciliation-route.test.ts`
Expected: PASS — 2/2 testes.

- [ ] **Step 7: Escrever os testes do organizador (falhando)**

Create `tests/organizer-reconciliation-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));
vi.mock("@/lib/alerts/reconciliation", () => ({ notifyReconciliationMismatches: vi.fn() }));

import { POST } from "@/app/api/organizer/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

const authMock = vi.mocked(auth);

describe("POST /api/organizer/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação escopada ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 2, mismatches: [] });

    await POST();

    expect(reconcilePayments).toHaveBeenCalledWith({ organizerUserId: "org-1" });
  });

  it("dispara o alerta para o admin quando encontra divergências", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const mismatches = [{ paymentId: "p1", orderId: "o1", eventTitle: "Corrida", localStatus: "PENDING", gatewayStatus: "PAID" }];
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 1, mismatches });

    await POST();

    expect(notifyReconciliationMismatches).toHaveBeenCalledWith(mismatches);
  });
});
```

- [ ] **Step 8: Rodar e confirmar que falha, depois implementar a rota do organizador**

Run: `npx vitest run tests/organizer-reconciliation-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/organizer/reconciliation/route'`.

Create `app/api/organizer/reconciliation/route.ts`:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

export async function POST() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await reconcilePayments({ organizerUserId: session.user.id });
  if (result.mismatches.length > 0) {
    void notifyReconciliationMismatches(result.mismatches);
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 9: Rodar os testes do organizador e confirmar que passam**

Run: `npx vitest run tests/organizer-reconciliation-route.test.ts`
Expected: PASS — 3/3 testes.

- [ ] **Step 10: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 11: Commit**

```bash
git add app/api/cron/reconciliation app/api/admin/reconciliation app/api/organizer/reconciliation tests/cron-reconciliation-route.test.ts tests/admin-reconciliation-route.test.ts tests/organizer-reconciliation-route.test.ts
git commit -m "feat: rotas de disparo da conciliacao de pagamentos"
```

---

## Task 6: Confirmação manual + código de transação (alto cuidado)

**Files:**
- Modify: `lib/admin/labels.ts`
- Create: `app/api/organizer/registrations/[id]/manual-confirm/route.ts`
- Create: `components/organizer/ManualConfirmButton.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`
- Test: `tests/organizer-manual-confirm-route.test.ts`

**Interfaces:**
- Consumes: `notifyOrderConfirmed` (já existente, `lib/notifications.ts`).
- Produces: `POST /api/organizer/registrations/[id]/manual-confirm` com corpo `{ reason: string }` — consumida pelo `ManualConfirmButton`.

- [ ] **Step 1: Adicionar o rótulo de auditoria**

Find (em `lib/admin/labels.ts`):
```ts
  PAGE_VIEWED: "Página acessada",
  CART_ABANDONED: "Carrinho abandonado",
};
```

Replace it with:
```ts
  PAGE_VIEWED: "Página acessada",
  CART_ABANDONED: "Carrinho abandonado",
  REGISTRATION_MANUALLY_CONFIRMED: "Inscrição confirmada manualmente",
};
```

- [ ] **Step 2: Escrever os testes da rota (falhando)**

Create `tests/organizer-manual-confirm-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/manual-confirm/route";
import { notifyOrderConfirmed } from "@/lib/notifications";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/manual-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const registrationFixture = {
  id: "reg-1",
  status: "PENDING_PAYMENT",
  orderId: "order-1",
  order: { id: "order-1", payments: [{ id: "payment-1" }] },
};

describe("POST /api/organizer/registrations/[id]/manual-confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        payment: { update: vi.fn() },
        order: { update: vi.fn() },
        registration: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 400 com justificativa curta demais", async () => {
    const res = await POST(makeRequest({ reason: "ok" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a um evento deste organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a inscrição não está aguardando pagamento", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ ...registrationFixture, status: "CONFIRMED" });
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há nenhum pagamento associado ao pedido", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ ...registrationFixture, order: { id: "order-1", payments: [] } });
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("confirma a inscrição, o pagamento e o pedido, grava auditoria com o motivo, e notifica o atleta", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);
    const txPaymentUpdate = vi.fn();
    const txOrderUpdate = vi.fn();
    const txRegistrationUpdate = vi.fn();
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        payment: { update: txPaymentUpdate },
        order: { update: txOrderUpdate },
        registration: { update: txRegistrationUpdate },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await POST(
      makeRequest({ reason: "Pagamento recebido via PIX manual, comprovante conferido" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(txPaymentUpdate).toHaveBeenCalledWith({ where: { id: "payment-1" }, data: expect.objectContaining({ status: "PAID" }) });
    expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "PAID" } });
    expect(txRegistrationUpdate).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: { status: "CONFIRMED" } });
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "REGISTRATION_MANUALLY_CONFIRMED",
          metadata: { reason: "Pagamento recebido via PIX manual, comprovante conferido" },
        }),
      }),
    );
    expect(notifyOrderConfirmed).toHaveBeenCalledWith("order-1");
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/organizer-manual-confirm-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/organizer/registrations/[id]/manual-confirm/route'`.

- [ ] **Step 4: Implementar a rota**

Create `app/api/organizer/registrations/[id]/manual-confirm/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyOrderConfirmed } from "@/lib/notifications";

const schema = z.object({
  reason: z.string(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe uma justificativa" }, { status: 400 });
  }

  const reason = parsed.data.reason.trim();
  if (reason.length < 5) {
    return NextResponse.json({ error: "Justifique o motivo da confirmação manual" }, { status: 400 });
  }

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: {
      id: true,
      status: true,
      order: {
        select: {
          id: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  if (registration.status !== "PENDING_PAYMENT") {
    return NextResponse.json({ error: "Esta inscrição não está aguardando pagamento" }, { status: 400 });
  }

  const payment = registration.order.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Nenhum pagamento encontrado para esta inscrição" }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date() },
    });

    await tx.order.update({
      where: { id: registration.order.id },
      data: { status: "PAID" },
    });

    await tx.registration.update({
      where: { id },
      data: { status: "CONFIRMED" },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGISTRATION_MANUALLY_CONFIRMED",
        entityType: "Registration",
        entityId: id,
        metadata: { reason },
      },
    });
  });

  void notifyOrderConfirmed(registration.order.id);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/organizer-manual-confirm-route.test.ts`
Expected: PASS — 6/6 testes.

- [ ] **Step 6: Criar o botão de confirmação manual**

Create `components/organizer/ManualConfirmButton.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ManualConfirmButton({ registrationId }: { registrationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    setLoading(true);
    const res = await fetch(`/api/organizer/registrations/${registrationId}/manual-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Erro ao confirmar inscrição.");
    setLoading(false);
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Justifique o motivo da confirmação manual"
          className="input-field text-xs"
          rows={2}
        />
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={loading || reason.trim().length < 5}
            className="text-xs text-green-600 hover:underline disabled:opacity-50"
          >
            {loading ? "Confirmando..." : "Confirmar"}
          </button>
          <button onClick={() => setConfirming(false)} className="text-xs text-gray-500 hover:underline">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="text-xs text-green-600 hover:underline">
      Confirmar manualmente
    </button>
  );
}
```

- [ ] **Step 7: Adicionar o código de transação e o botão na tabela de inscritos**

Find (em `app/organizador/eventos/[id]/inscritos/page.tsx`):
```tsx
import RefundRegistrationButton from "@/components/organizer/RefundRegistrationButton";
import CancellationDecisionButtons from "@/components/organizer/CancellationDecisionButtons";
```

Replace it with:
```tsx
import RefundRegistrationButton from "@/components/organizer/RefundRegistrationButton";
import CancellationDecisionButtons from "@/components/organizer/CancellationDecisionButtons";
import ManualConfirmButton from "@/components/organizer/ManualConfirmButton";
```

Find:
```tsx
      order: {
        select: {
          totalAmount: true,
          payments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { method: true, paidAt: true, status: true },
          },
        },
      },
```

Replace it with:
```tsx
      order: {
        select: {
          totalAmount: true,
          payments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { method: true, paidAt: true, status: true, providerPaymentId: true },
          },
        },
      },
```

Find:
```tsx
                <th className="pb-2 pr-4">Pagamento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Data pag.</th>
                <th className="pb-2 pr-4">Data inscrição</th>
```

Replace it with:
```tsx
                <th className="pb-2 pr-4">Pagamento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Data pag.</th>
                <th className="pb-2 pr-4">Cód. transação</th>
                <th className="pb-2 pr-4">Data inscrição</th>
```

Find:
```tsx
                    <td className="py-2 pr-4 text-gray-700">
                      {payment?.paidAt ? formatDate(payment.paidAt, "dd/MM/yyyy HH:mm") : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatDate(r.createdAt, "dd/MM/yyyy HH:mm")}
                    </td>
```

Replace it with:
```tsx
                    <td className="py-2 pr-4 text-gray-700">
                      {payment?.paidAt ? formatDate(payment.paidAt, "dd/MM/yyyy HH:mm") : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 font-mono text-xs truncate max-w-[10rem]">
                      {payment?.providerPaymentId ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatDate(r.createdAt, "dd/MM/yyyy HH:mm")}
                    </td>
```

Find:
```tsx
                    <td className="py-2">
                      <div className="flex flex-col gap-1">
                        {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                        {r.status === "CANCELLATION_REQUESTED" && <CancellationDecisionButtons registrationId={r.id} />}
                      </div>
                    </td>
```

Replace it with:
```tsx
                    <td className="py-2">
                      <div className="flex flex-col gap-1">
                        {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                        {r.status === "CANCELLATION_REQUESTED" && <CancellationDecisionButtons registrationId={r.id} />}
                        {r.status === "PENDING_PAYMENT" && <ManualConfirmButton registrationId={r.id} />}
                      </div>
                    </td>
```

- [ ] **Step 8: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: tudo passa (nenhuma regressão nos testes existentes da tabela de inscritos — nenhum teste de rota cobre esta página hoje, só a rota nova é testada).

- [ ] **Step 10: Commit**

```bash
git add lib/admin/labels.ts app/api/organizer/registrations/[id]/manual-confirm components/organizer/ManualConfirmButton.tsx app/organizador/eventos/[id]/inscritos/page.tsx tests/organizer-manual-confirm-route.test.ts
git commit -m "feat: confirmacao manual de inscricao e exibicao do codigo de transacao"
```

---

## Task 7: Perfil do admin (campo de telefone)

**Files:**
- Create: `app/api/admin/profile/route.ts`
- Create: `app/admin/perfil/page.tsx`
- Test: `tests/admin-profile-route.test.ts`

**Interfaces:**
- Consumes: `User.phone` (Task 1).
- Produces: `GET`/`PUT /api/admin/profile` → `{ profile: { phone: string | null } }`.

- [ ] **Step 1: Escrever os testes da rota (falhando)**

Create `tests/admin-profile-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/admin/profile/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("admin profile api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("retorna o telefone do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.findUnique.mockResolvedValueOnce({ phone: "5511999999999" });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({ profile: { phone: "5511999999999" } });
    });
  });

  describe("PUT", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await PUT(makeRequest({ phone: "5511999999999" }));
      expect(res.status).toBe(403);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("atualiza o telefone do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.update.mockResolvedValueOnce({ phone: "5511999999999" });

      const res = await PUT(makeRequest({ phone: "5511999999999" }));
      const body = await res.json();

      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: "admin-1" },
        data: { phone: "5511999999999" },
        select: { phone: true },
      });
      expect(body).toEqual({ profile: { phone: "5511999999999" } });
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-profile-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/profile/route'`.

- [ ] **Step 3: Implementar a rota**

Create `app/api/admin/profile/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  phone: z.string().optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { phone: true },
  });

  return NextResponse.json({ profile: user });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await db.user.update({
    where: { id: session.user.id },
    data: { phone: parsed.data.phone || null },
    select: { phone: true },
  });

  return NextResponse.json({ profile: user });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-profile-route.test.ts`
Expected: PASS — 4/4 testes.

- [ ] **Step 5: Criar a página de perfil do admin**

Create `app/admin/perfil/page.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export default function AdminPerfilPage() {
  const { data: session } = useSession();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/profile")
      .then((r) => r.json())
      .then(({ profile }) => { if (profile?.phone) setPhone(profile.phone); })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/admin/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.trim() || null }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meu perfil</h1>

      <div className="card">
        <p className="text-sm text-gray-600">{session?.user?.name} · {session?.user?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone (WhatsApp)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input-field w-full"
            placeholder="(11) 99999-9999"
          />
          <p className="text-xs text-gray-500 mt-1">Usado para receber alertas de conciliação de pagamentos por WhatsApp.</p>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/profile app/admin/perfil tests/admin-profile-route.test.ts
git commit -m "feat: pagina de perfil do admin com campo de telefone"
```

---

## Task 8: UI — páginas de conciliação, card de alerta, links de menu

**Files:**
- Create: `components/payment/ReconciliationPanel.tsx`
- Create: `app/admin/conciliacao/page.tsx`
- Create: `app/organizador/conciliacao/page.tsx`
- Modify: `app/admin/alertas/page.tsx`
- Modify: `components/admin/AdminNav.tsx`
- Modify: `components/organizer/OrganizerNav.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/reconciliation`, `POST /api/organizer/reconciliation` (Task 5); `getReconciliationAlertSettings` (Task 3).

Sem testes automatizados de UI (convenção já estabelecida); verificação manual na Task 9.

- [ ] **Step 1: Criar o painel reutilizável**

Create `components/payment/ReconciliationPanel.tsx`:
```tsx
"use client";

import { useState } from "react";

interface Mismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
}

export default function ReconciliationPanel({ endpoint }: { endpoint: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ checked: number; mismatches: Mismatch[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao verificar");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card space-y-4">
      <button type="button" onClick={handleRun} disabled={running} className="btn-primary px-6 disabled:opacity-50">
        {running ? "Verificando..." : "Verificar agora"}
      </button>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {result.checked} pagamento(s) verificado(s), {result.mismatches.length} divergência(s) encontrada(s).
          </p>
          {result.mismatches.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4">Evento</th>
                  <th className="pb-2 pr-4">Pedido</th>
                  <th className="pb-2 pr-4">Status local</th>
                  <th className="pb-2">Status no gateway</th>
                </tr>
              </thead>
              <tbody>
                {result.mismatches.map((m) => (
                  <tr key={m.paymentId} className="border-b dark:border-gray-700 last:border-0">
                    <td className="py-2 pr-4">{m.eventTitle}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{m.orderId}</td>
                    <td className="py-2 pr-4">{m.localStatus}</td>
                    <td className="py-2">{m.gatewayStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Criar a página do admin**

Create `app/admin/conciliacao/page.tsx`:
```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import ReconciliationPanel from "@/components/payment/ReconciliationPanel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conciliação — Admin" };

export default async function AdminConciliacaoPage() {
  await requireAdmin();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Conciliação de pagamentos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Compara o status local dos pagamentos pendentes da plataforma toda com o status real no gateway de pagamento.
          Nenhuma correção é feita automaticamente — só sinaliza divergências.
        </p>
      </div>

      <ReconciliationPanel endpoint="/api/admin/reconciliation" />
    </div>
  );
}
```

- [ ] **Step 3: Criar a página do organizador**

Create `app/organizador/conciliacao/page.tsx`:
```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import ReconciliationPanel from "@/components/payment/ReconciliationPanel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conciliação" };

export default async function OrganizerConciliacaoPage() {
  await requireOrganizer();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Conciliação de pagamentos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Compara o status local dos pagamentos pendentes dos seus eventos com o status real no gateway de pagamento.
          Nenhuma correção é feita automaticamente — só sinaliza divergências.
        </p>
      </div>

      <ReconciliationPanel endpoint="/api/organizer/reconciliation" />
    </div>
  );
}
```

- [ ] **Step 4: Adicionar o 4º card em `/admin/alertas`**

Find (em `app/admin/alertas/page.tsx`):
```tsx
import {
  getLowStockAlertSettings,
  getAbandonedCartAlertSettings,
  getPaymentErrorAlertSettings,
} from "@/lib/alerts/alert-settings";
```

Replace it with:
```tsx
import {
  getLowStockAlertSettings,
  getAbandonedCartAlertSettings,
  getPaymentErrorAlertSettings,
  getReconciliationAlertSettings,
} from "@/lib/alerts/alert-settings";
```

Find:
```tsx
  const [lowStock, abandonedCart, paymentError] = await Promise.all([
    getLowStockAlertSettings(),
    getAbandonedCartAlertSettings(),
    getPaymentErrorAlertSettings(),
  ]);
```

Replace it with:
```tsx
  const [lowStock, abandonedCart, paymentError, reconciliation] = await Promise.all([
    getLowStockAlertSettings(),
    getAbandonedCartAlertSettings(),
    getPaymentErrorAlertSettings(),
    getReconciliationAlertSettings(),
  ]);
```

Find:
```tsx
      <AlertConfigCard
        title="Erro de pagamento"
        description="Avisa o atleta quando um pagamento é recusado ou expira."
        emailKey="alert_payment_error_email_enabled"
        whatsappKey="alert_payment_error_whatsapp_enabled"
        currentEmailEnabled={paymentError.emailEnabled}
        currentWhatsappEnabled={paymentError.whatsappEnabled}
      />
    </div>
  );
}
```

Replace it with:
```tsx
      <AlertConfigCard
        title="Erro de pagamento"
        description="Avisa o atleta quando um pagamento é recusado ou expira."
        emailKey="alert_payment_error_email_enabled"
        whatsappKey="alert_payment_error_whatsapp_enabled"
        currentEmailEnabled={paymentError.emailEnabled}
        currentWhatsappEnabled={paymentError.whatsappEnabled}
      />

      <AlertConfigCard
        title="Divergência de conciliação"
        description="Avisa todo admin quando a conciliação encontra pagamentos pendentes há muito tempo com status diferente no gateway. Requer uma tarefa agendada (crontab) chamando /api/cron/reconciliation, ou pode ser disparada manualmente em Admin/Organizador → Conciliação."
        emailKey="alert_reconciliation_email_enabled"
        whatsappKey="alert_reconciliation_whatsapp_enabled"
        paramKey="alert_reconciliation_minutes_threshold"
        paramLabel="Após"
        paramSuffix="minutos pendente"
        currentEmailEnabled={reconciliation.emailEnabled}
        currentWhatsappEnabled={reconciliation.whatsappEnabled}
        currentParamValue={reconciliation.minutesThreshold}
      />
    </div>
  );
}
```

- [ ] **Step 5: Adicionar os links no menu do admin**

Find (em `components/admin/AdminNav.tsx`):
```tsx
          <Link href="/admin/alertas" className="hover:text-gray-300">Alertas</Link>
        </div>
```

Replace it with:
```tsx
          <Link href="/admin/alertas" className="hover:text-gray-300">Alertas</Link>
          <Link href="/admin/conciliacao" className="hover:text-gray-300">Conciliação</Link>
          <Link href="/admin/perfil" className="hover:text-gray-300">Perfil</Link>
        </div>
```

- [ ] **Step 6: Adicionar o link no menu do organizador**

Find (em `components/organizer/OrganizerNav.tsx`, o bloco de navegação em tela larga):
```tsx
            <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
```

Replace it with:
```tsx
            <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
            <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
```

Find (o bloco de navegação em tela estreita, no final do arquivo):
```tsx
          <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
        </div>
      </div>
    </nav>
  );
}
```

Replace it with:
```tsx
          <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
          <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 7: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: tudo passa.

- [ ] **Step 9: Commit**

```bash
git add components/payment/ReconciliationPanel.tsx app/admin/conciliacao app/organizador/conciliacao app/admin/alertas/page.tsx components/admin/AdminNav.tsx components/organizer/OrganizerNav.tsx
git commit -m "feat: paginas de conciliacao, 4o card de alerta e links de menu"
```

---

## Task 9: Verificação manual

**Files:** nenhum (só verificação).

- [ ] **Step 1: Preparar o ambiente**

Mesmo padrão de VPS descartável usado nos sub-projetos anteriores. Depois do `git pull`, rodar `npx prisma db push` (para adicionar a coluna `phone` em `users`) seguido de `npx prisma generate`, e **reiniciar o servidor dev**.

- [ ] **Step 2: Código de transação**

Com um pedido pago existente, confirmar que a coluna "Cód. transação" aparece corretamente na tabela de inscritos do organizador.

- [ ] **Step 3: Confirmação manual**

Com uma inscrição `PENDING_PAYMENT`, clicar "Confirmar manualmente" sem justificativa (botão deve ficar desabilitado), depois com uma justificativa válida — confirmar que a inscrição vira `CONFIRMED`, o pedido `PAID`, o pagamento `PAID`, e que existe uma entrada `AuditLog` (`REGISTRATION_MANUALLY_CONFIRMED`) com o motivo. Confirmar também que o botão não aparece para inscrições já confirmadas/canceladas.

- [ ] **Step 4: Conciliação — divergência real**

Usando `PAYMENT_PROVIDER=sandbox`, criar manualmente (via SQL) uma divergência: um `Payment` com `status="PENDING"`, `providerPaymentId` preenchido, `createdAt` mais antigo que o limiar configurado. Como o Sandbox sempre retorna `"PENDING"` em `checkPaymentStatus`, para testar uma divergência real de verdade é necessário rodar contra um provedor real (Mercado Pago/Pagar.me) em modo sandbox deles, OU documentar que — com `PAYMENT_PROVIDER=sandbox` — nenhuma divergência jamais é detectada (comportamento esperado, já documentado no spec) e validar o "caminho feliz" (checked > 0, mismatches vazio) nesse modo. Se um dos gateways reais estiver configurável no ambiente de teste, validar também o caminho de divergência de verdade.

- [ ] **Step 5: Alerta e botões manuais**

Ligar o alerta de conciliação (e-mail) em `/admin/alertas`. Cadastrar um telefone em `/admin/perfil`. Clicar "Verificar agora" em `/admin/conciliacao` — confirmar que o resultado aparece na tela e que **nenhum** e-mail é disparado (disparo manual do admin não aciona alerta). Clicar "Verificar agora" em `/organizador/conciliacao` (como organizador, com uma divergência real ou simulada nos seus próprios eventos) — confirmar que o resultado aparece na tela do organizador **e** que o e-mail chega ao admin (ou falha silenciosamente se SMTP não estiver configurado no ambiente de teste). Confirmar que `POST /api/cron/reconciliation` sem o segredo correto retorna 401.

- [ ] **Step 6: Relatar ao usuário**

Resumir o que foi verificado (incluindo se SMTP/gateway real estavam configurados no ambiente de teste) e aguardar autorização explícita antes de qualquer push/deploy em produção — esta mudança adiciona um campo ao schema (`User.phone`), uma nova capacidade de mutação de dados financeiros (confirmação manual) e novas rotas que consultam gateways de pagamento externos.
