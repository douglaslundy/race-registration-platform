# Catálogo de Alertas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar 3 alertas automáticos (vagas se esgotando, carrinho abandonado, erro de pagamento) com configuração por canal (e-mail/WhatsApp) e parâmetro simples no admin, todos desligados por padrão.

**Architecture:** Catálogo fixo no código (sem motor de regras). Infraestrutura compartilhada: tabela `AlertLog` para deduplicação, configuração via `PlatformSetting` (já existente), um módulo por alerta em `lib/alerts/`. Dois alertas são disparados por eventos já existentes (checkout, transição de pagamento); o terceiro (carrinho abandonado) usa uma rota de cron protegida por segredo, chamada por crontab do SO.

**Tech Stack:** Next.js App Router, Prisma, Vitest.

## Global Constraints

- Os 3 alertas vêm **desligados por padrão** (e-mail e WhatsApp) — nenhum e-mail/WhatsApp real é enviado até o admin ativar em `/admin/alertas`.
- Toda modificação em rota existente (`app/api/checkout/route.ts`, `app/api/webhooks/payment/route.ts`, `app/api/orders/[id]/status/route.ts`) é uma única chamada `void <função>(...)` no final do fluxo já existente — nunca lança exceção, nunca muda a resposta da rota.
- Carrinho abandonado dispara **uma única vez por pedido** (deduplicação permanente via `AlertLog`).
- Vagas se esgotando dispara **uma única vez por lote** (sem re-disparo se a capacidade for aumentada depois — limitação conhecida da v1).
- WhatsApp usa `sendWhatsAppMessage(phone, text)` (sub-projeto 6a) — se falhar (não configurado, telefone ausente), a falha é engolida sem quebrar o e-mail do mesmo alerta.
- Nenhum componente React tem teste automatizado (convenção já estabelecida).

---

## Task 1: Infraestrutura compartilhada (schema, configuração, dedupe)

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/setup.ts`
- Create: `lib/alerts/alert-settings.ts`
- Create: `lib/alerts/dedupe.ts`
- Test: `tests/alert-settings.test.ts`
- Test: `tests/alert-dedupe.test.ts`

**Interfaces:**
- Produces: `LowStockAlertSettings { emailEnabled, whatsappEnabled, thresholdPercent }`, `AbandonedCartAlertSettings { emailEnabled, whatsappEnabled, minutesThreshold }`, `PaymentErrorAlertSettings { emailEnabled, whatsappEnabled }`, `getLowStockAlertSettings()`, `getAbandonedCartAlertSettings()`, `getPaymentErrorAlertSettings()`; `AlertChannel = "EMAIL" | "WHATSAPP"`, `hasAlertBeenSent(alertType, entityId, channel): Promise<boolean>`, `markAlertSent(alertType, entityType, entityId, channel): Promise<void>` — todos consumidos pelas Tasks 2, 3, 4.

- [ ] **Step 1: Adicionar a tabela `AlertLog` ao schema**

Find (no final de `prisma/schema.prisma`):
```prisma
model PlatformSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt

  @@map("platform_settings")
}
```

Replace it with:
```prisma
model PlatformSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt

  @@map("platform_settings")
}

