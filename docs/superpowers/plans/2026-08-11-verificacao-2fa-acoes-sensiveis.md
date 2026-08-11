# Verificação em 2 etapas para ações sensíveis de pagamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exigir um código de verificação de 6 dígitos (enviado por e-mail e WhatsApp pro usuário que está agindo) antes de qualquer estorno de pagamento real acontecer, cobrindo os 4 pontos de entrada que chamam `refundPayment()`.

**Architecture:** Tabela nova genérica `SensitiveActionCode` + serviço `lib/security/sensitive-action-verification.ts` com `requestSensitiveActionCode`/`verifySensitiveActionCode`. Cada rota protegida ganha uma rota irmã `.../request-code`; a rota original passa a exigir `{ verificationId, code }` antes de qualquer side effect. Frontend usa um hook compartilhado (`useSensitiveActionVerification`) + um modal novo (`CodeVerificationModal`) nos 4 componentes que hoje disparam essas rotas.

**Tech Stack:** Next.js 16 App Router, Prisma 5 + PostgreSQL, Vitest, TypeScript, React (client components).

## Global Constraints

- Código numérico de 6 dígitos, válido por 10 minutos, máximo 5 tentativas erradas antes de exigir gerar um novo.
- Código vai sempre para o e-mail (obrigatório) e WhatsApp (best-effort, só se o usuário tiver `phone` cadastrado) do usuário autenticado que está executando a ação — nunca de quem ele representa (ex: assistente age em nome de organizador, mas o código vai pro assistente).
- Rate limit no pedido de código: 3 pedidos por 5 minutos, por usuário+ação+alvo.
- Mensagem do código é fixa (hardcoded), não passa pelo sistema de templates customizáveis (`/admin/mensagens`) — mesmo tratamento de `sendPasswordResetEmail`.
- Nunca gravar o código em texto puro — só o hash SHA-256, comparado com `crypto.timingSafeEqual`.
- `sendMail`/`sendWhatsAppMessage` exigem `messageType` obrigatório hoje — todo envio novo desta feature usa `messageType: "SENSITIVE_ACTION_CODE"`.
- Sem teste automatizado em componentes React (convenção já estabelecida no projeto) — só nos hooks/serviços/rotas.
- Nenhuma rota protegida deve produzir qualquer side effect (mudança de status, marcação de rejeitado/cancelado) antes do código ser confirmado.

---

### Task 1: Schema — tabela `SensitiveActionCode` + rate limit + mocks de teste

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/rate-limit.ts`
- Modify: `tests/setup.ts`

**Interfaces:**
- Produces: model Prisma `SensitiveActionCode` (`id`, `userId`, `actionType`, `targetId`, `codeHash`, `attempts`, `consumedAt`, `expiresAt`, `createdAt`); `RATE_LIMITS.SENSITIVE_ACTION_CODE: { requests: 3, windowMs: 300_000 }`; `db.sensitiveActionCode` mockado em todos os testes.
- Consumes: nada (é a base de tudo).

- [ ] **Step 1: Adicionar o model ao schema**

Em `prisma/schema.prisma`, adicione ao final do arquivo (depois do último model existente):

```prisma
model SensitiveActionCode {
  id         String    @id @default(cuid())
  userId     String
  actionType String
  targetId   String
  codeHash   String
  attempts   Int       @default(0)
  consumedAt DateTime?
  expiresAt  DateTime
  createdAt  DateTime  @default(now())

  @@index([userId, actionType, targetId])
  @@map("sensitive_action_codes")
}
```

- [ ] **Step 2: Regenerar o Prisma Client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" sem erros. Não toca no banco (aplicado via `prisma db push` no deploy).

- [ ] **Step 3: Adicionar o rate limit**

Em `lib/rate-limit.ts`, adicione ao objeto `RATE_LIMITS`:

```ts
export const RATE_LIMITS = {
  AUTH: { requests: 10, windowMs: 60_000 },
  CHECKOUT: { requests: 5, windowMs: 60_000 },
  WEBHOOK: { requests: 100, windowMs: 60_000 },
  SENSITIVE_ACTION_CODE: { requests: 3, windowMs: 300_000 },
} satisfies Record<string, RateLimitConfig>;
```

- [ ] **Step 4: Adicionar o mock em `tests/setup.ts`**

No objeto `db` mockado, adicione (perto de `verificationToken`, mesma seção de tabelas de auth/segurança):

```ts
    sensitiveActionCode: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
```

- [ ] **Step 5: Verificar que o projeto ainda compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma lib/rate-limit.ts tests/setup.ts
git commit -m "feat: schema e rate limit da verificacao em 2 etapas"
```

---

### Task 2: E-mail do código — `sendSensitiveActionCodeEmail`

**Files:**
- Modify: `lib/email.ts`
- Modify: `lib/message-logs.ts`
- Test: `tests/lib-email.test.ts`

**Interfaces:**
- Consumes: `sendMail(opts)` (já existe, `lib/email.ts`), `getAppName()` (já existe, `lib/settings.ts`), `layout(appName, body)` (já existe, `lib/email.ts`).
- Produces: `sendSensitiveActionCodeEmail(params: { to: string; name: string; code: string; actionLabel: string }): Promise<void>`.

- [ ] **Step 1: Adicionar a entrada em `MESSAGE_TYPE_LABEL`**

Em `lib/message-logs.ts`, dentro do objeto `MESSAGE_TYPE_LABEL`, adicione uma linha nova (em qualquer posição, mantendo ordem alfabética não é exigido pelo arquivo atual):

```ts
  SENSITIVE_ACTION_CODE: "Código de verificação",
```

- [ ] **Step 2: Escrever o teste (falha esperada)**

Em `tests/lib-email.test.ts`, adicione (dentro do `describe` existente que testa as funções de `lib/email.ts`, seguindo o padrão dos testes de `sendPasswordResetEmail` já presentes no arquivo):

```ts
  it("sendSensitiveActionCodeEmail envia o código no corpo do e-mail com messageType correto", async () => {
    const { sendSensitiveActionCodeEmail } = await import("@/lib/email");
    await sendSensitiveActionCodeEmail({
      to: "admin@example.com",
      name: "Admin",
      code: "123456",
      actionLabel: "Confirmação de estorno de pagamento",
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        messageType: "SENSITIVE_ACTION_CODE",
        subject: expect.stringContaining("Confirmação de estorno de pagamento"),
        html: expect.stringContaining("123456"),
      }),
    );
  });
```

Confirme antes o nome exato do mock de `sendMail` já usado nos outros testes deste arquivo (procure por `vi.mock` no topo de `tests/lib-email.test.ts` — provavelmente `sendMailMock` ou similar; ajuste o nome no teste acima pra bater com o que já existe no arquivo, não crie um mock novo).

- [ ] **Step 3: Rodar o teste, confirmar que falha**

Run: `npx vitest run tests/lib-email.test.ts -t "sendSensitiveActionCodeEmail"`
Expected: FAIL — função não existe.

- [ ] **Step 4: Implementar**

Em `lib/email.ts`, adicione ao final do arquivo:

```ts
/** E-mail com o código de verificação de 2 etapas pra ações sensíveis (ex: estorno de pagamento).
 * Mensagem fixa, fora do sistema de templates customizáveis por design de segurança. */
export async function sendSensitiveActionCodeEmail(params: {
  to: string;
  name: string;
  code: string;
  actionLabel: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    messageType: "SENSITIVE_ACTION_CODE",
    subject: `${params.actionLabel} — ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>${params.actionLabel}. Use o código abaixo para confirmar:</p>
       <p style="font-size:28px;font-weight:bold;letter-spacing:4px;text-align:center;background:#f3f4f6;padding:16px;border-radius:8px">${params.code}</p>
       <p style="font-size:13px;color:#6b7280">Válido por 10 minutos. Se você não solicitou esta ação, ignore este e-mail — nenhuma ação será tomada sem o código.</p>`
    ),
  });
}
```

- [ ] **Step 5: Rodar o teste, confirmar que passa**

Run: `npx vitest run tests/lib-email.test.ts -t "sendSensitiveActionCodeEmail"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts lib/message-logs.ts tests/lib-email.test.ts
git commit -m "feat: e-mail do codigo de verificacao em 2 etapas"
```

---

### Task 3: Serviço central — `lib/security/sensitive-action-verification.ts`

**Files:**
- Create: `lib/security/sensitive-action-verification.ts`
- Test: `tests/lib-sensitive-action-verification.test.ts`

**Interfaces:**
- Consumes: `sendSensitiveActionCodeEmail` (Task 2), `sendWhatsAppMessage(phone, text, messageType)` (já existe, `lib/whatsapp.ts`), `checkRateLimit`/`RATE_LIMITS.SENSITIVE_ACTION_CODE` (Task 1), `db` (`lib/db.ts`).
- Produces: `SensitiveActionType = "PAYMENT_REFUND"`; `requestSensitiveActionCode(params: { userId: string; actionType: SensitiveActionType; targetId: string }): Promise<{ ok: true; verificationId: string } | { ok: false; error: string }>`; `verifySensitiveActionCode(params: { verificationId: string; userId: string; actionType: SensitiveActionType; targetId: string; code: string }): Promise<{ ok: true } | { ok: false; error: string; attemptsRemaining?: number }>`.

- [ ] **Step 1: Escrever os testes de `requestSensitiveActionCode` (falha esperada)**

