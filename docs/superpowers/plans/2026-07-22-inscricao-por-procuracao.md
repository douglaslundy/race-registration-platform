# Inscrição por procuração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a spec `docs/superpowers/specs/2026-07-22-inscricao-por-procuracao-design.md`
(Fases A+B): permitir que um atleta logado inscreva outro atleta num evento, quando o
organizador/admin habilitar isso pro evento, com notificação dupla e vínculo automático por CPF
quando a pessoa já tem conta.

**Architecture:** `Order.buyerUserId` e `Registration.athleteUserId` já são campos separados no
schema — a única mudança estrutural é 1 campo booleano novo em `Event`. Todo o resto (listagem de
inscritos, exportação CSV, "minhas inscrições") já lê os dados certos assim que `athleteUserId`
apontar pra pessoa certa; o trabalho real é: resolver/criar essa pessoa dentro da transação de
checkout, notificar as duas partes, e expor o toggle + o formulário na UI.

**Tech Stack:** Next.js (App Router), Prisma, Zod, react-hook-form, Vitest, TypeScript.

## Global Constraints

- Nenhuma mudança de comportamento fora do escopo desta feature: toda inscrição sem
  `proxyAthlete` continua idêntica em request/response/notificação ao que é hoje.
- TDD em toda função de `lib/` e rota de API tocada.
- Componentes client (modal, seletor no formulário) sem teste automatizado — sem infraestrutura
  de teste de componente React neste projeto (convenção já estabelecida).
- `lib/checkout.ts::createCheckout` roda inteiro dentro de uma única `db.$transaction` — a
  criação/vínculo do atleta por procuração acontece dentro dela, atômica com `Order`/
  `Registration`.
- `AthleteProfile.phone`/`.cpf`/`.birthDate` são os campos realmente lidos pelo resto do sistema
  (WhatsApp, exportação) — não confundir com `User.phone`/`.cpf`, colunas vestigiais nunca
  populadas por nenhum fluxo existente.
- E-mail sintético (quando o comprador não informa e-mail do atleta) nunca é exibido em nenhuma
  tela nem usado como destinatário real de envio — sempre checado via `isPlaceholderEmail()`
  antes de qualquer tentativa de e-mail pro atleta.
- Servidor sempre revalida `event.allowProxyRegistration` dentro de `createCheckout` — nunca
  confia só no toggle da UI (um client malicioso poderia mandar `proxyAthlete` direto pra API
  mesmo com o evento desabilitado).

---

## Task 1: Schema — `Event.allowProxyRegistration`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260722000000_add_event_allow_proxy_registration/migration.sql`

**Interfaces:**
- Produces: `Event.allowProxyRegistration: boolean` (default `false`) — consumido por praticamente
  todas as tasks seguintes.

- [ ] **Step 1: Adicionar o campo ao model `Event`**

Em `prisma/schema.prisma`, no `model Event { ... }`, adicionar a linha abaixo logo depois de
`cancellationContactEmail String?` (mesmo bloco dos outros toggles de configuração do evento):

```prisma
  cancellationDeadline         DateTime?
  cancellationRequiresApproval Boolean   @default(false)
  cancellationContactPhone     String?
  cancellationContactEmail     String?
  allowProxyRegistration       Boolean   @default(false)
```

- [ ] **Step 2: Validar o schema**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: gera o client sem erros.

- [ ] **Step 3: Criar o arquivo de migração (documentação — deploy usa `prisma db push`, que não
  executa `migration.sql`, mas o projeto mantém um arquivo por mudança de schema como histórico)**

Criar `prisma/migrations/20260722000000_add_event_allow_proxy_registration/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "events" ADD COLUMN "allowProxyRegistration" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 4: Rodar a suíte completa e `tsc` (nenhuma mudança de código ainda, só confirmando
  que o schema novo não quebra nada)**

Run: `npx vitest run`
Expected: todos os testes continuam passando

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma "prisma/migrations/20260722000000_add_event_allow_proxy_registration/migration.sql"
git commit -m "feat: adicionar Event.allowProxyRegistration ao schema"
```

---

## Task 2: `lib/proxy-athlete.ts` — e-mail sintético

**Files:**
- Create: `lib/proxy-athlete.ts`
- Test: `tests/unit/proxy-athlete.test.ts`

**Interfaces:**
- Produces: `export function generatePlaceholderEmail(): string` e
  `export function isPlaceholderEmail(email: string): boolean` — consumidos pela Task 3
  (`lib/checkout.ts`) e Task 6 (`lib/notifications.ts`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/unit/proxy-athlete.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generatePlaceholderEmail, isPlaceholderEmail } from "@/lib/proxy-athlete";

describe("generatePlaceholderEmail", () => {
  it("gera um e-mail sintético terminando no domínio interno reservado", () => {
    const email = generatePlaceholderEmail();
    expect(email).toMatch(/^[0-9a-f-]{36}@sememail\.internal$/);
  });

  it("gera um valor diferente a cada chamada", () => {
    expect(generatePlaceholderEmail()).not.toBe(generatePlaceholderEmail());
  });
});

