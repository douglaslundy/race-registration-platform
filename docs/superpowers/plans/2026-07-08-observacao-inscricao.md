# Campo "Observação" na Inscrição — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um campo de observação livre (opcional, máx. 200 caracteres) à inscrição, preenchido pelo atleta no checkout, e propagá-lo para a exportação CSV, o e-mail de confirmação (junto com o código do pedido) e o modal de dados da inscrição já existente.

**Architecture:** Um único campo escalar novo (`Registration.notes`) flui por três pontos de saída já existentes no código — a exportação CSV, `lib/notifications.ts::notifyOrderConfirmed` (único ponto que monta o e-mail de confirmação, usado por 7 call sites) e o modal `AthleteDetailsModal` (reaproveitado, sem criar um segundo modal). Nenhuma dessas saídas precisa de nova infraestrutura — é sempre "adicionar um campo a uma lista de campos que já existe".

**Tech Stack:** Next.js (App Router) + Prisma + PostgreSQL + Vitest. Sem biblioteca de testes de componente React — componentes de UI são verificados manualmente via `npm run dev`.

## Global Constraints

- O campo é **opcional** — nunca bloqueia o checkout.
- Máximo de **200 caracteres**, validado em zod (client e servidor). Sem constraint de tamanho no banco (mesmo padrão de `teamName`/`medicalNotes`).
- Não editável depois de criado — somente leitura em toda a UI de organizador/admin.
- "Exportação em XML" não existe no sistema — a exportação relevante é o CSV (`/api/events/[id]/registrations?format=csv`). Não criar um novo formato.
- O botão "ver dados da inscrição" é o `AthleteDetailsModal` já existente (botão "Ver dados do atleta") — não criar um segundo modal.
- **Dependência de ordem entre planos:** este plano assume que o plano `docs/superpowers/plans/2026-07-08-cancelamento-aprovacao-reembolso.md` (Task 12) **já foi aplicado** — ambos tocam `components/registrations/RegistrationsTable.tsx` e adicionam campos ao mesmo `RegistrationRow`/`registrationContext`. Execute os dois planos em sequência (cancelamento/reembolso primeiro, depois este), nunca em paralelo/worktrees isoladas para esses dois arquivos, para evitar conflito de merge.

---

### Task 1: Schema — `Registration.notes`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Registration.notes: string | null` no Prisma Client, disponível para as tasks seguintes.

- [ ] **Step 1: Adicionar o campo ao `model Registration`**

Em `prisma/schema.prisma`, logo abaixo de `medicalNotes String?` (linha ~317):

```prisma
model Registration {
  ...
  medicalNotes         String?
  notes                String?
  status               RegistrationStatus @default(PENDING_PAYMENT)
  ...
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `npx prisma migrate dev --name registration_notes`
Expected: cria uma nova pasta em `prisma/migrations/`, aplica no banco de desenvolvimento e regenera o Prisma Client sem erros.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add optional notes field to Registration"
```

---

### Task 2: `createCheckout` grava a observação

**Files:**
- Modify: `lib/checkout.ts`
- Test: `tests/unit/checkout-notes.test.ts`

**Interfaces:**
- Consumes: `Registration.notes` (Task 1).
- Produces: `CheckoutInput.notes?: string` — consumido pela Task 3.

- [ ] **Step 1: Escrever o teste (arquivo novo)**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("createCheckout notes handling", () => {
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
  };

  const createTx = () => ({
    ticketBatch: {
      findUnique: vi.fn().mockResolvedValue(ticketBatch),
      findMany: vi.fn().mockResolvedValue([ticketBatch]),
      update: vi.fn().mockResolvedValue({}),
    },
    event: {
      findUnique: vi.fn().mockResolvedValue(event),
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
    order: {
      create: vi.fn().mockResolvedValue({ id: "order-1" }),
    },
    registration: {
      create: vi.fn().mockResolvedValue({ id: "reg-1" }),
    },
  });

  it("grava a observação na inscrição criada", async () => {
    const tx = createTx();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "user-1",
      athleteUserId: "user-1",
      notes: "Chegarei um pouco atrasado na retirada do kit",
    });

    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: "Chegarei um pouco atrasado na retirada do kit" }),
      }),
    );
  });

  it("grava notes como undefined quando não informado", async () => {
    const tx = createTx();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "user-1",
      athleteUserId: "user-1",
    });

    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notes: undefined }) }),
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/checkout-notes.test.ts`
Expected: FAIL — `notes` ainda não é aceito por `CheckoutInput` nem gravado.

- [ ] **Step 3: Atualizar `lib/checkout.ts`**

Adicionar `notes?: string;` à interface `CheckoutInput` (logo abaixo de `medicalNotes?: string;`):

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
}
```