Crie `tests/lib-sensitive-action-verification.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn() };
});
vi.mock("@/lib/email", () => ({ sendSensitiveActionCodeEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));

import { requestSensitiveActionCode, verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendSensitiveActionCodeEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const dbMock = db as any;
const rateLimitMock = vi.mocked(checkRateLimit);

describe("requestSensitiveActionCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 2 });
    dbMock.user.findUnique.mockResolvedValue({ name: "Admin", email: "admin@example.com", phone: "5511999999999" });
    dbMock.sensitiveActionCode.create.mockResolvedValue({ id: "code-1" });
  });

  it("gera o código, grava só o hash (nunca o texto puro) e envia por e-mail e WhatsApp", async () => {
    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result).toEqual({ ok: true, verificationId: "code-1" });
    expect(dbMock.sensitiveActionCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" }),
      }),
    );
    const createCall = dbMock.sensitiveActionCode.create.mock.calls[0][0];
    expect(createCall.data.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sendSensitiveActionCodeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", name: "Admin" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String), "SENSITIVE_ACTION_CODE");
  });

  it("não envia WhatsApp quando o usuário não tem telefone cadastrado, mas ainda retorna ok", async () => {
    dbMock.user.findUnique.mockResolvedValue({ name: "Admin", email: "admin@example.com", phone: null });

    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result.ok).toBe(true);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("continua retornando ok quando o WhatsApp falha, desde que o e-mail tenha sido enviado", async () => {
    vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("evolution down"));

    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result.ok).toBe(true);
  });

  it("não gera código (e apaga o registro criado) quando o e-mail falha", async () => {
    vi.mocked(sendSensitiveActionCodeEmail).mockRejectedValueOnce(new Error("smtp down"));

    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result).toEqual({ ok: false, error: "Não foi possível enviar o código por e-mail. Tente novamente." });
    expect(dbMock.sensitiveActionCode.delete).toHaveBeenCalledWith({ where: { id: "code-1" } });
  });

  it("retorna erro sem gerar código quando o rate limit de pedidos é excedido", async () => {
    rateLimitMock.mockReturnValue({ allowed: false, remaining: 0 });

    const result = await requestSensitiveActionCode({ userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });

    expect(result.ok).toBe(false);
    expect(dbMock.sensitiveActionCode.create).not.toHaveBeenCalled();
  });
});

describe("verifySensitiveActionCode", () => {
  const CODE = "123456";
  let validRecord: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const crypto = await import("crypto");
    validRecord = {
      id: "code-1",
      userId: "user-1",
      actionType: "PAYMENT_REFUND",
      targetId: "payment-1",
      codeHash: crypto.createHash("sha256").update(CODE).digest("hex"),
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
  });

  it("aceita o código correto e marca como consumido", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(validRecord);
    dbMock.sensitiveActionCode.update.mockResolvedValueOnce({ ...validRecord, consumedAt: new Date() });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result).toEqual({ ok: true });
    expect(dbMock.sensitiveActionCode.update).toHaveBeenCalledWith({
      where: { id: "code-1" },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("rejeita código errado e incrementa as tentativas", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(validRecord);
    dbMock.sensitiveActionCode.update.mockResolvedValueOnce({ ...validRecord, attempts: 1 });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: "000000",
    });

    expect(result).toEqual({ ok: false, error: "Código incorreto.", attemptsRemaining: 4 });
    expect(dbMock.sensitiveActionCode.update).toHaveBeenCalledWith({
      where: { id: "code-1" },
      data: { attempts: { increment: 1 } },
    });
  });

  it("rejeita quando já atingiu o máximo de tentativas, com a mesma mensagem de expirado (não revela o motivo)", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce({ ...validRecord, attempts: 5 });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result).toEqual({ ok: false, error: "Código expirado ou inválido, solicite um novo." });
  });

  it("rejeita código expirado", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce({ ...validRecord, expiresAt: new Date(Date.now() - 1000) });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result.ok).toBe(false);
  });

  it("rejeita código já consumido (não pode ser reusado)", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce({ ...validRecord, consumedAt: new Date() });

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result.ok).toBe(false);
  });

  it("rejeita quando o verificationId não existe", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(null);

    const result = await verifySensitiveActionCode({
      verificationId: "nao-existe", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result.ok).toBe(false);
  });

  it("rejeita quando o userId não bate com quem gerou o código", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(validRecord);

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "outro-user", actionType: "PAYMENT_REFUND", targetId: "payment-1", code: CODE,
    });

    expect(result.ok).toBe(false);
  });

  it("rejeita quando o targetId não bate (código gerado pra outro pagamento)", async () => {
    dbMock.sensitiveActionCode.findUnique.mockResolvedValueOnce(validRecord);

    const result = await verifySensitiveActionCode({
      verificationId: "code-1", userId: "user-1", actionType: "PAYMENT_REFUND", targetId: "outro-payment", code: CODE,
    });

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes, confirmar que falham**

Run: `npx vitest run tests/lib-sensitive-action-verification.test.ts`
Expected: FAIL — módulo `@/lib/security/sensitive-action-verification` não existe.

- [ ] **Step 3: Implementar**

Crie `lib/security/sensitive-action-verification.ts`:

```ts
import crypto from "crypto";
import { db } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { sendSensitiveActionCodeEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export type SensitiveActionType = "PAYMENT_REFUND";

const CODE_EXPIRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const INVALID_OR_EXPIRED = "Código expirado ou inválido, solicite um novo.";

const ACTION_LABEL: Record<SensitiveActionType, string> = {
  PAYMENT_REFUND: "Confirmação de estorno de pagamento",
};

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export type RequestCodeResult = { ok: true; verificationId: string } | { ok: false; error: string };

export async function requestSensitiveActionCode(params: {
  userId: string;
  actionType: SensitiveActionType;
  targetId: string;
}): Promise<RequestCodeResult> {
  const rateLimitKey = `sensitive-code:${params.userId}:${params.actionType}:${params.targetId}`;
  const { allowed } = checkRateLimit(rateLimitKey, RATE_LIMITS.SENSITIVE_ACTION_CODE);
  if (!allowed) {
    return { ok: false, error: "Muitos pedidos de código em pouco tempo. Aguarde alguns minutos e tente novamente." };
  }

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { name: true, email: true, phone: true },
  });
  if (!user) return { ok: false, error: "Usuário não encontrado" };

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  const record = await db.sensitiveActionCode.create({
    data: { userId: params.userId, actionType: params.actionType, targetId: params.targetId, codeHash, expiresAt },
  });

  const actionLabel = ACTION_LABEL[params.actionType];

  try {
    await sendSensitiveActionCodeEmail({ to: user.email, name: user.name, code, actionLabel });
  } catch (err) {
    await db.sensitiveActionCode.delete({ where: { id: record.id } });
    console.error("[requestSensitiveActionCode] falha ao enviar e-mail:", err);
    return { ok: false, error: "Não foi possível enviar o código por e-mail. Tente novamente." };
  }

  if (user.phone) {
    try {
      const text = `${actionLabel}\n\nSeu código de verificação é: ${code}\n\nVálido por 10 minutos. Se você não solicitou esta ação, ignore esta mensagem.`;
      await sendWhatsAppMessage(user.phone, text, "SENSITIVE_ACTION_CODE");
    } catch (err) {
      console.error("[requestSensitiveActionCode] falha ao enviar WhatsApp (e-mail já enviado):", err);
    }
  }

  return { ok: true, verificationId: record.id };
}

export type VerifyCodeResult = { ok: true } | { ok: false; error: string; attemptsRemaining?: number };

export async function verifySensitiveActionCode(params: {
  verificationId: string;
  userId: string;
  actionType: SensitiveActionType;
  targetId: string;
  code: string;
}): Promise<VerifyCodeResult> {
  const record = await db.sensitiveActionCode.findUnique({ where: { id: params.verificationId } });

  if (
    !record ||
    record.userId !== params.userId ||
    record.actionType !== params.actionType ||
    record.targetId !== params.targetId ||
    record.consumedAt !== null ||
    record.expiresAt < new Date() ||
    record.attempts >= MAX_ATTEMPTS
  ) {
    return { ok: false, error: INVALID_OR_EXPIRED };
  }

  const recordHashBuf = Buffer.from(record.codeHash);
  const providedHashBuf = Buffer.from(hashCode(params.code));
  const matches =
    recordHashBuf.length === providedHashBuf.length && crypto.timingSafeEqual(recordHashBuf, providedHashBuf);

  if (!matches) {
    const updated = await db.sensitiveActionCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: "Código incorreto.", attemptsRemaining: Math.max(0, MAX_ATTEMPTS - updated.attempts) };
  }

  await db.sensitiveActionCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  return { ok: true };
}
```

- [ ] **Step 4: Rodar os testes, confirmar que passam**

Run: `npx vitest run tests/lib-sensitive-action-verification.test.ts`
Expected: PASS, todos os 11 casos.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/security/sensitive-action-verification.ts tests/lib-sensitive-action-verification.test.ts
git commit -m "feat: servico central de verificacao em 2 etapas"
```

---

### Task 4: Rota de estorno do admin — exige código

**Files:**
- Create: `app/api/admin/payments/[id]/refund/request-code/route.ts`
- Modify: `app/api/admin/payments/[id]/refund/route.ts`
- Modify: `tests/admin-payment-refund-route.test.ts`
- Test: `tests/admin-payment-refund-request-code-route.test.ts`

**Interfaces:**
- Consumes: `requestSensitiveActionCode`/`verifySensitiveActionCode` (Task 3), `checkAdminOnlyApiPermission` (já existe, `lib/auth/rbac.ts`), `refundPayment` (já existe, `lib/payment/refund-service.ts`).