describe("isPlaceholderEmail", () => {
  it("retorna true para um e-mail sintético gerado pela própria função", () => {
    expect(isPlaceholderEmail(generatePlaceholderEmail())).toBe(true);
  });

  it("retorna false para um e-mail real", () => {
    expect(isPlaceholderEmail("atleta@example.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/unit/proxy-athlete.test.ts`
Expected: FAIL — módulo `@/lib/proxy-athlete` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/proxy-athlete.ts`:

```ts
import { randomUUID } from "crypto";

const PLACEHOLDER_EMAIL_DOMAIN = "sememail.internal";

/** Gera um e-mail sintético único, nunca roteável, pra satisfazer o @unique de User.email quando
 * o comprador não informa o e-mail do atleta numa inscrição por procuração. Nunca deve ser
 * exibido em nenhuma tela nem usado como destinatário de envio real — checar com
 * isPlaceholderEmail() antes de mandar qualquer coisa pro e-mail de um atleta. */
export function generatePlaceholderEmail(): string {
  return `${randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/proxy-athlete.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Type-check e commit**

Run: `npx tsc --noEmit`
Expected: sem erros

```bash
git add lib/proxy-athlete.ts tests/unit/proxy-athlete.test.ts
git commit -m "feat: geracao de e-mail sintetico para atleta inscrito por procuracao"
```

---

## Task 3: `lib/checkout.ts` — resolver/criar o atleta por procuração

**Files:**
- Modify: `lib/checkout.ts`
- Test: `tests/unit/checkout-proxy-athlete.test.ts`

**Interfaces:**
- Consumes: `generatePlaceholderEmail` (Task 2), `normalizeCpf` (`lib/cpf.ts`, já existe).
- Produces: `CheckoutInput.proxyAthlete?: { name: string; birthDate: string; cpf: string; phone:
  string; email?: string }` e `CheckoutResult.proxyAthleteInvite?: { userId: string; name: string;
  email: string }` — consumidos pela Task 5 (`app/api/checkout/route.ts`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/unit/checkout-proxy-athlete.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

vi.mock("@/lib/proxy-athlete", () => ({
  generatePlaceholderEmail: vi.fn(() => "placeholder-uuid@sememail.internal"),
}));

const dbMock = db as any;

describe("createCheckout proxy athlete handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ticketBatch = {
    id: "batch-1",
    active: true,
    soldCount: 0,
    capacity: 10,
    priceAmount: 20000,
  };

  const event = {
    id: "event-1",
    status: "REGISTRATIONS_OPEN",
    platformFeePercent: 1100,
    allowProxyRegistration: true,
  };

  const proxyAthleteInput = {
    name: "Maria Atleta",
    birthDate: "1995-05-20",
    cpf: "111.444.777-35",
    phone: "35999998888",
  };

  function createTx(overrides: {
    eventOverride?: Record<string, unknown>;
    existingAthleteProfile?: Record<string, unknown> | null;
    emailTaken?: Record<string, unknown> | null;
    createdUser?: Record<string, unknown>;
  } = {}) {
    return {
      ticketBatch: {
        findUnique: vi.fn().mockResolvedValue(ticketBatch),
        findMany: vi.fn().mockResolvedValue([ticketBatch]),
        update: vi.fn().mockResolvedValue({}),
      },
      event: {
        findUnique: vi.fn().mockResolvedValue({ ...event, ...(overrides.eventOverride ?? {}) }),
      },
      eventRoute: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      eventCategory: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      coupon: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      athleteProfile: {
        findFirst: vi.fn().mockResolvedValue(overrides.existingAthleteProfile ?? null),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(overrides.emailTaken ?? null),
        create: vi.fn().mockResolvedValue(overrides.createdUser ?? { id: "new-athlete-1", name: "Maria Atleta" }),
      },
      order: {
        create: vi.fn().mockResolvedValue({ id: "order-1" }),
      },
      registration: {
        create: vi.fn().mockResolvedValue({ id: "reg-1" }),
      },
    };
  }

  it("rejeita proxyAthlete quando o evento não permite inscrição por procuração", async () => {
    const tx = createTx({ eventOverride: { allowProxyRegistration: false } });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "buyer-1",
        athleteUserId: "buyer-1",
        proxyAthlete: proxyAthleteInput,
      }),
    ).rejects.toThrow("Inscrição por procuração não está habilitada para este evento");
    expect(tx.athleteProfile.findFirst).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it("cria uma conta nova pro atleta quando o CPF não bate com nenhuma conta existente", async () => {
    const tx = createTx({ existingAthleteProfile: null });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
      proxyAthlete: proxyAthleteInput,
    });

    expect(tx.athleteProfile.findFirst).toHaveBeenCalledWith({ where: { cpf: "11144477735" } });
    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        name: "Maria Atleta",
        email: "placeholder-uuid@sememail.internal",
        role: "ATHLETE",
        passwordHash: null,
        athleteProfile: {
          create: { cpf: "11144477735", birthDate: new Date("1995-05-20"), phone: "35999998888" },
        },
      },
    });
    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ athleteUserId: "new-athlete-1" }) }),
    );
    expect(result.proxyAthleteInvite).toBeUndefined();
  });

  it("reaproveita a conta existente quando o CPF já está cadastrado (Fase B), sem criar conta nova", async () => {
    const tx = createTx({ existingAthleteProfile: { userId: "existing-athlete-1", cpf: "11144477735" } });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
      proxyAthlete: proxyAthleteInput,
    });

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ athleteUserId: "existing-athlete-1" }) }),
    );
  });

  it("usa o e-mail informado quando fornecido, e retorna proxyAthleteInvite", async () => {
    const tx = createTx({
      existingAthleteProfile: null,
      emailTaken: null,
      createdUser: { id: "new-athlete-2", name: "Maria Atleta" },
    });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
      proxyAthlete: { ...proxyAthleteInput, email: "maria@example.com" },
    });

    expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { email: "maria@example.com" }, select: { id: true } });
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "maria@example.com" }) }),
    );
    expect(result.proxyAthleteInvite).toEqual({
      userId: "new-athlete-2",
      name: "Maria Atleta",
      email: "maria@example.com",
    });
  });

  it("rejeita quando o e-mail informado já pertence a outra conta", async () => {
    const tx = createTx({ existingAthleteProfile: null, emailTaken: { id: "other-user" } });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "buyer-1",
        athleteUserId: "buyer-1",
        proxyAthlete: { ...proxyAthleteInput, email: "jatem@example.com" },
      }),
    ).rejects.toThrow("Este e-mail já está em uso por outra conta");
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it("quando o CPF informado é do próprio comprador, a inscrição fica igual a uma normal (mesmo athleteUserId)", async () => {
    const tx = createTx({ existingAthleteProfile: { userId: "buyer-1", cpf: "11144477735" } });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
      proxyAthlete: proxyAthleteInput,
    });

    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ athleteUserId: "buyer-1" }) }),
    );
  });

  it("sem proxyAthlete, comportamento idêntico a uma inscrição normal (não consulta athleteProfile por CPF)", async () => {
    const tx = createTx();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "buyer-1",
      athleteUserId: "buyer-1",
    });

    expect(tx.athleteProfile.findFirst).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ athleteUserId: "buyer-1" }) }),
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/unit/checkout-proxy-athlete.test.ts`
Expected: FAIL — `proxyAthlete` não existe em `CheckoutInput`, guard/lógica ainda não implementados.

- [ ] **Step 3: Implementar em `lib/checkout.ts`**

Adicionar os imports no topo do arquivo:

```ts
import { db } from "./db";
import { calculatePlatformFee } from "./format";
import { getSetting } from "./settings";
import { isBatchAvailable } from "./batch-status";
import { normalizeCpf } from "./cpf";
import { generatePlaceholderEmail } from "./proxy-athlete";
import type { ShirtSize } from "@prisma/client";
```

Estender `CheckoutInput` e `CheckoutResult`:

```ts
export interface CheckoutInput {
  eventId: string;
  ticketBatchId: string;
  routeId?: string;
  categoryId?: string;
  buyerUserId: string;
  athleteUserId: string;
  shirtSize?: ShirtSize;
  teamName?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  medicalNotes?: string;
  notes?: string;
  couponCode?: string;
  proxyAthlete?: {
    name: string;
    birthDate: string;
    cpf: string;
    phone: string;
    email?: string;
  };
}

export interface CheckoutResult {
  orderId: string;
  registrationId: string;
  subtotalAmount: number;
  totalAmount: number;
  discountAmount: number;
  platformFeeAmount: number;
  proxyAthleteInvite?: { userId: string; name: string; email: string };
}
```

Logo depois da checagem `if (!event || event.status !== "REGISTRATIONS_OPEN") throw new
Error("Inscrições não abertas");`, adicionar o guard server-side:

```ts
    if (input.proxyAthlete && !event.allowProxyRegistration) {
      throw new Error("Inscrição por procuração não está habilitada para este evento");
    }
```

Antes do bloco `let discountAmount = 0;` (ou seja, entre a checagem de percurso/categoria e a
checagem de cupom), adicionar a resolução do atleta:

```ts
    let athleteUserId = input.athleteUserId;
    let proxyAthleteInvite: CheckoutResult["proxyAthleteInvite"];

    if (input.proxyAthlete) {
      const proxyCpf = normalizeCpf(input.proxyAthlete.cpf);
      // Busca só pelo CPF — se já existe conta (Fase B), reaproveita e nunca cria duplicata; se
      // coincidir com o próprio comprador, o resultado já é idêntico a uma inscrição normal.
      const existingProfile = await tx.athleteProfile.findFirst({ where: { cpf: proxyCpf } });

      if (existingProfile) {
        athleteUserId = existingProfile.userId;
      } else {
        const realEmail = input.proxyAthlete.email?.trim();
        const proxyEmail = realEmail || generatePlaceholderEmail();
        if (realEmail) {
          const emailTaken = await tx.user.findUnique({ where: { email: proxyEmail }, select: { id: true } });
          if (emailTaken) throw new Error("Este e-mail já está em uso por outra conta");
        }

        const newAthlete = await tx.user.create({
          data: {
            name: input.proxyAthlete.name,
            email: proxyEmail,
            role: "ATHLETE",
            passwordHash: null,
            athleteProfile: {
              create: {
                cpf: proxyCpf,
                birthDate: new Date(input.proxyAthlete.birthDate),
                phone: input.proxyAthlete.phone,
              },
            },
          },
        });
        athleteUserId = newAthlete.id;
        if (realEmail) {
          proxyAthleteInvite = { userId: newAthlete.id, name: newAthlete.name, email: realEmail };
        }
      }
    }
```

No `tx.registration.create`, trocar `athleteUserId: input.athleteUserId,` por
`athleteUserId,` (usa a variável local resolvida, não mais o valor bruto do input).

No `return` final da função, adicionar `proxyAthleteInvite,` ao objeto retornado:

```ts
    return {
      orderId: order.id,
      registrationId: registration.id,
      subtotalAmount: subtotal,
      totalAmount: total,
      discountAmount,
      platformFeeAmount: platformFee,
      proxyAthleteInvite,
    };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/checkout-proxy-athlete.test.ts tests/unit/checkout-coupon.test.ts`
Expected: PASS (7 + 6 testes — confirma também que o guard/resolução novos não quebraram nada do
fluxo de cupom, que roda na mesma função)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add lib/checkout.ts tests/unit/checkout-proxy-athlete.test.ts
git commit -m "feat: resolver/criar atleta por procuracao dentro de createCheckout"
```

---

## Task 4: Convite de acesso — `lib/email.ts` + `lib/proxy-athlete.ts`

**Files:**
- Modify: `lib/email.ts`
- Modify: `lib/proxy-athlete.ts`
- Test: `tests/proxy-athlete-invite.test.ts`

**Interfaces:**
- Produces: `sendProxyRegistrationInviteEmail(params: { to: string; name: string; invitedByName:
  string; resetUrl: string }): Promise<void>` (em `lib/email.ts`) e
  `sendProxyRegistrationInvite(params: { name: string; email: string; invitedByName: string }):
  Promise<void>` (em `lib/proxy-athlete.ts`) — consumido pela Task 5.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/proxy-athlete-invite.test.ts` (mesmo padrão de
`tests/assistants-create-or-promote.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendProxyRegistrationInviteEmail: vi.fn(),
}));

import { sendProxyRegistrationInvite } from "@/lib/proxy-athlete";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendProxyRegistrationInviteEmail } from "@/lib/email";

const dbMock = db as any;

describe("sendProxyRegistrationInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("gera um token de verificação e dispara o e-mail de convite", async () => {
    await sendProxyRegistrationInvite({
      name: "Maria Atleta",
      email: "maria@example.com",
      invitedByName: "João Comprador",
    });

    expect(dbMock.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { identifier: "maria@example.com" } });
    expect(dbMock.verificationToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ identifier: "maria@example.com" }) }),
    );
    expect(sendProxyRegistrationInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "maria@example.com", name: "Maria Atleta", invitedByName: "João Comprador" }),
    );
  });

  it("não dispara o e-mail quando o SMTP não está configurado, mas ainda assim não lança erro", async () => {
    vi.mocked(isSmtpReady).mockReturnValue(false);

    await expect(
      sendProxyRegistrationInvite({ name: "Maria", email: "maria@example.com", invitedByName: "João" }),
    ).resolves.toBeUndefined();

    expect(sendProxyRegistrationInviteEmail).not.toHaveBeenCalled();
  });

  it("nunca lança erro quando o envio do e-mail falha (best-effort)", async () => {
    vi.mocked(sendProxyRegistrationInviteEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(
      sendProxyRegistrationInvite({ name: "Maria", email: "maria@example.com", invitedByName: "João" }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/proxy-athlete-invite.test.ts`
Expected: FAIL — `sendProxyRegistrationInvite` não existe.

- [ ] **Step 3: Implementar `sendProxyRegistrationInviteEmail` em `lib/email.ts`**

Adicionar ao final de `lib/email.ts`, depois de `sendAssistantInviteEmail`:

```ts
/** E-mail de convite pro atleta inscrito por procuração definir a senha e acessar a própria
 * conta/inscrição. Só é disparado quando o comprador informou um e-mail real (nunca pro
 * sintético). */
export async function sendProxyRegistrationInviteEmail(params: {
  to: string;
  name: string;
  invitedByName: string;
  resetUrl: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Você tem uma inscrição em ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p><strong>${params.invitedByName}</strong> criou uma inscrição pra você no ${appName}.</p>
       <p>Clique no botão abaixo para definir sua senha e acompanhar sua inscrição:</p>
       <p><a href="${params.resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Definir senha e acessar</a></p>
       <p style="font-size:13px;color:#6b7280">Se você não esperava este convite, ignore este e-mail. O link expira em 1 hora.</p>`
    ),
  });
}
```

- [ ] **Step 4: Implementar `sendProxyRegistrationInvite` em `lib/proxy-athlete.ts`**

Adicionar ao topo do arquivo os novos imports, e a função ao final:

```ts
import { randomUUID, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendProxyRegistrationInviteEmail } from "@/lib/email";

const PLACEHOLDER_EMAIL_DOMAIN = "sememail.internal";

export function generatePlaceholderEmail(): string {
  return `${randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** Gera um token de verificação (mesmo padrão de createOrPromoteAssistant) e dispara o e-mail de
 * convite pro atleta inscrito por procuração definir a senha e acessar a própria conta.
 * Best-effort: nunca lança — chamado fire-and-forget pela rota de checkout. */
export async function sendProxyRegistrationInvite(params: {
  name: string;
  email: string;
  invitedByName: string;
}): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60);
  await db.verificationToken.deleteMany({ where: { identifier: params.email } });
  await db.verificationToken.create({ data: { identifier: params.email, token, expires } });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const resetUrl = `${baseUrl}/auth/nova-senha?token=${token}&email=${encodeURIComponent(params.email)}`;

  const cfg = await getSmtpConfig();
  if (!isSmtpReady(cfg)) return;

  try {
    await sendProxyRegistrationInviteEmail({
      to: params.email,
      name: params.name,
      invitedByName: params.invitedByName,
      resetUrl,
    });
  } catch (err) {
    console.error("[sendProxyRegistrationInvite] invite email failed:", err);
  }
}
```

(Note: o arquivo fica com `generatePlaceholderEmail`/`isPlaceholderEmail` da Task 2 mais essa
função nova — as duas primeiras não mudam de assinatura nem comportamento, só ganham vizinhas
novas no mesmo arquivo.)

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/proxy-athlete-invite.test.ts tests/unit/proxy-athlete.test.ts`
Expected: PASS (3 + 4 testes)

- [ ] **Step 6: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 7: Commit**

```bash
git add lib/email.ts lib/proxy-athlete.ts tests/proxy-athlete-invite.test.ts
git commit -m "feat: convite de acesso por e-mail para atleta inscrito por procuracao"
```

---

## Task 5: `app/api/checkout/route.ts` — aceitar `proxyAthlete` e disparar o convite

**Files:**
- Modify: `app/api/checkout/route.ts`
- Test: `tests/checkout-route.test.ts`

**Interfaces:**
- Consumes: `CheckoutInput.proxyAthlete`/`CheckoutResult.proxyAthleteInvite` (Task 3),
  `sendProxyRegistrationInvite` (Task 4).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/checkout-route.test.ts`, adicionar o mock de `@/lib/proxy-athlete` junto aos outros
mocks do topo do arquivo:

```ts
vi.mock("@/lib/proxy-athlete", () => ({
  sendProxyRegistrationInvite: vi.fn(),
}));
```

E o import correspondente, junto aos outros imports:

```ts
import { sendProxyRegistrationInvite } from "@/lib/proxy-athlete";
```

Adicionar os 2 testes abaixo ao final do `describe("checkout api", ...)`, antes do fechamento:

```ts
  it("dispara o convite de acesso quando createCheckout retorna proxyAthleteInvite com e-mail real", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);
    vi.mocked(createCheckout).mockResolvedValueOnce({
      orderId: "order-1",
      registrationId: "reg-1",
      subtotalAmount: 10000,
      totalAmount: 10000,
      discountAmount: 0,
      platformFeeAmount: 0,
      proxyAthleteInvite: { userId: "new-athlete-1", name: "Maria Atleta", email: "maria@example.com" },
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Comprador", email: "comprador@example.com" });
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
          proxyAthlete: {
            name: "Maria Atleta",
            birthDate: "1995-05-20",
            cpf: "111.444.777-35",
            phone: "35999998888",
            email: "maria@example.com",
          },
        }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(sendProxyRegistrationInvite).toHaveBeenCalledWith({
      name: "Maria Atleta",
      email: "maria@example.com",
      invitedByName: "Comprador",
    });
  });

  it("não dispara convite quando createCheckout não retorna proxyAthleteInvite", async () => {
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
        body: JSON.stringify({ eventId: "event-1", ticketBatchId: "batch-1", paymentMethod: "PIX" }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(sendProxyRegistrationInvite).not.toHaveBeenCalled();
  });

  it("rejeita proxyAthlete com CPF inválido (dígito verificador), sem chamar createCheckout", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
          proxyAthlete: {
            name: "Maria Atleta",
            birthDate: "1995-05-20",
            cpf: "111.444.777-36",
            phone: "35999998888",
          },
        }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(createCheckout).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/checkout-route.test.ts`
Expected: FAIL — `proxyAthlete` rejeitado pelo Zod (schema ainda não aceita o campo) e
`sendProxyRegistrationInvite` nunca chamado.

- [ ] **Step 3: Implementar em `app/api/checkout/route.ts`**

Substituir o conteúdo inteiro do arquivo por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { getPaymentProvider } from "@/lib/payment";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
import { getPaymentProviderSetting, getMercadoPagoAccessToken, getPagarMeApiKey } from "@/lib/payment-settings";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import type { ShirtSize, PaymentMethod } from "@prisma/client";
import { emptyStringToUndefined, optionalEnumField, optionalOpaqueIdField, opaqueIdField } from "@/lib/checkout-validation";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { checkLowStockAlert } from "@/lib/alerts/low-stock";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { sendProxyRegistrationInvite } from "@/lib/proxy-athlete";
import { isValidCpf } from "@/lib/cpf";

const proxyAthleteSchema = z.object({
  name: z.string().min(2).max(100),
  birthDate: z.string().min(1),
  cpf: z.string().min(11).max(14).refine(isValidCpf, "CPF inválido"),
  phone: z.string().min(10).max(20),
  email: z.string().email().optional(),
});

const checkoutSchema = z.object({
  eventId: opaqueIdField(),
  ticketBatchId: opaqueIdField(),
  routeId: optionalOpaqueIdField(),
  categoryId: optionalOpaqueIdField(),
  shirtSize: optionalEnumField(["PP", "P", "M", "G", "GG", "XGG"] as const),
  teamName: z.string().max(100).optional(),
  emergencyContactName: z.string().max(100).optional(),
  emergencyContactPhone: z.string().max(20).optional(),
  medicalNotes: z.string().max(500).optional(),
  notes: z.string().max(200).optional(),
  couponCode: z.string().max(50).optional(),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
  cpf: z.string().max(14).optional(),
  cardToken: z.string().max(200).optional(),
  cardBrand: z.string().max(50).optional(),
  installments: z.number().int().min(1).max(12).optional(),
  proxyAthlete: proxyAthleteSchema.optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  }

  // Limita tentativas de checkout por usuário — mitiga "card testing" (submissão em massa de
  // tokens de cartão roubados contra este endpoint).
  const { allowed } = checkRateLimit(`checkout:${session.user.id}`, RATE_LIMITS.CHECKOUT);
  if (!allowed) {
    return NextResponse.json(
      { error: "Muitas tentativas de pagamento. Aguarde um minuto e tente novamente." },
      { status: 429 },
    );
  }

  const body = await req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { paymentMethod, cpf, cardToken, cardBrand, installments, ...checkoutData } = parsed.data;
  const enabledPaymentMethods = await getEnabledPaymentMethods();
  if (!enabledPaymentMethods.includes(paymentMethod)) {
    return NextResponse.json({ error: "Meio de pagamento indisponível" }, { status: 400 });
  }

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

  const idempotencyKey = `${checkout.orderId}_${paymentMethod}_${Date.now()}`;

  const providerKey = await getPaymentProviderSetting();
  if (providerKey === "mercadopago") {
    const token = await getMercadoPagoAccessToken();
    if (!token) {
      return NextResponse.json(
        { error: "Gateway de pagamento não configurado. Acesse Admin → Configurações para configurar o Mercado Pago." },
        { status: 503 }
      );
    }
  }
  if (providerKey === "pagarme") {
    const apiKey = await getPagarMeApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Gateway de pagamento não configurado. Acesse Admin → Configurações para configurar o Pagar.me." },
        { status: 503 }
      );
    }
  }

  const provider = await getPaymentProvider();
  const [buyer, athleteProfile] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true },
    }),
    db.athleteProfile.findUnique({
      where: { userId: session.user.id },
      select: { cpf: true },
    }),
  ]);

  // Se a inscrição foi criada pra outro atleta e um e-mail real foi informado, manda o convite de
  // acesso (fire-and-forget) assim que sabemos que a conta existe — não espera o pagamento ser
  // confirmado, já que a conta já foi criada nesse ponto independente do status do pagamento.
  if (checkout.proxyAthleteInvite) {
    void sendProxyRegistrationInvite({
      name: checkout.proxyAthleteInvite.name,
      email: checkout.proxyAthleteInvite.email,
      invitedByName: buyer!.name,
    });
  }

  const effectiveCpf = cpf ?? athleteProfile?.cpf ?? undefined;

  let paymentResult: Awaited<ReturnType<typeof provider.createPayment>>;
  try {
    paymentResult = await provider.createPayment({
      orderId: checkout.orderId,
      amount: checkout.totalAmount,
      method: paymentMethod,
      idempotencyKey,
      buyer: { name: buyer!.name, email: buyer!.email },
      description: `Inscrição #${checkout.registrationId}`,
      cpf: effectiveCpf,
      cardToken,
      cardBrand,
      installments,
    });
  } catch (payErr) {
    let msg = "Erro no gateway de pagamento";
    if (payErr instanceof Error) {
      msg = payErr.message;
    } else if (payErr && typeof payErr === "object") {
      const obj = payErr as Record<string, unknown>;
      if (typeof obj.message === "string" && obj.message) {
        msg = obj.message;
      } else if (typeof obj.error === "string" && obj.error) {
        msg = obj.error;
      } else {
        try { msg = JSON.stringify(obj).slice(0, 300); } catch { /* keep default */ }
      }
    }
    console.error("[checkout] payment gateway error:", payErr);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (paymentResult.status === "CANCELLED") {
    await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: checkout.orderId,
          provider: providerKey,
          providerPaymentId: paymentResult.providerPaymentId,
          method: paymentMethod as PaymentMethod,
          status: "PENDING",
          amount: checkout.totalAmount,
          idempotencyKey,
        },
      });
      await applyGatewayStatus(
        tx,
        payment,
        { id: checkout.orderId, status: "PENDING" },
        [{ id: checkout.registrationId, ticketBatchId: checkoutData.ticketBatchId, status: "PENDING_PAYMENT" }],
        "CANCELLED",
        "checkout",
      );
    });

    return NextResponse.json(
      { error: "Pagamento recusado pela operadora do cartão. Verifique os dados ou tente outro cartão." },
      { status: 402 },
    );
  }

  const payment = await db.payment.create({
    data: {
      orderId: checkout.orderId,
      provider: providerKey,
      providerPaymentId: paymentResult.providerPaymentId,
      method: paymentMethod as PaymentMethod,
      status: paymentResult.status === "PAID" ? "PAID" : "PENDING",
      amount: checkout.totalAmount,
      idempotencyKey,
      paidAt: paymentResult.status === "PAID" ? new Date() : null,
      gatewayFeeAmount: paymentResult.gatewayFeeAmount ?? null,
      pixQrCodeText: paymentResult.pixQrCodeText ?? null,
      boletoUrl: paymentResult.boletoUrl ?? null,
      expiresAt: paymentResult.expiresAt ? new Date(paymentResult.expiresAt) : null,
    },
  });

  if (paymentResult.status === "PAID") {
    await db.order.update({ where: { id: checkout.orderId }, data: { status: "PAID" } });
    await db.registration.update({
      where: { id: checkout.registrationId },
      data: { status: "CONFIRMED" },
    });
    // Envia a confirmação de inscrição por e-mail (fire-and-forget)
    void notifyOrderConfirmed(checkout.orderId);
  }

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CHECKOUT_INITIATED",
      entityType: "Order",
      entityId: checkout.orderId,
      metadata: { paymentMethod, totalAmount: checkout.totalAmount },
    },
  });

  return NextResponse.json({
    orderId: checkout.orderId,
    registrationId: checkout.registrationId,
    paymentId: payment.id,
    totalAmount: checkout.totalAmount,
    subtotalAmount: checkout.subtotalAmount,
    discountAmount: checkout.discountAmount,
    status: paymentResult.status,
    pixQrCodeText: paymentResult.pixQrCodeText,
    boletoUrl: paymentResult.boletoUrl,
    checkoutUrl: paymentResult.checkoutUrl,
    expiresAt: paymentResult.expiresAt,
  });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/checkout-route.test.ts`
Expected: PASS (10 testes — 7 já existentes + 3 novos)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add app/api/checkout/route.ts tests/checkout-route.test.ts
git commit -m "feat: aceitar proxyAthlete no checkout e disparar convite de acesso"
```