model AlertLog {
  id         String   @id @default(cuid())
  alertType  String
  entityType String
  entityId   String
  channel    String
  sentAt     DateTime @default(now())

  @@unique([alertType, entityId, channel])
  @@map("alert_logs")
}
```

- [ ] **Step 2: Gerar o Prisma Client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sem erros. (Não rode `prisma db push` — sem banco acessível nesta sessão; isso acontece na verificação manual, Task 8.)

- [ ] **Step 3: Adicionar os novos mocks em `tests/setup.ts`**

Find:
```ts
    organizerProfile: { upsert: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({
```

Replace it with:
```ts
    organizerProfile: { upsert: vi.fn(), findUnique: vi.fn() },
    alertLog: { findUnique: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn({
```

- [ ] **Step 4: Escrever os testes de `alert-settings.ts` (falhando)**

Create `tests/alert-settings.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));

import { getSetting } from "@/lib/settings";
import {
  getLowStockAlertSettings,
  getAbandonedCartAlertSettings,
  getPaymentErrorAlertSettings,
} from "@/lib/alerts/alert-settings";

const getSettingMock = vi.mocked(getSetting);

describe("alert-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getLowStockAlertSettings", () => {
    it("retorna os valores padrão quando nada está configurado", async () => {
      getSettingMock.mockResolvedValue(null);
      const result = await getLowStockAlertSettings();
      expect(result).toEqual({ emailEnabled: false, whatsappEnabled: false, thresholdPercent: 90 });
    });

    it("retorna os valores configurados", async () => {
      getSettingMock.mockImplementation(async (key: string) => {
        if (key === "alert_low_stock_email_enabled") return "true";
        if (key === "alert_low_stock_whatsapp_enabled") return "true";
        if (key === "alert_low_stock_threshold_percent") return "80";
        return null;
      });
      const result = await getLowStockAlertSettings();
      expect(result).toEqual({ emailEnabled: true, whatsappEnabled: true, thresholdPercent: 80 });
    });
  });

  describe("getAbandonedCartAlertSettings", () => {
    it("retorna os valores padrão quando nada está configurado", async () => {
      getSettingMock.mockResolvedValue(null);
      const result = await getAbandonedCartAlertSettings();
      expect(result).toEqual({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 30 });
    });

    it("retorna os valores configurados", async () => {
      getSettingMock.mockImplementation(async (key: string) => {
        if (key === "alert_abandoned_cart_email_enabled") return "true";
        if (key === "alert_abandoned_cart_minutes") return "45";
        return null;
      });
      const result = await getAbandonedCartAlertSettings();
      expect(result).toEqual({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 45 });
    });
  });

  describe("getPaymentErrorAlertSettings", () => {
    it("retorna os valores padrão quando nada está configurado", async () => {
      getSettingMock.mockResolvedValue(null);
      const result = await getPaymentErrorAlertSettings();
      expect(result).toEqual({ emailEnabled: false, whatsappEnabled: false });
    });

    it("retorna os valores configurados", async () => {
      getSettingMock.mockImplementation(async (key: string) => {
        if (key === "alert_payment_error_whatsapp_enabled") return "true";
        return null;
      });
      const result = await getPaymentErrorAlertSettings();
      expect(result).toEqual({ emailEnabled: false, whatsappEnabled: true });
    });
  });
});
```

- [ ] **Step 5: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/alert-settings.test.ts`
Expected: FAIL — `Cannot find module '@/lib/alerts/alert-settings'`.

- [ ] **Step 6: Implementar `alert-settings.ts`**

Create `lib/alerts/alert-settings.ts`:
```ts
import { getSetting } from "../settings";

export interface LowStockAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  thresholdPercent: number;
}

export interface AbandonedCartAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  minutesThreshold: number;
}

export interface PaymentErrorAlertSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
}

export async function getLowStockAlertSettings(): Promise<LowStockAlertSettings> {
  const [emailEnabled, whatsappEnabled, thresholdPercent] = await Promise.all([
    getSetting("alert_low_stock_email_enabled"),
    getSetting("alert_low_stock_whatsapp_enabled"),
    getSetting("alert_low_stock_threshold_percent"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
    thresholdPercent: thresholdPercent ? parseInt(thresholdPercent, 10) : 90,
  };
}

export async function getAbandonedCartAlertSettings(): Promise<AbandonedCartAlertSettings> {
  const [emailEnabled, whatsappEnabled, minutesThreshold] = await Promise.all([
    getSetting("alert_abandoned_cart_email_enabled"),
    getSetting("alert_abandoned_cart_whatsapp_enabled"),
    getSetting("alert_abandoned_cart_minutes"),
  ]);
  return {
    emailEnabled: emailEnabled === "true",
    whatsappEnabled: whatsappEnabled === "true",
    minutesThreshold: minutesThreshold ? parseInt(minutesThreshold, 10) : 30,
  };
}

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

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/alert-settings.test.ts`
Expected: PASS — 6/6 testes.

- [ ] **Step 8: Escrever os testes de `dedupe.ts` (falhando)**

Create `tests/alert-dedupe.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasAlertBeenSent, markAlertSent } from "@/lib/alerts/dedupe";

const dbMock = db as any;

describe("alert dedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasAlertBeenSent", () => {
    it("retorna false quando não há registro em AlertLog", async () => {
      dbMock.alertLog.findUnique.mockResolvedValueOnce(null);
      const result = await hasAlertBeenSent("LOW_STOCK", "batch-1", "EMAIL");
      expect(result).toBe(false);
      expect(dbMock.alertLog.findUnique).toHaveBeenCalledWith({
        where: { alertType_entityId_channel: { alertType: "LOW_STOCK", entityId: "batch-1", channel: "EMAIL" } },
      });
    });

    it("retorna true quando já existe um registro", async () => {
      dbMock.alertLog.findUnique.mockResolvedValueOnce({ id: "log-1" });
      const result = await hasAlertBeenSent("LOW_STOCK", "batch-1", "EMAIL");
      expect(result).toBe(true);
    });
  });

  describe("markAlertSent", () => {
    it("grava um novo registro em AlertLog", async () => {
      await markAlertSent("LOW_STOCK", "TicketBatch", "batch-1", "EMAIL");
      expect(dbMock.alertLog.create).toHaveBeenCalledWith({
        data: { alertType: "LOW_STOCK", entityType: "TicketBatch", entityId: "batch-1", channel: "EMAIL" },
      });
    });
  });
});
```

- [ ] **Step 9: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/alert-dedupe.test.ts`
Expected: FAIL — `Cannot find module '@/lib/alerts/dedupe'`.

- [ ] **Step 10: Implementar `dedupe.ts`**

Create `lib/alerts/dedupe.ts`:
```ts
import { db } from "@/lib/db";

export type AlertChannel = "EMAIL" | "WHATSAPP";

export async function hasAlertBeenSent(alertType: string, entityId: string, channel: AlertChannel): Promise<boolean> {
  const existing = await db.alertLog.findUnique({
    where: { alertType_entityId_channel: { alertType, entityId, channel } },
  });
  return existing !== null;
}

export async function markAlertSent(
  alertType: string,
  entityType: string,
  entityId: string,
  channel: AlertChannel,
): Promise<void> {
  await db.alertLog.create({
    data: { alertType, entityType, entityId, channel },
  });
}
```

- [ ] **Step 11: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/alert-dedupe.test.ts`
Expected: PASS — 3/3 testes.

- [ ] **Step 12: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 13: Commit**

```bash
git add prisma/schema.prisma tests/setup.ts lib/alerts/alert-settings.ts lib/alerts/dedupe.ts tests/alert-settings.test.ts tests/alert-dedupe.test.ts
git commit -m "feat: infraestrutura compartilhada do catalogo de alertas (schema, configuracao, dedupe)"
```

---

## Task 2: Alerta de vagas se esgotando

**Files:**
- Modify: `lib/email.ts`
- Create: `lib/alerts/low-stock.ts`
- Test: `tests/alert-low-stock.test.ts`

**Interfaces:**
- Consumes: `getLowStockAlertSettings` (Task 1), `hasAlertBeenSent`/`markAlertSent` (Task 1), `sendWhatsAppMessage` (sub-projeto 6a, `lib/whatsapp.ts`), `getSmtpConfig`/`isSmtpReady` (`lib/smtp-settings.ts`, já existente).
- Produces: `sendLowStockEmail(params)` em `lib/email.ts`; `checkLowStockAlert(ticketBatchId: string): Promise<void>` — consumida pela Task 5.

- [ ] **Step 1: Adicionar o template de e-mail**

Find (em `lib/email.ts`):
```ts
/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

Replace it with:
```ts
/** E-mail avisando o organizador que um lote está quase esgotado. */
export async function sendLowStockEmail(params: {
  to: string;
  organizerName: string;
  eventTitle: string;
  batchName: string;
  soldCount: number;
  capacity: number;
}): Promise<void> {
  const appName = await getAppName();
  const percent = Math.round((params.soldCount / params.capacity) * 100);
  await sendMail({
    to: params.to,
    subject: `Vagas se esgotando — ${params.eventTitle}`,
    html: layout(
      appName,
      `<p>Olá ${params.organizerName},</p>
       <p>O lote <strong>${params.batchName}</strong> do evento <strong>${params.eventTitle}</strong> já vendeu
       <strong>${params.soldCount} de ${params.capacity}</strong> vagas (${percent}%).</p>
       <p>Considere abrir um novo lote em breve.</p>`
    ),
  });
}

/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

- [ ] **Step 2: Escrever os testes (falhando)**

Create `tests/alert-low-stock.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendLowStockEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getLowStockAlertSettings: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  hasAlertBeenSent: vi.fn(),
  markAlertSent: vi.fn(),
}));

import { checkLowStockAlert } from "@/lib/alerts/low-stock";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendLowStockEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getLowStockAlertSettings } from "@/lib/alerts/alert-settings";
import { hasAlertBeenSent, markAlertSent } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const batchFixture = {
  id: "batch-1",
  name: "Lote 1",
  capacity: 100,
  soldCount: 95,
  event: {
    title: "Corrida Teste",
    organizer: {
      phone: "5511999999999",
      user: { name: "Organizador", email: "organizador@example.com" },
    },
  },
};

describe("checkLowStockAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(hasAlertBeenSent).mockResolvedValue(false);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, thresholdPercent: 90 });

    await checkLowStockAlert("batch-1");

    expect(dbMock.ticketBatch.findUnique).not.toHaveBeenCalled();
  });

  it("não dispara quando o percentual vendido está abaixo do limiar", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce({ ...batchFixture, soldCount: 50 });

    await checkLowStockAlert("batch-1");

    expect(sendLowStockEmail).not.toHaveBeenCalled();
  });

  it("envia e-mail e grava AlertLog quando o percentual atinge o limiar", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce(batchFixture);

    await checkLowStockAlert("batch-1");

    expect(sendLowStockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "organizador@example.com", soldCount: 95, capacity: 100 }),
    );
    expect(markAlertSent).toHaveBeenCalledWith("LOW_STOCK", "TicketBatch", "batch-1", "EMAIL");
  });

  it("não reenvia por e-mail quando já foi alertado", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    vi.mocked(hasAlertBeenSent).mockResolvedValue(true);
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce(batchFixture);

    await checkLowStockAlert("batch-1");

    expect(sendLowStockEmail).not.toHaveBeenCalled();
  });

  it("envia WhatsApp quando habilitado e o organizador tem telefone", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce(batchFixture);

    await checkLowStockAlert("batch-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    expect(markAlertSent).toHaveBeenCalledWith("LOW_STOCK", "TicketBatch", "batch-1", "WHATSAPP");
  });

  it("pula o WhatsApp sem quebrar quando o organizador não tem telefone cadastrado", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce({
      ...batchFixture,
      event: { ...batchFixture.event, organizer: { ...batchFixture.event.organizer, phone: null } },
    });

    await checkLowStockAlert("batch-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("não faz nada quando a capacidade do lote é zero", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce({ ...batchFixture, capacity: 0 });

    await checkLowStockAlert("batch-1");

    expect(sendLowStockEmail).not.toHaveBeenCalled();
  });

  it("nunca lança exceção, mesmo se o e-mail falhar", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce(batchFixture);
    vi.mocked(sendLowStockEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(checkLowStockAlert("batch-1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/alert-low-stock.test.ts`
Expected: FAIL — `Cannot find module '@/lib/alerts/low-stock'`.

- [ ] **Step 4: Implementar `checkLowStockAlert`**

Create `lib/alerts/low-stock.ts`:
```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendLowStockEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getLowStockAlertSettings } from "./alert-settings";
import { hasAlertBeenSent, markAlertSent } from "./dedupe";

const ALERT_TYPE = "LOW_STOCK";

export async function checkLowStockAlert(ticketBatchId: string): Promise<void> {
  try {
    const settings = await getLowStockAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const batch = await db.ticketBatch.findUnique({
      where: { id: ticketBatchId },
      select: {
        id: true,
        name: true,
        capacity: true,
        soldCount: true,
        event: {
          select: {
            title: true,
            organizer: {
              select: { phone: true, user: { select: { name: true, email: true } } },
            },
          },
        },
      },
    });

    if (!batch || batch.capacity <= 0) return;

    const percent = (batch.soldCount / batch.capacity) * 100;
    if (percent < settings.thresholdPercent) return;

    const organizer = batch.event.organizer;

    if (settings.emailEnabled && !(await hasAlertBeenSent(ALERT_TYPE, ticketBatchId, "EMAIL"))) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        await sendLowStockEmail({
          to: organizer.user.email,
          organizerName: organizer.user.name,
          eventTitle: batch.event.title,
          batchName: batch.name,
          soldCount: batch.soldCount,
          capacity: batch.capacity,
        });
        await markAlertSent(ALERT_TYPE, "TicketBatch", ticketBatchId, "EMAIL");
      }
    }

    if (
      settings.whatsappEnabled &&
      organizer.phone &&
      !(await hasAlertBeenSent(ALERT_TYPE, ticketBatchId, "WHATSAPP"))
    ) {
      await sendWhatsAppMessage(
        organizer.phone,
        `Alerta: o lote "${batch.name}" do evento "${batch.event.title}" já vendeu ${batch.soldCount} de ${batch.capacity} vagas.`,
      );
      await markAlertSent(ALERT_TYPE, "TicketBatch", ticketBatchId, "WHATSAPP");
    }
  } catch (err) {
    console.error("[checkLowStockAlert] failed:", err);
  }
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/alert-low-stock.test.ts`
Expected: PASS — 8/8 testes.

- [ ] **Step 6: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/email.ts lib/alerts/low-stock.ts tests/alert-low-stock.test.ts
git commit -m "feat: alerta de vagas se esgotando"
```

---

## Task 3: Alerta de carrinho abandonado

**Files:**
- Modify: `lib/email.ts`
- Modify: `tests/setup.ts`
- Create: `lib/alerts/abandoned-cart.ts`
- Test: `tests/alert-abandoned-cart.test.ts`

**Interfaces:**
- Consumes: `getAbandonedCartAlertSettings` (Task 1), `hasAlertBeenSent`/`markAlertSent` (Task 1), `sendWhatsAppMessage`, `getSmtpConfig`/`isSmtpReady`.
- Produces: `sendAbandonedCartEmail(params)` em `lib/email.ts`; `checkAbandonedCarts(): Promise<{ checked: number; notified: number }>` — consumida pela Task 6.

- [ ] **Step 1: Adicionar `findMany` ao mock de `order` em `tests/setup.ts`**

Find:
```ts
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
```

Replace it with:
```ts
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
```

- [ ] **Step 2: Adicionar o template de e-mail**

Find (em `lib/email.ts`, o template acrescentado na Task 2):
```ts
/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

Replace it with:
```ts
/** E-mail avisando o atleta que o pedido está pendente há tempo demais. */
export async function sendAbandonedCartEmail(params: {
  to: string;
  name: string;
  eventTitle: string;
  orderId: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/dashboard/inscricoes`;
  await sendMail({
    to: params.to,
    subject: `Finalize sua inscrição — ${params.eventTitle}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Notamos que você iniciou uma inscrição em <strong>${params.eventTitle}</strong> mas o pagamento ainda não foi concluído.</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Finalizar pagamento</a></p>`
    ),
  });
}

