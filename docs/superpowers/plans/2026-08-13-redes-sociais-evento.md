# Redes sociais com limite de envio, por evento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizador cadastra redes sociais por evento (rede + link + mensagem + limite
de envios por pessoa + ativa/inativa); a plataforma inclui isso automaticamente — via uma
variável de template, `{{redes_sociais}}` — nas 3 mensagens que já manda pro comprador/
atleta sobre um evento (confirmação de inscrição, carrinho abandonado, erro de
pagamento), respeitando o limite configurado.

**Architecture:** Dois models novos (`EventSocialLink`, `SocialLinkSend`). Um helper puro
`getSocialPromoText(eventId, userId)` decide, a cada chamada, quais redes ainda têm
limite disponível pra aquele usuário, monta o texto e incrementa a contagem numa
transação atômica. O valor entra no pipeline de templates já existente (mesmo mecanismo
usado por `{{link_patrocinio}}`) — os 3 fluxos de envio (`notifications.ts`,
`abandoned-cart.ts`, `payment-error.ts`) passam a calcular esse valor e acrescentá-lo aos
objetos `values` que já montam hoje. Cadastro via uma tela CRUD nova (organizador),
espelhando o padrão já usado por `/cupons`.

**Tech Stack:** Next.js App Router, Prisma (Postgres), Vitest, React (client component).

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-13-redes-sociais-evento-design.md`.
- **O banco local aponta para produção** — nenhuma task deste plano executa `prisma migrate dev`, `prisma db push`, ou qualquer comando que toque o banco. A migration é escrita à mão; aplicá-la em produção acontece fora deste plano, com confirmação explícita do usuário. `npx prisma generate` é seguro e necessário rodar localmente após a Task 1.
- **`/prisma/migrations/` está no `.gitignore`** — o commit da Task 1 precisa de `git add -f` pra migration.sql, e verificação depois (`git show --stat` + `git ls-files`) que ela foi de fato versionada. Essa pegadinha já mordeu duas features anteriores neste projeto.
- **Toda variável de template nova precisa de DUAS edições, não uma**: acrescentar o nome ao array `variables` do(s) alerta(s) em `lib/templates/registry.ts` E acrescentar a entrada correspondente em `ALL_VARIABLES`, em `lib/templates/variables.ts`. A revisão final da feature anterior (`link_patrocinio`) pegou exatamente esse esquecimento — `tests/templates-registry.test.ts` falha se as duas não estiverem em sincronia.
- `{{redes_sociais}}` só nos alertas `ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER`, `ORDER_CONFIRMED_PROXY_ATHLETE`, `ABANDONED_CART`, `PAYMENT_ERROR`, `PAYMENT_ERROR_ORDER_CANCELLED` — os únicos 3 fluxos (6 alertKeys) que o comprador/atleta recebe sobre um evento hoje.
- O limite é "primeiras N mensagens recebem a promoção" — nunca throw, nunca deixa `{{redes_sociais}}` literal na mensagem enviada (resolve pra `""` quando não há link ativo ou nenhum link "passou" no limite).
- Contagem por `athleteUserId` na confirmação de inscrição; por `buyerUserId` no carrinho abandonado e erro de pagamento (não existe inscrição confirmada nesses dois pontos do fluxo).

---

### Task 1: Schema — `EventSocialLink` + `SocialLinkSend` + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260813010000_add_event_social_links/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `EventSocialLink` e `SocialLinkSend` no Prisma Client, consumidos pelas Tasks 2, 5 e 6.

- [ ] **Step 1: Adicionar os models no schema**

Em `prisma/schema.prisma`, logo após o `model Coupon { ... }` existente, acrescentar:

```prisma
model EventSocialLink {
  id        String   @id @default(cuid())
  eventId   String
  platform  String                          // texto livre digitado pelo organizador (ex.: "Instagram", "Strava")
  url       String
  message   String   @db.Text
  active    Boolean  @default(true)
  maxSends  Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  event Event            @relation(fields: [eventId], references: [id], onDelete: Cascade)
  sends SocialLinkSend[]

  @@index([eventId])
  @@map("event_social_links")
}

model SocialLinkSend {
  id                String   @id @default(cuid())
  eventSocialLinkId String
  userId            String
  count             Int      @default(0)
  updatedAt         DateTime @updatedAt

  eventSocialLink EventSocialLink @relation(fields: [eventSocialLinkId], references: [id], onDelete: Cascade)

  @@unique([eventSocialLinkId, userId])
  @@map("social_link_sends")
}
```

No `model Event`, acrescentar a relação nova logo após `coupons Coupon[]`:

```prisma
  coupons       Coupon[]
  socialLinks   EventSocialLink[]