---

## Task 6: `lib/notifications.ts` — notificação dupla

**Files:**
- Modify: `lib/notifications.ts`
- Test: `tests/notifications.test.ts`

**Interfaces:**
- Consumes: `isPlaceholderEmail` (Task 2/4).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/notifications.test.ts`, adicionar o mock de `@/lib/proxy-athlete` junto aos outros
mocks do topo do arquivo:

```ts
vi.mock("@/lib/proxy-athlete", () => ({
  isPlaceholderEmail: vi.fn(),
}));
```

E o import correspondente:

```ts
import { isPlaceholderEmail } from "@/lib/proxy-athlete";
```

No `beforeEach` já existente, adicionar a linha de default:

```ts
    vi.mocked(isPlaceholderEmail).mockReturnValue(false);
```

Atualizar `orderFixture` (adicionar `buyerUserId` e, dentro de `registrations[0]`,
`athleteUserId` + `name`/`email` no objeto `athlete` — únicos campos novos; nada mais muda):

```ts
const orderFixture = {
  buyerUserId: "user-1",
  buyer: { name: "Atleta Teste", email: "atleta@example.com" },
  event: { id: "event-1", title: "Corrida Teste" },
  registrations: [
    {
      id: "reg-1",
      notes: "Chegarei atrasado",
      athleteUserId: "user-1",
      athlete: { name: "Atleta Teste", email: "atleta@example.com", athleteProfile: { phone: "5511999999999" } },
    },
  ],
};
```

Adicionar o novo fixture e os 4 testes abaixo ao final do `describe("notifyOrderConfirmed", ...)`,
antes do fechamento:

```ts
  const proxyOrderFixture = {
    buyerUserId: "buyer-1",
    buyer: { name: "Comprador Teste", email: "comprador@example.com", athleteProfile: { phone: "5511777777777" } },
    event: { id: "event-1", title: "Corrida Teste" },
    registrations: [
      {
        id: "reg-1",
        notes: null,
        athleteUserId: "athlete-1",
        athlete: { name: "Atleta Convidado", email: "atleta-convidado@example.com", athleteProfile: { phone: "5511888888888" } },
      },
    ],
  };

  it("procuração: manda e-mail + WhatsApp pro comprador com texto avisando quem ele inscreveu", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(proxyOrderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValue("open");

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "comprador@example.com", name: "Comprador Teste" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511777777777",
      expect.stringContaining("Você inscreveu Atleta Convidado"),
      expect.anything(),
    );
  });

  it("procuração: manda e-mail + WhatsApp pro atleta com texto avisando quem criou a inscrição", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(proxyOrderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValue("open");

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta-convidado@example.com", name: "Atleta Convidado" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511888888888",
      expect.stringContaining("Comprador Teste criou uma inscrição pra você"),
      expect.anything(),
    );
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(2);
  });

  it("procuração: não manda e-mail pro atleta quando o e-mail é sintético, mas manda WhatsApp normalmente", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(proxyOrderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValue("open");
    vi.mocked(isPlaceholderEmail).mockReturnValue(true);

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "comprador@example.com" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511888888888", expect.any(String), expect.anything());
  });

  it("procuração: confirmationEmailSentAt é gravado só 1x, refletindo o e-mail do comprador", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(proxyOrderFixture);

    await notifyOrderConfirmed("order-1");

    expect(dbMock.order.update).toHaveBeenCalledTimes(1);
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { confirmationEmailSentAt: expect.any(Date) },
    });
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/notifications.test.ts`
Expected: FAIL — `notifyOrderConfirmed` ainda não distingue procuração, textos/contagens não
batem.

- [ ] **Step 3: Implementar em `lib/notifications.ts`**

Substituir o conteúdo inteiro do arquivo por:

```ts
import { db } from "./db";
import { getSmtpConfig, isSmtpReady } from "./smtp-settings";
import { sendRegistrationConfirmationEmail } from "./email";
import { sendWhatsAppMessage } from "./whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "./whatsapp-settings";
import { getConnectionState } from "./whatsapp/evolution-client";
import { isPlaceholderEmail } from "./proxy-athlete";

