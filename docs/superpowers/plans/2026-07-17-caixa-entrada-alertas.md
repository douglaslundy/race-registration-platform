# Caixa de entrada de mensagens (WhatsApp/E-mail) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar todo e-mail e WhatsApp enviado pelo sistema num log consultável (`MessageLog`),
com confirmação de leitura real para WhatsApp (webhook da Evolution API) e status de envio/falha
para e-mail, exibido em duas telas de "caixa de entrada" (admin vê tudo; organizador vê só o seu)
com abas WhatsApp/E-mail.

**Architecture:** Instrumentação centralizada em dois pontos únicos já existentes —
`sendMail()` (`lib/email.ts`) e `sendWhatsAppMessage()` (`lib/whatsapp.ts`) — de forma que nenhum
dos ~15 chamadores precisa mudar. Um novo módulo `lib/message-logs.ts` concentra toda a lógica de
escrita/leitura do log. WhatsApp ganha um webhook receptor novo (`/api/webhooks/whatsapp`) e uma
função de registro automático de webhook, disparada pelo endpoint de status já existente sempre
que a conexão está aberta. Duas páginas novas (`/admin/mensagens`, `/organizador/mensagens`)
reaproveitam um componente de tabela compartilhado. A tela do organizador é gateada pelo sistema
de permissões de assistentes já existente (mesmo padrão dos 6 domínios anteriores).

**Tech Stack:** Next.js 15 App Router, Prisma, Vitest (mock global de `db` via `tests/setup.ts`),
Evolution API (WhatsApp), nodemailer (e-mail).

## Global Constraints

- Nunca usar `alert()`/`confirm()`/`prompt()` nativos (`CLAUDE.md`) — não se aplica diretamente a
  este plano (sem diálogos de confirmação envolvidos), mantido por ser regra permanente.
- `AlertLog` não é tocado — continua existindo só para dedupe, sem relação com `MessageLog`.
- E-mail só tem status `SENT`/`FAILED` — nenhuma tentativa de rastrear abertura (pixel).
- WhatsApp tem `SENT`/`DELIVERED`/`READ`/`FAILED`, via webhook `MESSAGES_UPDATE` da Evolution API,
  só ativo quando há conexão válida (registrado automaticamente pelo endpoint de status).
- Status de uma linha nunca regride (`READ` não volta pra `DELIVERED` num ACK fora de ordem).
- Organizador vê só mensagens com `recipientUserId` igual ao dele mesmo (nunca mensagens enviadas
  aos atletas dos eventos dele). Assistente de organizador vê o mesmo escopo do organizador que o
  criou (resolvido via `User.createdByUserId`), nunca o próprio.
- Tela do organizador gateada pela chave de permissão `messages.view` (mesmo padrão de
  `resolveActingScope`/`checkApiPermission`/`AssistantPermission` dos 6 domínios já rollout).
- Sem pixel de rastreio de e-mail, sem retenção/expurgo do log, sem alterar `AlertLog`, sem
  reenviar mensagens pela tela, sem "marcar como lido" pelo viewer, sem log de `sendTestEmail()`.

Spec completa: `docs/superpowers/specs/2026-07-17-caixa-entrada-alertas-design.md`.

---

## Task 1: Schema — modelo `MessageLog`

**Files:**
- Modify: `prisma/schema.prisma` (adicionar modelo após `AlertLog`, linha ~579; adicionar relação
  em `User`, linha ~127)
- Create: `prisma/migrations/20260717000000_add_message_log/migration.sql`

**Interfaces:**
- Produces: modelo Prisma `MessageLog` com campos `id, channel, subject, recipientAddress,
  recipientUserId, relatedEntityType, relatedEntityId, status, providerMessageId, errorMessage,
  sentAt, deliveredAt, readAt, createdAt` — consumido por todas as tasks seguintes via
  `db.messageLog.*`.

Sem banco de dev acessível nesta sessão (DNS falha em `db.usgslzpuovvrkvvrhljt.supabase.co`) —
verificação é só de sintaxe (`prisma validate`/`generate`, que não precisam de conexão com banco).

- [ ] **Step 1: Adicionar o modelo em `prisma/schema.prisma`**

Logo após o modelo `AlertLog` (que termina em `@@map("alert_logs")`, por volta da linha 579),
inserir:

```prisma
model MessageLog {
  id                String    @id @default(cuid())
  channel           String
  subject           String
  recipientAddress  String
  recipientUserId   String?
  relatedEntityType String?
  relatedEntityId   String?
  status            String
  providerMessageId String?
  errorMessage      String?
  sentAt            DateTime?
  deliveredAt       DateTime?
  readAt            DateTime?
  createdAt         DateTime  @default(now())

  recipientUser User? @relation(fields: [recipientUserId], references: [id])

  @@index([channel, createdAt])
  @@index([recipientUserId, channel, createdAt])
  @@index([providerMessageId])
  @@map("message_logs")
}
```

No modelo `User` (por volta da linha 127, junto das outras relações inversas como
`dailySummaryRecipients DailySummaryRecipient[]`), adicionar:

```prisma
  messageLogs MessageLog[]
```

- [ ] **Step 2: Validar a sintaxe do schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀` (não precisa de conexão com banco).

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sem erros (também não precisa de conexão com banco — só lê o
schema local).

- [ ] **Step 3: Escrever a migração manualmente**

Sem banco acessível, `prisma migrate dev` não pode gerar o arquivo automaticamente. Criar
`prisma/migrations/20260717000000_add_message_log/migration.sql` (mesmo estilo das migrações
anteriores, ex. `20260714010000_add_assistant_users/migration.sql`):

```sql
-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_logs_channel_createdAt_idx" ON "message_logs"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "message_logs_recipientUserId_channel_createdAt_idx" ON "message_logs"("recipientUserId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "message_logs_providerMessageId_idx" ON "message_logs"("providerMessageId");

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Aditiva, sem sequenciamento especial — pode rodar via `prisma db push` no deploy, junto ou
separada de qualquer outra mudança pendente.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260717000000_add_message_log
git commit -m "feat: add MessageLog schema for the message inbox"
```

---

## Task 2: `tests/setup.ts` — mock do novo modelo + `user.findFirst`

**Files:**
- Modify: `tests/setup.ts:5` (adicionar `findFirst` ao mock de `user`), `tests/setup.ts:33`
  (adicionar mock de `messageLog`, logo após `assistantPermission`)

**Interfaces:**
- Produces: `db.messageLog.{create,findMany,findFirst,update,count}` e `db.user.findFirst`
  mockados — pré-requisito de todas as tasks seguintes que escrevem testes.

Sem TDD aqui — é só infraestrutura de teste, não há comportamento pra testar isoladamente. A
verificação acontece nas tasks seguintes (se o mock estiver errado, os testes delas falham).

- [ ] **Step 1: Editar `tests/setup.ts`**

Linha 5, adicionar `findFirst: vi.fn()` ao objeto `user`:

```ts
    user: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
```

Logo após a linha do `assistantPermission` (linha 33), adicionar:

```ts
    messageLog: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