/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

- [ ] **Step 3: Escrever os testes (falhando)**

Create `tests/alert-abandoned-cart.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendAbandonedCartEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getAbandonedCartAlertSettings: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  hasAlertBeenSent: vi.fn(),
  markAlertSent: vi.fn(),
}));

import { checkAbandonedCarts } from "@/lib/alerts/abandoned-cart";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { hasAlertBeenSent, markAlertSent } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const orderFixture = {
  id: "order-1",
  event: { title: "Corrida Teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

describe("checkAbandonedCarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(hasAlertBeenSent).mockResolvedValue(false);
  });

  it("não consulta pedidos quando os dois canais estão desligados", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 30 });

    const result = await checkAbandonedCarts();

    expect(dbMock.order.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, notified: 0 });
  });

  it("filtra por status PENDING e createdAt mais antigo que o limiar de minutos", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await checkAbandonedCarts();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING", createdAt: { lte: expect.any(Date) } } }),
    );
  });

  it("envia e-mail e grava AlertLog para um pedido pendente ainda não alertado", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", orderId: "order-1" }),
    );
    expect(markAlertSent).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "EMAIL");
    expect(result).toEqual({ checked: 1, notified: 1 });
  });

  it("não reenvia por e-mail quando já foi alertado", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    vi.mocked(hasAlertBeenSent).mockResolvedValue(true);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("pula o WhatsApp sem quebrar quando o atleta não tem telefone cadastrado", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, buyer: { ...orderFixture.buyer, athleteProfile: null } },
    ]);

    const result = await checkAbandonedCarts();

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("continua processando os demais pedidos quando um falha", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, id: "order-1" },
      { ...orderFixture, id: "order-2" },
    ]);
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 2, notified: 1 });
  });
});
```

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/alert-abandoned-cart.test.ts`
Expected: FAIL — `Cannot find module '@/lib/alerts/abandoned-cart'`.

- [ ] **Step 5: Implementar `checkAbandonedCarts`**

Create `lib/alerts/abandoned-cart.ts`:
```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "./alert-settings";
import { hasAlertBeenSent, markAlertSent } from "./dedupe";