async function isWhatsAppConnectionActive(): Promise<boolean> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) return false;
  try {
    return (await getConnectionState(config)) === "open";
  } catch {
    return false;
  }
}

async function sendWhatsAppIfActive(
  phone: string | null | undefined,
  text: string,
  eventId?: string,
): Promise<void> {
  if (!phone) return;
  try {
    if (await isWhatsAppConnectionActive()) {
      await sendWhatsAppMessage(
        phone,
        text,
        eventId ? { relatedEntityType: "Event", relatedEntityId: eventId } : undefined,
      );
    }
  } catch (err) {
    console.error("[notifyOrderConfirmed] whatsapp failed:", err);
  }
}

/**
 * Envia a confirmação de inscrição por e-mail e, se houver uma conexão de WhatsApp ativa
 * (instância com status "open"), também por WhatsApp. Seguro para chamar em
 * "fire-and-forget": não lança; cada canal falha de forma independente do outro.
 *
 * Quando a inscrição é por procuração (order.buyerUserId !== registration.athleteUserId), o
 * comprador recebe uma mensagem avisando quem ele inscreveu, e o atleta recebe uma mensagem
 * separada avisando quem criou a inscrição pra ele (e-mail só se não for sintético).
 */
export async function notifyOrderConfirmed(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      buyerUserId: true,
      buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
      event: { select: { id: true, title: true } },
      registrations: {
        select: {
          id: true,
          notes: true,
          athleteUserId: true,
          athlete: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
        },
        take: 1,
      },
    },
  });

  if (!order?.buyer || order.registrations.length === 0) return;
  const registration = order.registrations[0];
  const eventLabel = order.event?.title ? ` em ${order.event.title}` : "";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const detailsUrl = `${baseUrl}/dashboard/inscricoes/${registration.id}`;
  const isProxyRegistration = order.buyerUserId !== registration.athleteUserId;

  // Comprador — sempre recebe. Quando não é procuração, é a única mensagem (idêntico ao
  // comportamento de sempre); quando é, o texto deixa claro que ele inscreveu outra pessoa.
  try {
    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg)) {
      await sendRegistrationConfirmationEmail({
        to: order.buyer.email,
        name: order.buyer.name,
        registrationId: registration.id,
        orderId,
        eventTitle: order.event?.title,
        eventId: order.event?.id,
        notes: registration.notes ?? undefined,
      });
      await db.order.update({ where: { id: orderId }, data: { confirmationEmailSentAt: new Date() } });
    }
  } catch (err) {
    console.error("[notifyOrderConfirmed] email failed:", err);
  }

  const buyerWhatsappPhone = isProxyRegistration
    ? order.buyer.athleteProfile?.phone
    : registration.athlete.athleteProfile?.phone;
  const buyerWhatsappText = isProxyRegistration
    ? `Você inscreveu ${registration.athlete.name}${eventLabel}! Pedido ${orderId}. Detalhes: ${detailsUrl}`
    : `Sua inscrição${eventLabel} foi confirmada! Pedido ${orderId}. Detalhes: ${detailsUrl}`;
  await sendWhatsAppIfActive(buyerWhatsappPhone, buyerWhatsappText, order.event?.id);

  if (!isProxyRegistration) return;

  // Atleta — só quando é procuração (o comprador já foi tratado acima).
  if (!isPlaceholderEmail(registration.athlete.email)) {
    try {
      const cfg = await getSmtpConfig();
      if (isSmtpReady(cfg)) {
        await sendRegistrationConfirmationEmail({
          to: registration.athlete.email,
          name: registration.athlete.name,
          registrationId: registration.id,
          orderId,
          eventTitle: order.event?.title,
          eventId: order.event?.id,
          notes: registration.notes ?? undefined,
        });
      }
    } catch (err) {
      console.error("[notifyOrderConfirmed] athlete email failed:", err);
    }
  }

  await sendWhatsAppIfActive(
    registration.athlete.athleteProfile?.phone,
    `${order.buyer.name} criou uma inscrição pra você${eventLabel}! Pedido ${orderId}. Detalhes: ${detailsUrl}`,
    order.event?.id,
  );
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/notifications.test.ts`
Expected: PASS (todos os testes já existentes + os 4 novos)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add lib/notifications.ts tests/notifications.test.ts
git commit -m "feat: notificacao dupla (comprador + atleta) para inscricao por procuracao"
```