```

- [ ] **Step 2: Commit**

```bash
git add tests/setup.ts
git commit -m "test: add MessageLog and user.findFirst to the global db mock"
```

---

## Task 3: `lib/message-logs.ts` — módulo central de escrita/leitura

**Files:**
- Create: `lib/message-logs.ts`
- Test: `tests/lib-message-logs.test.ts`

**Interfaces:**
- Produces:
  - `recordMessageLog(params: RecordMessageLogParams): Promise<void>` — consumido pela Task 4
    (`lib/email.ts`) e Task 6 (`lib/whatsapp.ts`).
  - `updateMessageLogStatusByProviderMessageId(providerMessageId: string, status: "DELIVERED" |
    "READ"): Promise<void>` — consumido pela Task 8 (webhook receiver).
  - `listMessageLogs(filters: MessageLogFilters): Promise<{rows, total, page, pageSize,
    totalPages}>` — consumido pela Task 12/13 (páginas).
  - `resolveMessageOwnerUserId(session: Session): Promise<string | null>` — consumido pela Task 13
    (página do organizador).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-message-logs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  recordMessageLog,
  updateMessageLogStatusByProviderMessageId,
  listMessageLogs,
  resolveMessageOwnerUserId,
} from "@/lib/message-logs";

const dbMock = db as any;

describe("recordMessageLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.messageLog.create.mockResolvedValue({});
  });

  it("resolve recipientUserId por e-mail exato quando channel é EMAIL", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1" });

    await recordMessageLog({
      channel: "EMAIL",
      subject: "Assunto",
      recipientAddress: "atleta@example.com",
      status: "SENT",
    });

    expect(dbMock.user.findUnique).toHaveBeenCalledWith({ where: { email: "atleta@example.com" } });
    expect(dbMock.messageLog.create).toHaveBeenCalledWith({
      data: {
        channel: "EMAIL",
        subject: "Assunto",
        recipientAddress: "atleta@example.com",
        recipientUserId: "user-1",
        status: "SENT",
        errorMessage: null,
        providerMessageId: null,
        sentAt: expect.any(Date),
      },
    });
  });

  it("resolve recipientUserId por telefone (findFirst) quando channel é WHATSAPP", async () => {
    dbMock.user.findFirst.mockResolvedValueOnce({ id: "user-2" });

    await recordMessageLog({
      channel: "WHATSAPP",
      subject: "Prévia da mensagem",
      recipientAddress: "5511999999999",
      status: "SENT",
      providerMessageId: "wamid.abc",
    });

    expect(dbMock.user.findFirst).toHaveBeenCalledWith({ where: { phone: "5511999999999" } });
    expect(dbMock.messageLog.create).toHaveBeenCalledWith({
      data: {
        channel: "WHATSAPP",
        subject: "Prévia da mensagem",
        recipientAddress: "5511999999999",
        recipientUserId: "user-2",
        status: "SENT",
        errorMessage: null,
        providerMessageId: "wamid.abc",
        sentAt: expect.any(Date),
      },
    });
  });

  it("recipientUserId fica null quando não bate com nenhum usuário", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    await recordMessageLog({
      channel: "EMAIL",
      subject: "Assunto",
      recipientAddress: "extra@example.com",
      status: "SENT",
    });

    expect(dbMock.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientUserId: null }) }),
    );
  });

  it("status FAILED grava errorMessage e não seta sentAt", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    await recordMessageLog({
      channel: "EMAIL",
      subject: "Assunto",
      recipientAddress: "atleta@example.com",
      status: "FAILED",
      errorMessage: "SMTP timeout",
    });

    expect(dbMock.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", errorMessage: "SMTP timeout", sentAt: null }),
      }),
    );
  });

  it("nunca lança erro quando a gravação do log falha (best-effort)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.messageLog.create.mockRejectedValueOnce(new Error("db down"));

    await expect(
      recordMessageLog({ channel: "EMAIL", subject: "x", recipientAddress: "a@b.com", status: "SENT" }),
    ).resolves.toBeUndefined();
  });
});

describe("updateMessageLogStatusByProviderMessageId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atualiza status e deliveredAt quando o ACK é DELIVERED e o status atual é SENT", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "log-1", status: "SENT" });

    await updateMessageLogStatusByProviderMessageId("wamid.abc", "DELIVERED");

    expect(dbMock.messageLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "DELIVERED", deliveredAt: expect.any(Date) },
    });
  });

  it("atualiza status e readAt quando o ACK é READ e o status atual é DELIVERED", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "log-2", status: "DELIVERED" });

    await updateMessageLogStatusByProviderMessageId("wamid.def", "READ");

    expect(dbMock.messageLog.update).toHaveBeenCalledWith({
      where: { id: "log-2" },
      data: { status: "READ", readAt: expect.any(Date) },
    });
  });

  it("não regride: ignora DELIVERED se o status atual já é READ", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce({ id: "log-3", status: "READ" });

    await updateMessageLogStatusByProviderMessageId("wamid.ghi", "DELIVERED");

    expect(dbMock.messageLog.update).not.toHaveBeenCalled();
  });

  it("ignora silenciosamente quando providerMessageId não bate com nenhuma linha", async () => {
    dbMock.messageLog.findFirst.mockResolvedValueOnce(null);

    await expect(updateMessageLogStatusByProviderMessageId("wamid.unknown", "READ")).resolves.toBeUndefined();
    expect(dbMock.messageLog.update).not.toHaveBeenCalled();
  });
});

describe("listMessageLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.messageLog.findMany.mockResolvedValue([]);
    dbMock.messageLog.count.mockResolvedValue(0);
  });

  it("filtra por channel e pagina com o padrão de 20 por página", async () => {
    await listMessageLogs({ channel: "EMAIL" });

    expect(dbMock.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channel: "EMAIL" },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 20,
      }),
    );
  });

  it("escopo do organizador: inclui recipientUserId quando informado", async () => {
    await listMessageLogs({ channel: "WHATSAPP", recipientUserId: "org-user-1" });

    expect(dbMock.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channel: "WHATSAPP", recipientUserId: "org-user-1" } }),
    );
  });

  it("combina status, busca e intervalo de data no where", async () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-10T00:00:00.000Z");

    await listMessageLogs({ channel: "EMAIL", status: "FAILED", q: "joão", from, to });

    expect(dbMock.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channel: "EMAIL",
          status: "FAILED",
          OR: [
            { recipientAddress: { contains: "joão", mode: "insensitive" } },
            { recipientUser: { name: { contains: "joão", mode: "insensitive" } } },
          ],
          createdAt: { gte: from, lte: to },
        },
      }),
    );
  });
});

describe("resolveMessageOwnerUserId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ORGANIZER: retorna o próprio id, sem consultar o banco", async () => {
    const id = await resolveMessageOwnerUserId({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    expect(id).toBe("org-1");
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT: resolve o createdByUserId do criador", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-owner-1" });
    const id = await resolveMessageOwnerUserId({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    expect(dbMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "assistant-1" },
      select: { createdByUserId: true },
    });
    expect(id).toBe("org-owner-1");
  });

  it("qualquer outro papel (ex.: ADMIN visitando a tela do organizador): retorna null", async () => {
    const id = await resolveMessageOwnerUserId({ user: { id: "admin-1", role: "ADMIN" } } as any);
    expect(id).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-message-logs.test.ts`