E adicionar `notes: input.notes,` à criação da `Registration` dentro de `createCheckout`:

```ts
    const registration = await tx.registration.create({
      data: {
        eventId: input.eventId,
        athleteUserId: input.athleteUserId,
        routeId: input.routeId,
        categoryId: input.categoryId,
        ticketBatchId: input.ticketBatchId,
        orderId: order.id,
        shirtSize: input.shirtSize,
        teamName: input.teamName,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        medicalNotes: input.medicalNotes,
        notes: input.notes,
        acceptedTermsAt: new Date(),
      },
    });
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/unit/checkout-notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte de checkout inteira (garantir que nada quebrou)**

Run: `npx vitest run tests/unit/checkout-coupon.test.ts tests/unit/checkout-notes.test.ts`
Expected: PASS em ambos.

- [ ] **Step 6: Commit**

```bash
git add lib/checkout.ts tests/unit/checkout-notes.test.ts
git commit -m "feat: persist optional registration notes in createCheckout"
```

---

### Task 3: Rota `/api/checkout` valida e repassa `notes`

**Files:**
- Modify: `app/api/checkout/route.ts:14-30,44-59`
- Test: `tests/checkout-route.test.ts`

**Interfaces:**
- Consumes: `CheckoutInput.notes` (Task 2).
- Produces: `POST /api/checkout` aceita `notes?: string` no corpo (máx. 200 caracteres) e repassa para `createCheckout`.

- [ ] **Step 1: Escrever o teste**

Adicionar a `tests/checkout-route.test.ts`, dentro do `describe("checkout api", ...)`:

```ts
  it("rejeita observação com mais de 200 caracteres", async () => {
    enabledMethodsMock.mockResolvedValue(["PIX"]);

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
          notes: "a".repeat(201),
        }),
      }) as any,
    );

    expect(res.status).toBe(400);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("repassa a observação para createCheckout quando dentro do limite", async () => {
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
          notes: "Chegarei atrasado",
        }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({ notes: "Chegarei atrasado" }));
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/checkout-route.test.ts`
Expected: FAIL — `notes` ainda não existe no schema zod da rota, então o segundo teste falha (`createCheckout` não recebe `notes`) e o primeiro teste falha porque nada rejeita 201 caracteres (a rota devolve 200/outro erro, não 400 por causa do tamanho).

- [ ] **Step 3: Atualizar `app/api/checkout/route.ts`**

Adicionar `notes: z.string().max(200).optional(),` ao `checkoutSchema` (logo abaixo de `medicalNotes`):

```ts
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
});
```

`notes` já é repassado automaticamente para `createCheckout` — o handler espalha `...checkoutData` (que inclui todo campo de `checkoutSchema` exceto `paymentMethod`, `cpf`, `cardToken`, `cardBrand`, `installments`, já desestruturados à parte), então nenhuma outra mudança é necessária nesse arquivo.

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/checkout-route.test.ts`
Expected: PASS em todos os testes do arquivo.

- [ ] **Step 5: Commit**

```bash
git add app/api/checkout/route.ts tests/checkout-route.test.ts
git commit -m "feat: accept and validate optional notes field in checkout API"
```

---

### Task 4: Campo de observação no formulário de checkout

**Files:**
- Modify: `components/checkout/CheckoutForm.tsx`

**Interfaces:**
- Consumes: `POST /api/checkout` aceitando `notes` (Task 3).

- [ ] **Step 1: Adicionar `notes` ao schema zod do formulário**