const ALERT_TYPE = "ABANDONED_CART";

export async function checkAbandonedCarts(): Promise<{ checked: number; notified: number }> {
  const settings = await getAbandonedCartAlertSettings();
  if (!settings.emailEnabled && !settings.whatsappEnabled) return { checked: 0, notified: 0 };

  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const orders = await db.order.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    select: {
      id: true,
      event: { select: { title: true } },
      buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
    },
  });

  let notified = 0;

  for (const order of orders) {
    try {
      let sentSomething = false;

      if (settings.emailEnabled && !(await hasAlertBeenSent(ALERT_TYPE, order.id, "EMAIL"))) {
        const cfg = await getSmtpConfig();
        if (isSmtpReady(cfg)) {
          await sendAbandonedCartEmail({
            to: order.buyer.email,
            name: order.buyer.name,
            eventTitle: order.event.title,
            orderId: order.id,
          });
          await markAlertSent(ALERT_TYPE, "Order", order.id, "EMAIL");
          sentSomething = true;
        }
      }

      if (
        settings.whatsappEnabled &&
        order.buyer.athleteProfile?.phone &&
        !(await hasAlertBeenSent(ALERT_TYPE, order.id, "WHATSAPP"))
      ) {
        await sendWhatsAppMessage(
          order.buyer.athleteProfile.phone,
          `Sua inscrição em "${order.event.title}" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
        );
        await markAlertSent(ALERT_TYPE, "Order", order.id, "WHATSAPP");
        sentSomething = true;
      }

      if (sentSomething) notified++;
    } catch (err) {
      console.error("[checkAbandonedCarts] failed for order", order.id, err);
    }
  }

  return { checked: orders.length, notified };
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/alert-abandoned-cart.test.ts`
Expected: PASS — 6/6 testes.

- [ ] **Step 7: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 8: Commit**

```bash
git add lib/email.ts tests/setup.ts lib/alerts/abandoned-cart.ts tests/alert-abandoned-cart.test.ts
git commit -m "feat: alerta de carrinho abandonado"
```

---

## Task 4: Alerta de erro de pagamento

**Files:**
- Modify: `lib/email.ts`
- Create: `lib/alerts/payment-error.ts`
- Test: `tests/alert-payment-error.test.ts`

**Interfaces:**
- Consumes: `getPaymentErrorAlertSettings` (Task 1), `hasAlertBeenSent`/`markAlertSent` (Task 1), `sendWhatsAppMessage`, `getSmtpConfig`/`isSmtpReady`.
- Produces: `sendPaymentErrorEmail(params)` em `lib/email.ts`; `notifyPaymentError(paymentId: string): Promise<void>` — consumida pela Task 5.

- [ ] **Step 1: Adicionar o template de e-mail**

Find (em `lib/email.ts`, o template acrescentado na Task 3):
```ts
/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

Replace it with:
```ts
/** E-mail avisando o atleta que o pagamento foi recusado ou expirou. */
export async function sendPaymentErrorEmail(params: {
  to: string;
  name: string;
  eventTitle: string;
  orderId: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/dashboard/inscricoes`;
  await sendMail({
    to: params.to,
    subject: `Pagamento não concluído — ${params.eventTitle}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>O pagamento da sua inscrição em <strong>${params.eventTitle}</strong> não foi concluído (recusado ou expirado).</p>
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Tentar novamente</a></p>`
    ),
  });
}

/** E-mail de recuperação de senha. */
export async function sendPasswordResetEmail(params: {
```

- [ ] **Step 2: Escrever os testes (falhando)**

Create `tests/alert-payment-error.test.ts`:
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
  hasAlertBeenSent: vi.fn(),
  markAlertSent: vi.fn(),
}));

import { notifyPaymentError } from "@/lib/alerts/payment-error";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "@/lib/alerts/alert-settings";
import { hasAlertBeenSent, markAlertSent } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const paymentFixture = {
  order: {
    id: "order-1",
    event: { title: "Corrida Teste" },
    buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
  },
};

describe("notifyPaymentError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(hasAlertBeenSent).mockResolvedValue(false);
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

  it("envia e-mail e grava AlertLog", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", orderId: "order-1" }),
    );
    expect(markAlertSent).toHaveBeenCalledWith("PAYMENT_ERROR", "Payment", "payment-1", "EMAIL");
  });

  it("não reenvia por e-mail quando já foi alertado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(hasAlertBeenSent).mockResolvedValue(true);
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
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
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/alert-payment-error.test.ts`
Expected: FAIL — `Cannot find module '@/lib/alerts/payment-error'`.

- [ ] **Step 4: Implementar `notifyPaymentError`**

Create `lib/alerts/payment-error.ts`:
```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "./alert-settings";
import { hasAlertBeenSent, markAlertSent } from "./dedupe";

const ALERT_TYPE = "PAYMENT_ERROR";

export async function notifyPaymentError(paymentId: string): Promise<void> {
  try {
    const settings = await getPaymentErrorAlertSettings();
    if (!settings.emailEnabled && !settings.whatsappEnabled) return;

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        order: {
          select: {
            id: true,
            event: { select: { title: true } },
            buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
          },
        },
      },
    });

    if (!payment) return;

    if (settings.emailEnabled && !(await hasAlertBeenSent(ALERT_TYPE, paymentId, "EMAIL"))) {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        await sendPaymentErrorEmail({
          to: payment.order.buyer.email,
          name: payment.order.buyer.name,
          eventTitle: payment.order.event.title,
          orderId: payment.order.id,
        });
        await markAlertSent(ALERT_TYPE, "Payment", paymentId, "EMAIL");
      }
    }

    if (
      settings.whatsappEnabled &&
      payment.order.buyer.athleteProfile?.phone &&
      !(await hasAlertBeenSent(ALERT_TYPE, paymentId, "WHATSAPP"))
    ) {
      await sendWhatsAppMessage(
        payment.order.buyer.athleteProfile.phone,
        `Seu pagamento para "${payment.order.event.title}" não foi concluído. Acesse o app para tentar novamente.`,
      );
      await markAlertSent(ALERT_TYPE, "Payment", paymentId, "WHATSAPP");
    }
  } catch (err) {
    console.error("[notifyPaymentError] failed:", err);
  }
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/alert-payment-error.test.ts`
Expected: PASS — 6/6 testes.

- [ ] **Step 6: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/email.ts lib/alerts/payment-error.ts tests/alert-payment-error.test.ts
git commit -m "feat: alerta de erro de pagamento"
```