---

## Task 7: Toggle do evento — schema Zod, UI, e fix de acesso do admin

**Files:**
- Modify: `app/api/events/[id]/route.ts`
- Modify: `app/organizador/eventos/[id]/editar/page.tsx`
- Modify: `components/organizer/EditEventForm.tsx`
- Test: `tests/event-update-route.test.ts`

**Interfaces:** Nenhuma nova — só expõe o campo já existente (Task 1) na UI/API de edição.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/event-update-route.test.ts`, adicionar ao final do `describe("event update api", ...)`,
antes do fechamento:

```ts
  it("aceita e persiste allowProxyRegistration", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });

    const res = await PATCH(
      makeRequest({ allowProxyRegistration: true }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.event.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ allowProxyRegistration: true }) }),
    );
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/event-update-route.test.ts`
Expected: FAIL — `allowProxyRegistration` rejeitado pelo Zod schema atual (campo desconhecido é
ignorado silenciosamente pelo `safeParse`, então na verdade o teste falha porque `dbMock.event.
update` não recebe o campo — `parsed.data` não o contém).

- [ ] **Step 3: Adicionar o campo ao schema Zod da rota**

Em `app/api/events/[id]/route.ts`, no `updateEventSchema`, adicionar a linha abaixo logo depois de
`cancellationContactEmail: z.string().optional().nullable(),`:

```ts
  allowProxyRegistration: z.boolean().optional(),