- [ ] **Step 1: Escrever o teste da rota `request-code` (falha esperada)**

Crie `tests/admin-payment-refund-request-code-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ requestSensitiveActionCode: vi.fn() }));

import { POST } from "@/app/api/admin/payments/[id]/refund/request-code/route";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const requestCodeMock = vi.mocked(requestSensitiveActionCode);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/payments/[id]/refund/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 pra organizador titular", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await POST(new Request("http://localhost") as any, makeContext("pay-1"));
    expect(res.status).toBe(403);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o pagamento não está com status Pago", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PENDING" });
    const res = await POST(new Request("http://localhost") as any, makeContext("pay-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("gera o código e retorna o verificationId", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PAID" });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await POST(new Request("http://localhost") as any, makeContext("pay-1"));
    const body = await res.json();

    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "admin-1", actionType: "PAYMENT_REFUND", targetId: "pay-1" });
    expect(res.status).toBe(200);
    expect(body).toEqual({ verificationId: "code-1" });
  });

  it("retorna 400 quando o serviço de código falha (ex: rate limit)", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({ status: "PAID" });
    requestCodeMock.mockResolvedValueOnce({ ok: false, error: "Muitos pedidos de código em pouco tempo." });

    const res = await POST(new Request("http://localhost") as any, makeContext("pay-1"));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run tests/admin-payment-refund-request-code-route.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar a rota `request-code`**

Crie `app/api/admin/payments/[id]/refund/request-code/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payments.refund-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;

  const payment = await db.payment.findUnique({ where: { id }, select: { status: true } });
  if (!payment || payment.status !== "PAID") {
    return NextResponse.json({ error: "Só é possível estornar pagamentos com status Pago" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "PAYMENT_REFUND", targetId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run tests/admin-payment-refund-request-code-route.test.ts`
Expected: PASS

- [ ] **Step 5: Atualizar o teste da rota original (falha esperada)**

Em `tests/admin-payment-refund-route.test.ts`, adicione o mock de `verifySensitiveActionCode` no topo:

```ts
vi.mock("@/lib/security/sensitive-action-verification", () => ({ verifySensitiveActionCode: vi.fn() }));
```

E logo abaixo dos outros imports/mocks:

```ts
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";
const verifyCodeMock = vi.mocked(verifySensitiveActionCode);
```

No `beforeEach`, adicione:

```ts
    verifyCodeMock.mockResolvedValue({ ok: true });
```

Em TODOS os `makeRequest(...)` que hoje testam o caminho de sucesso (ex: "admin titular estorna qualquer pagamento", "assistente de admin com a permissão estorna qualquer pagamento"), adicione `verificationId: "code-1", code: "123456"` ao corpo, por exemplo:

```ts
    const res = await POST(makeRequest({ reason: "fraude", verificationId: "code-1", code: "123456" }), makeContext("pay-1"));
```

Adicione dois testes novos ao final do `describe`, antes do fechamento:

```ts
  it("retorna 400 sem verificationId/code", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await POST(makeRequest({ reason: "fraude" }), makeContext("pay-1"));

    expect(res.status).toBe(400);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o código é inválido, sem chamar refundPayment", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    verifyCodeMock.mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 3 });

    const res = await POST(makeRequest({ verificationId: "code-1", code: "000000" }), makeContext("pay-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Código incorreto.", attemptsRemaining: 3 });
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Rodar o teste, confirmar que falha**

Run: `npx vitest run tests/admin-payment-refund-route.test.ts`
Expected: FAIL — a rota ainda não exige `verificationId`/`code`.

- [ ] **Step 7: Modificar a rota original**

Em `app/api/admin/payments/[id]/refund/route.ts`, substitua o conteúdo por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { refundPayment } from "@/lib/payment/refund-service";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payments.refund-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  const { verificationId, code } = body;
  if (typeof verificationId !== "string" || typeof code !== "string") {
    return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
  }
  const verification = await verifySensitiveActionCode({
    verificationId,
    userId: session.user.id,
    actionType: "PAYMENT_REFUND",
    targetId: id,
    code,
  });
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error, attemptsRemaining: verification.attemptsRemaining }, { status: 400 });
  }

  try {
    const result = await refundPayment({ paymentId: id, initiatedByUserId: session.user.id, reason });
    return NextResponse.json({ success: true, alreadySynced: result.alreadySynced });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao estornar pagamento";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 8: Rodar os testes, confirmar que passam**

Run: `npx vitest run tests/admin-payment-refund-route.test.ts tests/admin-payment-refund-request-code-route.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/payments/[id]/refund tests/admin-payment-refund-route.test.ts tests/admin-payment-refund-request-code-route.test.ts
git commit -m "feat: estorno do admin exige codigo de verificacao em 2 etapas"
```

---

### Task 5: Rota de estorno do organizador — exige código

**Files:**
- Create: `app/api/organizer/registrations/[id]/refund/request-code/route.ts`
- Modify: `app/api/organizer/registrations/[id]/refund/route.ts`
- Modify: `tests/organizer-payment-refund-route.test.ts`
- Test: `tests/organizer-payment-refund-request-code-route.test.ts`

**Interfaces:**
- Consumes: mesmas do Task 4, mais `checkApiPermission` (já existe, `lib/auth/rbac.ts`).

- [ ] **Step 1: Ler a rota original inteira antes de mexer**

Leia `app/api/organizer/registrations/[id]/refund/route.ts` — ela resolve `organizerUserId` (com tratamento especial pra `ASSISTANT`), busca a `registration` filtrando por `event.organizer.userId`, e pega `registration.order.payments[0]`. A rota `request-code` precisa fazer a MESMA resolução de escopo, porque o `verificationId` só pode ser gerado depois de confirmar que esse organizador (ou assistente dele) realmente tem acesso a essa inscrição — senão qualquer organizador autenticado poderia gerar um código pra estornar a inscrição de outro.

- [ ] **Step 2: Escrever o teste da rota `request-code` (falha esperada)**

Crie `tests/organizer-payment-refund-request-code-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ requestSensitiveActionCode: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/refund/request-code/route";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const requestCodeMock = vi.mocked(requestSensitiveActionCode);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/organizer/registrations/[id]/refund/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 404 quando a inscrição não pertence ao organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(404);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando não há pagamento pago pra essa inscrição", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [] } });
    const res = await POST(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("gera o código pro pagamento da inscrição", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [{ id: "payment-1" }] } });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await POST(new Request("http://localhost") as any, makeContext("reg-1"));
    const body = await res.json();

    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "org-user-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });
    expect(res.status).toBe(200);
    expect(body).toEqual({ verificationId: "code-1" });
  });

  it("assistente de organizador resolve o organizerUserId antes de buscar a inscrição", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-user-1" });
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [{ id: "payment-1" }] } });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await POST(new Request("http://localhost") as any, makeContext("reg-1"));

    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "assistant-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Rodar o teste, confirmar que falha**

Run: `npx vitest run tests/organizer-payment-refund-request-code-route.test.ts`
Expected: FAIL — rota não existe.

- [ ] **Step 4: Implementar a rota `request-code`**

Crie `app/api/organizer/registrations/[id]/refund/request-code/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("payments.refund");
  if (!check.allowed) return check.response;
  const { session } = check;

  let organizerUserId = session.user.id;
  if (session.user.role === "ASSISTANT") {
    const assistant = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    organizerUserId = assistant?.createdByUserId ?? "__none__";
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: organizerUserId } } },
    include: {
      order: {
        include: { payments: { where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 1 } },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Nenhum pagamento pago encontrado para esta inscrição" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "PAYMENT_REFUND", targetId: payment.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
```

- [ ] **Step 5: Rodar o teste, confirmar que passa**

Run: `npx vitest run tests/organizer-payment-refund-request-code-route.test.ts`
Expected: PASS

- [ ] **Step 6: Atualizar o teste da rota original (falha esperada)**

Substitua o conteúdo de `tests/organizer-payment-refund-route.test.ts` por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ verifySensitiveActionCode: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/refund/route";
import { refundPayment } from "@/lib/payment/refund-service";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const refundPaymentMock = vi.mocked(refundPayment);
const verifyCodeMock = vi.mocked(verifySensitiveActionCode);

function makeRequest(body: unknown = {}) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const registrationWithPayment = {
  id: "reg-1",
  order: { payments: [{ id: "pay-1" }] },
};

const validCode = { verificationId: "code-1", code: "123456" };

describe("POST /api/organizer/registrations/[id]/refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyCodeMock.mockResolvedValue({ ok: true });
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(), makeContext("reg-1"));
    expect(res.status).toBe(403);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("organizador titular estorna o pagamento da própria inscrição", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest({ reason: "pedido do atleta", ...validCode }), makeContext("reg-1"));

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizer: { userId: "org-user-1" } } },
      include: {
        order: {
          include: {
            payments: { where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 1 },
          },
        },
      },
    });
    expect(verifyCodeMock).toHaveBeenCalledWith({
      verificationId: "code-1",
      userId: "org-user-1",
      actionType: "PAYMENT_REFUND",
      targetId: "pay-1",
      code: "123456",
    });
    expect(refundPaymentMock).toHaveBeenCalledWith({
      paymentId: "pay-1",
      initiatedByUserId: "org-user-1",
      reason: "pedido do atleta",
    });
    expect(res.status).toBe(200);
  });

  it("admin titular recebe 404 (SEM bypass — payments.refund não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeContext("reg-9"));

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-9", event: { organizer: { userId: "admin-1" } } } })
    );
    expect(res.status).toBe(404);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão estorna usando o userId do criador, mas o código vai pro assistente", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-user-1" });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest(validCode), makeContext("reg-1"));

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizer: { userId: "org-user-1" } } } })
    );
    expect(verifyCodeMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "assistant-1" }));
    expect(refundPaymentMock).toHaveBeenCalledWith({
      paymentId: "pay-1",
      initiatedByUserId: "assistant-1",
      reason: undefined,
    });
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeContext("reg-1"));

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 400 quando refundPayment lança erro", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);
    refundPaymentMock.mockRejectedValueOnce(new Error("Gateway indisponível"));

    const res = await POST(makeRequest(validCode), makeContext("reg-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Gateway indisponível");
  });

  it("retorna 400 sem verificationId/code", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);

    const res = await POST(makeRequest({ reason: "pedido do atleta" }), makeContext("reg-1"));

    expect(res.status).toBe(400);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o código é inválido, sem chamar refundPayment", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);
    verifyCodeMock.mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 3 });

    const res = await POST(makeRequest({ verificationId: "code-1", code: "000000" }), makeContext("reg-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Código incorreto.", attemptsRemaining: 3 });
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Modificar a rota original**

Em `app/api/organizer/registrations/[id]/refund/route.ts`, adicione `import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";` no topo, e insira a checagem de código logo depois de encontrar `payment` e antes do bloco `try { refundPayment(...) }`: substitua

```ts
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  const { verificationId, code } = body;
  if (typeof verificationId !== "string" || typeof code !== "string") {
    return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
  }
  const verification = await verifySensitiveActionCode({
    verificationId,
    userId: session.user.id,
    actionType: "PAYMENT_REFUND",
    targetId: payment.id,
    code,
  });
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error, attemptsRemaining: verification.attemptsRemaining }, { status: 400 });
  }

  try {
```

(substitui o bloco `const body = ...` e `try {` que já existem na rota — a leitura de `body`/`reason` continua igual, só adiciona a checagem de código entre a leitura do `body` e o `try`. Adicione também `import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";` no topo do arquivo.)

- [ ] **Step 7: Rodar os testes, confirmar que passam**

Run: `npx vitest run tests/organizer-payment-refund-route.test.ts tests/organizer-payment-refund-request-code-route.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/api/organizer/registrations/[id]/refund tests/organizer-payment-refund-route.test.ts tests/organizer-payment-refund-request-code-route.test.ts
git commit -m "feat: estorno do organizador exige codigo de verificacao em 2 etapas"
```

---

### Task 6: Rota de rejeição de anunciante — exige código

**Files:**
- Create: `app/api/admin/anunciantes/[purchaseId]/reject/request-code/route.ts`
- Modify: `app/api/admin/anunciantes/[purchaseId]/reject/route.ts`
- Modify: `tests/admin-anunciantes-reject-route.test.ts`
- Test: `tests/admin-anunciantes-reject-request-code-route.test.ts`

**Interfaces:**
- Consumes: mesmas do Task 4.

- [ ] **Step 1: Escrever o teste da rota `request-code` (falha esperada)**

Crie `tests/admin-anunciantes-reject-request-code-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ requestSensitiveActionCode: vi.fn() }));

import { POST } from "@/app/api/admin/anunciantes/[purchaseId]/reject/request-code/route";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const requestCodeMock = vi.mocked(requestSensitiveActionCode);

function makeContext(purchaseId: string) {
  return { params: Promise.resolve({ purchaseId }) };
}

describe("POST /api/admin/anunciantes/[purchaseId]/reject/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(new Request("http://localhost") as any, makeContext("purchase-1"));
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando a compra não existe ou não está PENDING_APPROVAL", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://localhost") as any, makeContext("purchase-1"));
    expect(res.status).toBe(404);
  });

  it("retorna 400 quando a compra não tem pagamento pago (nada a estornar, código não faz sentido)", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({ id: "purchase-1", status: "PENDING_APPROVAL", payments: [] });
    const res = await POST(new Request("http://localhost") as any, makeContext("purchase-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("gera o código pro pagamento da compra", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({ id: "purchase-1", status: "PENDING_APPROVAL", payments: [{ id: "payment-1" }] });
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await POST(new Request("http://localhost") as any, makeContext("purchase-1"));
    const body = await res.json();

    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "admin-1", actionType: "PAYMENT_REFUND", targetId: "payment-1" });
    expect(body).toEqual({ verificationId: "code-1" });
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run tests/admin-anunciantes-reject-request-code-route.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar a rota `request-code`**

Crie `app/api/admin/anunciantes/[purchaseId]/reject/request-code/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ purchaseId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { purchaseId } = await params;

  const purchase = await db.adPurchase.findUnique({
    where: { id: purchaseId },
    select: { id: true, status: true, payments: { select: { id: true }, where: { status: "PAID" }, take: 1 } },
  });
  if (!purchase || purchase.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
  }

  const payment = purchase.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Esta solicitação não tem pagamento pago associado" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "PAYMENT_REFUND", targetId: payment.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run tests/admin-anunciantes-reject-request-code-route.test.ts`
Expected: PASS

- [ ] **Step 5: Atualizar o teste da rota original (falha esperada)**

Em `tests/admin-anunciantes-reject-route.test.ts`, adicione o mock e o import no topo do arquivo:

```ts
vi.mock("@/lib/security/sensitive-action-verification", () => ({ verifySensitiveActionCode: vi.fn() }));
```

```ts
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";
const verifyCodeMock = vi.mocked(verifySensitiveActionCode);
```

No `beforeEach` já existente (que já faz `authMock.mockResolvedValue(...)`), adicione a linha:

```ts
    verifyCodeMock.mockResolvedValue({ ok: true });
```

Nos dois testes que hoje chamam `makeRequest({ reason: "Dados inconsistentes" })` esperando sucesso ("rejeita: marca REJECTED..." e "rejeita mesmo quando o estorno falha..."), troque o corpo da chamada para `makeRequest({ reason: "Dados inconsistentes", verificationId: "code-1", code: "123456" })`. Adicione 2 testes novos (sem verificationId/code → 400; código inválido → 400, `adPurchase.update` não é chamado):

```ts
  it("retorna 400 sem verificationId/code", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      advertiser: { user: { name: "Fulano", email: "fulano@example.com" } },
      payments: [{ id: "payment-1" }],
    });

    const res = await POST(makeRequest({ reason: "Dados inconsistentes" }), { params: Promise.resolve({ purchaseId: "purchase-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.adPurchase.update).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o código é inválido, sem marcar REJECTED", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce({
      id: "purchase-1",
      status: "PENDING_APPROVAL",
      advertiser: { user: { name: "Fulano", email: "fulano@example.com" } },
      payments: [{ id: "payment-1" }],
    });
    vi.mocked(verifySensitiveActionCode).mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 2 });

    const res = await POST(
      makeRequest({ reason: "Dados inconsistentes", verificationId: "code-1", code: "000000" }),
      { params: Promise.resolve({ purchaseId: "purchase-1" }) },
    );

    expect(res.status).toBe(400);
    expect(dbMock.adPurchase.update).not.toHaveBeenCalled();
  });
```

Não esqueça de importar `verifySensitiveActionCode` no topo do arquivo de teste pra usar `vi.mocked(verifySensitiveActionCode)`.

- [ ] **Step 6: Rodar o teste, confirmar que falha**

Run: `npx vitest run tests/admin-anunciantes-reject-route.test.ts`
Expected: FAIL

- [ ] **Step 7: Modificar a rota original**

Em `app/api/admin/anunciantes/[purchaseId]/reject/route.ts`, depois do bloco que busca `purchase` (e antes de `await db.adPurchase.update(...)`), adicione a checagem de código quando houver pagamento a estornar:

```ts
  const payment = purchase.payments[0];
  if (payment) {
    const { verificationId, code } = body;
    if (typeof verificationId !== "string" || typeof code !== "string") {
      return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
    }
    const verification = await verifySensitiveActionCode({
      verificationId,
      userId: session.user.id,
      actionType: "PAYMENT_REFUND",
      targetId: payment.id,
      code,
    });
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error, attemptsRemaining: verification.attemptsRemaining }, { status: 400 });
    }
  }

  await db.adPurchase.update({
```

(o `const payment = purchase.payments[0];` já existe mais abaixo no arquivo original, logo depois do `db.adPurchase.update` — mova essa linha pra ANTES do `update`, junto com o bloco acima; remova a declaração duplicada que sobrar mais abaixo). Adicione `import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";` no topo.

- [ ] **Step 8: Rodar os testes, confirmar que passam**

Run: `npx vitest run tests/admin-anunciantes-reject-route.test.ts tests/admin-anunciantes-reject-request-code-route.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/anunciantes/[purchaseId]/reject tests/admin-anunciantes-reject-route.test.ts tests/admin-anunciantes-reject-request-code-route.test.ts
git commit -m "feat: rejeicao de anunciante exige codigo quando ha estorno"
```

---

### Task 7: Rotas de decisão de cancelamento (admin + organizador) — exigem código só quando há pagamento pago

**Files:**
- Modify: `lib/registrations/cancellation-decision-service.ts`
- Create: `app/api/admin/registrations/[id]/cancellation-decision/request-code/route.ts`
- Create: `app/api/organizer/registrations/[id]/cancellation-decision/request-code/route.ts`
- Modify: `app/api/admin/registrations/[id]/cancellation-decision/route.ts`
- Modify: `app/api/organizer/registrations/[id]/cancellation-decision/route.ts`
- Modify: `tests/admin-cancellation-decision-route.test.ts`
- Modify: `tests/organizer-cancellation-decision-route.test.ts`
- Test: `tests/cancellation-decision-request-code-routes.test.ts`
- Test: `tests/registration-has-paid-payment.test.ts`

**Interfaces:**
- Produces: `registrationHasPaidPayment(where: Prisma.RegistrationWhereInput): Promise<boolean>` em `lib/registrations/cancellation-decision-service.ts` — usada pelas 2 rotas `request-code` e pelas 2 rotas originais, pra decidir sem duplicar a query em 4 lugares.
- Consumes: `requestSensitiveActionCode`/`verifySensitiveActionCode` (Task 3).

- [ ] **Step 1: Escrever o teste de `registrationHasPaidPayment` (falha esperada)**

Crie `tests/registration-has-paid-payment.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("registrationHasPaidPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna true quando existe pagamento pago associado", async () => {
    const { registrationHasPaidPayment } = await import("@/lib/registrations/cancellation-decision-service");
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [{ id: "payment-1" }] } });

    const result = await registrationHasPaidPayment({ id: "reg-1" });

    expect(result).toBe(true);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      select: { order: { select: { payments: { where: { status: "PAID" }, take: 1, select: { id: true } } } } },
    });
  });

  it("retorna false quando não há pagamento pago", async () => {
    const { registrationHasPaidPayment } = await import("@/lib/registrations/cancellation-decision-service");
    dbMock.registration.findFirst.mockResolvedValueOnce({ order: { payments: [] } });

    const result = await registrationHasPaidPayment({ id: "reg-1" });

    expect(result).toBe(false);
  });

  it("retorna false quando a inscrição não existe", async () => {
    const { registrationHasPaidPayment } = await import("@/lib/registrations/cancellation-decision-service");
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const result = await registrationHasPaidPayment({ id: "reg-inexistente" });

    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run tests/registration-has-paid-payment.test.ts`
Expected: FAIL — função não existe.

- [ ] **Step 3: Implementar `registrationHasPaidPayment`**

Em `lib/registrations/cancellation-decision-service.ts`, adicione ao final do arquivo:

```ts
export async function registrationHasPaidPayment(where: Prisma.RegistrationWhereInput): Promise<boolean> {
  const registration = await db.registration.findFirst({
    where,
    select: { order: { select: { payments: { where: { status: "PAID" }, take: 1, select: { id: true } } } } },
  });
  return Boolean(registration?.order.payments.length);
}
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run tests/registration-has-paid-payment.test.ts`
Expected: PASS

- [ ] **Step 5: Escrever os testes das 2 rotas `request-code` (falha esperada)**

Crie `tests/cancellation-decision-request-code-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/rbac");
vi.mock("@/lib/registrations/cancellation-decision-service", () => ({
  registrationHasPaidPayment: vi.fn(),
}));
vi.mock("@/lib/security/sensitive-action-verification", () => ({ requestSensitiveActionCode: vi.fn() }));

import { checkAdminOnlyApiPermission, checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";
import { POST as adminPost } from "@/app/api/admin/registrations/[id]/cancellation-decision/request-code/route";
import { POST as organizerPost } from "@/app/api/organizer/registrations/[id]/cancellation-decision/request-code/route";

const checkAdminMock = vi.mocked(checkAdminOnlyApiPermission);
const checkOrgMock = vi.mocked(checkApiPermission);
const resolveScopeMock = vi.mocked(resolveActingScope);
const hasPaidMock = vi.mocked(registrationHasPaidPayment);
const requestCodeMock = vi.mocked(requestSensitiveActionCode);

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/registrations/[id]/cancellation-decision/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAdminMock.mockResolvedValue({ allowed: true, session: { user: { id: "admin-1", role: "ADMIN" } } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    checkAdminMock.mockResolvedValueOnce({ allowed: false, response: new Response(null, { status: 403 }) } as any);
    const res = await adminPost(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(403);
  });

  it("retorna 400 quando não há pagamento pago (não faz sentido pedir código)", async () => {
    hasPaidMock.mockResolvedValueOnce(false);
    const res = await adminPost(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it("gera o código quando há pagamento pago", async () => {
    hasPaidMock.mockResolvedValueOnce(true);
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    const res = await adminPost(new Request("http://localhost") as any, makeContext("reg-1"));
    const body = await res.json();

    expect(hasPaidMock).toHaveBeenCalledWith({ id: "reg-1" });
    expect(requestCodeMock).toHaveBeenCalledWith({ userId: "admin-1", actionType: "PAYMENT_REFUND", targetId: "reg-1" });
    expect(body).toEqual({ verificationId: "code-1" });
  });
});

describe("POST /api/organizer/registrations/[id]/cancellation-decision/request-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkOrgMock.mockResolvedValue({ allowed: true, session: { user: { id: "org-user-1", role: "ORGANIZER" } } } as any);
    resolveScopeMock.mockResolvedValue({ organizerId: "org-1" } as any);
  });

  it("escopa a checagem de pagamento pago pelo organizador dono do evento", async () => {
    hasPaidMock.mockResolvedValueOnce(true);
    requestCodeMock.mockResolvedValueOnce({ ok: true, verificationId: "code-1" });

    await organizerPost(new Request("http://localhost") as any, makeContext("reg-1"));

    expect(hasPaidMock).toHaveBeenCalledWith({ id: "reg-1", event: { organizerId: "org-1" } });
  });

  it("retorna 400 quando não há pagamento pago", async () => {
    hasPaidMock.mockResolvedValueOnce(false);
    const res = await organizerPost(new Request("http://localhost") as any, makeContext("reg-1"));
    expect(res.status).toBe(400);
    expect(requestCodeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar os testes, confirmar que falham**

Run: `npx vitest run tests/cancellation-decision-request-code-routes.test.ts`
Expected: FAIL — rotas não existem.

- [ ] **Step 7: Implementar as 2 rotas `request-code`**

Crie `app/api/admin/registrations/[id]/cancellation-decision/request-code/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.cancellation-decision-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;

  const hasPaidPayment = await registrationHasPaidPayment({ id });
  if (!hasPaidPayment) {
    return NextResponse.json({ error: "Esta inscrição não tem pagamento pago associado" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "PAYMENT_REFUND", targetId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
```

Crie `app/api/organizer/registrations/[id]/cancellation-decision/request-code/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.cancellation-decision");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);

  const hasPaidPayment = await registrationHasPaidPayment({ id, event: { organizerId: scope.organizerId ?? "__none__" } });
  if (!hasPaidPayment) {
    return NextResponse.json({ error: "Esta inscrição não tem pagamento pago associado" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "PAYMENT_REFUND", targetId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
```

- [ ] **Step 8: Rodar os testes, confirmar que passam**

Run: `npx vitest run tests/cancellation-decision-request-code-routes.test.ts`
Expected: PASS

- [ ] **Step 9: Atualizar os testes das 2 rotas originais (falha esperada)**

Em `tests/admin-cancellation-decision-route.test.ts` e `tests/organizer-cancellation-decision-route.test.ts`, adicione o mock de `registrationHasPaidPayment` e `verifySensitiveActionCode` no topo (mesmo padrão dos mocks já existentes nesses arquivos):

```ts
vi.mock("@/lib/security/sensitive-action-verification", () => ({ verifySensitiveActionCode: vi.fn() }));
```

E, no mock de `@/lib/registrations/cancellation-decision-service` que já existe (`vi.mock("@/lib/registrations/cancellation-decision-service", () => ({ decideRegistrationCancellation: vi.fn() }))`), adicione `registrationHasPaidPayment: vi.fn()` ao objeto retornado. No `beforeEach`, adicione:

```ts
    vi.mocked(registrationHasPaidPayment).mockResolvedValue(false);
    vi.mocked(verifySensitiveActionCode).mockResolvedValue({ ok: true });
```

(por padrão, os testes existentes de `APPROVE` não têm pagamento pago — `registrationHasPaidPayment` retorna `false`, comportamento igual ao de hoje, sem exigir código; isso preserva todos os testes já existentes sem modificação). Adicione 3 testes novos ao final de cada arquivo:

Para `tests/admin-cancellation-decision-route.test.ts`:

```ts
  it("exige verificationId/code quando há pagamento pago e a decisão é APPROVE", async () => {
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("segue com o código correto quando há pagamento pago", async () => {
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(
      makeRequest({ decision: "APPROVE", verificationId: "code-1", code: "123456" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(decideMock).toHaveBeenCalledWith({ where: { id: "reg-1" }, decision: "APPROVE", actingUserId: "admin-1" });
  });

  it("não exige código pra REJECT (nunca mexe em pagamento)", async () => {
    decideMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ decision: "REJECT" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(registrationHasPaidPayment).not.toHaveBeenCalled();
  });
```

Em `tests/organizer-cancellation-decision-route.test.ts`, adicione o mesmo mock de `@/lib/security/sensitive-action-verification` (import `verifySensitiveActionCode`, `vi.mocked` como `verifyCodeMock`), adicione `registrationHasPaidPayment: vi.fn()` ao mock de `@/lib/registrations/cancellation-decision-service` já existente, e no `beforeEach` adicione `vi.mocked(registrationHasPaidPayment).mockResolvedValue(false);` e `verifyCodeMock.mockResolvedValue({ ok: true });`. Adicione estes 3 testes novos ao final do `describe` (usando os nomes reais já existentes no arquivo: `checkPermMock`, `resolveScope`, `organizer-1` como `actingUserId`):

```ts
  it("exige verificationId/code quando há pagamento pago e a decisão é APPROVE", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("segue com o código correto quando há pagamento pago", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    vi.mocked(registrationHasPaidPayment).mockResolvedValueOnce(true);
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(
      makeRequest({ decision: "APPROVE", verificationId: "code-1", code: "123456" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(decideMock).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizerId: "org-1" } },
      decision: "APPROVE",
      actingUserId: "organizer-1",
    });
  });

  it("não exige código pra REJECT (nunca mexe em pagamento)", async () => {
    resolveScope.mockResolvedValueOnce({ actingAsAdmin: false, organizerId: "org-1" });
    decideMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ decision: "REJECT" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(registrationHasPaidPayment).not.toHaveBeenCalled();
  });
```

Não esqueça de importar `registrationHasPaidPayment` no topo do arquivo de teste (`import { decideRegistrationCancellation, registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";`) pra poder usar `vi.mocked(registrationHasPaidPayment)`.

- [ ] **Step 10: Rodar os testes, confirmar que falham**

Run: `npx vitest run tests/admin-cancellation-decision-route.test.ts tests/organizer-cancellation-decision-route.test.ts`
Expected: FAIL nos 2 primeiros testes novos de cada arquivo (a rota ainda não faz a checagem).

- [ ] **Step 11: Modificar as 2 rotas originais**

Em `app/api/admin/registrations/[id]/cancellation-decision/route.ts`, substitua o conteúdo por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { decideRegistrationCancellation, registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.cancellation-decision-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.decision === "APPROVE" && (await registrationHasPaidPayment({ id }))) {
    const { verificationId, code } = body;
    if (typeof verificationId !== "string" || typeof code !== "string") {
      return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
    }
    const verification = await verifySensitiveActionCode({
      verificationId,
      userId: session.user.id,
      actionType: "PAYMENT_REFUND",
      targetId: id,
      code,
    });
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error, attemptsRemaining: verification.attemptsRemaining }, { status: 400 });
    }
  }

  const result = await decideRegistrationCancellation({
    where: { id },
    decision: parsed.data.decision,
    actingUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, refund: result.refund });
}
```

Em `app/api/organizer/registrations/[id]/cancellation-decision/route.ts`, substitua o conteúdo por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { decideRegistrationCancellation, registrationHasPaidPayment } from "@/lib/registrations/cancellation-decision-service";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.cancellation-decision");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const scope = await resolveActingScope(session);
  const registrationWhere = { id, event: { organizerId: scope.organizerId ?? "__none__" } };

  if (parsed.data.decision === "APPROVE" && (await registrationHasPaidPayment(registrationWhere))) {
    const { verificationId, code } = body;
    if (typeof verificationId !== "string" || typeof code !== "string") {
      return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
    }
    const verification = await verifySensitiveActionCode({
      verificationId,
      userId: session.user.id,
      actionType: "PAYMENT_REFUND",
      targetId: id,
      code,
    });
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error, attemptsRemaining: verification.attemptsRemaining }, { status: 400 });
    }
  }

  const result = await decideRegistrationCancellation({
    where: registrationWhere,
    decision: parsed.data.decision,
    actingUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, refund: result.refund });
}
```

- [ ] **Step 12: Rodar os testes, confirmar que passam**

Run: `npx vitest run tests/admin-cancellation-decision-route.test.ts tests/organizer-cancellation-decision-route.test.ts tests/cancellation-decision-request-code-routes.test.ts tests/registration-has-paid-payment.test.ts`
Expected: PASS

- [ ] **Step 13: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 14: Commit**

```bash
git add lib/registrations/cancellation-decision-service.ts app/api/admin/registrations/[id]/cancellation-decision app/api/organizer/registrations/[id]/cancellation-decision tests/admin-cancellation-decision-route.test.ts tests/organizer-cancellation-decision-route.test.ts tests/cancellation-decision-request-code-routes.test.ts tests/registration-has-paid-payment.test.ts
git commit -m "feat: aprovacao de cancelamento exige codigo quando ha estorno"
```

---

### Task 8: Componente de UI — `CodeVerificationModal`

**Files:**
- Create: `components/ui/CodeVerificationModal.tsx`

**Interfaces:**
- Produces: `<CodeVerificationModal open expiresAt error attemptsRemaining loading resending onSubmit onResend onCancel title? />`.
- Consumes: nada (componente puro).

- [ ] **Step 1: Implementar (sem teste automatizado — client component, convenção do projeto)**

Crie `components/ui/CodeVerificationModal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

export default function CodeVerificationModal({
  open,
  title = "Digite o código de verificação",
  expiresAt,
  error,
  attemptsRemaining,
  loading = false,
  resending = false,
  onSubmit,
  onResend,
  onCancel,
}: {
  open: boolean;
  title?: string;
  expiresAt: Date | null;
  error?: string | null;
  attemptsRemaining?: number | null;
  loading?: boolean;
  resending?: boolean;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!open) setCode("");
  }, [open]);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!open) return null;

  const expired = secondsLeft === 0;
  const minutes = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
  const seconds = secondsLeft !== null ? secondsLeft % 60 : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => !loading && onCancel()}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Enviamos um código de 6 dígitos para o seu e-mail (e WhatsApp, se cadastrado). Digite abaixo para confirmar.
        </p>

        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          className="input-field text-center text-2xl tracking-[0.5em] mt-4"
          autoFocus
        />

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {typeof attemptsRemaining === "number" && attemptsRemaining > 0 && (
          <p className="mt-1 text-xs text-gray-500">Restam {attemptsRemaining} tentativa(s).</p>
        )}

        <div className="mt-2 text-xs text-gray-500">
          {secondsLeft !== null && !expired && (
            <span>Código expira em {minutes}:{String(seconds).padStart(2, "0")}</span>
          )}
          {expired && <span className="text-red-600 dark:text-red-400">Código expirado — solicite um novo.</span>}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onResend}
            disabled={resending || loading}
            className="text-xs text-primary-600 hover:underline disabled:opacity-50"
          >
            {resending ? "Reenviando..." : "Reenviar código"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onSubmit(code)}
              disabled={loading || code.length !== 6 || expired}
              className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
            >
              {loading ? "Confirmando..." : "Confirmar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/ui/CodeVerificationModal.tsx
git commit -m "feat: componente CodeVerificationModal"
```

---

### Task 9: Hook compartilhado — `useSensitiveActionVerification`

**Files:**
- Create: `lib/hooks/use-sensitive-action-verification.ts`

**Interfaces:**
- Consumes: nada além de `fetch` do navegador.
- Produces: `useSensitiveActionVerification({ requestCodeEndpoint, confirmEndpoint }): { step, error, attemptsRemaining, expiresAt, resending, start, submitCode, resend, cancel }` — usado pelas Tasks 10-13.

- [ ] **Step 1: Implementar (sem teste automatizado — hook de client component, convenção do projeto)**

Crie `lib/hooks/use-sensitive-action-verification.ts`:

```ts
"use client";

import { useCallback, useState } from "react";

type Step = "idle" | "requesting" | "code" | "submitting";

export function useSensitiveActionVerification(params: {
  requestCodeEndpoint: string;
  confirmEndpoint: string;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [resending, setResending] = useState(false);

  const requestCode = useCallback(async () => {
    setError(null);
    const res = await fetch(params.requestCodeEndpoint, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Não foi possível enviar o código.");
      return false;
    }
    setVerificationId(data.verificationId);
    setExpiresAt(new Date(Date.now() + 10 * 60 * 1000));
    setAttemptsRemaining(null);
    return true;
  }, [params.requestCodeEndpoint]);

  const start = useCallback(async () => {
    setStep("requesting");
    const ok = await requestCode();
    setStep(ok ? "code" : "idle");
  }, [requestCode]);

  const resend = useCallback(async () => {
    setResending(true);
    await requestCode();
    setResending(false);
  }, [requestCode]);

  const submitCode = useCallback(
    async (code: string, extraBody?: Record<string, unknown>): Promise<{ ok: boolean; response?: Response }> => {
      if (!verificationId) return { ok: false };
      setStep("submitting");
      setError(null);
      const res = await fetch(params.confirmEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId, code, ...extraBody }),
      });
      if (res.ok) {
        setStep("idle");
        return { ok: true, response: res };
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao confirmar o código.");
      setAttemptsRemaining(typeof data.attemptsRemaining === "number" ? data.attemptsRemaining : null);
      setStep("code");
      return { ok: false, response: res };
    },
    [verificationId, params.confirmEndpoint],
  );

  const cancel = useCallback(() => {
    setStep("idle");
    setVerificationId(null);
    setError(null);
    setAttemptsRemaining(null);
    setExpiresAt(null);
  }, []);

  return { step, error, attemptsRemaining, expiresAt, resending, start, submitCode, resend, cancel };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-sensitive-action-verification.ts
git commit -m "feat: hook useSensitiveActionVerification"
```

---

### Task 10: Ligar o hook em `RefundPaymentButton` (admin)

**Files:**
- Modify: `components/admin/RefundPaymentButton.tsx`

**Interfaces:**
- Consumes: `CodeVerificationModal` (Task 8), `useSensitiveActionVerification` (Task 9).

- [ ] **Step 1: Substituir o conteúdo do componente**

Substitua `components/admin/RefundPaymentButton.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

export default function RefundPaymentButton({ paymentId }: { paymentId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/payments/${paymentId}/refund/request-code`,
    confirmEndpoint: `/api/admin/payments/${paymentId}/refund`,
  });

  async function handleConfirmReason(noteReason?: string) {
    setReason(noteReason);
    setConfirming(false);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, { reason });
    if (result.ok) router.refresh();
  }

  const busy = verification.step === "requesting" || verification.step === "submitting";

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="btn-secondary text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
      >
        {busy ? "Estornando..." : "Estornar pagamento"}
      </button>

      <ConfirmModal
        open={confirming}
        title="Estornar pagamento"
        message="Estornar este pagamento? O valor total será devolvido via gateway de pagamento. Esta ação não pode ser desfeita. Você receberá um código de confirmação por e-mail e WhatsApp."
        confirmLabel="Continuar"
        tone="danger"
        loading={verification.step === "requesting"}
        showNoteField
        notePlaceholder="Motivo do estorno (opcional)"
        onConfirm={handleConfirmReason}
        onCancel={() => setConfirming(false)}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={verification.cancel}
      />

      <ErrorModal
        message={verification.step === "idle" ? verification.error : null}
        onClose={verification.cancel}
      />
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Testar manualmente no navegador**

Suba o app (`npm run dev`), acesse `/admin/pagamentos/[id]` de um pagamento PAGO, clique em "Estornar pagamento", confirme o motivo, confira que o modal de código abre, digite um código errado (confere mensagem de erro + tentativas restantes), e depois o código certo (confira no `MessageLog` do admin ou no console de e-mail/WhatsApp de teste, dependendo do ambiente).

- [ ] **Step 4: Commit**

```bash
git add components/admin/RefundPaymentButton.tsx
git commit -m "feat: RefundPaymentButton pede codigo de verificacao antes de estornar"
```

---

### Task 11: Ligar o hook em `RefundRegistrationButton` (organizador)

**Files:**
- Modify: `components/organizer/RefundRegistrationButton.tsx`

**Interfaces:**
- Consumes: mesmas do Task 10.

- [ ] **Step 1: Substituir o conteúdo do componente**

Substitua `components/organizer/RefundRegistrationButton.tsx` por (idêntico ao Task 10, trocando os endpoints e o `paymentId`/`registrationId`):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

export default function RefundRegistrationButton({ registrationId }: { registrationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/organizer/registrations/${registrationId}/refund/request-code`,
    confirmEndpoint: `/api/organizer/registrations/${registrationId}/refund`,
  });

  async function handleConfirmReason(noteReason?: string) {
    setReason(noteReason);
    setConfirming(false);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, { reason });
    if (result.ok) router.refresh();
  }

  const busy = verification.step === "requesting" || verification.step === "submitting";

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {busy ? "Estornando..." : "Estornar"}
      </button>

      <ConfirmModal
        open={confirming}
        title="Estornar pagamento"
        message="Estornar o pagamento desta inscrição? O valor total será devolvido via gateway de pagamento. Esta ação não pode ser desfeita. Você receberá um código de confirmação por e-mail e WhatsApp."
        confirmLabel="Continuar"
        tone="danger"
        loading={verification.step === "requesting"}
        showNoteField
        notePlaceholder="Motivo do estorno (opcional)"
        onConfirm={handleConfirmReason}
        onCancel={() => setConfirming(false)}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={verification.cancel}
      />

      <ErrorModal
        message={verification.step === "idle" ? verification.error : null}
        onClose={verification.cancel}
      />
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Testar manualmente no navegador**

Mesmo roteiro do Task 10, na tela de inscritos do organizador.

- [ ] **Step 4: Commit**

```bash
git add components/organizer/RefundRegistrationButton.tsx
git commit -m "feat: RefundRegistrationButton pede codigo de verificacao antes de estornar"
```

---

### Task 12: Ligar o hook em `AdvertiserRequestRow` (rejeição com estorno)

**Files:**
- Modify: `components/admin/AdvertiserRequestRow.tsx`

**Interfaces:**
- Consumes: mesmas do Task 10, mais o tratamento de `refundFailed` que já existe no fluxo atual.

- [ ] **Step 1: Substituir o conteúdo do componente**

Substitua `components/admin/AdvertiserRequestRow.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

interface Props {
  purchaseId: string;
  companyName: string;
  document: string | null;
  address: string | null;
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
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint: `/api/admin/anunciantes/${purchaseId}/reject/request-code`,
    confirmEndpoint: `/api/admin/anunciantes/${purchaseId}/reject`,
  });

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

  async function handleConfirmReject(noteReason?: string) {
    setReason(noteReason);
    setRejecting(false);
    await verification.start();
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, { reason });
    if (result.ok && result.response) {
      router.refresh();
      const data = await result.response.json().catch(() => ({}));
      if (data.refundFailed) {
        setError("Solicitação rejeitada, mas o estorno automático falhou — verifique manualmente o pagamento.");
      }
    }
  }

  const busy = loading || verification.step === "requesting" || verification.step === "submitting";

  return (
    <div className="py-4 first:pt-0 last:pb-0 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{companyName} <span className="text-xs text-gray-500">— {planName}</span></p>
          <p className="text-xs text-gray-500">{document ?? "—"} — {address ?? "—"}</p>
          <p className="text-xs text-gray-500">{contactEmail} — {contactPhone}</p>
          {(instagram || facebook) && (
            <p className="text-xs text-gray-500">
              {instagram && <span>Instagram: {instagram} </span>}
              {facebook && <span>Facebook: {facebook}</span>}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={handleApprove} disabled={busy} className="btn-primary py-1.5 px-3 text-sm disabled:opacity-50">
            {loading ? "Processando..." : "Aprovar"}
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="btn-secondary py-1.5 px-3 text-sm text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50"
          >
            Rejeitar
          </button>
        </div>
      </div>

      <ConfirmModal
        open={rejecting}
        title="Rejeitar solicitação de anunciante"
        message="Informe o motivo da rejeição. O valor pago será estornado automaticamente e o solicitante verá esse motivo por e-mail. Você receberá um código de confirmação por e-mail e WhatsApp."
        confirmLabel="Continuar"
        tone="danger"
        loading={verification.step === "requesting"}
        showNoteField
        noteRequired
        notePlaceholder="Motivo da rejeição"
        onConfirm={handleConfirmReject}
        onCancel={() => setRejecting(false)}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={verification.cancel}
      />

      <ErrorModal
        message={error ?? (verification.step === "idle" ? verification.error : null)}
        onClose={() => { setError(null); verification.cancel(); }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Testar manualmente no navegador**

Em `/admin/anunciantes/solicitacoes`, rejeite uma solicitação com pagamento pago — confirma que o código é exigido antes do estorno acontecer.

- [ ] **Step 4: Commit**

```bash
git add components/admin/AdvertiserRequestRow.tsx
git commit -m "feat: rejeicao de anunciante pede codigo de verificacao antes de estornar"
```

---

### Task 13: Ligar o hook em `CancellationDecisionButtons` (só quando há pagamento pago)

**Files:**
- Modify: `components/organizer/CancellationDecisionButtons.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Consumes: mesmas do Task 10.
- Produces: `CancellationDecisionButtons` ganha 2 props novas: `requestCodeEndpoint: string`, `hasPaidPayment: boolean`.

- [ ] **Step 1: Substituir o conteúdo do componente**

Substitua `components/organizer/CancellationDecisionButtons.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";
import CodeVerificationModal from "@/components/ui/CodeVerificationModal";
import { useSensitiveActionVerification } from "@/lib/hooks/use-sensitive-action-verification";

export default function CancellationDecisionButtons({
  cancellationReason,
  endpoint,
  requestCodeEndpoint,
  hasPaidPayment,
}: {
  cancellationReason: string | null;
  endpoint: string;
  requestCodeEndpoint: string;
  hasPaidPayment: boolean;
}) {
  const [pendingDecision, setPendingDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const verification = useSensitiveActionVerification({
    requestCodeEndpoint,
    confirmEndpoint: endpoint,
  });

  const needsCode = pendingDecision === "APPROVE" && hasPaidPayment;

  async function confirmDecision() {
    if (!pendingDecision) return;

    if (needsCode) {
      setPendingDecision(null);
      await verification.start();
      return;
    }

    setLoading(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: pendingDecision }),
    });
    setLoading(false);
    setPendingDecision(null);
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Erro ao processar a decisão.");
  }

  async function handleSubmitCode(code: string) {
    const result = await verification.submitCode(code, { decision: "APPROVE" });
    if (result.ok) router.refresh();
  }

  const busy = loading || verification.step === "requesting" || verification.step === "submitting";

  return (
    <>
      <div className="flex gap-2">
        <button onClick={() => setPendingDecision("APPROVE")} disabled={busy} className="text-xs text-green-600 hover:underline disabled:opacity-50">
          Aprovar
        </button>
        <button onClick={() => setPendingDecision("REJECT")} disabled={busy} className="text-xs text-red-600 hover:underline disabled:opacity-50">
          Rejeitar
        </button>
      </div>

      <ConfirmModal
        open={pendingDecision !== null}
        title={pendingDecision === "APPROVE" ? "Confirmar aprovação do cancelamento" : "Confirmar rejeição do cancelamento"}
        message={
          `Justificativa do atleta:\n${cancellationReason ?? "Nenhuma justificativa registrada."}` +
          (needsCode ? "\n\nComo há um pagamento pago, você receberá um código de confirmação por e-mail e WhatsApp." : "")
        }
        confirmLabel={pendingDecision === "APPROVE" ? (needsCode ? "Continuar" : "Confirmar aprovação") : "Confirmar rejeição"}
        tone={pendingDecision === "APPROVE" ? "success" : "danger"}
        loading={loading}
        onConfirm={confirmDecision}
        onCancel={() => setPendingDecision(null)}
      />

      <CodeVerificationModal
        open={verification.step === "code" || verification.step === "submitting"}
        expiresAt={verification.expiresAt}
        error={verification.step !== "idle" ? verification.error : null}
        attemptsRemaining={verification.attemptsRemaining}
        loading={verification.step === "submitting"}
        resending={verification.resending}
        onSubmit={handleSubmitCode}
        onResend={verification.resend}
        onCancel={verification.cancel}
      />

      <ErrorModal
        message={error ?? (verification.step === "idle" ? verification.error : null)}
        onClose={() => { setError(null); verification.cancel(); }}
      />
    </>
  );
}
```

- [ ] **Step 2: Atualizar o call site em `app/organizador/eventos/[id]/inscritos/page.tsx`**

Encontre o bloco (já modificado nesta sessão pela correção de performance, dentro de `renderActions`):

```tsx
                  {r.status === "CANCELLATION_REQUESTED" && (
                    <CancellationDecisionButtons
                      cancellationReason={r.cancellationReason}
                      endpoint={`/api/organizer/registrations/${r.id}/cancellation-decision`}
                    />
                  )}
```

Substitua por:

```tsx
                  {r.status === "CANCELLATION_REQUESTED" && (
                    <CancellationDecisionButtons
                      cancellationReason={r.cancellationReason}
                      endpoint={`/api/organizer/registrations/${r.id}/cancellation-decision`}
                      requestCodeEndpoint={`/api/organizer/registrations/${r.id}/cancellation-decision/request-code`}
                      hasPaidPayment={payment?.status === "PAID"}
                    />
                  )}
```

(`payment` já é uma constante local calculada logo no início do `renderActions` desse arquivo — `const payment = r.order.payments[0];` — reaproveite, não declare de novo.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Testar manualmente no navegador**

Na tela de inscritos do organizador, com uma inscrição em `CANCELLATION_REQUESTED` e pagamento pago, clique "Aprovar" — confirme que pede código. Com uma inscrição sem pagamento pago (ex: gratuita), confirme que aprova direto, sem pedir código.

- [ ] **Step 5: Commit**

```bash
git add components/organizer/CancellationDecisionButtons.tsx "app/organizador/eventos/[id]/inscritos/page.tsx"
git commit -m "feat: aprovacao de cancelamento na UI pede codigo quando ha pagamento pago"
```

---

### Task 14: Fila de "reembolsos pendentes" (admin + organizador) também exige código

**Contexto (descoberto durante a Task 13, não estava no escopo original):** existe um terceiro
consumidor de `CancellationDecisionButtons` que nenhuma task anterior contemplou —
`components/registrations/PendingCancellationsTable.tsx`, usado por
`app/admin/reembolsos-pendentes/page.tsx` e `app/organizador/reembolsos-pendentes/page.tsx`. Essa
fila chama a mesma rota que a Task 7 travou no backend (exige código quando `decision === "APPROVE"`
e há pagamento pago), mas nunca recebeu `requestCodeEndpoint`/`hasPaidPayment`. A Task 13 tornou
essas duas props opcionais (default `""`/`false`) só para não quebrar o build; sem esta task, o
botão "Aprovar" nessa fila específica falha com um erro genérico para qualquer cancelamento com
pagamento pago (o backend ainda bloqueia corretamente — não é falha de segurança, é regressão de
funcionalidade).

**Files:**
- Modify: `lib/registrations/pending-queue.ts`
- Modify: `components/registrations/PendingCancellationsTable.tsx`
- Modify: `app/admin/reembolsos-pendentes/page.tsx`
- Modify: `app/organizador/reembolsos-pendentes/page.tsx`
- Modify: `components/organizer/CancellationDecisionButtons.tsx` (torna `requestCodeEndpoint`/`hasPaidPayment` obrigatórias de novo, já que após esta task os 3 consumidores existentes sempre as passam — confirmado via grep, não há mais nenhum outro consumidor)

**Interfaces:**
- Consumes: mesmas do Task 13.
- Produces: `PendingCancellation` (lib/registrations/pending-queue.ts) ganha o campo `hasPaidPayment: boolean`. `PendingCancellationsTable` ganha a prop `requestCodeEndpoint: (registrationId: string) => string`.

- [ ] **Step 1: `lib/registrations/pending-queue.ts` — expor `hasPaidPayment`**

```ts
export interface PendingCancellation {
  id: string;
  createdAt: Date;
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  athlete: { name: string; email: string };
  event: { id: string; title: string };
  hasPaidPayment: boolean;
}
```

Em `listPendingCancellations`, adicione ao `select` (reaproveitando o mesmo padrão de
`registrationHasPaidPayment` em `lib/registrations/cancellation-decision-service.ts:87-93`):

```ts
      order: { select: { payments: { where: { status: "PAID" }, take: 1, select: { id: true } } } },
```

E troque o `return registrations;` final por:

```ts
  return registrations.map(({ order, ...r }) => ({ ...r, hasPaidPayment: order.payments.length > 0 }));
```

- [ ] **Step 2: `components/registrations/PendingCancellationsTable.tsx` — passar as novas props**

Adicione `requestCodeEndpoint: (registrationId: string) => string` à assinatura de props, e no
`<CancellationDecisionButtons ...>` (dentro do `.map`) adicione:

```tsx
                  requestCodeEndpoint={requestCodeEndpoint(item.id)}
                  hasPaidPayment={item.hasPaidPayment}
```

- [ ] **Step 3: Call sites — as duas páginas de reembolsos pendentes**

Em `app/admin/reembolsos-pendentes/page.tsx`, no `<PendingCancellationsTable ...>`, adicione:

```tsx
          requestCodeEndpoint={(id) => `/api/admin/registrations/${id}/cancellation-decision/request-code`}
```

Em `app/organizador/reembolsos-pendentes/page.tsx`, no `<PendingCancellationsTable ...>`, adicione:

```tsx
          requestCodeEndpoint={(id) => `/api/organizer/registrations/${id}/cancellation-decision/request-code`}
```

- [ ] **Step 4: `components/organizer/CancellationDecisionButtons.tsx` — remover o fallback opcional**

Confirme via grep (`CancellationDecisionButtons` em `*.tsx`) que os 3 únicos consumidores
(`app/organizador/eventos/[id]/inscritos/page.tsx`, e os 2 call sites tocados nesta task via
`PendingCancellationsTable`) agora sempre passam `requestCodeEndpoint` e `hasPaidPayment`. Se
confirmado, reverta a assinatura de props para exigi-las (remova os defaults `""`/`false`
introduzidos na Task 13), restaurando a tipagem estrita original do brief da Task 13.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Testar manualmente no navegador**

Não é viável nesta sessão (mesmo motivo das Tasks 10-13 — `.env` local aponta para o Supabase de
produção). Deixe registrado no relatório e adicione este ponto à lista de QA conjunta.

- [ ] **Step 7: Commit**

```bash
git add lib/registrations/pending-queue.ts components/registrations/PendingCancellationsTable.tsx "app/admin/reembolsos-pendentes/page.tsx" "app/organizador/reembolsos-pendentes/page.tsx" components/organizer/CancellationDecisionButtons.tsx
git commit -m "fix: fila de reembolsos pendentes tambem exige codigo quando ha pagamento pago"
```

---

### Task 15: Revisão final — suíte completa, typecheck, documentação

**Files:**
- Modify: `PROGRESSO.md`

- [ ] **Step 1: Rodar a suíte completa**

Run: `npx vitest run`
Expected: todos os testes novos passando; as falhas pré-existentes não relacionadas (trabalho de `messageType`, ~23 casos, já documentadas em `PROGRESSO.md`) continuam as mesmas, nenhuma nova.

- [ ] **Step 2: Typecheck final**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Conferir a cobertura da spec**

Releia `docs/superpowers/specs/2026-08-11-verificacao-2fa-acoes-sensiveis-design.md` e confirme, um por um, que os 4 pontos de entrada listados no Contexto (estorno admin, estorno organizador, rejeição de anunciante, aprovação de cancelamento) estão cobertos pelas Tasks 4-7, 10-13.

- [ ] **Step 4: Atualizar `PROGRESSO.md`**

Adicione uma seção nova no topo do arquivo (mesmo formato das seções já existentes) resumindo: o que foi implementado, os commits (liste os hashes reais depois de commitados), que a migração de schema (`SensitiveActionCode`) precisa de `prisma db push` no próximo deploy, e que o fluxo foi testado manualmente em quais dos 4 pontos (marque os que você realmente testou no navegador).

- [ ] **Step 5: Commit da documentação**

```bash
git add PROGRESSO.md
git commit -m "docs: registra implementacao da verificacao em 2 etapas"
```

- [ ] **Step 6: Perguntar ao usuário sobre deploy**

Não faça `git push` nem deploy na VPS sem perguntar antes — esta é uma mudança de schema (precisa de `prisma db push`) e mexe em rotinas de dinheiro real. Apresente o resumo do que foi implementado e aguarde autorização explícita antes de subir pra produção.