---

## Task 5: Pontos de disparo nas rotas existentes (alto cuidado)

**Files:**
- Modify: `app/api/checkout/route.ts` (rota sensível — comportamento atual deve ser preservado)
- Modify: `app/api/webhooks/payment/route.ts` (rota sensível)
- Modify: `app/api/orders/[id]/status/route.ts` (rota sensível)
- Modify: `tests/setup.ts`
- Modify: `tests/checkout-route.test.ts`
- Test: `tests/webhook-payment-alerts.test.ts`
- Test: `tests/order-status-alerts.test.ts`

**Interfaces:**
- Consumes: `checkLowStockAlert` (Task 2), `notifyPaymentError` (Task 4).

- [ ] **Step 1: Adicionar `findFirst` ao mock de `order` e `findUnique` ao mock de `athleteProfile` em `tests/setup.ts`**

Find:
```ts
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
```

Replace it with:
```ts
    order: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
```

Find:
```ts
    athleteProfile: { upsert: vi.fn() },
```

Replace it with:
```ts
    athleteProfile: { upsert: vi.fn(), findUnique: vi.fn() },
```

- [ ] **Step 2: Adicionar o disparo de vagas esgotando em `app/api/checkout/route.ts`**

Find:
```ts
import { emptyStringToUndefined, optionalEnumField, optionalOpaqueIdField, opaqueIdField } from "@/lib/checkout-validation";
import { notifyOrderConfirmed } from "@/lib/notifications";
```

Replace it with:
```ts
import { emptyStringToUndefined, optionalEnumField, optionalOpaqueIdField, opaqueIdField } from "@/lib/checkout-validation";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { checkLowStockAlert } from "@/lib/alerts/low-stock";
```

Find:
```ts
  let checkout;
  try {
    checkout = await createCheckout({
      ...checkoutData,
      routeId: emptyStringToUndefined(checkoutData.routeId) as string | undefined,
      categoryId: emptyStringToUndefined(checkoutData.categoryId) as string | undefined,
      shirtSize: checkoutData.shirtSize as ShirtSize | undefined,
      buyerUserId: session.user.id,
      athleteUserId: session.user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar inscrição";
    return NextResponse.json({ error: message }, { status: 400 });
  }
```

Replace it with:
```ts
  let checkout;
  try {
    checkout = await createCheckout({
      ...checkoutData,
      routeId: emptyStringToUndefined(checkoutData.routeId) as string | undefined,
      categoryId: emptyStringToUndefined(checkoutData.categoryId) as string | undefined,
      shirtSize: checkoutData.shirtSize as ShirtSize | undefined,
      buyerUserId: session.user.id,
      athleteUserId: session.user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar inscrição";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Verifica se o lote está quase esgotado e avisa o organizador (fire-and-forget)
  void checkLowStockAlert(checkoutData.ticketBatchId);
```

- [ ] **Step 3: Adicionar testes para o disparo em `app/api/checkout/route.ts`**

Find (arquivo inteiro de `tests/checkout-route.test.ts`):
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/checkout/route";
import { auth } from "@/lib/auth";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/payment-methods", () => ({
  getEnabledPaymentMethods: vi.fn(),
}));