```

(Nenhuma outra mudança na rota — o `data: { ...parsed.data, ... }` já existente no `PATCH` repassa
o campo automaticamente, mesmo padrão de `cancellationRequiresApproval`.)

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/event-update-route.test.ts`
Expected: PASS (9 testes — 8 já existentes + 1 novo)

- [ ] **Step 5: Corrigir o acesso do admin na página de edição**

Em `app/organizador/eventos/[id]/editar/page.tsx`, trocar o import:

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
```

por:

```tsx
import { requireOrganizer, resolveActingScope } from "@/lib/auth/rbac";
```

E trocar o corpo da função (do `const session = ...` até o fechamento do `Promise.all`) por:

```tsx
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;
  const scope = await resolveActingScope(session);

  const [event, cancellationPolicyEnabled] = await Promise.all([
    db.event.findFirst({
      where: scope.actingAsAdmin ? { id } : { id, organizer: { userId: session.user.id } },
      select: {
        id: true, title: true, description: true, modality: true,
        startAt: true, kitPickupAt: true, venueName: true, addressLine: true,
        city: true, state: true, maxParticipants: true, organizerContact: true,
        bannerUrl: true, listBannerUrl: true, regulationUrl: true, regulationText: true,
        cancellationDeadline: true, cancellationRequiresApproval: true,
        cancellationContactPhone: true, cancellationContactEmail: true,
        allowProxyRegistration: true,
      },
    }),
    getCancellationPolicyEnabled(),
  ]);

  if (!event) notFound();
```

(O restante do arquivo — o `return` com o JSX — não muda.)

- [ ] **Step 6: Adicionar o campo ao `EditEventForm.tsx`**

Estender o tipo `EventData` — adicionar logo depois de `cancellationContactEmail?: string | null;`:

```ts
  allowProxyRegistration?: boolean;
```

Estender o `schema` Zod — adicionar logo depois de `cancellationContactEmail:
z.string().optional(),`:

```ts
  allowProxyRegistration: z.boolean().optional(),
```

Estender `defaultValues` — adicionar logo depois de `cancellationContactEmail:
event.cancellationContactEmail ?? "",`:

```ts
      allowProxyRegistration: event.allowProxyRegistration ?? false,
```

Adicionar o novo checkbox no JSX, logo depois do bloco `<div>` do "Regulamento (texto)" e antes do
bloco `{cancellationPolicyEnabled && (...)}`:

```tsx
      <div className="border-t pt-5 dark:border-gray-700">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" {...register("allowProxyRegistration")} className="h-4 w-4" />
          Permitir inscrição por procuração (atleta inscrever outra pessoa)
        </label>
      </div>