Expected: FAIL — módulo `@/lib/message-logs` não existe ainda.

- [ ] **Step 3: Implementar**

Criar `lib/message-logs.ts`:

```ts
import type { Session } from "next-auth";
import { db } from "./db";

export type MessageChannel = "EMAIL" | "WHATSAPP";
export type MessageLogStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

const STATUS_RANK: Record<MessageLogStatus, number> = { SENT: 0, FAILED: 0, DELIVERED: 1, READ: 2 };

export interface RecordMessageLogParams {
  channel: MessageChannel;
  subject: string;
  recipientAddress: string;
  status: "SENT" | "FAILED";
  errorMessage?: string;
  providerMessageId?: string;
}

async function resolveRecipientUserIdByEmail(email: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { email } });
  return user?.id ?? null;
}

async function resolveRecipientUserIdByPhone(phone: string): Promise<string | null> {
  const user = await db.user.findFirst({ where: { phone } });
  return user?.id ?? null;
}

/** Registra o resultado de um envio de e-mail/WhatsApp. Nunca lança — é best-effort, não pode
 * derrubar um envio que já aconteceu (ou já falhou por outro motivo real). */
export async function recordMessageLog(params: RecordMessageLogParams): Promise<void> {
  try {
    const recipientUserId =
      params.channel === "EMAIL"
        ? await resolveRecipientUserIdByEmail(params.recipientAddress)
        : await resolveRecipientUserIdByPhone(params.recipientAddress);

    await db.messageLog.create({
      data: {
        channel: params.channel,
        subject: params.subject,
        recipientAddress: params.recipientAddress,
        recipientUserId,
        status: params.status,
        errorMessage: params.errorMessage ?? null,
        providerMessageId: params.providerMessageId ?? null,
        sentAt: params.status === "SENT" ? new Date() : null,
      },
    });
  } catch {
    // Best-effort — gravação do log nunca deve mascarar nem quebrar o fluxo de envio real.
  }
}

/** Atualiza o status de uma mensagem de WhatsApp a partir do ACK recebido via webhook. Nunca
 * regride (READ não volta pra DELIVERED). */
export async function updateMessageLogStatusByProviderMessageId(
  providerMessageId: string,
  status: "DELIVERED" | "READ",
): Promise<void> {
  const existing = await db.messageLog.findFirst({ where: { providerMessageId } });
  if (!existing) return;
  if (STATUS_RANK[status] <= STATUS_RANK[existing.status as MessageLogStatus]) return;

  await db.messageLog.update({
    where: { id: existing.id },
    data: {
      status,
      ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      ...(status === "READ" ? { readAt: new Date() } : {}),
    },
  });
}

export interface MessageLogFilters {
  channel: MessageChannel;
  recipientUserId?: string;
  status?: MessageLogStatus;
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listMessageLogs(filters: MessageLogFilters) {
  const { channel, recipientUserId, status, q, from, to, page = 1, pageSize = 20 } = filters;

  const where = {
    channel,
    ...(recipientUserId ? { recipientUserId } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { recipientAddress: { contains: q, mode: "insensitive" as const } },
            { recipientUser: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.messageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { recipientUser: { select: { name: true } } },
    }),
    db.messageLog.count({ where }),
  ]);

  return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Resolve de quem são as mensagens que a tela do organizador deve mostrar: o próprio organizador,
 * ou (se for um assistente) o organizador que o criou. Qualquer outro papel retorna null — o
 * chamador deve tratar null como "nenhum escopo válido" (nunca cair pra "mostrar tudo"). */
export async function resolveMessageOwnerUserId(session: Session): Promise<string | null> {
  if (session.user.role === "ORGANIZER") return session.user.id;
  if (session.user.role === "ASSISTANT") {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    return user?.createdByUserId ?? null;
  }
  return null;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-message-logs.test.ts`
Expected: PASS (13/13)

- [ ] **Step 5: Commit**

```bash
git add lib/message-logs.ts tests/lib-message-logs.test.ts
git commit -m "feat: add MessageLog read/write module"
```

---

## Task 4: `lib/email.ts` — instrumentar `sendMail`

**Files:**
- Modify: `lib/email.ts:14-27`
- Test: `tests/lib-email.test.ts` (criar)

**Interfaces:**
- Consumes: `recordMessageLog` (Task 3).
- Produces: nada novo consumido por outras tasks — `sendMail` mantém a mesma assinatura pública.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-email.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock, verify: vi.fn() })) },
}));

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));

vi.mock("@/lib/message-logs", () => ({
  recordMessageLog: vi.fn(),
}));

import { sendMail } from "@/lib/email";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { recordMessageLog } from "@/lib/message-logs";

const smtpConfig = { host: "smtp.example.com", port: 587, user: "u", pass: "p", from: "noreply@example.com", secure: false };

