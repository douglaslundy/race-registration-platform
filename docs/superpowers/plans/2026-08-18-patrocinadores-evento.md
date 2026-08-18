# Patrocinadores por evento (múltiplos, nos moldes de redes sociais) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizador cadastra um ou mais patrocinadores por evento (nome + link + mensagem
+ ativo/inativo); a plataforma inclui isso automaticamente — via uma variável de template
nova, `{{patrocinio}}` — nas 3 mensagens de confirmação de inscrição, juntando o texto de
cada patrocinador ativo com linha em branco entre blocos. Substitui por completo o campo
simples `Event.sponsorLink` e a variável `{{link_patrocinio}}`.

**Architecture:** Um model novo (`EventSponsor`), sem equivalente a `SocialLinkSend`/
`maxSends` — patrocínio não tem limite de envio por pessoa, aparece sempre que ativo. Um
helper puro `getSponsorPromoText(eventId)` (sem efeito colateral, ao contrário de
`getSocialPromoText`) busca os patrocinadores ativos e monta o texto. O valor entra no
pipeline de templates já existente, substituindo `link_patrocinio` por `patrocinio` nos 3
alertKeys de confirmação de inscrição. Cadastro via tela CRUD nova (organizador),
espelhando exatamente o padrão já usado por `/redes-sociais`. A migration de schema é
dividida em duas partes (Task 1 só ADICIONA a tabela nova + backfill; Task 6 remove a
coluna antiga) pra nenhuma task no meio do caminho deixar o projeto sem compilar.

**Tech Stack:** Next.js App Router, Prisma (Postgres), Vitest, React (client component).

**Spec:** `docs/superpowers/specs/2026-08-18-patrocinadores-evento-design.md`

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-18-patrocinadores-evento-design.md`.
- **O banco local não tem acesso de rede nesta sessão** — nenhuma task deste plano executa
  `prisma migrate dev`, `prisma db push`, ou qualquer comando que toque o banco. As
  migrations são escritas à mão; aplicá-las em produção acontece fora deste plano, com
  confirmação explícita do usuário. `npx prisma generate` é seguro e necessário rodar
  localmente depois de qualquer edição em `prisma/schema.prisma`.
- **`/prisma/migrations/` está no `.gitignore`** — todo commit que inclui uma migration
  precisa de `git add -f`, e verificação depois (`git show --stat` + `git ls-files`) que
  ela foi de fato versionada. Essa pegadinha já mordeu duas features anteriores neste
  projeto.
- **Toda variável de template nova precisa de DUAS edições, não uma**: o nome no array
  `variables` do(s) alerta(s) em `lib/templates/registry.ts` E a entrada correspondente em
  `ALL_VARIABLES`, em `lib/templates/variables.ts`. `tests/templates-registry.test.ts`
  falha se as duas não estiverem em sincronia — rodar esse teste na task que mexe nos dois
  arquivos, não só descobrir isso na revisão final.
- **Toda permissão de assistente nova precisa dos dois catálogos, não só da API**: a API
  chama `checkApiPermission("sponsors.xxx")` e funciona sozinha, mas sem a entrada
  correspondente em `app/organizador/assistentes/page.tsx` E
  `app/admin/assistentes/page.tsx`, nenhum assistente jamais consegue receber essa
  permissão pela UI (403 permanente e silencioso). Isso já aconteceu de verdade com
  `social-links.*` na feature anterior (só foi pego na revisão final, virou fix wave) —
  neste plano os dois catálogos entram na MESMA task que cria a API (Task 5), não depois.
- `{{patrocinio}}` só nos alertKeys `ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER`,
  `ORDER_CONFIRMED_PROXY_ATHLETE` — os mesmos 3 que `{{link_patrocinio}}` já tinha. Não
  entra em `ABANDONED_CART`/`PAYMENT_ERROR`(+variante) — fora de escopo desta feature.
- `getSponsorPromoText` **não tem efeito colateral** (ao contrário de
  `getSocialPromoText`) — pode ser chamado uma vez, cedo, sem memoização especial nem
  cuidado de ordem em relação a guardas de canal/dedupe.
- Nunca usar `alert()`/`confirm()`/`window.prompt()` — a tela de cadastro usa
  `components/ui/ConfirmModal.tsx` pra exclusão, mesmo padrão de `/redes-sociais` (regra
  em `CLAUDE.md`).

---

### Task 1: Schema — `EventSponsor` + migration (criação + backfill, sem remover `sponsorLink` ainda)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260818000000_add_event_sponsors/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `EventSponsor` no Prisma Client, consumido pelas Tasks 2, 5 e 6.

- [ ] **Step 1: Adicionar o model no schema**

Em `prisma/schema.prisma`, logo após o `model EventSocialLink { ... }` existente,
acrescentar:

```prisma
model EventSponsor {
  id        String   @id @default(cuid())
  eventId   String
  name      String                          // nome do patrocinador
  url       String
  message   String   @db.Text
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([eventId])
  @@map("event_sponsors")
}
```

No `model Event`, acrescentar a relação nova logo após `socialLinks EventSocialLink[]`:

```prisma
  socialLinks   EventSocialLink[]
  sponsors      EventSponsor[]