const authMock = vi.mocked(auth);
const enabledMethodsMock = vi.mocked(getEnabledPaymentMethods);
const dbMock = db as any;

describe("checkout api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
  });

  it("rejects a disabled payment method before creating the checkout", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "BOLETO",
        }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(dbMock.payment.create).not.toHaveBeenCalled();
    expect(dbMock.order.create).not.toHaveBeenCalled();
  });
});
```

Replace it with:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/checkout/route";
import { auth } from "@/lib/auth";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { getPaymentProvider } from "@/lib/payment";
import { checkLowStockAlert } from "@/lib/alerts/low-stock";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/payment-methods", () => ({
  getEnabledPaymentMethods: vi.fn(),
}));

vi.mock("@/lib/checkout", () => ({
  createCheckout: vi.fn(),
}));

vi.mock("@/lib/payment", () => ({
  getPaymentProvider: vi.fn(),
}));

vi.mock("@/lib/alerts/low-stock", () => ({
  checkLowStockAlert: vi.fn(),
}));

const authMock = vi.mocked(auth);
const enabledMethodsMock = vi.mocked(getEnabledPaymentMethods);
const dbMock = db as any;

describe("checkout api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
  });

  it("rejects a disabled payment method before creating the checkout", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "BOLETO",
        }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(dbMock.payment.create).not.toHaveBeenCalled();
    expect(dbMock.order.create).not.toHaveBeenCalled();
    expect(checkLowStockAlert).not.toHaveBeenCalled();
  });

  it("verifica o estoque baixo do lote depois de um checkout bem-sucedido", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);
    vi.mocked(createCheckout).mockResolvedValueOnce({
      orderId: "order-1",
      registrationId: "reg-1",
      subtotalAmount: 10000,
      totalAmount: 10000,
      discountAmount: 0,
      platformFeeAmount: 0,
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Atleta", email: "atleta@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-1", status: "PENDING" }),
    } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
        }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(checkLowStockAlert).toHaveBeenCalledWith("batch-1");
  });
});
```

- [ ] **Step 4: Rodar os testes de checkout e confirmar que o novo passa e o antigo continua passando**

Run: `npx vitest run tests/checkout-route.test.ts`
Expected: PASS — 2/2 testes (o hook já foi adicionado à rota no Step 2, então ambos passam nesta primeira execução).

- [ ] **Step 5: Adicionar o disparo de erro de pagamento em `app/api/webhooks/payment/route.ts`**

Find:
```ts
import { notifyOrderConfirmed } from "@/lib/notifications";
```

Replace it with:
```ts
import { notifyOrderConfirmed } from "@/lib/notifications";
import { notifyPaymentError } from "@/lib/alerts/payment-error";
```

Find:
```ts
  // Envia a confirmação de inscrição por e-mail quando o pagamento é aprovado
  if (newPaymentStatus === "PAID") {
    void notifyOrderConfirmed(payment.orderId);
  }

  return NextResponse.json({ ok: true });
}
```

Replace it with:
```ts
  // Envia a confirmação de inscrição por e-mail quando o pagamento é aprovado
  if (newPaymentStatus === "PAID") {
    void notifyOrderConfirmed(payment.orderId);
  }

  // Avisa o atleta quando o pagamento falha ou expira
  if (newPaymentStatus === "CANCELLED" || newPaymentStatus === "EXPIRED") {
    void notifyPaymentError(payment.id);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Escrever os testes para o webhook (falhando)**

Create `tests/webhook-payment-alerts.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";

vi.mock("@/lib/payment", () => ({ getPaymentProvider: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({ getMercadoPagoAccessToken: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { POST } from "@/app/api/webhooks/payment/route";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

const dbMock = db as any;

function makeProvider(parsed: unknown) {
  return {
    verifyWebhookSignature: vi.fn().mockResolvedValue(true),
    parseWebhookPayload: vi.fn().mockReturnValue(parsed),
  };
}

describe("payment webhook alert hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("avisa o atleta quando o pagamento é cancelado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "CANCELLED", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: { status: "PENDING", registrations: [], buyer: { name: "Atleta", email: "atleta@example.com" } },
    });

    const res = await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1");
  });

  it("não avisa quando o pagamento é aprovado", async () => {
    vi.mocked(getPaymentProvider).mockResolvedValue(
      makeProvider({ providerPaymentId: "pay-1", status: "PAID", rawPayload: {} }) as any,
    );
    dbMock.payment.findFirst.mockResolvedValueOnce({
      id: "payment-1",
      status: "PENDING",
      orderId: "order-1",
      order: { status: "PENDING", registrations: [], buyer: { name: "Atleta", email: "atleta@example.com" } },
    });

    await POST(
      new Request("http://localhost/api/webhooks/payment", {
        method: "POST",
        body: JSON.stringify({ type: "charge.updated" }),
      }) as any,
    );

    expect(notifyPaymentError).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/webhook-payment-alerts.test.ts`
Expected: PASS — 2/2 testes.

- [ ] **Step 8: Adicionar o disparo de erro de pagamento em `app/api/orders/[id]/status/route.ts`**

Find:
```ts
import { notifyOrderConfirmed } from "@/lib/notifications";
```

Replace it with:
```ts
import { notifyOrderConfirmed } from "@/lib/notifications";
import { notifyPaymentError } from "@/lib/alerts/payment-error";
```

Find:
```ts
        if (mpStatus === "CANCELLED" && payment.status !== "CANCELLED") {
          await db.$transaction([
            db.payment.update({ where: { id: payment.id }, data: { status: "CANCELLED" } }),
            db.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } }),
          ]);
          return NextResponse.json({ status: "CANCELLED", totalAmount: order.totalAmount });
        }
```

Replace it with:
```ts
        if (mpStatus === "CANCELLED" && payment.status !== "CANCELLED") {
          await db.$transaction([
            db.payment.update({ where: { id: payment.id }, data: { status: "CANCELLED" } }),
            db.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } }),
          ]);
          void notifyPaymentError(payment.id);
          return NextResponse.json({ status: "CANCELLED", totalAmount: order.totalAmount });
        }
```

- [ ] **Step 9: Escrever os testes para a rota de status (falhando)**

Create `tests/order-status-alerts.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getPaymentProviderSetting, getMercadoPagoAccessToken } from "@/lib/payment-settings";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment-settings", () => ({
  getPaymentProviderSetting: vi.fn(),
  getMercadoPagoAccessToken: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ notifyOrderConfirmed: vi.fn() }));