describe("sendMail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
  });

  it("lança erro quando o SMTP não está configurado, sem tentar enviar", async () => {
    vi.mocked(isSmtpReady).mockReturnValue(false);

    await expect(sendMail({ to: "a@b.com", subject: "Oi", html: "<p>Oi</p>" })).rejects.toThrow(
      "SMTP não configurado",
    );
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(recordMessageLog).not.toHaveBeenCalled();
  });

  it("em caso de sucesso, registra o log como SENT", async () => {
    sendMailMock.mockResolvedValueOnce({});

    await sendMail({ to: "atleta@example.com", subject: "Confirmação", html: "<p>Oi</p>" });

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "EMAIL",
      subject: "Confirmação",
      recipientAddress: "atleta@example.com",
      status: "SENT",
    });
  });

  it("em caso de falha no envio, registra o log como FAILED e relança o erro original", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("Connection timeout"));

    await expect(sendMail({ to: "atleta@example.com", subject: "Confirmação", html: "<p>Oi</p>" })).rejects.toThrow(
      "Connection timeout",
    );

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "EMAIL",
      subject: "Confirmação",
      recipientAddress: "atleta@example.com",
      status: "FAILED",
      errorMessage: "Connection timeout",
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-email.test.ts`
Expected: FAIL — `sendMail` ainda não chama `recordMessageLog`.

- [ ] **Step 3: Implementar**

Em `lib/email.ts`, adicionar o import no topo:

```ts
import { recordMessageLog } from "./message-logs";
```

Substituir a função `sendMail` (linhas 14-27) por:

```ts
/** Envia um e-mail usando a configuração SMTP salva (ou variáveis de ambiente). */
export async function sendMail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const cfg = await getSmtpConfig();
  if (!isSmtpReady(cfg)) {
    throw new Error("SMTP não configurado. Configure em Admin → Configurações.");
  }
  const transporter = buildTransport(cfg);

  try {
    await transporter.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
  } catch (err) {
    await recordMessageLog({
      channel: "EMAIL",
      subject: opts.subject,
      recipientAddress: opts.to,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await recordMessageLog({
    channel: "EMAIL",
    subject: opts.subject,
    recipientAddress: opts.to,
    status: "SENT",
  });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-email.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Rodar a suíte completa (não só o arquivo novo) pra garantir que os ~19 testes que
  já mockam `@/lib/email` inteiro continuam passando (não deveriam ser afetados, já que mockam o
  módulo inteiro, mas confirmar é rápido)**

Run: `npx vitest run`
Expected: todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts tests/lib-email.test.ts
git commit -m "feat: log every email send to MessageLog"
```

---

## Task 5: `lib/whatsapp/evolution-client.ts` — capturar `providerMessageId` e `setWebhook`

**Files:**
- Modify: `lib/whatsapp/evolution-client.ts:96-105`
- Test: `tests/whatsapp-evolution-client.test.ts:113-130` (estender `describe("sendTextMessage")`),
  adicionar novo `describe("setWebhook")`

**Interfaces:**
- Produces: `sendTextMessage(...): Promise<{ providerMessageId: string | null }>` (assinatura de
  retorno muda de `Promise<void>`) — consumido pela Task 6. `setWebhook(config, url):
  Promise<void>` — consumido pela Task 7.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/whatsapp-evolution-client.test.ts`, importar `setWebhook` junto dos outros (linha 2-9):

```ts
import {
  createInstance,
  getQrCode,
  getConnectionState,
  logoutInstance,
  deleteInstance,
  sendTextMessage,
  setWebhook,
} from "@/lib/whatsapp/evolution-client";
```

Substituir o bloco `describe("sendTextMessage", ...)` (linhas 113-130) por:

```ts
  describe("sendTextMessage", () => {
    it("envia o telefone e o texto para /message/sendText/{instance} e retorna o providerMessageId", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({ key: { id: "wamid.abc" } }) });
      const result = await sendTextMessage(config, "5511999999999", "Olá!");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/message/sendText/corridas-app",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ number: "5511999999999", text: "Olá!" }),
        }),
      );
      expect(result).toEqual({ providerMessageId: "wamid.abc" });
    });

    it("retorna providerMessageId null quando a resposta não traz key.id", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 200, json: async () => ({}) });
      const result = await sendTextMessage(config, "5511999999999", "Olá!");
      expect(result).toEqual({ providerMessageId: null });
    });

    it("lança erro quando o envio falha", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 400, json: async () => ({ error: "invalid number" }) });
      await expect(sendTextMessage(config, "invalid", "Olá!")).rejects.toThrow("Evolution API 400");
    });
  });

  describe("setWebhook", () => {
    it("faz POST em /webhook/set/{instance} inscrevendo em MESSAGES_UPDATE", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 201, json: async () => ({}) });
      await setWebhook(config, "https://app.example.com/api/webhooks/whatsapp?secret=abc");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://evo.example.com/webhook/set/corridas-app",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            webhook: {
              url: "https://app.example.com/api/webhooks/whatsapp?secret=abc",
              enabled: true,
              events: ["MESSAGES_UPDATE"],
            },
          }),
        }),
      );
    });

    it("lança erro quando a Evolution API rejeita a configuração do webhook", async () => {
      (global.fetch as any).mockResolvedValueOnce({ status: 500, json: async () => ({}) });
      await expect(setWebhook(config, "https://app.example.com/x")).rejects.toThrow("Evolution API 500");
    });
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/whatsapp-evolution-client.test.ts`
Expected: FAIL — `setWebhook` não existe; `sendTextMessage` ainda retorna `undefined`.

- [ ] **Step 3: Implementar**

Em `lib/whatsapp/evolution-client.ts`, substituir `sendTextMessage` (linhas 96-105) por:

```ts
export async function sendTextMessage(
  config: WhatsAppConfig,
  phone: string,
  text: string,
): Promise<{ providerMessageId: string | null }> {
  const { status, body } = await evolutionFetch(config, `/message/sendText/${config.instanceName}`, {
    method: "POST",
    body: { number: phone, text },
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao enviar mensagem: ${JSON.stringify(body).slice(0, 300)}`);
  }

  const messageId = (body as { key?: { id?: string } } | null)?.key?.id;
  return { providerMessageId: typeof messageId === "string" ? messageId : null };
}