```

**Não remover o campo `sponsorLink String?` do `model Event` nesta task** — ele continua
existindo até a Task 6, quando todo o código que ainda o referencia já tiver sido migrado
para o mecanismo novo. Removê-lo agora quebraria a compilação de `lib/notifications.ts`,
`lib/email.ts`, `components/organizer/EditEventForm.tsx` e mais 2 arquivos até essas tasks
rodarem.

- [ ] **Step 2: Escrever a migration à mão (criação + backfill, sem DROP)**

Criar `prisma/migrations/20260818000000_add_event_sponsors/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "event_sponsors" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_sponsors_eventId_idx" ON "event_sponsors"("eventId");

-- AddForeignKey
ALTER TABLE "event_sponsors" ADD CONSTRAINT "event_sponsors_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: todo evento que já tem sponsorLink preenchido ganha 1 EventSponsor
-- equivalente, pra nada se perder na migração do mecanismo antigo pro novo. Nome e
-- mensagem genéricos — o organizador ajusta depois na tela nova se quiser.
-- gen_random_uuid() é nativo do Postgres a partir da versão 13, não precisa de extensão.
INSERT INTO "event_sponsors" ("id", "eventId", "name", "url", "message", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Patrocinador', "sponsorLink", 'Confira nosso patrocinador:', true, now(), now()
FROM "events"
WHERE "sponsorLink" IS NOT NULL AND "sponsorLink" != '';
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
git add -f prisma/migrations/20260818000000_add_event_sponsors/migration.sql
git commit -m "feat: schema de patrocinadores por evento (EventSponsor)"
```

Depois do commit, verificar que a migration foi de fato versionada:

```bash
git show --stat HEAD
git ls-files prisma/migrations/20260818000000_add_event_sponsors/
```

Ambos precisam listar `migration.sql` — se não listarem, o `git add -f` falhou e o
arquivo não foi commitado.

---

### Task 2: Helper `getSponsorPromoText`

**Files:**
- Create: `lib/event-sponsors.ts`
- Test: `tests/lib-event-sponsors.test.ts`
- Modify: `tests/setup.ts`

**Interfaces:**
- Consumes: `EventSponsor` do Prisma Client (Task 1).
- Produces: `export async function getSponsorPromoText(eventId: string): Promise<string>`,
  consumido pela Task 4.

- [ ] **Step 1: Acrescentar o mock de `eventSponsor` em `tests/setup.ts`**

Em `tests/setup.ts`, logo após a linha de `eventSocialLink` (que já tem um comentário
explicando por que `findMany` tem default `[]`), acrescentar:

```ts
    eventSponsor: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
```

(Mesmo motivo do default em `eventSocialLink`: `getSponsorPromoText` passa a ser chamada
de dentro de `notifyOrderConfirmed` a partir da Task 4 — sem esse default, qualquer teste
que exercite esse fluxo sem mockar `eventSponsor` explicitamente quebraria com "Cannot
read properties of undefined".)

- [ ] **Step 2: Write the failing tests**

Criar `tests/lib-event-sponsors.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSponsorPromoText } from "@/lib/event-sponsors";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("getSponsorPromoText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna string vazia quando não há patrocinadores ativos", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([]);

    const result = await getSponsorPromoText("event-1");

    expect(result).toBe("");
  });

  it("inclui um patrocinador ativo", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([
      { id: "sponsor-1", name: "ACME", message: "Confira nosso patrocinador ACME!", url: "https://acme.com" },
    ]);

    const result = await getSponsorPromoText("event-1");

    expect(result).toBe("Confira nosso patrocinador ACME! https://acme.com");
  });

  it("junta vários patrocinadores ativos com linha em branco entre eles", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([
      { id: "sponsor-1", name: "ACME", message: "Confira a ACME!", url: "https://acme.com" },
      { id: "sponsor-2", name: "Beta", message: "Confira a Beta!", url: "https://beta.com" },
    ]);

    const result = await getSponsorPromoText("event-1");

    expect(result).toBe("Confira a ACME! https://acme.com\n\nConfira a Beta! https://beta.com");
  });

  it("busca só patrocinadores ativos do evento, ordenados por criação", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([]);

    await getSponsorPromoText("event-1");

    expect(dbMock.eventSponsor.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1", active: true },
      orderBy: { createdAt: "asc" },
    });
  });

  it("retorna string vazia (não lança) quando a busca no banco falha", async () => {
    dbMock.eventSponsor.findMany.mockRejectedValueOnce(new Error("db down"));

    const result = await getSponsorPromoText("event-1");

    expect(result).toBe("");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/lib-event-sponsors.test.ts`
Expected: FAIL — `Cannot find module '@/lib/event-sponsors'` (ou erro de import
equivalente).

- [ ] **Step 4: Implementar o helper**

Criar `lib/event-sponsors.ts`:

```ts
import { db } from "./db";

/**
 * Texto de divulgação dos patrocinadores ativos de um evento, pra incluir numa mensagem
 * (WhatsApp/e-mail). Ao contrário de `getSocialPromoText`, não tem efeito colateral nem
 * limite por destinatário — patrocínio é conteúdo pago do organizador, aparece sempre que
 * ativo.
 */
export async function getSponsorPromoText(eventId: string): Promise<string> {
  try {
    const sponsors = await db.eventSponsor.findMany({
      where: { eventId, active: true },
      orderBy: { createdAt: "asc" },
    });
    if (sponsors.length === 0) return "";

    return sponsors.map((s) => `${s.message} ${s.url}`).join("\n\n");
  } catch (err) {
    console.error("getSponsorPromoText failed:", err);
    return "";
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib-event-sponsors.test.ts`
Expected: PASS (5/5).

- [ ] **Step 6: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add lib/event-sponsors.ts tests/lib-event-sponsors.test.ts tests/setup.ts
git commit -m "feat: helper getSponsorPromoText"
```

---

### Task 3: Variável de template `{{patrocinio}}` (substitui `{{link_patrocinio}}`)

**Files:**
- Modify: `lib/templates/registry.ts`
- Modify: `lib/templates/variables.ts`
- Test: `tests/templates-registry.test.ts`, `tests/templates-variables.test.ts` (só
  rodar, não precisa editar)

**Interfaces:**
- Consumes: nada.
- Produces: `"patrocinio"` disponível nos 3 alertKeys de confirmação de inscrição,
  consumido pela Task 4.

- [ ] **Step 1: Trocar `link_patrocinio` por `patrocinio` nos 3 alertKeys**

Em `lib/templates/registry.ts`, nos arrays `variables` de `ORDER_CONFIRMED` (linha ~290),
`ORDER_CONFIRMED_PROXY_BUYER` (linha ~310) e `ORDER_CONFIRMED_PROXY_ATHLETE` (linha ~319)
— cada um hoje tem `["nome_atleta", ..., "link_patrocinio", "redes_sociais"]` (a lista
completa varia por alertKey, só o nome do item muda). Trocar a string `"link_patrocinio"`
por `"patrocinio"` nos 3 arrays, mantendo os outros itens intactos. Exemplo de como fica o
de `ORDER_CONFIRMED`:

```ts
    variables: ["nome_atleta", "nome_evento", "codigo_confirmacao", "link_evento", "patrocinio", "redes_sociais"],
```

Não mexer em nenhum `factoryDefault` — a variável fica só disponível, não é forçada no
texto padrão de fábrica de nenhum alerta (mesmo padrão de `redes_sociais`).

- [ ] **Step 2: Trocar a entrada no catálogo `ALL_VARIABLES`**

Em `lib/templates/variables.ts`, a entrada existente (linha ~36):

```ts
  { name: "link_patrocinio", label: "Link de patrocínio", category: "Evento", description: "Event.sponsorLink. Pode ser vazio. Só disponível nos alertas de confirmação de inscrição.", sample: "https://www.strava.com/routes/123" },
```

vira:

```ts
  { name: "patrocinio", label: "Patrocínio", category: "Evento", description: "Patrocinadores ativos cadastrados no evento. Pode ser vazio. Só disponível nos alertas de confirmação de inscrição.", sample: "Confira nosso patrocinador! https://patrocinador.com" },
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/templates-registry.test.ts tests/templates-variables.test.ts`
Expected: PASS — o teste de sincronia (toda entrada só declara variáveis que existem no
catálogo geral) precisa passar já nesta task.

- [ ] **Step 4: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add lib/templates/registry.ts lib/templates/variables.ts
git commit -m "feat: variavel patrocinio substitui link_patrocinio nos templates de confirmacao"
```

---

### Task 4: Wiring — resolver `{{patrocinio}}` em `notifyOrderConfirmed` e remover `sponsorLink`/`link_patrocinio`

**Files:**
- Modify: `lib/notifications.ts`
- Modify: `lib/email.ts`
- Test: `tests/notifications.test.ts`, `tests/lib-email.test.ts`

**Interfaces:**
- Consumes: `getSponsorPromoText` (Task 2); `"patrocinio"` disponível nos alertas (Task 3).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: `lib/email.ts` — trocar `sponsorLink` por `sponsorPromo`**

Em `sendRegistrationConfirmationEmail` (`lib/email.ts`), o parâmetro
`sponsorLink?: string | null` vira `sponsorPromo?: string | null`, e a linha
`link_patrocinio: params.sponsorLink ?? ""` dentro do objeto `values` vira
`patrocinio: params.sponsorPromo ?? ""`:

```ts
export async function sendRegistrationConfirmationEmail(params: {
  to: string;
  name: string;
  registrationId: string;
  orderId: string;
  eventTitle?: string;
  eventId?: string;
  notes?: string;
  alertKey: "ORDER_CONFIRMED" | "ORDER_CONFIRMED_PROXY_ATHLETE";
  recipientRole: "BUYER" | "ATHLETE";
  buyerName?: string;
  sponsorPromo?: string | null;
  socialPromo?: string | null;
  kitQrCodePng?: Buffer;
}): Promise<void> {
  const appName = await getAppName();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${baseUrl}/dashboard/inscricoes/${params.registrationId}`;
  const values = {
    nome_atleta: params.name,
    nome_comprador: params.buyerName ?? params.name,
    nome_evento: params.eventTitle ?? "",
    codigo_confirmacao: params.orderId,
    link_evento: url,
    patrocinio: params.sponsorPromo ?? "",
    redes_sociais: params.socialPromo ?? "",
  };
```

(Resto da função sem mudança.)

- [ ] **Step 2: `lib/notifications.ts` — resolver `sponsorPromo` uma vez e substituir os 2 pontos que usavam `sponsorLink`**

No `select` de `order` (dentro de `db.order.findUnique`), trocar `sponsorLink: true` por
nada — o campo não é mais necessário nesse select (o valor agora vem de
`getSponsorPromoText`, uma query separada por `eventId`):

```ts
        event: { select: { id: true, title: true } },
```

Logo depois de `const kitQrCaption = ...` (já existente), calcular a promoção de
patrocínio uma vez — `getSponsorPromoText` não tem efeito colateral, então não precisa de
memoização especial nem de cuidado de ordem em relação às guardas de canal:

```ts
    const sponsorPromo = await getSponsorPromoText(order.event?.id ?? "");
```

Nos dois objetos passados pra `sendRegistrationConfirmationEmail` (comprador e, se
procuração, atleta), trocar `sponsorLink: order.event?.sponsorLink,` por
`sponsorPromo,`.

Nos dois objetos `values` passados pra `sendWhatsAppIfActive` (comprador e atleta), trocar
`link_patrocinio: order.event?.sponsorLink ?? "",` por `patrocinio: sponsorPromo,`.

Importar no topo do arquivo:

```ts
import { getSponsorPromoText } from "@/lib/event-sponsors";
```

- [ ] **Step 3: Atualizar `tests/notifications.test.ts`**

Acrescentar o mock de `@/lib/event-sponsors` junto aos outros mocks já existentes no topo
do arquivo (perto de `vi.mock("@/lib/event-social-links", ...)`):

```ts
vi.mock("@/lib/event-sponsors", () => ({
  getSponsorPromoText: vi.fn().mockResolvedValue(""),
}));
```

E o import correspondente, junto aos outros:

```ts
import { getSponsorPromoText } from "@/lib/event-sponsors";
```

Nenhuma asserção existente precisa mudar — os testes de WhatsApp já usam
`expect.stringContaining(...)` pro corpo da mensagem, não enumeram todas as chaves de
`values`, e nenhum teste hoje verifica `link_patrocinio`/`sponsorLink` diretamente
(confirmar isso rodando a suíte no Step 5 — se algum teste quebrar por causa dessa
mudança, ajustar a asserção pro nome novo).

- [ ] **Step 4: Atualizar `tests/lib-email.test.ts`**

Os dois testes existentes (`"resolve {{link_patrocinio}} quando o evento tem um link de
patrocínio cadastrado"` e `"resolve {{link_patrocinio}} pra string vazia quando o evento
não tem link cadastrado"`) mudam de nome e conteúdo:

```ts
  it("resolve {{patrocinio}} quando o evento tem patrocinador ativo", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{nome_evento}}",
      body: "<p>Olá {{nome_atleta}}, veja também: {{patrocinio}}</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta@example.com",
      name: "Maria",
      registrationId: "reg-1",
      orderId: "order-1",
      eventTitle: "Corrida X",
      eventId: "event-1",
      alertKey: "ORDER_CONFIRMED",
      recipientRole: "BUYER",
      sponsorPromo: "Confira nosso patrocinador! https://www.strava.com/routes/123",
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Confira nosso patrocinador! https://www.strava.com/routes/123");
  });

  it("resolve {{patrocinio}} pra string vazia quando o evento não tem patrocinador ativo", async () => {
    sendMailMock.mockResolvedValueOnce({});
    vi.mocked(getEffectiveTemplate).mockResolvedValueOnce({
      subject: "Assunto — {{nome_evento}}",
      body: "<p>Link: [{{patrocinio}}]</p>",
      source: "global",
    });

    await sendRegistrationConfirmationEmail({
      to: "atleta@example.com",
      name: "Maria",
      registrationId: "reg-1",
      orderId: "order-1",
      eventTitle: "Corrida X",
      eventId: "event-1",
      alertKey: "ORDER_CONFIRMED",
      recipientRole: "BUYER",
    });

    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Link: []");
  });
```

(Ler o teste original antes de editar pra confirmar a asserção exata do segundo caso —
seguir o mesmo formato já usado ali, só trocando `link_patrocinio`/`sponsorLink` por
`patrocinio`/`sponsorPromo`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/notifications.test.ts tests/lib-email.test.ts`
Expected: PASS em todos.

- [ ] **Step 6: Rodar typecheck e a suíte de testes inteira**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm test`
Expected: PASS em todos os arquivos (garante que nenhum outro teste dependia do nome
antigo `sponsorLink`/`link_patrocinio`).

- [ ] **Step 7: Commit**

```bash
git add lib/notifications.ts lib/email.ts tests/notifications.test.ts tests/lib-email.test.ts
git commit -m "feat: resolve patrocinio em notifyOrderConfirmed, remove sponsorLink/link_patrocinio"
```

---

### Task 5: API REST de patrocinadores + permissões de assistente

**Files:**
- Create: `app/api/events/[id]/sponsors/route.ts`
- Create: `app/api/events/[id]/sponsors/[sponsorId]/route.ts`
- Modify: `app/organizador/assistentes/page.tsx`
- Modify: `app/admin/assistentes/page.tsx`
- Test: `tests/events-sponsors-route.test.ts`

**Interfaces:**
- Consumes: `EventSponsor` (Task 1).
- Produces: `GET/POST /api/events/[id]/sponsors`, `PATCH/DELETE
  /api/events/[id]/sponsors/[sponsorId]`, consumidos pela Task 6.

- [ ] **Step 1: Write the failing tests**

Criar `tests/events-sponsors-route.test.ts`, seguindo exatamente o padrão de
`tests/events-social-links-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/sponsors/route";
import { PATCH, DELETE } from "@/app/api/events/[id]/sponsors/[sponsorId]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/events/event-1/sponsors", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

describe("GET/POST /api/events/[id]/sponsors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("lista os patrocinadores do evento", async () => {
    dbMock.eventSponsor.findMany.mockResolvedValueOnce([{ id: "sponsor-1", name: "ACME" }]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sponsors).toHaveLength(1);
  });

  it("cria um patrocinador novo", async () => {
    dbMock.eventSponsor.create.mockResolvedValueOnce({ id: "sponsor-1" });

    const res = await POST(
      makeRequest({ name: "ACME", url: "https://acme.com", message: "Confira a ACME!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.eventSponsor.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1", name: "ACME" }) }),
    );
  });

  it("rejeita corpo inválido (sem url)", async () => {
    const res = await POST(
      makeRequest({ name: "ACME", message: "Confira a ACME!" }),
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

describe("PATCH/DELETE /api/events/[id]/sponsors/[sponsorId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.eventSponsor.findFirst.mockResolvedValue({ id: "sponsor-1", eventId: "event-1" });
  });

  it("edita um patrocinador existente", async () => {
    dbMock.eventSponsor.update.mockResolvedValueOnce({ id: "sponsor-1", active: false });

    const res = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ active: false }) }) as any,
      { params: Promise.resolve({ id: "event-1", sponsorId: "sponsor-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventSponsor.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sponsor-1" }, data: expect.objectContaining({ active: false }) }),
    );
  });

  it("remove um patrocinador", async () => {
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", sponsorId: "sponsor-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventSponsor.delete).toHaveBeenCalledWith({ where: { id: "sponsor-1" } });
  });

  it("retorna 404 quando o patrocinador não pertence ao evento", async () => {
    dbMock.eventSponsor.findFirst.mockResolvedValueOnce(null);
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE" }) as any,
      { params: Promise.resolve({ id: "event-1", sponsorId: "sponsor-999" }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/events-sponsors-route.test.ts`
Expected: FAIL — os arquivos de rota ainda não existem.

- [ ] **Step 3: Implementar `app/api/events/[id]/sponsors/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const sponsorSchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().trim().min(1),
  message: z.string().trim().min(1),
  active: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("sponsors.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const sponsors = await db.eventSponsor.findMany({ where: { eventId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ sponsors });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("sponsors.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = sponsorSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const sponsor = await db.eventSponsor.create({
    data: { eventId: id, ...parsed.data },
  });

  return NextResponse.json({ sponsor }, { status: 201 });
}
```

- [ ] **Step 4: Implementar `app/api/events/[id]/sponsors/[sponsorId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; sponsorId: string }> }) {
  const check = await checkApiPermission("sponsors.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, sponsorId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existing = await db.eventSponsor.findFirst({ where: { id: sponsorId, eventId: id } });
  if (!existing) return NextResponse.json({ error: "Patrocinador não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const sponsor = await db.eventSponsor.update({ where: { id: sponsorId }, data: parsed.data });
  return NextResponse.json({ sponsor });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; sponsorId: string }> }) {
  const check = await checkApiPermission("sponsors.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, sponsorId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existing = await db.eventSponsor.findFirst({ where: { id: sponsorId, eventId: id } });
  if (!existing) return NextResponse.json({ error: "Patrocinador não encontrado" }, { status: 404 });

  await db.eventSponsor.delete({ where: { id: sponsorId } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Acrescentar as 4 permissões nos dois catálogos de assistente**

Em `app/organizador/assistentes/page.tsx`, no array `ORGANIZER_EVENT_ACTIONS`, logo após
as 4 entradas de `social-links.*`:

```ts
  { key: "social-links.view", label: "Ver redes sociais de um evento" },
  { key: "social-links.create", label: "Criar rede social" },
  { key: "social-links.edit", label: "Editar rede social" },
  { key: "social-links.delete", label: "Excluir rede social" },
  { key: "sponsors.view", label: "Ver patrocinadores de um evento" },
  { key: "sponsors.create", label: "Criar patrocinador" },
  { key: "sponsors.edit", label: "Editar patrocinador" },
  { key: "sponsors.delete", label: "Excluir patrocinador" },
```

Em `app/admin/assistentes/page.tsx`, no array `ADMIN_EVENT_ACTIONS`, mesma posição (logo
após as 4 de `social-links.*`), mesmas 4 entradas (labels idênticos — o padrão de outras
entradas administrativas que já têm exatamente o mesmo texto entre os dois catálogos
quando a ação não distingue "meu evento" de "qualquer evento", como já é o caso de
`social-links.*` nos dois arquivos):

```ts
  { key: "social-links.view", label: "Ver redes sociais de um evento" },
  { key: "social-links.create", label: "Criar rede social" },
  { key: "social-links.edit", label: "Editar rede social" },
  { key: "social-links.delete", label: "Excluir rede social" },
  { key: "sponsors.view", label: "Ver patrocinadores de um evento" },
  { key: "sponsors.create", label: "Criar patrocinador" },
  { key: "sponsors.edit", label: "Editar patrocinador" },
  { key: "sponsors.delete", label: "Excluir patrocinador" },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/events-sponsors-route.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 7: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add "app/api/events/[id]/sponsors" tests/events-sponsors-route.test.ts app/organizador/assistentes/page.tsx app/admin/assistentes/page.tsx
git commit -m "feat: API REST de patrocinadores por evento + permissoes de assistente"
```

---

### Task 6: UI de cadastro (organizador) + remoção final do `sponsorLink` antigo

**Files:**
- Create: `app/organizador/eventos/[id]/patrocinio/page.tsx`
- Modify: `app/organizador/eventos/[id]/page.tsx`
- Modify: `components/organizer/EditEventForm.tsx`
- Modify: `app/api/events/[id]/route.ts`
- Modify: `app/organizador/eventos/[id]/editar/page.tsx`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260818010000_drop_event_sponsor_link/migration.sql`

**Interfaces:**
- Consumes: API de Task 5.
- Produces: nada.

- [ ] **Step 1: Criar a página de cadastro**

Criar `app/organizador/eventos/[id]/patrocinio/page.tsx` — mesmo client component de
`app/organizador/eventos/[id]/redes-sociais/page.tsx`, sem o campo "Quantas vezes incluir
por pessoa" (patrocínio não tem limite de envio), campo "Rede" vira "Nome do
patrocinador", endpoint `social-links` vira `sponsors`, chave da resposta `socialLinks`
vira `sponsors`, `platform` vira `name`. Usar `ConfirmModal`, nunca `confirm()` nativo:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ConfirmModal from "@/components/ui/ConfirmModal";

type Sponsor = {
  id: string;
  name: string;
  url: string;
  message: string;
  active: boolean;
};

export default function PatrocinioPage() {
  const { id } = useParams<{ id: string }>();
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", url: "", message: "", active: true });
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", message: "" });

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/events/${id}/sponsors`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPageError(data.error ?? "Erro ao carregar patrocinadores");
        setLoading(false);
        return;
      }
      setPageError(null);
      setSponsors(data.sponsors ?? []);
      setLoading(false);
    };
    void load();
  }, [id]);

  async function reload() {
    const res = await fetch(`/api/events/${id}/sponsors`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPageError(data.error ?? "Erro ao carregar patrocinadores");
      return;
    }
    setPageError(null);
    setSponsors(data.sponsors ?? []);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const res = await fetch(`/api/events/${id}/sponsors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, url: form.url, message: form.message }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setFormError(
        data.error?.formErrors?.[0] ??
        (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
        "Erro ao criar patrocinador",
      );
    } else {
      setShowForm(false);
      setForm({ name: "", url: "", message: "" });
      await reload();
    }
    setSaving(false);
  }

  function openEdit(sponsor: Sponsor) {
    setEditId(sponsor.id);
    setEditForm({ name: sponsor.name, url: sponsor.url, message: sponsor.message, active: sponsor.active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    await fetch(`/api/events/${id}/sponsors/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editForm.name, url: editForm.url, message: editForm.message, active: editForm.active }),
    });
    setEditSaving(false);
    setEditId(null);
    await reload();
  }

  async function doDelete() {
    if (!deletingId) return;
    setDeleting(true);
    await fetch(`/api/events/${id}/sponsors/${deletingId}`, { method: "DELETE" });
    setDeleting(false);
    setDeletingId(null);
    await reload();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfirmModal
        open={!!deletingId}
        title="Remover patrocinador"
        message="Deseja remover este patrocinador do evento? Ele deixa de ser incluído nas próximas mensagens de confirmação."
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingId(null)}
      />

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditId(null)}>
          <form onSubmit={saveEdit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar patrocinador</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
              <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link</label>
              <input required value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
              <textarea required value={editForm.message} onChange={(e) => setEditForm({ ...editForm, message: e.target.value })} className="input w-full" rows={3} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} className="h-4 w-4" />
              Ativo
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
          <h1 className="text-xl font-bold mt-1">Patrocínio</h1>
          <p className="text-sm text-gray-500">Incluídos automaticamente nas mensagens de confirmação de inscrição, enquanto ativos.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">+ Novo patrocinador</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Novo patrocinador</h2>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded px-3 py-2">{formError}</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome *</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full" placeholder="Nome do patrocinador" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link *</label>
            <input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="input w-full" placeholder="https://patrocinador.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
            <textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="input w-full" rows={3} placeholder="Confira nosso patrocinador!" />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? "Criando..." : "Criar"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
          </div>
        </form>
      )}

      {pageError ? (
        <div className="card text-center py-8 text-red-600 dark:text-red-400">{pageError}</div>
      ) : sponsors.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhum patrocinador cadastrado.</div>
      ) : (
        <div className="space-y-2">
          {sponsors.map((sponsor) => (
            <div key={sponsor.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium">{sponsor.name} {!sponsor.active && <span className="text-xs text-gray-400">(inativo)</span>}</p>
                <p className="text-sm text-gray-500">{sponsor.url}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(sponsor)} className="text-blue-600 hover:text-blue-800 text-sm">Editar</button>
                <button onClick={() => setDeletingId(sponsor.id)} className="text-red-500 hover:text-red-700 text-sm">Remover</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Acrescentar o link "Patrocínio" na página do evento**

Em `app/organizador/eventos/[id]/page.tsx`, no bloco "Ações" (grid com "Ver inscritos",
"Relatório Geral", "Redes sociais", "Importar resultados", "Entrega de kits"):

```tsx
        <Link href={`/organizador/eventos/${id}/redes-sociais`} className="btn-secondary text-center">
          Redes sociais
        </Link>
        <Link href={`/organizador/eventos/${id}/patrocinio`} className="btn-secondary text-center">
          Patrocínio
        </Link>
```

(O grid é `grid-cols-2 sm:grid-cols-4` com 5 itens hoje — vira 6. Não precisa ajustar as
classes de grid, o layout já quebra linha automaticamente.)

- [ ] **Step 3: Remover o campo "Link de patrocínio" de `EditEventForm.tsx`**

Em `components/organizer/EditEventForm.tsx`, remover:
- `sponsorLink: z.string().optional(),` do `schema` (zod).
- `sponsorLink?: string | null;` do tipo `EventData`.
- `sponsorLink: event.sponsorLink ?? "",` de `defaultValues`.
- O bloco JSX inteiro:
  ```tsx
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link de patrocínio</label>
        <input {...register("sponsorLink")} className="input w-full" placeholder="Strava, página do patrocinador etc." />
      </div>
  ```

**Não remover** o bloco "Organizador deste evento" logo abaixo (feature diferente, já
implementada nesta mesma sessão) — só o campo de patrocínio sai.

- [ ] **Step 4: Remover `sponsorLink` da API de edição de evento**

Em `app/api/events/[id]/route.ts`, remover a linha `sponsorLink:
z.string().optional().nullable(),` de `updateEventSchema`.

- [ ] **Step 5: Remover `sponsorLink` do select da página de editar**

Em `app/organizador/eventos/[id]/editar/page.tsx`, remover `sponsorLink: true` da lista de
campos do `select` (linha com `city: true, state: true, maxParticipants: true,
organizerContact: true, sponsorLink: true,` — vira só até `organizerContact: true,`, sem
`sponsorLink: true`).

- [ ] **Step 6: Remover `sponsorLink` do schema e escrever a migration final de DROP**

Em `prisma/schema.prisma`, remover a linha `sponsorLink                  String?` do
`model Event`.

Criar `prisma/migrations/20260818010000_drop_event_sponsor_link/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "events" DROP COLUMN "sponsorLink";
```

- [ ] **Step 7: Regenerar o Prisma Client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client ...`, sem erros.

- [ ] **Step 8: Rodar typecheck e a suíte de testes inteira**

Run: `npx tsc --noEmit`
Expected: sem erros — este é o ponto em que qualquer referência esquecida a
`sponsorLink`/`link_patrocinio` em qualquer arquivo do projeto aparece como erro de tipo
(o campo não existe mais no Prisma Client). Se aparecer, resolver antes de prosseguir —
não deve sobrar nenhuma.

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 9: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/organizador/eventos/<id>/patrocinio`. Confirmar:
- Cadastrar um patrocinador novo (nome, link, mensagem), ele aparece na lista.
- Editar (mudar mensagem/ativo), salvar, reabrir a página: os valores persistem.
- Remover um patrocinador usando o `ConfirmModal` (não deve haver nenhum `confirm()`
  nativo do navegador em nenhum momento).
- O link "Patrocínio" aparece na página do evento e leva pra essa tela.
- O campo "Link de patrocínio" não aparece mais em "Editar evento".
- Abrir a edição de template de `ORDER_CONFIRMED` (Admin → Alertas → templates) e
  confirmar que `{{patrocinio}}` aparece como variável disponível, e `{{link_patrocinio}}`
  não aparece mais.

- [ ] **Step 10: Commit (com `git add -f` pra migration)**

```bash
git add "app/organizador/eventos/[id]/patrocinio" "app/organizador/eventos/[id]/page.tsx" components/organizer/EditEventForm.tsx "app/api/events/[id]/route.ts" "app/organizador/eventos/[id]/editar/page.tsx" prisma/schema.prisma
git add -f prisma/migrations/20260818010000_drop_event_sponsor_link/migration.sql
git commit -m "feat: tela de cadastro de patrocinadores por evento, remove sponsorLink antigo"
```

Depois do commit, verificar que a migration foi de fato versionada:

```bash
git show --stat HEAD
git ls-files prisma/migrations/20260818010000_drop_event_sponsor_link/
```

---

## Deploy (fora deste plano — só com autorização explícita do usuário)

Quando o usuário autorizar o deploy desta feature:

1. `git push origin main`.
2. Na VPS: `git pull` → `docker build -t corridas-app:latest .` → `docker compose run --rm
   app sh -c "npx prisma db push --skip-generate"` (aplica as duas migrations desta
   feature: criação de `event_sponsors` + backfill, e depois o DROP de
   `events.sponsorLink`) → `docker compose up -d --no-deps app`.
3. Conferir no banco que todo evento que tinha `sponsorLink` preenchido ganhou exatamente
   1 `EventSponsor` (o backfill já rodou dentro do `db push`, mas vale conferir
   manualmente com uma query direta antes de considerar concluído).
4. **Passo manual nos templates de produção**: via `psql`, nas mesmas linhas de
   `message_templates` (escopo GLOBAL) já editadas nas features de `link_patrocinio` e
   `redes_sociais` (`ORDER_CONFIRMED` EMAIL+WHATSAPP, `ORDER_CONFIRMED_PROXY_BUYER`
   WHATSAPP, `ORDER_CONFIRMED_PROXY_ATHLETE` EMAIL+WHATSAPP), trocar o texto
   `{{link_patrocinio}}` por `{{patrocinio}}`, mantendo a mesma posição/linha em branco já
   usada. Conferir lendo o corpo gravado depois do UPDATE, mesmo padrão das duas features
   anteriores.

---

## Self-Review Notes

- **Spec coverage:** model `EventSponsor` sem `maxSends`/`sends` (Task 1) ✓; backfill
  automático do `sponsorLink` existente (Task 1) ✓; helper sem efeito colateral (Task 2)
  ✓; variável `patrocinio` só nos 3 alertKeys de confirmação, registrada nos DOIS arquivos
  (Task 3) ✓; wiring com separador `\n\n` herdado do helper (Task 4) ✓; API espelhando
  `social-links` (Task 5) ✓; permissões de assistente na MESMA task da API, não deferidas
  pra depois (Task 5) ✓; UI usando `ConfirmModal` (Task 6) ✓; remoção completa do
  `sponsorLink`/`link_patrocinio` antigo, checada por typecheck depois do DROP no Prisma
  Client (Task 6) ✓; passo de deploy manual dos templates de produção documentado (fora
  do plano, seção própria) ✓.
- **Placeholder scan:** nenhum "TBD"/"similar to Task N" — cada task tem o código
  completo, inclusive os testes. O Step 4 da Task 4 tem uma instrução condicional ("se
  algum teste quebrar, ajustar") porque a asserção exata depende do estado do arquivo no
  momento da execução — não é um placeholder de código, é uma verificação a fazer.
- **Type consistency:** `EventSponsor` (Task 1) usado de forma idêntica em
  `lib/event-sponsors.ts` (Task 2), nas rotas (Task 5) e no `type Sponsor` local da UI
  (Task 6, espelha o shape retornado pela API). `getSponsorPromoText(eventId: string):
  Promise<string>` — mesma assinatura usada no único ponto de chamada (Task 4).
  `sponsorPromo` (não `sponsorLink`) é o nome usado de forma consistente em
  `lib/notifications.ts` e `lib/email.ts` a partir da Task 4.
- **Risco de compilação quebrada no meio do plano:** resolvido dividindo a migration em
  duas partes — Task 1 só adiciona, Task 6 remove — para que `sponsorLink` continue
  existindo no Prisma Client durante as Tasks 2-5, quando ainda há código o referenciando.
- **Risco de produção:** as únicas ações que tocam o banco de produção (aplicar as
  migrations, editar os templates) ficam fora das tasks, na seção "Deploy" separada,
  mesmo padrão já estabelecido nas features anteriores.