Em `components/checkout/CheckoutForm.tsx`, no `schema` (linha ~20), logo abaixo de `medicalNotes`:

```ts
const schema = z.object({
  ticketBatchId: opaqueIdField(),
  routeId: optionalOpaqueIdField(),
  categoryId: optionalOpaqueIdField(),
  shirtSize: optionalEnumField(["PP", "P", "M", "G", "GG", "XGG"] as const),
  teamName: z.string().max(100).optional(),
  emergencyContactName: z.string().min(2, "Informe o contato de emergência"),
  emergencyContactPhone: z.string().min(8, "Telefone inválido"),
  medicalNotes: z.string().max(500).optional(),
  notes: z.string().max(200, "Máximo de 200 caracteres").optional(),
  couponCode: z.string().optional(),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Aceite os termos para continuar" }) }),
});
```

- [ ] **Step 2: Renderizar o campo, com contador de caracteres, logo após "Informações médicas"**

No JSX (linha ~445-448), logo depois do `<textarea {...register("medicalNotes")} ... />`:

```tsx
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Informações médicas</label>
          <textarea {...register("medicalNotes")} className="input-field" rows={2} placeholder="Alergias, condições médicas..." />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observação (opcional)</label>
          <textarea
            {...register("notes")}
            className="input-field"
            rows={2}
            maxLength={200}
            placeholder="Alguma informação adicional para o organizador?"
          />
          <p className="text-xs text-gray-400 mt-1 text-right">{(watch("notes") ?? "").length}/200</p>
          {errors.notes && <p className="text-red-500 text-xs mt-1">{errors.notes.message}</p>}
        </div>
```

- [ ] **Step 3: Incluir `notes` na lista de prioridade de erro de validação**

Em `getFirstValidationError` (linha ~203), adicionar `"notes"` ao array `orderedKeys` (posição não importa muito — colocar perto de `"medicalNotes"`):

```ts
    const orderedKeys = [
      "ticketBatchId",
      "paymentMethod",
      "acceptTerms",
      "emergencyContactName",
      "emergencyContactPhone",
      "routeId",
      "categoryId",
      "shirtSize",
      "couponCode",
      "teamName",
      "medicalNotes",
      "notes",
    ];
```

- [ ] **Step 4: Verificar a compilação TypeScript**

Run: `npx tsc --noEmit`
Expected: sem erros — `notes` já é aceito pelo `payload` enviado a `/api/checkout` porque o handler faz `{ ...data, ... }` (espalha todos os campos do form, incluindo `notes`).

- [ ] **Step 5: Verificação manual**

Run: `npm run dev`, iniciar uma inscrição em `/eventos/[slug]/inscricao` (ou fluxo equivalente de checkout).
Expected: campo "Observação (opcional)" aparece, com contador de caracteres indo até 200/200 e bloqueando digitação além disso (`maxLength={200}` no HTML); enviar o formulário com e sem observação preenchida funciona nos dois casos.

- [ ] **Step 6: Commit**

```bash
git add components/checkout/CheckoutForm.tsx
git commit -m "feat: add optional notes field to checkout form"
```

---

### Task 5: Coluna "Observação" na exportação CSV

**Files:**
- Modify: `app/api/events/[id]/registrations/route.ts`
- Test: `tests/events-registrations-export-route.test.ts`

**Interfaces:** nenhuma nova — consome `Registration.notes` (Task 1), que já vem no resultado de `db.registration.findMany` sem mudança de query (o `include` atual já traz todos os campos escalares).

- [ ] **Step 1: Atualizar o teste existente**

Em `tests/events-registrations-export-route.test.ts`, no primeiro teste (`"inclui a coluna CPF..."`), adicionar `notes: "Chegarei atrasado",` ao objeto da fixture e atualizar as duas asserções:

```ts
  it("inclui a coluna CPF e Observação no cabeçalho e os valores nas linhas", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        athlete: { name: "Ana Silva", email: "ana@example.com", athleteProfile: { cpf: "11144477735" } },
        route: { name: "10km" },
        category: null,
        ticketBatch: { name: "Lote 1", priceAmount: 5000 },
        shirtSize: "M",
        teamName: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: "Chegarei atrasado",
        status: "CONFIRMED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const csv = await res.text();

    expect(csv.split("\n")[0]).toBe(
      "Nome,Email,CPF,Percurso,Categoria,Lote,Camisa,Equipe,Contato de Emergência,Telefone de Emergência,Observação,Status,Data",
    );
    expect(csv).toContain('"Ana Silva","ana@example.com","11144477735",');
    expect(csv).toContain('"Chegarei atrasado","CONFIRMED"');
  });
```

No segundo teste (`"usa string vazia quando o atleta ainda não tem CPF..."`), adicionar `notes: null,` à fixture (sem mudar as asserções existentes, já que elas não checam a coluna nova).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/events-registrations-export-route.test.ts`
Expected: FAIL — o cabeçalho e as linhas do CSV ainda não têm a coluna "Observação".

- [ ] **Step 3: Atualizar `app/api/events/[id]/registrations/route.ts`**

```ts
  if (format === "csv") {
    const header = "Nome,Email,CPF,Percurso,Categoria,Lote,Camisa,Equipe,Contato de Emergência,Telefone de Emergência,Observação,Status,Data\n";
    const rows = registrations.map((r) =>
      [
        r.athlete.name,
        r.athlete.email,
        r.athlete.athleteProfile?.cpf ?? "",
        r.route?.name ?? "",
        r.category?.name ?? "",
        r.ticketBatch.name,
        r.shirtSize ?? "",
        r.teamName ?? "",
        r.emergencyContactName ?? "",
        r.emergencyContactPhone ?? "",
        r.notes ?? "",
        r.status,
        r.createdAt.toISOString(),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/events-registrations-export-route.test.ts`
Expected: PASS em ambos os testes.

- [ ] **Step 5: Commit**

```bash
git add app/api/events/\[id\]/registrations/route.ts tests/events-registrations-export-route.test.ts
git commit -m "feat: include registration notes column in CSV export"
```

---

### Task 6: Código do pedido e observação no e-mail de confirmação

**Files:**
- Modify: `lib/email.ts:60-81`
- Modify: `lib/notifications.ts:10-37`
- Test: `tests/notifications.test.ts`

**Interfaces:**
- Produces: `sendRegistrationConfirmationEmail(params: { to: string; name: string; registrationId: string; orderId: string; eventTitle?: string; notes?: string }): Promise<void>` — assinatura estendida, usada apenas por `notifyOrderConfirmed`.

- [ ] **Step 1: Atualizar o teste**

Em `tests/notifications.test.ts`, atualizar a fixture e o primeiro teste:

```ts
const orderFixture = {
  buyer: { name: "Atleta Teste", email: "atleta@example.com" },
  event: { title: "Corrida Teste" },
  registrations: [{ id: "reg-1", notes: "Chegarei atrasado" }],
};

describe("notifyOrderConfirmed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("envia o e-mail com o código do pedido e a observação, e grava confirmationEmailSentAt", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "atleta@example.com",
        registrationId: "reg-1",
        orderId: "order-1",
        notes: "Chegarei atrasado",
      }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { confirmationEmailSentAt: expect.any(Date) },
    });
  });

  it("envia notes como undefined quando a inscrição não tem observação", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...orderFixture,
      registrations: [{ id: "reg-1", notes: null }],
    });

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ notes: undefined }),
    );
  });
```

(Os demais testes do arquivo — SMTP não configurado, sem inscrições, envio falha — continuam iguais, sem mudança.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/notifications.test.ts`
Expected: FAIL nos dois novos testes — `notifyOrderConfirmed` ainda não busca/repassa `orderId`/`notes`.

- [ ] **Step 3: Atualizar `lib/email.ts::sendRegistrationConfirmationEmail`**