export async function setWebhook(config: WhatsAppConfig, url: string): Promise<void> {
  const { status, body } = await evolutionFetch(config, `/webhook/set/${config.instanceName}`, {
    method: "POST",
    body: { webhook: { url, enabled: true, events: ["MESSAGES_UPDATE"] } },
  });

  if (status >= 400) {
    throw new Error(`Evolution API ${status} ao configurar webhook: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/whatsapp-evolution-client.test.ts`
Expected: PASS (todos, incluindo os 5 pré-existentes de outras funções)

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp/evolution-client.ts tests/whatsapp-evolution-client.test.ts
git commit -m "feat: capture providerMessageId on send, add setWebhook to Evolution client"
```

---

## Task 6: `lib/whatsapp.ts` — instrumentar `sendWhatsAppMessage`

**Files:**
- Modify: `lib/whatsapp.ts`
- Test: `tests/whatsapp.test.ts`

**Interfaces:**
- Consumes: `sendTextMessage` retornando `{providerMessageId}` (Task 5), `recordMessageLog`
  (Task 3).
- Produces: `sendWhatsAppMessage` mantém a mesma assinatura pública.

- [ ] **Step 1: Atualizar os testes existentes e escrever os novos (falham antes do Step 3)**

Substituir `tests/whatsapp.test.ts` inteiro por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  sendTextMessage: vi.fn(),
}));
vi.mock("@/lib/message-logs", () => ({
  recordMessageLog: vi.fn(),
}));

import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { sendTextMessage } from "@/lib/whatsapp/evolution-client";
import { recordMessageLog } from "@/lib/message-logs";

describe("sendWhatsAppMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lança erro quando o WhatsApp não está configurado, sem chamar o cliente nem logar", async () => {
    vi.mocked(getWhatsAppConfig).mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);

    await expect(sendWhatsAppMessage("5511999999999", "Olá!")).rejects.toThrow("WhatsApp não configurado");
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageLog).not.toHaveBeenCalled();
  });

  it("em caso de sucesso, delega pro cliente e registra o log com o providerMessageId", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ providerMessageId: "wamid.abc" });

    await sendWhatsAppMessage("5511999999999", "Olá!");

    expect(sendTextMessage).toHaveBeenCalledWith(config, "5511999999999", "Olá!");
    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "WHATSAPP",
      subject: "Olá!",
      recipientAddress: "5511999999999",
      status: "SENT",
      providerMessageId: "wamid.abc",
    });
  });

  it("trunca o texto em ~80 caracteres pro subject do log", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ providerMessageId: null });
    const longText = "a".repeat(120);

    await sendWhatsAppMessage("5511999999999", longText);

    expect(recordMessageLog).toHaveBeenCalledWith(
      expect.objectContaining({ subject: `${"a".repeat(77)}...` }),
    );
  });

  it("em caso de falha no envio, registra o log como FAILED e relança o erro original", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockRejectedValueOnce(new Error("Evolution API 400 ao enviar mensagem"));

    await expect(sendWhatsAppMessage("invalid", "Olá!")).rejects.toThrow("Evolution API 400");

    expect(recordMessageLog).toHaveBeenCalledWith({
      channel: "WHATSAPP",
      subject: "Olá!",
      recipientAddress: "invalid",
      status: "FAILED",
      errorMessage: "Evolution API 400 ao enviar mensagem",
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: FAIL — `sendWhatsAppMessage` ainda não trunca texto, não chama `recordMessageLog`, e a
mock de `sendTextMessage` sem valor resolvido quebra a desestruturação assim que o código mudar.

- [ ] **Step 3: Implementar**

Substituir `lib/whatsapp.ts` inteiro por:

```ts
import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { sendTextMessage } from "./whatsapp/evolution-client";
import { recordMessageLog } from "./message-logs";

function truncateForSubject(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** Envia uma mensagem de WhatsApp usando a configuração salva (Evolution API). */
export async function sendWhatsAppMessage(phone: string, text: string): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }

  const subject = truncateForSubject(text);

  try {
    const { providerMessageId } = await sendTextMessage(config, phone, text);
    await recordMessageLog({
      channel: "WHATSAPP",
      subject,
      recipientAddress: phone,
      status: "SENT",
      ...(providerMessageId ? { providerMessageId } : {}),
    });
  } catch (err) {
    await recordMessageLog({
      channel: "WHATSAPP",
      subject,
      recipientAddress: phone,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp.ts tests/whatsapp.test.ts
git commit -m "feat: log every WhatsApp send to MessageLog"
```

---

## Task 7: `app/api/admin/whatsapp/status/route.ts` — registrar o webhook quando conectado

**Files:**
- Modify: `app/api/admin/whatsapp/status/route.ts`
- Test: `tests/admin-whatsapp-routes.test.ts:7-17` (mock de `evolution-client`),
  `tests/admin-whatsapp-routes.test.ts:109-130` (`describe("GET /api/admin/whatsapp/status")`)

**Interfaces:**
- Consumes: `setWebhook` (Task 5).

- [ ] **Step 1: Atualizar o mock e escrever os testes que falham**

Em `tests/admin-whatsapp-routes.test.ts`, no `vi.mock("@/lib/whatsapp/evolution-client", ...)`
(linhas 12-18), adicionar `setWebhook: vi.fn()`:

```ts
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  createInstance: vi.fn(),
  getQrCode: vi.fn(),
  getConnectionState: vi.fn(),
  logoutInstance: vi.fn(),
  deleteInstance: vi.fn(),
  setWebhook: vi.fn(),
}));
```

No import de `evolution-client` logo abaixo (linhas 30-35), adicionar `setWebhook`:

```ts
import {
  createInstance,
  getQrCode,
  getConnectionState,
  logoutInstance,
  deleteInstance,
  setWebhook,
} from "@/lib/whatsapp/evolution-client";
```

Substituir o `describe("GET /api/admin/whatsapp/status", ...)` (linhas 109-130) por:

```ts
  describe("GET /api/admin/whatsapp/status", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await statusGet();
      expect(res.status).toBe(403);
    });

    it("retorna not_configured sem chamar o cliente quando faltam credenciais", async () => {
      vi.mocked(isWhatsAppConfigured).mockReturnValue(false);
      const res = await statusGet();
      const body = await res.json();
      expect(body.state).toBe("not_configured");
      expect(getConnectionState).not.toHaveBeenCalled();
    });

    it("retorna o estado de conexão quando configurado", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
      const res = await statusGet();
      const body = await res.json();
      expect(body.state).toBe("open");
    });

    it("registra o webhook quando o estado é open e as env vars estão presentes", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

      await statusGet();

      expect(setWebhook).toHaveBeenCalledWith(
        configMock,
        "https://app.example.com/api/webhooks/whatsapp?secret=shh",
      );
    });

    it("não registra o webhook quando o estado não é open", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("connecting");
      process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

      await statusGet();

      expect(setWebhook).not.toHaveBeenCalled();
    });

    it("não registra o webhook quando falta a env var do segredo, mas ainda retorna o estado normalmente", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      delete process.env.WHATSAPP_WEBHOOK_SECRET;
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

      const res = await statusGet();

      expect(setWebhook).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("uma falha ao registrar o webhook não quebra a resposta de status", async () => {
      vi.mocked(getConnectionState).mockResolvedValueOnce("open");
      process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
      vi.mocked(setWebhook).mockRejectedValueOnce(new Error("Evolution API 500"));

      const res = await statusGet();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.state).toBe("open");
    });
  });
```

Adicionar `afterEach` ao import do topo do arquivo (linha 1):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-whatsapp-routes.test.ts`
Expected: FAIL — a rota ainda não chama `setWebhook`.

- [ ] **Step 3: Implementar**

Substituir `app/api/admin/whatsapp/status/route.ts` inteiro por:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWhatsAppConfig, isWhatsAppConfigured, type WhatsAppConfig } from "@/lib/whatsapp-settings";
import { getConnectionState, setWebhook } from "@/lib/whatsapp/evolution-client";