```

- [ ] **Step 2: Escrever a migration à mão**

Criar `prisma/migrations/20260813010000_add_event_social_links/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "event_social_links" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxSends" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_link_sends" (
    "id" TEXT NOT NULL,
    "eventSocialLinkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_link_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_social_links_eventId_idx" ON "event_social_links"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "social_link_sends_eventSocialLinkId_userId_key" ON "social_link_sends"("eventSocialLinkId", "userId");

-- AddForeignKey
ALTER TABLE "event_social_links" ADD CONSTRAINT "event_social_links_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_link_sends" ADD CONSTRAINT "social_link_sends_eventSocialLinkId_fkey" FOREIGN KEY ("eventSocialLinkId") REFERENCES "event_social_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Não rodar `prisma migrate dev`/`db push`/qualquer comando que conecte no banco — o
arquivo é só texto.

- [ ] **Step 3: Regenerar o Prisma Client (seguro, não toca no banco)**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client ... to ./node_modules/@prisma/client`, sem erros.

- [ ] **Step 4: Confirmar que o projeto ainda compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit (com `git add -f` pra migration)**

```bash
git add prisma/schema.prisma
git add -f prisma/migrations/20260813010000_add_event_social_links/migration.sql
git commit -m "feat: schema das redes sociais por evento (EventSocialLink, SocialLinkSend)"
```

Depois do commit, verificar que a migration foi de fato versionada:

```bash
git show --stat HEAD
git ls-files prisma/migrations/20260813010000_add_event_social_links/
```

Ambos precisam listar `migration.sql` — se não listarem, o `git add -f` falhou e o
arquivo não foi commitado.

---

### Task 2: Helper `getSocialPromoText`

**Files:**
- Create: `lib/social-links.ts`
- Test: `tests/lib-social-links.test.ts`

**Interfaces:**
- Consumes: `EventSocialLink`/`SocialLinkSend` do Prisma Client (Task 1).
- Produces: `export async function getSocialPromoText(eventId: string, userId: string): Promise<string>`, consumido pela Task 4.

- [ ] **Step 1: Write the failing tests**

Criar `tests/lib-social-links.test.ts`, seguindo o padrão de mock de
`db as any` já usado noutros testes de lib (ex.: `tests/unit/checkout-notes.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSocialPromoText } from "@/lib/social-links";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("getSocialPromoText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna string vazia quando não há links ativos", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([]);

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("");
  });

  it("inclui um link ainda dentro do limite e incrementa a contagem", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue a gente no Instagram!", url: "https://instagram.com/corrida", maxSends: 2 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValueOnce({ count: 1 }),
        upsert: vi.fn().mockResolvedValueOnce({}),
      },
    };
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("Segue a gente no Instagram! https://instagram.com/corrida");
    expect(tx.socialLinkSend.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventSocialLinkId_userId: { eventSocialLinkId: "link-1", userId: "user-1" } },
        create: { eventSocialLinkId: "link-1", userId: "user-1", count: 1 },
        update: { count: { increment: 1 } },
      }),
    );
  });

  it("pula um link que já bateu o limite, sem incrementar", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue no Insta!", url: "https://instagram.com/corrida", maxSends: 2 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValueOnce({ count: 2 }),
        upsert: vi.fn(),
      },
    };
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("");
    expect(tx.socialLinkSend.upsert).not.toHaveBeenCalled();
  });

  it("concatena vários links que ainda estão dentro do limite, um por linha", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue no Insta!", url: "https://instagram.com/corrida", maxSends: 5 },
      { id: "link-2", message: "Bora no Strava!", url: "https://strava.com/routes/1", maxSends: 5 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    dbMock.$transaction.mockImplementation(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("Segue no Insta! https://instagram.com/corrida\nBora no Strava! https://strava.com/routes/1");
  });

  it("busca só links ativos do evento", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([]);

    await getSocialPromoText("event-1", "user-1");

    expect(dbMock.eventSocialLink.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1", active: true },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib-social-links.test.ts`
Expected: FAIL — `Cannot find module '@/lib/social-links'` (ou erro de import equivalente).

- [ ] **Step 3: Implementar o helper**

Criar `lib/social-links.ts`:

```ts
import { db } from "./db";

export async function getSocialPromoText(eventId: string, userId: string): Promise<string> {
  const links = await db.eventSocialLink.findMany({
    where: { eventId, active: true },
  });
  if (links.length === 0) return "";

  const parts: string[] = [];
  for (const link of links) {
    const included = await claimSocialLinkSend(link.id, userId, link.maxSends);
    if (included) parts.push(`${link.message} ${link.url}`);
  }
  return parts.join("\n");
}

async function claimSocialLinkSend(eventSocialLinkId: string, userId: string, maxSends: number): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const existing = await tx.socialLinkSend.findUnique({
      where: { eventSocialLinkId_userId: { eventSocialLinkId, userId } },
    });
    const currentCount = existing?.count ?? 0;
    if (currentCount >= maxSends) return false;

    await tx.socialLinkSend.upsert({
      where: { eventSocialLinkId_userId: { eventSocialLinkId, userId } },
      create: { eventSocialLinkId, userId, count: 1 },
      update: { count: { increment: 1 } },
    });
    return true;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib-social-links.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add lib/social-links.ts tests/lib-social-links.test.ts
git commit -m "feat: helper getSocialPromoText com limite de envio por pessoa"
```

---

### Task 3: Variável de template `{{redes_sociais}}`

**Files:**
- Modify: `lib/templates/registry.ts`
- Modify: `lib/templates/variables.ts`
- Test: `tests/templates-registry.test.ts` (só rodar, não precisa editar — é o teste de
  sincronia entre os dois arquivos acima)

**Interfaces:**
- Consumes: nada.
- Produces: `"redes_sociais"` disponível nos 6 alertKeys listados, consumido pela Task 4.

- [ ] **Step 1: Acrescentar a variável nos 6 alertas**

Em `lib/templates/registry.ts`, acrescentar `"redes_sociais"` ao array `variables` de
`ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER`, `ORDER_CONFIRMED_PROXY_ATHLETE`
(já têm `"link_patrocinio"` da etapa anterior — acrescentar `"redes_sociais"` também),
`ABANDONED_CART`, `PAYMENT_ERROR` e `PAYMENT_ERROR_ORDER_CANCELLED`. Exemplo (mesmo
padrão nas outras 5):

```ts
  ABANDONED_CART: {
    alertKey: "ABANDONED_CART",
    description: "Carrinho abandonado — avisa o comprador quando um pedido fica pendente além do limite configurado.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["BUYER"],
    variables: ["nome_atleta", "nome_evento", "link_finalizar_pagamento", "redes_sociais"],
    ...
```

Não mexer em nenhum `factoryDefault` — a variável fica só disponível, não é forçada no
texto padrão de fábrica de nenhum alerta.

- [ ] **Step 2: Acrescentar a entrada no catálogo `ALL_VARIABLES`**

Em `lib/templates/variables.ts`, na mesma seção/categoria de `link_patrocinio` (bloco
"Evento"), acrescentar logo depois:

```ts
  { name: "redes_sociais", label: "Redes sociais", category: "Evento", description: "Promoções de redes sociais cadastradas no evento, respeitando o limite de envios por pessoa. Pode ser vazio. Disponível nos alertas de confirmação, carrinho abandonado e erro de pagamento.", sample: "Segue a gente no Instagram! https://instagram.com/corrida" },
```

(Confira o nome exato do campo de categoria/etc. lendo o arquivo antes de editar — usar
exatamente a mesma forma da entrada de `link_patrocinio`, já existente.)

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/templates-registry.test.ts tests/templates-variables.test.ts`
Expected: PASS — o teste de sincronia (`toda entrada só declara variáveis que existem no
catálogo geral`) precisa passar já nesta task, não só descoberto na revisão final.

- [ ] **Step 4: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add lib/templates/registry.ts lib/templates/variables.ts
git commit -m "feat: variavel redes_sociais nos templates de confirmacao/carrinho/erro de pagamento"
```

---

### Task 4: Wiring — resolver `redes_sociais` nos 3 fluxos de envio

**Files:**
- Modify: `lib/notifications.ts`
- Modify: `lib/alerts/abandoned-cart.ts`
- Modify: `lib/alerts/payment-error.ts`
- Modify: `lib/email.ts`
- Test: `tests/lib-email.test.ts`, `tests/alert-abandoned-cart.test.ts`, `tests/alert-payment-error.test.ts`

**Interfaces:**
- Consumes: `getSocialPromoText` (Task 2); `"redes_sociais"` disponível nos alertas (Task 3).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: `lib/email.ts` — acrescentar o parâmetro nos 3 e-mails relevantes**

`sendRegistrationConfirmationEmail`, `sendAbandonedCartEmail` e `sendPaymentErrorEmail`
ganham um parâmetro `socialPromo?: string` cada, e `redes_sociais: params.socialPromo ??
""` no respectivo objeto `values`. Exemplo pra `sendAbandonedCartEmail`:

```ts
export async function sendAbandonedCartEmail(params: {
  to: string;
  name: string;
  eventTitle: string;
  orderId: string;
  eventId?: string;
  socialPromo?: string;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const values = {
    nome_atleta: params.name,
    nome_evento: params.eventTitle,
    link_finalizar_pagamento: `${baseUrl}/dashboard/inscricoes`,
    redes_sociais: params.socialPromo ?? "",
  };
  ...
```

Mesma mudança em `sendPaymentErrorEmail` (acrescentar `socialPromo?: string` aos
`params`, `redes_sociais: params.socialPromo ?? ""` aos `values`) e em
`sendRegistrationConfirmationEmail` (que já ganhou `sponsorLink` na etapa anterior —
acrescentar `socialPromo?: string | null` ao lado, e `redes_sociais: params.socialPromo
?? ""` ao objeto `values` que já tem `link_patrocinio`).

- [ ] **Step 2: `lib/notifications.ts` — `notifyOrderConfirmed`**

No `select` de `order` (dentro de `db.order.findUnique`), a `registration` já traz
`athleteUserId: true` — nada a acrescentar aí. Antes de cada chamada de e-mail/WhatsApp
(comprador e, se por procuração, atleta), calcular a promoção:

```ts
    const buyerSocialPromo = await getSocialPromoText(order.event?.id ?? "", registration.athleteUserId);
```

(Um cálculo só por destinatário, reaproveitado tanto no e-mail quanto no WhatsApp
daquele mesmo destinatário — não chamar `getSocialPromoText` duas vezes pro mesmo
usuário na mesma execução, senão a contagem seria incrementada duas vezes pra uma única
notificação lógica.)

Passar `socialPromo: buyerSocialPromo` pra `sendRegistrationConfirmationEmail`
(comprador) e acrescentar `redes_sociais: buyerSocialPromo` aos `values` já passados pra
`sendWhatsAppIfActive` (comprador).

Repetir o padrão pro bloco do atleta (inscrição por procuração): calcular
`athleteSocialPromo` (mesmo `registration.athleteUserId` — é o mesmo usuário-alvo, então
na prática dá o mesmo resultado do `buyerSocialPromo` já calculado acima; reaproveitar a
mesma variável em vez de chamar `getSocialPromoText` de novo, evitando duplo incremento),
usar nos dois call sites do atleta (e-mail e WhatsApp).

Importar no topo do arquivo:

```ts
import { getSocialPromoText } from "@/lib/social-links";
```

- [ ] **Step 3: `lib/alerts/abandoned-cart.ts`**

Dentro de `sendAbandonedCartAlert`, antes dos blocos de e-mail/WhatsApp, calcular uma vez:

```ts
  const socialPromo = await getSocialPromoText(order.event.id, order.buyerUserId);
```

Passar `socialPromo` pra `sendAbandonedCartEmail` (acrescentar ao objeto já passado) e
acrescentar `redes_sociais: socialPromo` ao objeto `values` já passado pra
`renderTemplate` no bloco de WhatsApp.

Importar `getSocialPromoText` de `@/lib/social-links` no topo do arquivo.

- [ ] **Step 4: `lib/alerts/payment-error.ts`**

`CancellationNotificationTarget` (a interface) precisa de `buyerUserId: string` — hoje só
tem `buyer: {...}`, sem o id. Acrescentar o campo à interface, e `buyerUserId: true` ao
`select` de `buyer` dentro de `db.payment.findUnique` (em `notifyPaymentError`) e de
`db.order.findUnique` (em `notifyOrderCancelledWithoutPayment`) — o `select` de `buyer`
hoje é `{ name: true, email: true, athleteProfile: {...} }`; falta um `buyerUserId`
separado no nível do `order`/`payment.order`, não dentro de `buyer` (o model `Order` já
tem a coluna `buyerUserId` direto, é só selecioná-la junto com `event`/`buyer`). Passar
esse valor no objeto montado em `notifyPaymentError`/`notifyOrderCancelledWithoutPayment`
ao chamar `sendCancellationInviteNotification`.

Dentro de `sendCancellationInviteNotification`, antes dos blocos de e-mail/WhatsApp,
calcular uma vez:

```ts
  const socialPromo = await getSocialPromoText(params.event.id, params.buyerUserId);
```

Passar `socialPromo` pra `sendPaymentErrorEmail` e acrescentar `redes_sociais:
socialPromo` ao objeto passado pra `renderTemplate` no bloco de WhatsApp.

Importar `getSocialPromoText` de `@/lib/social-links` no topo do arquivo.

- [ ] **Step 5: Write/update os testes**

Em `tests/lib-email.test.ts`, no `describe("sendRegistrationConfirmationEmail", ...)`,
acrescentar um caso análogo aos de `link_patrocinio` (link presente / ausente), agora com
`socialPromo` e `{{redes_sociais}}` no template mockado — mesmo padrão dos dois testes já
existentes ali pra `link_patrocinio`. Fazer o mesmo, um caso cada, nos describes de
`sendAbandonedCartEmail` e `sendPaymentErrorEmail` (se não existirem describes
dedicados pra essas duas funções em `tests/lib-email.test.ts`, criar um `it` dentro do
describe mais próximo existente, ou um describe novo, seguindo o estilo do arquivo).

Em `tests/alert-abandoned-cart.test.ts` e `tests/alert-payment-error.test.ts`
(describe de `notifyPaymentError`/`notifyOrderCancelledWithoutPayment`), mockar
`@/lib/social-links` (`vi.mock("@/lib/social-links", () => ({ getSocialPromoText: vi.fn().mockResolvedValue("") }))`,
mesmo padrão de mock de outras dependências nesses arquivos) — os testes existentes já
verificam o texto exato do WhatsApp/e-mail; com o mock retornando `""`, o comportamento
observável não muda (mesma asserção de antes continua batendo, já que
`{{redes_sociais}}` resolve pra vazio quando o mock devolve `""`), então nenhuma
asserção existente deveria quebrar — só é preciso adicionar o mock pra esses arquivos
não tentarem conectar no banco de verdade dentro de `getSocialPromoText`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib-email.test.ts tests/alert-abandoned-cart.test.ts tests/alert-payment-error.test.ts`
Expected: PASS em todos.

- [ ] **Step 7: Rodar typecheck e a suíte de testes inteira**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm test`
Expected: PASS em todos os arquivos (garante que o mock novo de `@/lib/social-links` não
quebrou nenhum outro teste que também exercite esses 3 fluxos, ex.: `tests/checkout-route.test.ts`
se ele chamar `notifyOrderConfirmed` indiretamente).

- [ ] **Step 8: Commit**

```bash
git add lib/notifications.ts lib/alerts/abandoned-cart.ts lib/alerts/payment-error.ts lib/email.ts tests/lib-email.test.ts tests/alert-abandoned-cart.test.ts tests/alert-payment-error.test.ts
git commit -m "feat: resolve redes_sociais nos 3 fluxos de envio (confirmacao, carrinho abandonado, erro de pagamento)"
```

---

### Task 5: API REST de redes sociais

**Files:**
- Create: `app/api/events/[id]/social-links/route.ts`
- Create: `app/api/events/[id]/social-links/[linkId]/route.ts`
- Test: `tests/events-social-links-route.test.ts`

**Interfaces:**
- Consumes: `EventSocialLink` (Task 1).
- Produces: `GET/POST /api/events/[id]/social-links`, `PATCH/DELETE
  /api/events/[id]/social-links/[linkId]`, consumidos pela Task 6.

- [ ] **Step 1: Write the failing tests**

Criar `tests/events-social-links-route.test.ts`, seguindo exatamente o padrão de mock de
`tests/events-registrations-export-route.test.ts` (mock de `@/lib/auth`, `db as any`).
Casos mínimos:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/social-links/route";
import { PATCH, DELETE } from "@/app/api/events/[id]/social-links/[linkId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/events/event-1/social-links", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

describe("GET/POST /api/events/[id]/social-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("lista as redes sociais do evento", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([{ id: "link-1", platform: "Instagram" }]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.socialLinks).toHaveLength(1);
  });

  it("cria uma rede social nova", async () => {
    dbMock.eventSocialLink.create.mockResolvedValueOnce({ id: "link-1" });

    const res = await POST(
      makeRequest({ platform: "Instagram", url: "https://instagram.com/corrida", message: "Segue a gente!", maxSends: 2 }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.eventSocialLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1", platform: "Instagram" }) }),
    );
  });

  it("rejeita corpo inválido (sem url)", async () => {
    const res = await POST(
      makeRequest({ platform: "Instagram", message: "Segue a gente!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });
});

describe("PATCH/DELETE /api/events/[id]/social-links/[linkId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.eventSocialLink.findFirst.mockResolvedValue({ id: "link-1", eventId: "event-1" });
  });

  it("edita uma rede social existente", async () => {
    dbMock.eventSocialLink.update.mockResolvedValueOnce({ id: "link-1", active: false });

    const res = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ active: false }) }) as any,
      { params: Promise.resolve({ id: "event-1", linkId: "link-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventSocialLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "link-1" }, data: expect.objectContaining({ active: false }) }),
    );
  });

  it("remove uma rede social", async () => {
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", linkId: "link-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventSocialLink.delete).toHaveBeenCalledWith({ where: { id: "link-1" } });
  });

  it("retorna 404 quando a rede social não pertence ao evento", async () => {
    dbMock.eventSocialLink.findFirst.mockResolvedValueOnce(null);
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", linkId: "link-999" }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/events-social-links-route.test.ts`
Expected: FAIL — os arquivos de rota ainda não existem.

- [ ] **Step 3: Implementar `app/api/events/[id]/social-links/route.ts`**

Seguindo exatamente o padrão de `app/api/events/[id]/coupons/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const socialLinkSchema = z.object({
  platform: z.string().trim().min(1),
  url: z.string().trim().min(1),
  message: z.string().trim().min(1),
  maxSends: z.number().int().positive().default(1),
  active: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("social-links.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const socialLinks = await db.eventSocialLink.findMany({ where: { eventId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ socialLinks });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("social-links.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = socialLinkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const socialLink = await db.eventSocialLink.create({
    data: { eventId: id, ...parsed.data },
  });

  return NextResponse.json({ socialLink }, { status: 201 });
}
```

- [ ] **Step 4: Implementar `app/api/events/[id]/social-links/[linkId]/route.ts`**

Seguindo exatamente o padrão de `app/api/events/[id]/coupons/[couponId]/route.ts` (sem a
checagem de "já usado em pedidos" — não se aplica aqui, `EventSocialLink` não tem
nenhuma FK entrante além de `SocialLinkSend`, que é apagado em cascata):

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  platform: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).optional(),
  maxSends: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const check = await checkApiPermission("social-links.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, linkId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existing = await db.eventSocialLink.findFirst({ where: { id: linkId, eventId: id } });
  if (!existing) return NextResponse.json({ error: "Rede social não encontrada" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const socialLink = await db.eventSocialLink.update({ where: { id: linkId }, data: parsed.data });
  return NextResponse.json({ socialLink });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const check = await checkApiPermission("social-links.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, linkId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existing = await db.eventSocialLink.findFirst({ where: { id: linkId, eventId: id } });
  if (!existing) return NextResponse.json({ error: "Rede social não encontrada" }, { status: 404 });

  await db.eventSocialLink.delete({ where: { id: linkId } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/events-social-links-route.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 6: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add "app/api/events/[id]/social-links" tests/events-social-links-route.test.ts
git commit -m "feat: API REST de redes sociais por evento"
```

---

### Task 6: UI de cadastro (organizador)

**Files:**
- Create: `app/organizador/eventos/[id]/redes-sociais/page.tsx`
- Modify: `app/organizador/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: API de Task 5.
- Produces: nada.

- [ ] **Step 1: Criar a página de cadastro**

Criar `app/organizador/eventos/[id]/redes-sociais/page.tsx`, client component, seguindo
exatamente o padrão de `app/organizador/eventos/[id]/cupons/page.tsx` (fetch on mount,
formulário de criação toggleable, edição via modal, exclusão via `ConfirmModal` —
**usar `components/ui/ConfirmModal.tsx`, não `ConfirmDialog.tsx`**: `ConfirmDialog` é o
padrão mais antigo usado em `cupons`/`lotes`/`percursos`/`categorias`, mas
`components/ui/ConfirmModal.tsx` é o componente atual documentado em `CLAUDE.md` pra
substituir `confirm()`, e é o que toda feature mais recente deste projeto já usa — ver
`components/organizer/EventDailySummaryRecipientsManager.tsx` como referência de uso
(`<ConfirmModal open={...} title="..." message="..." tone="danger" loading={...}
onConfirm={...} onCancel={...} />`).

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ConfirmModal from "@/components/ui/ConfirmModal";

type SocialLink = {
  id: string;
  platform: string;
  url: string;
  message: string;
  maxSends: number;
  active: boolean;
};

export default function RedesSociaisPage() {
  const { id } = useParams<{ id: string }>();
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ platform: "", url: "", message: "", maxSends: "1", active: true });
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({ platform: "", url: "", message: "", maxSends: "1" });

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/events/${id}/social-links`);
      const data = await res.json();
      setSocialLinks(data.socialLinks ?? []);
      setLoading(false);
    };
    void load();
  }, [id]);

  async function reload() {
    const res = await fetch(`/api/events/${id}/social-links`);
    const data = await res.json();
    setSocialLinks(data.socialLinks ?? []);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const res = await fetch(`/api/events/${id}/social-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: form.platform,
        url: form.url,
        message: form.message,
        maxSends: parseInt(form.maxSends) || 1,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setFormError(data.error?.formErrors?.[0] ?? data.error ?? "Erro ao criar rede social");
    } else {
      setShowForm(false);
      setForm({ platform: "", url: "", message: "", maxSends: "1" });
      await reload();
    }
    setSaving(false);
  }

  function openEdit(link: SocialLink) {
    setEditId(link.id);
    setEditForm({
      platform: link.platform,
      url: link.url,
      message: link.message,
      maxSends: String(link.maxSends),
      active: link.active,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    await fetch(`/api/events/${id}/social-links/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: editForm.platform,
        url: editForm.url,
        message: editForm.message,
        maxSends: parseInt(editForm.maxSends) || 1,
        active: editForm.active,
      }),
    });
    setEditSaving(false);
    setEditId(null);
    await reload();
  }

  async function doDelete() {
    if (!deletingId) return;
    setDeleting(true);
    await fetch(`/api/events/${id}/social-links/${deletingId}`, { method: "DELETE" });
    setDeleting(false);
    setDeletingId(null);
    await reload();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfirmModal
        open={!!deletingId}
        title="Remover rede social"
        message="Deseja remover esta rede social do evento? Ela deixa de ser incluída nas próximas mensagens."
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingId(null)}
      />

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditId(null)}>
          <form onSubmit={saveEdit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar rede social</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rede</label>
              <input required value={editForm.platform} onChange={(e) => setEditForm({ ...editForm, platform: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link</label>
              <input required value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
              <textarea required value={editForm.message} onChange={(e) => setEditForm({ ...editForm, message: e.target.value })} className="input w-full" rows={3} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantas vezes incluir por pessoa</label>
              <input required type="number" min="1" value={editForm.maxSends} onChange={(e) => setEditForm({ ...editForm, maxSends: e.target.value })} className="input w-full" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} className="h-4 w-4" />
              Ativa
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setEditId(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button type="submit" disabled={editSaving} className="px-4 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-medium">{editSaving ? "Salvando…" : "Salvar"}</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar</Link>
          <h1 className="text-xl font-bold mt-1">Redes sociais</h1>
          <p className="text-sm text-gray-500">Incluídas automaticamente nas mensagens de confirmação, carrinho abandonado e erro de pagamento, respeitando o limite de envios.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Nova rede social</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Nova rede social</h2>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded px-3 py-2">{formError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rede *</label>
            <input required value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className="input w-full" placeholder="Instagram, Strava..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Link *</label>
            <input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="input w-full" placeholder="https://instagram.com/corrida" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem *</label>
            <textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="input w-full" rows={3} placeholder="Segue a gente no Instagram!" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantas vezes incluir por pessoa</label>
            <input type="number" min="1" value={form.maxSends} onChange={(e) => setForm({ ...form, maxSends: e.target.value })} className="input w-full" />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Criando..." : "Criar"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {socialLinks.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhuma rede social cadastrada.</div>
      ) : (
        <div className="space-y-2">
          {socialLinks.map((link) => (
            <div key={link.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium">{link.platform} {!link.active && <span className="text-xs text-gray-400">(inativa)</span>}</p>
                <p className="text-sm text-gray-500">{link.url} · até {link.maxSends}x por pessoa</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(link)} className="text-blue-600 hover:text-blue-800 text-sm">Editar</button>
                <button onClick={() => setDeletingId(link.id)} className="text-red-500 hover:text-red-700 text-sm">Remover</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Acrescentar o link na página do evento**

Em `app/organizador/eventos/[id]/page.tsx`, no bloco "Ações" (já tem "Ver inscritos",
"Relatório Geral", "Importar resultados" das etapas anteriores):

```tsx
        <Link href={`/organizador/eventos/${id}/relatorio-geral`} className="btn-secondary flex-1 text-center">
          Relatório Geral
        </Link>
        <Link href={`/organizador/eventos/${id}/redes-sociais`} className="btn-secondary flex-1 text-center">
          Redes sociais
        </Link>
        <Link href={`/organizador/eventos/${id}/resultados`} className="btn-secondary flex-1 text-center">
          Importar resultados
        </Link>
```

(Conferir o texto exato já presente no arquivo antes de editar — a task só precisa
inserir o novo `<Link>` entre os dois já existentes, sem alterar o resto do bloco.)

- [ ] **Step 3: Rodar typecheck e a suíte de testes**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 4: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/organizador/eventos/<id>/redes-sociais`. Confirmar:
- Cadastrar uma rede social nova (rede, link, mensagem, limite), ela aparece na lista.
- Editar (mudar mensagem/limite/ativa), salvar, reabrir a página: os valores persistem.
- Remover uma rede social usando o `ConfirmModal` (não deve haver nenhum `confirm()`
  nativo do navegador em nenhum momento).
- O link "Redes sociais" aparece na página do evento e leva pra essa tela.
- Abrir a edição de template de `ORDER_CONFIRMED`/`ABANDONED_CART`/`PAYMENT_ERROR`
  (Admin → Alertas → templates) e confirmar que `{{redes_sociais}}` aparece como
  variável disponível.

- [ ] **Step 5: Commit**

```bash
git add "app/organizador/eventos/[id]/redes-sociais" "app/organizador/eventos/[id]/page.tsx"
git commit -m "feat: tela de cadastro de redes sociais por evento"
```

---

## Self-Review Notes

- **Spec coverage:** models novos com contagem por pessoa (Task 1) ✓; helper "primeiras N
  mensagens" com transação atômica (Task 2) ✓; variável disponível nos 6 alertKeys certos,
  registrada nos DOIS arquivos (`registry.ts` + `variables.ts`, lição da revisão anterior)
  (Task 3) ✓; os 3 fluxos de envio resolvendo o valor sem incrementar em dobro por
  destinatário (Task 4) ✓; API REST espelhando cupons (Task 5) ✓; UI usando `ConfirmModal`
  (não o `ConfirmDialog` mais antigo), consistente com `CLAUDE.md` (Task 6) ✓.
- **Placeholder scan:** nenhum "TBD"/"similar to Task N" — cada task tem o código
  completo, inclusive os testes.
- **Type consistency:** `EventSocialLink`/`SocialLinkSend` (Task 1) usados de forma
  idêntica em `lib/social-links.ts` (Task 2), nas rotas (Task 5) e implicitamente na UI
  (Task 6, via o `type SocialLink` local que espelha o shape retornado pela API).
  `getSocialPromoText(eventId: string, userId: string): Promise<string>` — mesma
  assinatura usada nos 3 pontos de chamada da Task 4.
- **Risco de produção:** a única ação que toca o banco de produção (aplicar a migration)
  fica fora das tasks, igual ao padrão já estabelecido nas features anteriores.
- **Risco de contagem em dobro:** a Task 4 explicitamente instrui reaproveitar o mesmo
  valor de `getSocialPromoText` entre o e-mail e o WhatsApp do MESMO destinatário na
  MESMA execução — chamar duas vezes incrementaria a contagem sem que a pessoa tenha
  recebido duas mensagens reais adicionais (ela recebe as duas, mas conta como duas
  "mensagens" de fato, o que é correto: e-mail e WhatsApp são canais/mensagens
  separados). O que a task evita é uma chamada REDUNDANTE (ex.: calcular de novo pro
  atleta quando `athleteUserId` é o mesmo já calculado pro comprador em inscrição não-
  procuração) incrementando por engano sem uma mensagem real correspondente.