```ts
/** E-mail de confirmação de inscrição (enviado quando o pagamento é confirmado). */
export async function sendRegistrationConfirmationEmail(params: {
  to: string;
  name: string;
  registrationId: string;
  orderId: string;
  eventTitle?: string;
  notes?: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/dashboard/inscricoes/${params.registrationId}`;
  await sendMail({
    to: params.to,
    subject: `Inscrição confirmada${params.eventTitle ? ` — ${params.eventTitle}` : ""} 🏅`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p>Sua inscrição${params.eventTitle ? ` em <strong>${params.eventTitle}</strong>` : ""} foi <strong>confirmada</strong> com sucesso! 🎉</p>
       <p>O pagamento foi aprovado e sua vaga está garantida.</p>
       <p>Código do pedido: <strong>${params.orderId}</strong></p>
       ${params.notes ? `<p>Observação registrada: ${params.notes}</p>` : ""}
       <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver detalhes da inscrição</a></p>`
    ),
  });
}
```

- [ ] **Step 4: Atualizar `lib/notifications.ts::notifyOrderConfirmed`**

```ts
export async function notifyOrderConfirmed(orderId: string): Promise<void> {
  try {
    const cfg = await getSmtpConfig();
    if (!isSmtpReady(cfg)) return;

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        buyer: { select: { name: true, email: true } },
        event: { select: { title: true } },
        registrations: { select: { id: true, notes: true }, take: 1 },
      },
    });

    if (!order?.buyer || order.registrations.length === 0) return;

    await sendRegistrationConfirmationEmail({
      to: order.buyer.email,
      name: order.buyer.name,
      registrationId: order.registrations[0].id,
      orderId,
      eventTitle: order.event?.title,
      notes: order.registrations[0].notes ?? undefined,
    });

    await db.order.update({ where: { id: orderId }, data: { confirmationEmailSentAt: new Date() } });
  } catch (err) {
    console.error("[notifyOrderConfirmed] failed:", err);
  }
}
```

- [ ] **Step 5: Rodar de novo e confirmar que passa**

Run: `npx vitest run tests/notifications.test.ts`
Expected: PASS em todos os testes do arquivo.

- [ ] **Step 6: Rodar a suíte inteira (7 call sites de `notifyOrderConfirmed` não mudam de assinatura, mas vale confirmar)**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 7: Commit**

```bash
git add lib/email.ts lib/notifications.ts tests/notifications.test.ts
git commit -m "feat: include order code and notes in registration confirmation email"
```

---

### Task 7: Expandir o modal "Ver dados do atleta" com os dados da inscrição

**Files:**
- Modify: `components/registrations/RegistrationsTable.tsx`
- Modify: `components/registrations/AthleteDetailsModal.tsx`

**Interfaces:**
- Produces: `RegistrationContextData` (em `AthleteDetailsModal.tsx`) ganha os campos `status`, `createdAt`, `routeName`, `categoryName`, `ticketBatchName`, `shirtSize`, `teamName`, `orderId`, `notes` — nenhuma outra task depende disso.

- [ ] **Step 1: Exportar o mapa de labels de status em `RegistrationsTable.tsx`**

Trocar (linha 6):

```ts
const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
```

por:

```ts
export const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
```

- [ ] **Step 2: Adicionar `teamName` e `notes` ao `RegistrationRow` e ao `registrationContext` passado ao modal**

Pela dependência de ordem declarada em Global Constraints, `RegistrationRow` já deve conter `cancellationReason: string | null;` e `cancellationRequestedAt: Date | null;` (adicionados pelo plano de cancelamento/reembolso, Task 12). Adicionar agora, logo abaixo de `medicalNotes: string | null;`:

```ts
  teamName: string | null;
  notes: string | null;
```

No JSX, atualizar a chamada de `AthleteDetailsModal` para passar o contexto completo:

```tsx
                  <AthleteDetailsModal
                    athleteName={r.athlete.name}
                    athleteEmail={r.athlete.email}
                    profile={r.athlete.athleteProfile}
                    editEndpoint={editEndpoint?.(r)}
                    registrationContext={{
                      status: r.status,
                      createdAt: r.createdAt,
                      routeName: r.route?.name ?? null,
                      categoryName: r.category?.name ?? null,
                      ticketBatchName: r.ticketBatch.name,
                      shirtSize: r.shirtSize,
                      teamName: r.teamName,
                      orderId: r.order.id,
                      emergencyContactName: r.emergencyContactName,
                      emergencyContactPhone: r.emergencyContactPhone,
                      medicalNotes: r.medicalNotes,
                      notes: r.notes,
                    }}
                  />
```

- [ ] **Step 3: Atualizar `RegistrationContextData` e a renderização em `AthleteDetailsModal.tsx`**

Trocar a interface (linha 30):

```ts
interface RegistrationContextData {
  status: string;
  createdAt: Date | string;
  routeName: string | null;
  categoryName: string | null;
  ticketBatchName: string;
  shirtSize: string | null;
  teamName: string | null;
  orderId: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
  notes: string | null;
}
```

Adicionar o import do mapa de labels:

```ts
import { REGISTRATION_STATUS } from "@/components/registrations/RegistrationsTable";
```

Substituir o bloco `{registrationContext && (...)}` (linhas 216-242) por:

```tsx
                {registrationContext && (
                  <div className="mt-4">
                    <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                      Dados desta inscrição
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-gray-500">Status</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {REGISTRATION_STATUS[registrationContext.status]?.label ?? registrationContext.status}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Data da inscrição</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {formatDate(registrationContext.createdAt, "dd/MM/yyyy HH:mm")}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Percurso</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.routeName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Categoria</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.categoryName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Lote</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.ticketBatchName}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Camiseta</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.shirtSize ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Equipe</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.teamName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Nº do pedido</dt>
                        <dd className="text-gray-800 dark:text-gray-200 font-mono">{registrationContext.orderId}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Contato de emergência</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.emergencyContactName ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Telefone de emergência</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.emergencyContactPhone ?? "—"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-gray-500">Observações médicas</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.medicalNotes ?? "—"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-gray-500">Observação</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{registrationContext.notes ?? "—"}</dd>
                      </div>
                    </dl>
                  </div>
                )}
```

- [ ] **Step 4: Verificar a compilação TypeScript**

Run: `npx tsc --noEmit`
Expected: sem erros — `teamName`, `notes`, `status`, `createdAt`, `route`, `category`, `ticketBatch`, `order.id` já vêm no resultado do Prisma nas duas páginas de inscritos (organizador e admin), que usam `include` (não `select` restritivo) — só faltava declará-los e usá-los.

- [ ] **Step 5: Verificação manual**

Run: `npm run dev`. Em `/organizador/eventos/[id]/inscritos`, clicar em "Ver dados do atleta" de uma inscrição com observação preenchida.
Expected: a seção "Dados desta inscrição" mostra status, data, percurso, categoria, lote, camiseta, equipe, número do pedido, contato de emergência, observações médicas e a nova "Observação", todos somente leitura.

- [ ] **Step 6: Commit**

```bash
git add components/registrations/RegistrationsTable.tsx components/registrations/AthleteDetailsModal.tsx
git commit -m "feat: show full registration details including notes in athlete modal"
```

---

### Task 8: Verificação final

**Files:** nenhum (apenas validação)

- [ ] **Step 1: Rodar a suíte completa de testes**

Run: `npm test`
Expected: todos os testes passam, incluindo os arquivos novos/alterados nas Tasks 2, 3, 5 e 6.

- [ ] **Step 2: Rodar o lint e o type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Roteiro manual ponta a ponta**

Run: `npm run dev`.
1. Fazer uma inscrição de teste em um evento, preenchendo "Observação" com um texto qualquer.
2. Confirmar o pagamento (sandbox) e verificar que o e-mail de confirmação (se SMTP configurado) contém o código do pedido e a observação.
3. Como organizador, exportar o CSV do evento (`/organizador/eventos/[id]/inscritos` → "Exportar CSV") e conferir a coluna "Observação".
4. Na mesma página, clicar em "Ver dados do atleta" da inscrição e conferir que a observação e os demais dados da inscrição aparecem na seção "Dados desta inscrição".

- [ ] **Step 4: Commit final (se o roteiro manual revelar ajustes)**

Se qualquer passo expuser um bug, corrija, adicione/ajuste o teste automatizado correspondente na task de origem, e commit separadamente.