async function registerWebhookBestEffort(config: WhatsAppConfig): Promise<void> {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL;
  if (!secret || !baseUrl) return;

  try {
    await setWebhook(config, `${baseUrl}/api/webhooks/whatsapp?secret=${secret}`);
  } catch {
    // Best-effort — não deve quebrar a checagem de status.
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    return NextResponse.json({ state: "not_configured" });
  }

  try {
    const state = await getConnectionState(config);
    if (state === "open") {
      await registerWebhookBestEffort(config);
    }
    return NextResponse.json({ state });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao consultar status";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-whatsapp-routes.test.ts`
Expected: PASS (todos, incluindo os testes pré-existentes das outras 4 rotas do arquivo)

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/whatsapp/status/route.ts tests/admin-whatsapp-routes.test.ts
git commit -m "feat: auto-register WhatsApp read-receipt webhook when connected"
```

---

## Task 8: Webhook receptor — `POST /api/webhooks/whatsapp`

**Files:**
- Create: `app/api/webhooks/whatsapp/route.ts`
- Modify: `.env.example` (documentar `WHATSAPP_WEBHOOK_SECRET`)
- Test: `tests/whatsapp-webhook-route.test.ts` (criar)

**Interfaces:**
- Consumes: `updateMessageLogStatusByProviderMessageId` (Task 3).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/whatsapp-webhook-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/message-logs", () => ({
  updateMessageLogStatusByProviderMessageId: vi.fn(),
}));

import { POST } from "@/app/api/webhooks/whatsapp/route";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";

function makeRequest(secret: string | null, body: unknown) {
  const url = new URL("http://localhost/api/webhooks/whatsapp");
  if (secret !== null) url.searchParams.set("secret", secret);
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/webhooks/whatsapp", () => {
  const originalSecret = process.env.WHATSAPP_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_WEBHOOK_SECRET = "shh";
  });

  afterAll(() => {
    process.env.WHATSAPP_WEBHOOK_SECRET = originalSecret;
  });

  it("retorna 401 quando o secret não bate", async () => {
    const res = await POST(makeRequest("wrong", {}));
    expect(res.status).toBe(401);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });

  it("retorna 401 quando o secret está ausente", async () => {
    const res = await POST(makeRequest(null, {}));
    expect(res.status).toBe(401);
  });

  it("ACK 2 (delivered) atualiza o status pra DELIVERED", async () => {
    const res = await POST(
      makeRequest("shh", { event: "messages.update", data: { keyId: "wamid.abc", status: "DELIVERY_ACK" } }),
    );
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("wamid.abc", "DELIVERED");
  });

  it("ACK 3 (read) atualiza o status pra READ", async () => {
    const res = await POST(
      makeRequest("shh", { event: "messages.update", data: { keyId: "wamid.abc", status: "READ" } }),
    );
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).toHaveBeenCalledWith("wamid.abc", "READ");
  });

  it("ACK 1 (sent) é ignorado silenciosamente — já setamos SENT no momento do envio", async () => {
    const res = await POST(
      makeRequest("shh", { event: "messages.update", data: { keyId: "wamid.abc", status: "SERVER_ACK" } }),
    );
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });

  it("corpo malformado (sem data.keyId) retorna 200 sem chamar o update", async () => {
    const res = await POST(makeRequest("shh", { event: "messages.update" }));
    expect(res.status).toBe(200);
    expect(updateMessageLogStatusByProviderMessageId).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/whatsapp-webhook-route.test.ts`
Expected: FAIL — a rota não existe ainda.

- [ ] **Step 3: Implementar**

Criar `app/api/webhooks/whatsapp/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";

const ACK_STATUS_MAP: Record<string, "DELIVERED" | "READ"> = {
  DELIVERY_ACK: "DELIVERED",
  READ: "READ",
};

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null) as
    | { event?: string; data?: { keyId?: string; status?: string } }
    | null;

  const keyId = payload?.data?.keyId;
  const ackStatus = payload?.data?.status;

  if (keyId && ackStatus && ACK_STATUS_MAP[ackStatus]) {
    await updateMessageLogStatusByProviderMessageId(keyId, ACK_STATUS_MAP[ackStatus]);
  }

  return NextResponse.json({ ok: true });
}
```

> **Nota pro implementador:** o formato exato do payload `MESSAGES_UPDATE` da Evolution API varia
> entre versões (algumas usam `data.keyId`, outras `data.key.id`; o nome do status pode vir como
> `DELIVERY_ACK`/`READ` ou como número 1/2/3). Este código assume o formato mais comum
> (`data.keyId` + string de status). Se ao testar em produção o payload real vier diferente,
> ajustar `ACK_STATUS_MAP` e a extração de `keyId`/`ackStatus` — a estrutura do handler
> (validação de secret → parse → mapear status → atualizar) não muda.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/whatsapp-webhook-route.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Documentar a env var**

Em `.env.example`, adicionar após o bloco `MP_WEBHOOK_SECRET`:

```
# WhatsApp (Evolution API) — segredo do webhook de confirmação de leitura
WHATSAPP_WEBHOOK_SECRET=""
```

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/whatsapp/route.ts tests/whatsapp-webhook-route.test.ts .env.example
git commit -m "feat: add WhatsApp read-receipt webhook receiver"
```

---

## Task 9: `lib/auth/rbac.ts` — `requirePermission(actionKey)`

**Files:**
- Modify: `lib/auth/rbac.ts`
- Test: `tests/rbac.test.ts`

**Interfaces:**
- Produces: `requirePermission(actionKey: string): Promise<Session>` — consumido pelas Task 12 e
  13 (páginas de mensagens).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `tests/rbac.test.ts` (dentro do mesmo arquivo, reaproveitando os mocks já
configurados no topo):

```ts
import { requirePermission } from "@/lib/auth/rbac";

describe("requirePermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ADMIN passa sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const session = await requirePermission("messages.view");
    expect(session.user.id).toBe("admin-1");
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });

  it("ORGANIZER passa sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const session = await requirePermission("messages.view");
    expect(session.user.id).toBe("org-1");
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT com a permissão concedida passa", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    const session = await requirePermission("messages.view");
    expect(dbMock.assistantPermission.findUnique).toHaveBeenCalledWith({
      where: { userId_actionKey: { userId: "assistant-1", actionKey: "messages.view" } },
    });
    expect(session.user.id).toBe("assistant-1");
  });

  it("ASSISTANT sem a permissão é redirecionado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);
    await expect(requirePermission("messages.view")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/acesso-negado");
  });

  it("ATHLETE é redirecionado sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    await expect(requirePermission("messages.view")).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });

  it("sem sessão é redirecionado pro login", async () => {
    authMock.mockResolvedValue(null as any);
    await expect(requirePermission("messages.view")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/rbac.test.ts`
Expected: FAIL — `requirePermission` não existe.

- [ ] **Step 3: Implementar**

Em `lib/auth/rbac.ts`, adicionar ao final do arquivo:

```ts
/** Checagem de permissão pra uso em Server Components (páginas) — redireciona em vez de
 * retornar uma NextResponse. Mesma lógica de checkApiPermission: ADMIN/ORGANIZER titulares
 * sempre passam; ASSISTANT precisa da AssistantPermission gravada pra essa actionKey. */
export async function requirePermission(actionKey: string) {
  const session = await requireAuth();

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return session;
  }

  if (session.user.role === "ASSISTANT") {
    const granted = await db.assistantPermission.findUnique({
      where: { userId_actionKey: { userId: session.user.id, actionKey } },
    });
    if (granted) return session;
  }

  redirect("/acesso-negado");
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/rbac.test.ts`
Expected: PASS (todos, incluindo os pré-existentes de `resolveActingScope`/`checkApiPermission`/
`checkAdminOnlyApiPermission`/`requireAdmin`/`requireOrganizer`)

- [ ] **Step 5: Commit**

```bash
git add lib/auth/rbac.ts tests/rbac.test.ts
git commit -m "feat: add requirePermission page-level guard for assistant permissions"
```

---

## Task 10: Chave de permissão `messages.view` nas telas de assistentes

**Files:**
- Modify: `app/admin/assistentes/page.tsx`, `app/organizador/assistentes/page.tsx`

**Interfaces:**
- Consumes: nada de código — só dados de UI (`actionOptions`).

Sem teste automatizado (arrays de configuração de UI, sem lógica — mesmo padrão dos outros 34+
itens já nesses arrays, nenhum deles tem teste próprio).

- [ ] **Step 1: Adicionar a opção no admin**

Em `app/admin/assistentes/page.tsx`, localizar o array de ações (mesmo padrão do organizador,
ver Task de referência abaixo) e adicionar, próximo às ações de alertas/relatórios/carrinhos já
existentes:

```ts
  { key: "messages.view", label: "Ver caixa de mensagens" },
```

- [ ] **Step 2: Adicionar a opção no organizador**

Em `app/organizador/assistentes/page.tsx`, no array `ORGANIZER_EVENT_ACTIONS` (linha 6-38),
adicionar ao final, antes do fechamento `];`:

```ts
  { key: "messages.view", label: "Ver caixa de mensagens (minhas mensagens)" },
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/assistentes/page.tsx app/organizador/assistentes/page.tsx
git commit -m "feat: add messages.view permission key to assistant management screens"
```

---

## Task 11: `components/messages/MessageLogList.tsx` — tabela compartilhada

**Files:**
- Create: `components/messages/MessageLogList.tsx`

**Interfaces:**
- Consumes: formato de retorno de `listMessageLogs` (Task 3) — especificamente o array `rows`,
  cada item com `id, channel, subject, recipientAddress, status, sentAt, deliveredAt, readAt,
  recipientUser: {name: string} | null`.
- Produces: componente `<MessageLogList rows={...} channel={...} />` — consumido pelas Task 12 e
  13.

Sem teste automatizado (zero testes de componente React neste repo, confirmado). Verificação:
visual, na Task 14.

- [ ] **Step 1: Implementar**

Criar `components/messages/MessageLogList.tsx`:

```tsx
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface MessageLogRow {
  id: string;
  channel: "EMAIL" | "WHATSAPP";
  subject: string;
  recipientAddress: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  sentAt: Date | null;
  createdAt: Date;
  recipientUser: { name: string } | null;
}

const STATUS_ICON: Record<string, { icon: string; color: string; label: string }> = {
  SENT: { icon: "✓", color: "text-gray-400", label: "Enviado" },
  DELIVERED: { icon: "✓✓", color: "text-gray-400", label: "Entregue" },
  READ: { icon: "✓✓", color: "text-blue-500", label: "Lido" },
  FAILED: { icon: "✕", color: "text-red-500", label: "Falhou" },
};

export default function MessageLogList({ rows }: { rows: MessageLogRow[] }) {
  if (rows.length === 0) {
    return <div className="card text-center py-12 text-gray-500">Nenhuma mensagem encontrada.</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b dark:border-gray-700 text-xs uppercase">
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Destinatário</th>
            <th className="pb-2 pr-4">Assunto</th>
            <th className="pb-2">Quando</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const statusInfo = STATUS_ICON[row.status] ?? STATUS_ICON.SENT;
            return (
              <tr key={row.id} className="border-b dark:border-gray-700 last:border-0 align-top">
                <td className="py-2 pr-4">
                  <span className={`font-bold ${statusInfo.color}`} title={statusInfo.label}>
                    {statusInfo.icon}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <div>{row.recipientUser?.name ?? row.recipientAddress}</div>
                  {row.recipientUser && <div className="text-xs text-gray-400">{row.recipientAddress}</div>}
                </td>
                <td className="py-2 pr-4">
                  <details>
                    <summary className="cursor-pointer truncate max-w-md">{row.subject}</summary>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{row.subject}</p>
                  </details>
                </td>
                <td className="py-2 text-xs text-gray-500 whitespace-nowrap">
                  {formatDistanceToNowStrict(row.createdAt, { locale: ptBR, addSuffix: true })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/messages/MessageLogList.tsx
git commit -m "feat: add shared MessageLogList table component"
```

---

## Task 12: `app/admin/mensagens/page.tsx`

**Files:**
- Create: `app/admin/mensagens/page.tsx`

**Interfaces:**
- Consumes: `requirePermission` (Task 9), `listMessageLogs` (Task 3), `MessageLogList` (Task 11).

Sem teste automatizado (página, mesmo padrão das outras páginas de admin/organizador neste repo).

- [ ] **Step 1: Implementar**

Criar `app/admin/mensagens/page.tsx`:

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listMessageLogs, type MessageLogStatus } from "@/lib/message-logs";
import MessageLogList, { type MessageLogRow } from "@/components/messages/MessageLogList";

export const metadata: Metadata = { title: "Mensagens — Admin" };
export const dynamic = "force-dynamic";

interface SearchParams {
  tab?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
}

export default async function AdminMensagensPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("messages.view");
  const params = await searchParams;

  const channel = params.tab === "whatsapp" ? "WHATSAPP" : "EMAIL";
  const status = params.status?.trim() || undefined;
  const q = params.q?.trim() || undefined;
  const dateFrom = params.dateFrom?.trim() || "";
  const dateTo = params.dateTo?.trim() || "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const { rows, total, totalPages } = await listMessageLogs({
    channel,
    status: status as MessageLogStatus | undefined,
    q,
    from: dateFrom ? new Date(dateFrom) : undefined,
    to: dateTo ? new Date(dateTo) : undefined,
    page,
  });

  const buildTabUrl = (tab: "email" | "whatsapp") => `/admin/mensagens?tab=${tab}`;

  const buildFilterQuery = (overrides: Partial<SearchParams> = {}) => {
    const query = new URLSearchParams();
    query.set("tab", params.tab === "whatsapp" ? "whatsapp" : "email");
    const merged = { status, q, dateFrom, dateTo, ...overrides };
    if (merged.status) query.set("status", merged.status);
    if (merged.q) query.set("q", merged.q);
    if (merged.dateFrom) query.set("dateFrom", merged.dateFrom);
    if (merged.dateTo) query.set("dateTo", merged.dateTo);
    return query;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mensagens</h1>
        <p className="text-sm text-gray-500">{total} mensagem(ns) encontrada(s)</p>
      </div>

      <div className="flex gap-2 border-b dark:border-gray-700">
        <Link
          href={buildTabUrl("email")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            channel === "EMAIL" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500"
          }`}
        >
          E-mail
        </Link>
        <Link
          href={buildTabUrl("whatsapp")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            channel === "WHATSAPP" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500"
          }`}
        >
          WhatsApp
        </Link>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-5">
        <input type="hidden" name="tab" value={params.tab === "whatsapp" ? "whatsapp" : "email"} />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q ?? ""} placeholder="Nome, e-mail ou telefone" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="SENT">Enviado</option>
            {channel === "WHATSAPP" && <option value="DELIVERED">Entregue</option>}
            {channel === "WHATSAPP" && <option value="READ">Lido</option>}
            <option value="FAILED">Falhou</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field text-sm py-1.5" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
          <Link href={buildTabUrl(channel === "WHATSAPP" ? "whatsapp" : "email")} className="btn-secondary py-1.5 px-4 text-sm">
            Limpar
          </Link>
        </div>
      </form>

      <MessageLogList rows={rows as MessageLogRow[]} />

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center flex-wrap">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
            const query = buildFilterQuery();
            query.set("page", String(p));
            return (
              <Link
                key={p}
                href={`/admin/mensagens?${query.toString()}`}
                className={`text-sm px-3 py-1.5 rounded-lg border ${
                  p === page ? "bg-primary-600 text-white border-primary-600" : "border-gray-300 dark:border-gray-600"
                }`}
              >
                {p}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros novos atribuíveis a este arquivo (nenhum erro em `app/admin/mensagens/page.tsx`).

- [ ] **Step 3: Commit**

```bash
git add app/admin/mensagens/page.tsx
git commit -m "feat: add admin message inbox page"
```

---

## Task 13: `app/organizador/mensagens/page.tsx`

**Files:**
- Create: `app/organizador/mensagens/page.tsx`

**Interfaces:**
- Consumes: `requirePermission` (Task 9), `listMessageLogs` + `resolveMessageOwnerUserId`
  (Task 3), `MessageLogList` (Task 11).

Mesmo padrão da Task 12, com duas diferenças: escopo por `recipientUserId` resolvido via
`resolveMessageOwnerUserId`, e uso do sentinel `"__none__"` quando a resolução falha (nunca cair
pra "mostrar tudo" — ver spec, seção de casos de borda).

- [ ] **Step 1: Implementar**

Criar `app/organizador/mensagens/page.tsx` — idêntico a `app/admin/mensagens/page.tsx` (Task 12),
com estas mudanças:

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listMessageLogs, resolveMessageOwnerUserId, type MessageLogStatus } from "@/lib/message-logs";
import MessageLogList, { type MessageLogRow } from "@/components/messages/MessageLogList";

export const metadata: Metadata = { title: "Mensagens" };
export const dynamic = "force-dynamic";

interface SearchParams {
  tab?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
}

export default async function OrganizerMensagensPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("messages.view");
  const params = await searchParams;

  const ownerUserId = (await resolveMessageOwnerUserId(session)) ?? "__none__";

  const channel = params.tab === "whatsapp" ? "WHATSAPP" : "EMAIL";
  const status = params.status?.trim() || undefined;
  const q = params.q?.trim() || undefined;
  const dateFrom = params.dateFrom?.trim() || "";
  const dateTo = params.dateTo?.trim() || "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const { rows, total, totalPages } = await listMessageLogs({
    channel,
    recipientUserId: ownerUserId,
    status: status as MessageLogStatus | undefined,
    q,
    from: dateFrom ? new Date(dateFrom) : undefined,
    to: dateTo ? new Date(dateTo) : undefined,
    page,
  });

  const buildTabUrl = (tab: "email" | "whatsapp") => `/organizador/mensagens?tab=${tab}`;

  const buildFilterQuery = (overrides: Partial<SearchParams> = {}) => {
    const query = new URLSearchParams();
    query.set("tab", params.tab === "whatsapp" ? "whatsapp" : "email");
    const merged = { status, q, dateFrom, dateTo, ...overrides };
    if (merged.status) query.set("status", merged.status);
    if (merged.q) query.set("q", merged.q);
    if (merged.dateFrom) query.set("dateFrom", merged.dateFrom);
    if (merged.dateTo) query.set("dateTo", merged.dateTo);
    return query;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mensagens</h1>
        <p className="text-sm text-gray-500">{total} mensagem(ns) encontrada(s)</p>
      </div>

      <div className="flex gap-2 border-b dark:border-gray-700">
        <Link
          href={buildTabUrl("email")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            channel === "EMAIL" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500"
          }`}
        >
          E-mail
        </Link>
        <Link
          href={buildTabUrl("whatsapp")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            channel === "WHATSAPP" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500"
          }`}
        >
          WhatsApp
        </Link>
      </div>

      <form method="GET" className="card grid gap-4 md:grid-cols-5">
        <input type="hidden" name="tab" value={params.tab === "whatsapp" ? "whatsapp" : "email"} />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q ?? ""} placeholder="Nome, e-mail ou telefone" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="SENT">Enviado</option>
            {channel === "WHATSAPP" && <option value="DELIVERED">Entregue</option>}
            {channel === "WHATSAPP" && <option value="READ">Lido</option>}
            <option value="FAILED">Falhou</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" name="dateFrom" defaultValue={dateFrom} className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field text-sm py-1.5" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
          <Link href={buildTabUrl(channel === "WHATSAPP" ? "whatsapp" : "email")} className="btn-secondary py-1.5 px-4 text-sm">
            Limpar
          </Link>
        </div>
      </form>

      <MessageLogList rows={rows as MessageLogRow[]} />

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center flex-wrap">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
            const query = buildFilterQuery();
            query.set("page", String(p));
            return (
              <Link
                key={p}
                href={`/organizador/mensagens?${query.toString()}`}
                className={`text-sm px-3 py-1.5 rounded-lg border ${
                  p === page ? "bg-primary-600 text-white border-primary-600" : "border-gray-300 dark:border-gray-600"
                }`}
              >
                {p}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rodar `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: sem erros novos atribuíveis a este arquivo.

- [ ] **Step 3: Commit**

```bash
git add app/organizador/mensagens/page.tsx
git commit -m "feat: add organizer message inbox page, scoped to own recipientUserId"
```

---

## Task 14: Nav — link "Mensagens" no admin e no organizador

**Files:**
- Modify: `components/admin/AdminNav.tsx:24-25`
- Modify: `components/organizer/OrganizerNav.tsx:21-22,49-50`

Sem teste (componente de navegação, sem lógica).

- [ ] **Step 1: `AdminNav.tsx`**

Entre as linhas do link "Alertas" (linha 25) e "Config." (linha 26), adicionar:

```tsx
          <Link href="/admin/mensagens" className="hover:text-gray-300">Mensagens</Link>
```

- [ ] **Step 2: `OrganizerNav.tsx`**

Nas DUAS ocorrências do bloco de nav (desktop, linha ~21; mobile, linha ~49), logo depois do link
"Carrinhos abandonados", adicionar:

```tsx
            <Link href="/organizador/mensagens" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Mensagens</Link>
```

(no bloco mobile a indentação é 10 espaços em vez de 12 — seguir a indentação já existente em
cada bloco, não copiar literalmente.)

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdminNav.tsx components/organizer/OrganizerNav.tsx
git commit -m "feat: add Mensagens link to admin and organizer nav"
```

---

## Task 15: Verificação final

**Files:** nenhum (só verificação, sem mudança de código)

- [ ] **Step 1: Suíte completa e type-check**

Run: `npx vitest run`
Expected: todos os testes passando (baseline de 855 + os novos desta feature).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 2: Checklist de verificação manual (registrar como pendência se o banco de dev
  continuar inacessível — mesma situação já registrada no sub-projeto anterior)**

- [ ] `/admin/mensagens` carrega, abas E-mail/WhatsApp alternam via URL (`?tab=`), filtros
  funcionam, paginação funciona.
- [ ] `/organizador/mensagens` mostra só mensagens do próprio organizador (testar com 2
  organizadores diferentes, confirmar que um não vê o log do outro).
- [ ] Assistente sem a permissão `messages.view` é redirecionado pra `/acesso-negado` ao tentar
  acessar `/organizador/mensagens`; com a permissão concedida (via `/organizador/assistentes`),
  acessa normalmente e vê o mesmo escopo do organizador que o criou.
- [ ] Disparar um e-mail real (ex. esqueci minha senha) e confirmar que aparece na aba E-mail como
  `SENT`.
- [ ] Conectar o WhatsApp (`/admin/whatsapp`, escanear QR), confirmar (via log da VPS ou painel da
  Evolution API) que o webhook foi registrado; disparar um alerta de teste e verificar que o
  status evolui de `SENT` pra `DELIVERED`/`READ` conforme o destinatário recebe/lê no celular.
- [ ] Dark mode: badges de status e tabs legíveis.

- [ ] **Step 3: Atualizar `PROGRESSO.md`**

Marcar o sub-projeto 2 (caixa de entrada de mensagens) como implementado, registrar os commits das
15 tasks, apontar a pendência da verificação manual (se o banco de dev continuar inacessível) e a
próxima tarefa da sessão (brainstorm do sub-projeto 3 — anúncios/Google-Meta Ads).

```bash
git add PROGRESSO.md
git commit -m "docs: record completion of message inbox sub-project"
```