```

(`onSubmit` já espalha `...data` no corpo do `PATCH`, então `allowProxyRegistration` é enviado
automaticamente — nenhuma linha extra necessária ali, mesmo padrão de `cancellationRequiresApproval`.)

- [ ] **Step 7: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam (nenhum teste cobre `page.tsx`/`EditEventForm.tsx` diretamente —
mudança de página/componente sem teste, mesma convenção do projeto)

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 8: Commit**

```bash
git add app/api/events/\[id\]/route.ts "app/organizador/eventos/[id]/editar/page.tsx" components/organizer/EditEventForm.tsx tests/event-update-route.test.ts
git commit -m "feat: toggle allowProxyRegistration na edicao de evento, admin consegue editar qualquer evento"
```

---

## Task 8: "Minhas inscrições" — mostrar procurações criadas pelo usuário

**Files:**
- Modify: `app/dashboard/inscricoes/page.tsx`

**Interfaces:** Nenhuma — página server component, sem teste automatizado (convenção já
estabelecida no projeto para páginas).

- [ ] **Step 1: Implementar**

Substituir o conteúdo inteiro de `app/dashboard/inscricoes/page.tsx` por:

```tsx
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import type { RegistrationStatus } from "@prisma/client";
import { BADGE } from "@/lib/badge-colors";

const STATUS_LABEL: Record<RegistrationStatus, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED:       { label: "Confirmada", color: BADGE.green },
  CANCELLED:       { label: "Cancelada", color: BADGE.red },
  TRANSFERRED:     { label: "Transferida", color: BADGE.blue },
  WAITLISTED:      { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
};