vi.mock("@/lib/alerts/payment-error", () => ({ notifyPaymentError: vi.fn() }));

import { GET } from "@/app/api/orders/[id]/status/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("order status route alert hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    vi.mocked(getPaymentProviderSetting).mockResolvedValue("mercadopago");
    vi.mocked(getMercadoPagoAccessToken).mockResolvedValue("mp-token");
    global.fetch = vi.fn();
    dbMock.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(dbMock),
    );
  });

  it("avisa o atleta quando o Mercado Pago informa que o pagamento foi cancelado", async () => {
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PENDING",
      totalAmount: 10000,
      payments: [{ id: "payment-1", providerPaymentId: "mp-1", status: "PENDING" }],
      registrations: [],
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "cancelled" }),
    });

    const res = await GET(
      new Request("http://localhost/api/orders/order-1/status") as any,
      { params: Promise.resolve({ id: "order-1" }) },
    );
    const body = await res.json();

    expect(body.status).toBe("CANCELLED");
    expect(notifyPaymentError).toHaveBeenCalledWith("payment-1");
  });

  it("não avisa quando o pagamento é aprovado", async () => {
    dbMock.order.findFirst.mockResolvedValueOnce({
      id: "order-1",
      status: "PENDING",
      totalAmount: 10000,
      payments: [{ id: "payment-1", providerPaymentId: "mp-1", status: "PENDING" }],
      registrations: [],
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "approved" }),
    });

    await GET(
      new Request("http://localhost/api/orders/order-1/status") as any,
      { params: Promise.resolve({ id: "order-1" }) },
    );

    expect(notifyPaymentError).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/order-status-alerts.test.ts`
Expected: PASS — 2/2 testes.

- [ ] **Step 11: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros (nenhuma regressão nos testes existentes de checkout/webhook/orders).

- [ ] **Step 12: Commit**

```bash
git add app/api/checkout/route.ts app/api/webhooks/payment/route.ts app/api/orders/[id]/status/route.ts tests/setup.ts tests/checkout-route.test.ts tests/webhook-payment-alerts.test.ts tests/order-status-alerts.test.ts
git commit -m "feat: dispara alertas de vagas esgotando e erro de pagamento nas rotas existentes"
```

---

## Task 6: Rota de cron do carrinho abandonado

**Files:**
- Create: `app/api/cron/abandoned-carts/route.ts`
- Test: `tests/cron-abandoned-carts-route.test.ts`

**Interfaces:**
- Consumes: `checkAbandonedCarts` (Task 3).
- Produces: `POST /api/cron/abandoned-carts` (header `x-cron-secret`) → `{ checked: number; notified: number }`.

- [ ] **Step 1: Escrever os testes (falhando)**

Create `tests/cron-abandoned-carts-route.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alerts/abandoned-cart", () => ({
  checkAbandonedCarts: vi.fn(),
}));

import { POST } from "@/app/api/cron/abandoned-carts/route";
import { checkAbandonedCarts } from "@/lib/alerts/abandoned-cart";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/abandoned-carts", {
    method: "POST",
    headers,
  }) as any;
}