export default async function InscricoesPage() {
  const session = await requireAuth();

  const registrations = await db.registration.findMany({
    where: {
      OR: [
        { athleteUserId: session.user.id },
        { order: { buyerUserId: session.user.id } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      event: { select: { title: true, slug: true, startAt: true, city: true, state: true, bannerUrl: true } },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true, priceAmount: true } },
      order: { select: { status: true, totalAmount: true, buyerUserId: true } },
      athlete: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Minhas Inscrições</h1>
        <Link href="/eventos" className="btn-primary text-sm">+ Nova inscrição</Link>
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-4xl mb-4">🏁</p>
          <p className="text-gray-500 mb-4">Você não tem nenhuma inscrição ainda.</p>
          <Link href="/eventos" className="btn-primary">Explorar eventos</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {registrations.map((r) => {
            const badge = STATUS_LABEL[r.status];
            const createdByMeForOther = r.order.buyerUserId === session.user.id && r.athleteUserId !== session.user.id;
            return (
              <Link
                key={r.id}
                href={`/dashboard/inscricoes/${r.id}`}
                className="card block hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.color}`}>
                        {badge.label}
                      </span>
                      {createdByMeForOther && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                          Inscrito por você — {r.athlete.name}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{r.event.title}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
                      <span>📅 {formatDate(r.event.startAt)}</span>
                      <span>📍 {r.event.city}/{r.event.state}</span>
                      {r.route && <span>🏃 {r.route.name}</span>}
                      {r.category && <span>🏷️ {r.category.name}</span>}
                      {r.shirtSize && <span>👕 {r.shirtSize}</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Lote: {r.ticketBatch.name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-primary-600">{formatCurrency(r.order.totalAmount)}</p>
                    {r.bibNumber && (
                      <p className="text-xs text-gray-500 mt-1">Nº {r.bibNumber}</p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam (nenhum teste cobre esta página)

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 3: Commit**

```bash
git add "app/dashboard/inscricoes/page.tsx"
git commit -m "feat: mostrar inscricoes por procuracao em Minhas Inscricoes"
```

---

## Task 9: Frontend — modal + seletor no checkout

**Files:**
- Create: `components/checkout/ProxyAthleteModal.tsx`
- Modify: `components/checkout/CheckoutForm.tsx`
- Modify: `app/(public)/inscricao/[slug]/page.tsx`

**Interfaces:**
- Produces: `export interface ProxyAthleteData { name, birthDate, cpf, phone, email?, routeId?,
  categoryId?, emergencyContactName, emergencyContactPhone, shirtSize?, teamName?, medicalNotes?
  }` e `export default function ProxyAthleteModal({ open, routes, categories, onSave, onCancel })`
  — consumido só por `CheckoutForm.tsx`.

Sem teste automatizado (componentes client, sem infra de teste de componente React neste
projeto).

- [ ] **Step 1: Criar o modal**

Criar `components/checkout/ProxyAthleteModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

export interface ProxyAthleteData {
  name: string;
  birthDate: string;
  cpf: string;
  phone: string;
  email?: string;
  routeId?: string;
  categoryId?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  shirtSize?: string;
  teamName?: string;
  medicalNotes?: string;
}

export default function ProxyAthleteModal({
  open,
  routes,
  categories,
  onSave,
  onCancel,
}: {
  open: boolean;
  routes: { id: string; name: string; distanceKm: number }[];
  categories: { id: string; name: string }[];
  onSave: (data: ProxyAthleteData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<ProxyAthleteData>>({});
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function set<K extends keyof ProxyAthleteData>(field: K, value: ProxyAthleteData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    setError(null);
    if (!form.name || form.name.trim().length < 2) return setError("Informe o nome do atleta.");
    if (!form.birthDate) return setError("Informe a data de nascimento.");
    if (!form.cpf || !isValidCpf(form.cpf)) return setError("Informe um CPF válido.");
    if (!form.phone || form.phone.replace(/\D/g, "").length < 10) return setError("Informe um telefone válido.");
    if (routes.length > 0 && !form.routeId) return setError("Selecione um percurso.");
    if (categories.length > 0 && !form.categoryId) return setError("Selecione uma categoria.");
    if (!form.emergencyContactName) return setError("Informe o contato de emergência.");
    if (!form.emergencyContactPhone) return setError("Informe o telefone de emergência.");

    onSave({
      name: form.name.trim(),
      birthDate: form.birthDate,
      cpf: normalizeCpf(form.cpf),
      phone: form.phone,
      email: form.email?.trim() || undefined,
      routeId: form.routeId,
      categoryId: form.categoryId,
      emergencyContactName: form.emergencyContactName,
      emergencyContactPhone: form.emergencyContactPhone,
      shirtSize: form.shirtSize,
      teamName: form.teamName,
      medicalNotes: form.medicalNotes,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-8"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-lg mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Dados do atleta</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome completo *</label>
            <input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data de nascimento *</label>
            <input type="date" value={form.birthDate ?? ""} onChange={(e) => set("birthDate", e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF *</label>
            <input value={form.cpf ?? ""} onChange={(e) => set("cpf", e.target.value)} placeholder="000.000.000-00" maxLength={14} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone *</label>
            <input type="tel" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="(11) 99999-9999" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail</label>
            <input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="Opcional" className="input-field" />
          </div>

          {routes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Percurso *</label>
              <select value={form.routeId ?? ""} onChange={(e) => set("routeId", e.target.value)} className="input-field">
                <option value="">Selecione</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.distanceKm}km</option>)}
              </select>
            </div>
          )}
          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria *</label>
              <select value={form.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value)} className="input-field">
                <option value="">Selecione</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contato emergência *</label>
            <input value={form.emergencyContactName ?? ""} onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="Nome" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone emergência *</label>
            <input value={form.emergencyContactPhone ?? ""} onChange={(e) => set("emergencyContactPhone", e.target.value)} placeholder="(11) 99999-9999" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Camiseta</label>
            <select value={form.shirtSize ?? ""} onChange={(e) => set("shirtSize", e.target.value)} className="input-field">
              <option value="">Selecione</option>
              {["PP", "P", "M", "G", "GG", "XGG"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Equipe / Assessoria</label>
            <input value={form.teamName ?? ""} onChange={(e) => set("teamName", e.target.value)} placeholder="Opcional" className="input-field" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Informações médicas</label>
            <textarea value={form.medicalNotes ?? ""} onChange={(e) => set("medicalNotes", e.target.value)} className="input-field" rows={2} placeholder="Alergias, condições médicas..." />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancelar
          </button>
          <button type="button" onClick={handleSave} className="btn-primary text-sm">
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Passar `allowProxyRegistration` da página pro `CheckoutForm`**

Em `app/(public)/inscricao/[slug]/page.tsx`, no JSX do `<CheckoutForm ... />`, adicionar a prop
`allowProxyRegistration={event.allowProxyRegistration}` (o objeto `event` já vem de
`getEventBySlug`, que usa `include` sem `select` — o campo já está presente automaticamente, sem
mudança de query necessária):

```tsx
      <CheckoutForm
        event={event}
        batches={availableBatches}
        paymentMethods={paymentMethods}
        userId={session.user.id}
        athleteProfile={athleteProfile ?? undefined}
        platformFeePercent={event.platformFeePercent}
        defaultPlatformFee={defaultPlatformFee}
        serviceFeePercent={serviceFeePercent}
        serviceFeeMin={serviceFeeMin}
        appName={appName}
        allowProxyRegistration={event.allowProxyRegistration}
      />
```

- [ ] **Step 3: Integrar no `CheckoutForm.tsx`**

Adicionar o import do modal, logo abaixo dos imports já existentes:

```tsx
import ProxyAthleteModal, { type ProxyAthleteData } from "./ProxyAthleteModal";
```

Adicionar `allowProxyRegistration?: boolean;` à interface de props do componente (junto aos
outros campos opcionais como `serviceFeePercent`).

No corpo do componente, adicionar os 3 novos estados logo junto aos outros `useState` já
existentes:

```tsx
  const [proxyAthlete, setProxyAthlete] = useState<ProxyAthleteData | null>(null);
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [registeringFor, setRegisteringFor] = useState<"self" | "other">("self");
```

Adicionar o novo bloco de UI logo antes do `<div className="card">` do "Lote de inscrição"
(primeiro card do formulário), condicionado à prop:

```tsx
      {allowProxyRegistration && (
        <div className="card">
          <h3 className="font-semibold mb-3">Para quem é esta inscrição?</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 dark:border-gray-600">
              <input
                type="radio"
                checked={registeringFor === "self"}
                onChange={() => { setRegisteringFor("self"); setProxyAthlete(null); }}
                className="accent-primary-600"
              />
              Para mim
            </label>
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 dark:border-gray-600">
              <input
                type="radio"
                checked={registeringFor === "other"}
                onChange={() => { setRegisteringFor("other"); setProxyModalOpen(true); }}
                className="accent-primary-600"
              />
              Para outro atleta
            </label>
          </div>
          {proxyAthlete && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-primary-200 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-800 px-3 py-2 text-sm">
              <span>Inscrevendo: <strong>{proxyAthlete.name}</strong> — CPF {proxyAthlete.cpf}</span>
              <button type="button" onClick={() => setProxyModalOpen(true)} className="text-primary-600 underline text-xs">Editar</button>
            </div>
          )}
        </div>
      )}
      <ProxyAthleteModal
        open={proxyModalOpen}
        routes={event.routes}
        categories={event.categories}
        onSave={(saved) => {
          // ProxyAthleteData junta 2 tipos de campo num só formulário (UX de uma tela só): os de
          // IDENTIDADE (nome/nascimento/CPF/telefone/e-mail — viram o objeto proxyAthlete enviado
          // à API) e os DA INSCRIÇÃO em si (percurso/categoria/camiseta/equipe/contato de
          // emergência/observação médica — que já são campos do formulário principal, geridos
          // pelo mesmo react-hook-form de uma inscrição normal). Sem este setValue, os dados de
          // inscrição digitados no modal nunca chegariam no payload — o backend só entende
          // proxyAthlete como identidade (name/birthDate/cpf/phone/email), nada mais.
          setValue("routeId", saved.routeId ?? "", { shouldValidate: true });
          setValue("categoryId", saved.categoryId ?? "", { shouldValidate: true });
          setValue("shirtSize", (saved.shirtSize as FormData["shirtSize"]) ?? undefined);
          setValue("teamName", saved.teamName ?? "");
          setValue("emergencyContactName", saved.emergencyContactName, { shouldValidate: true });
          setValue("emergencyContactPhone", saved.emergencyContactPhone, { shouldValidate: true });
          setValue("medicalNotes", saved.medicalNotes ?? "");
          setProxyAthlete(saved);
          setProxyModalOpen(false);
        }}
        onCancel={() => { setProxyModalOpen(false); if (!proxyAthlete) setRegisteringFor("self"); }}
      />
```

No `onSubmit`, logo depois da checagem existente de categoria (`if (event.categories.length > 0
&& !emptyStringToUndefined(data.categoryId)) { ... }`), adicionar a checagem de procuração:

```tsx
    if (registeringFor === "other" && !proxyAthlete) {
      setError("Preencha os dados do atleta para quem você está se inscrevendo.");
      return;
    }
```

No objeto `payload` dentro do `onSubmit`, adicionar `proxyAthlete` condicionalmente — trocar:

```tsx
      const payload = {
        ...data,
        routeId: emptyStringToUndefined(data.routeId),
        categoryId: emptyStringToUndefined(data.categoryId),
        shirtSize: emptyStringToUndefined(data.shirtSize),
        couponCode: emptyStringToUndefined(data.couponCode)?.toString().trim().toUpperCase(),
        cpf: cpf || undefined,
        cardToken,
        cardBrand,
        installments,
      };
```

por (`proxyAthlete` do payload é sempre reconstruído só com o subconjunto de identidade — nunca
o objeto `ProxyAthleteData` inteiro, que também carrega os campos de inscrição já tratados acima
via `setValue` e que fluem por `...data` normalmente, iguais a uma inscrição própria):

```tsx
      const payload = {
        ...data,
        routeId: emptyStringToUndefined(data.routeId),
        categoryId: emptyStringToUndefined(data.categoryId),
        shirtSize: emptyStringToUndefined(data.shirtSize),
        couponCode: emptyStringToUndefined(data.couponCode)?.toString().trim().toUpperCase(),
        cpf: cpf || undefined,
        cardToken,
        cardBrand,
        installments,
        ...(proxyAthlete
          ? {
              proxyAthlete: {
                name: proxyAthlete.name,
                birthDate: proxyAthlete.birthDate,
                cpf: proxyAthlete.cpf,
                phone: proxyAthlete.phone,
                email: proxyAthlete.email,
              },
            }
          : {}),
      };
```

- [ ] **Step 4: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam (nenhum teste cobre estes componentes/páginas)

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 5: Commit**

```bash
git add components/checkout/ProxyAthleteModal.tsx components/checkout/CheckoutForm.tsx "app/(public)/inscricao/[slug]/page.tsx"
git commit -m "feat: modal e seletor de inscricao por procuracao no checkout"
```

---

## Revisão final (depois de todas as 9 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo, confirmar que nenhuma rota nova quebra a
  geração estática/dinâmica.
- [ ] Conferir manualmente (leitura de código, sem navegador — banco de dev local inacessível
  nesta sessão) que `lib/organizer/registrations.ts` e `app/api/events/[id]/registrations/route.ts`
  (exportação CSV) não precisaram de nenhuma mudança — ambos já leem `registration.athlete`,
  confirmado antes de escrever este plano.