describe("POST /api/cron/abandoned-carts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("retorna 401 quando o segredo não é enviado", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(checkAbandonedCarts).not.toHaveBeenCalled();
  });

  it("retorna 401 quando o segredo enviado está errado", async () => {
    const res = await POST(makeRequest({ "x-cron-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(checkAbandonedCarts).not.toHaveBeenCalled();
  });

  it("retorna 401 quando CRON_SECRET não está configurado no ambiente", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(makeRequest({ "x-cron-secret": "anything" }));
    expect(res.status).toBe(401);
  });

  it("chama checkAbandonedCarts e retorna o resultado quando o segredo bate", async () => {
    vi.mocked(checkAbandonedCarts).mockResolvedValueOnce({ checked: 5, notified: 2 });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ checked: 5, notified: 2 });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/cron-abandoned-carts-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/cron/abandoned-carts/route'`.

- [ ] **Step 3: Implementar a rota**

Create `app/api/cron/abandoned-carts/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAbandonedCarts } from "@/lib/alerts/abandoned-cart";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const result = await checkAbandonedCarts();
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/cron-abandoned-carts-route.test.ts`
Expected: PASS — 4/4 testes.

- [ ] **Step 5: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/abandoned-carts/route.ts tests/cron-abandoned-carts-route.test.ts
git commit -m "feat: rota de cron para o alerta de carrinho abandonado"
```

---

## Task 7: Página `/admin/alertas` (UI)

**Files:**
- Create: `components/admin/AlertConfigCard.tsx`
- Create: `app/admin/alertas/page.tsx`
- Modify: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/settings` (existente); `getLowStockAlertSettings`, `getAbandonedCartAlertSettings`, `getPaymentErrorAlertSettings` (Task 1).

Sem testes automatizados de UI (convenção já estabelecida); verificação manual na Task 8.

- [ ] **Step 1: Criar o componente reutilizável de configuração de alerta**

Create `components/admin/AlertConfigCard.tsx`:
```tsx
"use client";

import { useState } from "react";

interface AlertConfigCardProps {
  title: string;
  description: string;
  emailKey: string;
  whatsappKey: string;
  paramKey?: string;
  paramLabel?: string;
  paramSuffix?: string;
  currentEmailEnabled: boolean;
  currentWhatsappEnabled: boolean;
  currentParamValue?: number;
}

export default function AlertConfigCard({
  title,
  description,
  emailKey,
  whatsappKey,
  paramKey,
  paramLabel,
  paramSuffix,
  currentEmailEnabled,
  currentWhatsappEnabled,
  currentParamValue,
}: AlertConfigCardProps) {
  const [emailEnabled, setEmailEnabled] = useState(currentEmailEnabled);
  const [whatsappEnabled, setWhatsappEnabled] = useState(currentWhatsappEnabled);
  const [paramValue, setParamValue] = useState(String(currentParamValue ?? ""));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSetting(emailKey, String(emailEnabled));
      await saveSetting(whatsappKey, String(whatsappEnabled));
      if (paramKey) await saveSetting(paramKey, paramValue.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>

      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Configuração salva!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} className="h-4 w-4" />
        Enviar por e-mail
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" checked={whatsappEnabled} onChange={(e) => setWhatsappEnabled(e.target.checked)} className="h-4 w-4" />
        Enviar por WhatsApp
      </label>

      {paramKey && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-700 dark:text-gray-300">{paramLabel}</label>
          <input
            type="number"
            value={paramValue}
            onChange={(e) => setParamValue(e.target.value)}
            className="input-field w-24"
          />
          {paramSuffix && <span className="text-sm text-gray-500">{paramSuffix}</span>}
        </div>
      )}

      <button type="button" onClick={handleSave} disabled={saving} className="btn-primary px-6 disabled:opacity-50">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Criar a página**

Create `app/admin/alertas/page.tsx`:
```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import AlertConfigCard from "@/components/admin/AlertConfigCard";
import {
  getLowStockAlertSettings,
  getAbandonedCartAlertSettings,
  getPaymentErrorAlertSettings,
} from "@/lib/alerts/alert-settings";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Alertas — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAlertasPage() {
  await requireAdmin();

  const [lowStock, abandonedCart, paymentError] = await Promise.all([
    getLowStockAlertSettings(),
    getAbandonedCartAlertSettings(),
    getPaymentErrorAlertSettings(),
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">Alertas</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure quais alertas automáticos são enviados por e-mail e/ou WhatsApp. Todos vêm desligados por padrão.
        </p>
      </div>

      <AlertConfigCard
        title="Vagas se esgotando"
        description="Avisa o organizador do evento quando um lote de ingressos atinge o limiar de vendas configurado."
        emailKey="alert_low_stock_email_enabled"
        whatsappKey="alert_low_stock_whatsapp_enabled"
        paramKey="alert_low_stock_threshold_percent"
        paramLabel="Limiar"
        paramSuffix="% vendido"
        currentEmailEnabled={lowStock.emailEnabled}
        currentWhatsappEnabled={lowStock.whatsappEnabled}
        currentParamValue={lowStock.thresholdPercent}
      />

      <AlertConfigCard
        title="Carrinho abandonado"
        description="Avisa o atleta quando um pedido fica pendente (sem pagamento) por mais tempo do que o limite configurado. Requer uma tarefa agendada (crontab) chamando /api/cron/abandoned-carts."
        emailKey="alert_abandoned_cart_email_enabled"
        whatsappKey="alert_abandoned_cart_whatsapp_enabled"
        paramKey="alert_abandoned_cart_minutes"
        paramLabel="Após"
        paramSuffix="minutos pendente"
        currentEmailEnabled={abandonedCart.emailEnabled}
        currentWhatsappEnabled={abandonedCart.whatsappEnabled}
        currentParamValue={abandonedCart.minutesThreshold}
      />

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

- [ ] **Step 3: Adicionar o link no menu admin**

Find (em `components/admin/AdminNav.tsx`):
```tsx
          <Link href="/admin/whatsapp" className="hover:text-gray-300">WhatsApp</Link>
```

Replace it with:
```tsx
          <Link href="/admin/whatsapp" className="hover:text-gray-300">WhatsApp</Link>
          <Link href="/admin/alertas" className="hover:text-gray-300">Alertas</Link>
```

- [ ] **Step 4: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add components/admin/AlertConfigCard.tsx app/admin/alertas/page.tsx components/admin/AdminNav.tsx
git commit -m "feat: pagina admin/alertas para configurar os 3 alertas"
```

---

## Task 8: Verificação manual

**Files:** nenhum (só verificação).

- [ ] **Step 1: Preparar o ambiente**

Mesmo padrão de VPS descartável usado nos sub-projetos anteriores. Depois do `git pull`, rodar `npx prisma db push` (para criar a tabela `alert_logs` e sincronizar todo o schema acumulado) seguido de `npx prisma generate`, e **reiniciar o servidor dev** (lição operacional já conhecida: `db push` sozinho não atualiza o Prisma Client já carregado). Configurar `CRON_SECRET` no ambiente do container de teste.

- [ ] **Step 2: Interruptores desligados — nada muda**

Com os 3 alertas desligados (padrão), fazer um checkout completo, forçar um pagamento cancelado via a rota de status, e chamar `POST /api/cron/abandoned-carts` com o segredo correto sobre um pedido antigo. Confirmar que nenhum e-mail é enviado e nenhuma linha é gravada em `alert_logs` — comportamento idêntico ao sistema sem esta feature.

- [ ] **Step 3: Vagas se esgotando**

Ligar o alerta em `/admin/alertas` (e-mail), configurar um limiar baixo (ex.: 10%) para facilitar o teste. Criar um lote pequeno via SQL/organizador e fazer 1-2 checkouts até cruzar o limiar. Confirmar o e-mail chegou ao organizador (ou, sem SMTP configurado, confirmar que a falha foi silenciosa e não quebrou o checkout) e que existe uma linha em `alert_logs` (`LOW_STOCK`, o `ticketBatchId`, `EMAIL`). Fazer outro checkout no mesmo lote e confirmar que **não** dispara de novo.

- [ ] **Step 4: Erro de pagamento**

Ligar o alerta. Forçar uma transição de pagamento para `CANCELLED` (via webhook simulado ou a rota de status com um provider mockado retornando `cancelled`). Confirmar o disparo e a linha em `alert_logs` (`PAYMENT_ERROR`, o `paymentId`, `EMAIL`).

- [ ] **Step 5: Carrinho abandonado**

Ligar o alerta com um limiar de minutos baixo (ex.: 1). Criar um `Order` `PENDING` via SQL com `createdAt` no passado além do limiar. Chamar `POST /api/cron/abandoned-carts` com o header `x-cron-secret` correto — confirmar `{ checked, notified }` com `notified >= 1` e a linha em `alert_logs`. Chamar de novo e confirmar `notified: 0` para aquele mesmo pedido (não duplica). Chamar sem o header ou com o valor errado e confirmar `401`.

- [ ] **Step 6: Relatar ao usuário**

Resumir o que foi verificado (incluindo se SMTP/WhatsApp estavam configurados no ambiente de teste) e aguardar autorização explícita antes de qualquer push/deploy em produção — esta mudança toca 3 rotas de produção sensíveis e adiciona uma tabela nova ao schema.
