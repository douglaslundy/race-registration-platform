# Entrega de kits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizador (e assistentes autorizados) controla, em múltiplos pontos de
retirada simultâneos, a entrega física do kit de cada inscrição confirmada — busca única
(nome/CPF/peito/QR, aceita leitor físico, digitação ou câmera), trava contra dupla
entrega no banco, registro de quem retirou (inclusive terceiro), relatório de progresso
com CSV, e o QR code de cada inscrição disponível na página "Minha inscrição" e anexado
na confirmação de inscrição (e-mail e WhatsApp).

**Architecture:** Model novo `KitDelivery` (1:1 com `Registration`, `registrationId`
único trava dupla entrega). `lib/kit-delivery.ts` concentra as leituras (busca pra
retirada, progresso pro relatório); a escrita (confirmar entrega) fica direto na rota
`POST`, seguindo o padrão já usado por `coupons`/`social-links`. UI cliente
(`/organizador/eventos/[id]/entrega-kits`) com busca/leitura única + confirmação +
relatório embutido; câmera é um botão adicional isolado num componente próprio. QR code
renderizado no navegador (`react-qr-code`, já instalada) e gerado como PNG no servidor
(`qrcode`, nova) pra anexar no e-mail/WhatsApp de confirmação, reaproveitando
`sendMail({ attachments })`/`sendWhatsAppDocument` — mecanismos já usados hoje pro PDF de
relatório de anúncio, sem mexer no motor de renderização de templates.

**Tech Stack:** Next.js App Router, Prisma (Postgres), Vitest, React (client component +
server component), `qrcode` (novo), `qr-scanner` (novo).

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-16-entrega-kits-design.md`.
- **O banco local aponta para produção** — nenhuma task deste plano executa `prisma
  migrate dev`, `prisma db push`, ou qualquer comando que toque o banco de verdade. A
  migration é escrita à mão; aplicá-la em produção acontece fora deste plano, com
  confirmação explícita do usuário. `npx prisma generate` é seguro e necessário rodar
  localmente após a Task 1.
- **`/prisma/migrations/` está no `.gitignore`** — o commit da Task 1 precisa de
  `git add -f` pra `migration.sql`, e verificação depois (`git show --stat` + `git
  ls-files`) que ela foi de fato versionada. Já mordeu várias features anteriores.
- Um kit por inscrição `CONFIRMED` — inscrições não confirmadas nunca podem ter
  `KitDelivery` criado; a rota de confirmação valida isso.
- QR code codifica só `registration.id` (texto puro) — nunca uma URL, nunca dado
  sensível.
- Nunca usar `alert()`/`confirm()`/`prompt()` nativos (regra do `CLAUDE.md`) — usar
  `components/ui/ErrorModal.tsx` pra erros; esta feature não tem fluxo de "excluir algo"
  que precise de `ConfirmModal`.
- Admin (plataforma) só lê o relatório de um evento — nunca confirma entrega de kit
  (mesma assimetria já estabelecida em `coupons`/`social-links`: rotas de escrita
  scoped só por `organizerId`, sem branch `actingAsAdmin`).
- Toda rota nova usa `checkApiPermission`/`resolveActingScope` de `@/lib/auth/rbac`,
  chaves novas `kits.view`/`kits.deliver`, mesmo padrão de `coupons.*`/`social-links.*`.

---

### Task 1: Schema — `KitDelivery` + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260817000000_add_kit_deliveries/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `KitDelivery` no Prisma Client, `Registration.kitDelivery`,
  `User.kitDeliveriesPerformed` — consumidos pelas Tasks 2, 4, 5.

- [ ] **Step 1: Adicionar o model no schema**

Em `prisma/schema.prisma`, logo após o `model EventSocialLink { ... }`/`model
SocialLinkSend { ... }` existentes, acrescentar:

```prisma
model KitDelivery {
  id                 String   @id @default(cuid())
  registrationId     String   @unique
  deliveredAt        DateTime @default(now())
  deliveredByUserId  String
  receivedByName     String
  receivedByDocument String?

  registration Registration @relation(fields: [registrationId], references: [id], onDelete: Cascade)
  deliveredBy  User         @relation(fields: [deliveredByUserId], references: [id])

  @@index([deliveredByUserId])
  @@map("kit_deliveries")
}
```

No `model Registration`, acrescentar a relação logo após `order Order @relation(...)`:

```prisma
  kitDelivery KitDelivery?
```

No `model User`, acrescentar a relação logo após `updatedMessageTemplates
MessageTemplate[]`:

```prisma
  kitDeliveriesPerformed KitDelivery[]
```

- [ ] **Step 2: Escrever a migration à mão**

Criar `prisma/migrations/20260817000000_add_kit_deliveries/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "kit_deliveries" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredByUserId" TEXT NOT NULL,
    "receivedByName" TEXT NOT NULL,
    "receivedByDocument" TEXT,

    CONSTRAINT "kit_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kit_deliveries_registrationId_key" ON "kit_deliveries"("registrationId");

-- CreateIndex
CREATE INDEX "kit_deliveries_deliveredByUserId_idx" ON "kit_deliveries"("deliveredByUserId");

-- AddForeignKey
ALTER TABLE "kit_deliveries" ADD CONSTRAINT "kit_deliveries_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_deliveries" ADD CONSTRAINT "kit_deliveries_deliveredByUserId_fkey" FOREIGN KEY ("deliveredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Não rodar nenhum comando que conecte no banco — o arquivo é só texto.

- [ ] **Step 3: Regenerar o Prisma Client (seguro, não toca no banco)**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client ... to ./node_modules/@prisma/client`, sem erros.

- [ ] **Step 4: Confirmar que o projeto ainda compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit (com `git add -f` pra migration)**

```bash
git add prisma/schema.prisma
git add -f prisma/migrations/20260817000000_add_kit_deliveries/migration.sql
git commit -m "feat: schema de entrega de kits (KitDelivery)"
```

Depois do commit, verificar que a migration foi de fato versionada:

```bash
git show --stat HEAD
git ls-files prisma/migrations/20260817000000_add_kit_deliveries/
```

Ambos precisam listar `migration.sql` — se não listarem, o `git add -f` falhou.

---

### Task 2: `lib/kit-delivery.ts` — busca e relatório

**Files:**
- Create: `lib/kit-delivery.ts`
- Test: `tests/lib-kit-delivery.test.ts`

**Interfaces:**
- Consumes: `KitDelivery`/`Registration` do Prisma Client (Task 1); `normalizeCpf` de
  `@/lib/cpf` (já existe).
- Produces:
  - `findRegistrationForKitDelivery(eventId: string, query: string): Promise<KitDeliverySearchResult[]>`
  - `getKitDeliveryProgress(eventId: string): Promise<KitDeliveryProgress>`
  - Tipos `KitDeliverySearchResult`, `KitDeliveryProgress` (exportados)
  - Consumidos pelas Tasks 4 e 5.

- [ ] **Step 1: Write the failing tests**

Criar `tests/lib-kit-delivery.test.ts`, seguindo o padrão de mock de `db as any` já
usado noutros testes de lib (ex.: `tests/event-social-links.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findRegistrationForKitDelivery, getKitDeliveryProgress } from "@/lib/kit-delivery";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("findRegistrationForKitDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna vazio pra query em branco, sem consultar o banco", async () => {
    const result = await findRegistrationForKitDelivery("event-1", "   ");
    expect(result).toEqual([]);
    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
  });

  it("busca por id exato, peito exato, nome (contains) e CPF de 11 dígitos, só CONFIRMED", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await findRegistrationForKitDelivery("event-1", "123.456.789-00");

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventId: "event-1",
          status: "CONFIRMED",
          OR: expect.arrayContaining([
            { id: "123.456.789-00" },
            { bibNumber: "123.456.789-00" },
            { athlete: { name: { contains: "123.456.789-00", mode: "insensitive" } } },
            { athlete: { athleteProfile: { cpf: "12345678900" } } },
          ]),
        }),
        take: 10,
      }),
    );
  });

  it("não inclui a cláusula de CPF quando a query não tem 11 dígitos", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await findRegistrationForKitDelivery("event-1", "João");

    const call = dbMock.registration.findMany.mock.calls[0][0];
    const hasCpfClause = call.where.OR.some((clause: any) => clause.athlete?.athleteProfile?.cpf);
    expect(hasCpfClause).toBe(false);
  });

  it("mapeia inscrição sem entrega ainda", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        proxyAthleteDisplayName: null,
        bibNumber: "42",
        shirtSize: "M",
        status: "CONFIRMED",
        athlete: { name: "João Silva" },
        category: { name: "Geral" },
        kitDelivery: null,
      },
    ]);

    const result = await findRegistrationForKitDelivery("event-1", "João");

    expect(result).toEqual([
      {
        id: "reg-1",
        athleteName: "João Silva",
        bibNumber: "42",
        shirtSize: "M",
        categoryName: "Geral",
        status: "CONFIRMED",
        delivered: false,
        deliveredAt: null,
        deliveredByName: null,
        receivedByName: null,
      },
    ]);
  });

  it("mapeia inscrição já entregue, usando proxyAthleteDisplayName quando presente", async () => {
    const deliveredAt = new Date("2026-08-20T10:00:00.000Z");
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-2",
        proxyAthleteDisplayName: "Maria (procuração)",
        bibNumber: null,
        shirtSize: null,
        status: "CONFIRMED",
        athlete: { name: "Nome da conta" },
        category: null,
        kitDelivery: {
          deliveredAt,
          receivedByName: "Pedro (amigo)",
          deliveredBy: { name: "Organizador Um" },
        },
      },
    ]);

    const result = await findRegistrationForKitDelivery("event-1", "Maria");

    expect(result[0]).toEqual(
      expect.objectContaining({
        athleteName: "Maria (procuração)",
        delivered: true,
        deliveredAt,
        deliveredByName: "Organizador Um",
        receivedByName: "Pedro (amigo)",
      }),
    );
  });
});

describe("getKitDeliveryProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("conta entregues/pendentes e lista só os pendentes", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        proxyAthleteDisplayName: null,
        bibNumber: "1",
        athlete: { name: "Atleta A", email: "a@example.com", athleteProfile: { phone: "11999990000" } },
        category: { name: "Geral" },
        kitDelivery: { id: "kd-1" },
      },
      {
        id: "reg-2",
        proxyAthleteDisplayName: null,
        bibNumber: "2",
        athlete: { name: "Atleta B", email: "b@example.com", athleteProfile: null },
        category: null,
        kitDelivery: null,
      },
    ]);

    const result = await getKitDeliveryProgress("event-1");

    expect(result).toEqual({
      total: 2,
      delivered: 1,
      pending: [
        {
          id: "reg-2",
          athleteName: "Atleta B",
          bibNumber: "2",
          categoryName: null,
          email: "b@example.com",
          phone: null,
        },
      ],
    });
    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1", status: "CONFIRMED" } }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib-kit-delivery.test.ts`
Expected: FAIL — `Cannot find module '@/lib/kit-delivery'`.

- [ ] **Step 3: Implementar o helper**

Criar `lib/kit-delivery.ts`:

```ts
import { db } from "./db";
import { normalizeCpf } from "./cpf";

export interface KitDeliverySearchResult {
  id: string;
  athleteName: string;
  bibNumber: string | null;
  shirtSize: string | null;
  categoryName: string | null;
  status: string;
  delivered: boolean;
  deliveredAt: Date | null;
  deliveredByName: string | null;
  receivedByName: string | null;
}

export interface KitDeliveryProgress {
  total: number;
  delivered: number;
  pending: Array<{
    id: string;
    athleteName: string;
    bibNumber: string | null;
    categoryName: string | null;
    email: string;
    phone: string | null;
  }>;
}

/** Busca inscrições CONFIRMED de um evento pra retirada de kit — por id exato (vindo de QR lido
 * por câmera, leitor físico, ou colado), número de peito exato, nome (contains, case-insensitive)
 * ou CPF do atleta (só quando a query tem exatamente 11 dígitos após normalizar). Limitado a 10
 * resultados — busca por nome pode ter homônimos, mas a tela mostra um card por resultado. */
export async function findRegistrationForKitDelivery(
  eventId: string,
  query: string,
): Promise<KitDeliverySearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const normalizedCpf = normalizeCpf(trimmed);
  const cpfClause = normalizedCpf.length === 11 ? [{ athlete: { athleteProfile: { cpf: normalizedCpf } } }] : [];

  const registrations = await db.registration.findMany({
    where: {
      eventId,
      status: "CONFIRMED",
      OR: [
        { id: trimmed },
        { bibNumber: trimmed },
        { athlete: { name: { contains: trimmed, mode: "insensitive" } } },
        ...cpfClause,
      ],
    },
    take: 10,
    orderBy: { athlete: { name: "asc" } },
    include: {
      athlete: { select: { name: true } },
      category: { select: { name: true } },
      kitDelivery: { include: { deliveredBy: { select: { name: true } } } },
    },
  });

  return registrations.map((r) => ({
    id: r.id,
    athleteName: r.proxyAthleteDisplayName ?? r.athlete.name,
    bibNumber: r.bibNumber,
    shirtSize: r.shirtSize,
    categoryName: r.category?.name ?? null,
    status: r.status,
    delivered: r.kitDelivery !== null,
    deliveredAt: r.kitDelivery?.deliveredAt ?? null,
    deliveredByName: r.kitDelivery?.deliveredBy.name ?? null,
    receivedByName: r.kitDelivery?.receivedByName ?? null,
  }));
}

/** Progresso de entrega de kits de um evento: total de inscrições CONFIRMED, quantas já têm
 * KitDelivery, e a lista completa das que ainda não têm — usado pelo card de progresso, pela
 * lista de pendentes na tela do organizador/admin, e pelo export CSV. */
export async function getKitDeliveryProgress(eventId: string): Promise<KitDeliveryProgress> {
  const registrations = await db.registration.findMany({
    where: { eventId, status: "CONFIRMED" },
    orderBy: { athlete: { name: "asc" } },
    include: {
      athlete: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
      category: { select: { name: true } },
      kitDelivery: { select: { id: true } },
    },
  });

  const delivered = registrations.filter((r) => r.kitDelivery !== null).length;
  const pending = registrations
    .filter((r) => r.kitDelivery === null)
    .map((r) => ({
      id: r.id,
      athleteName: r.proxyAthleteDisplayName ?? r.athlete.name,
      bibNumber: r.bibNumber,
      categoryName: r.category?.name ?? null,
      email: r.athlete.email,
      phone: r.athlete.athleteProfile?.phone ?? null,
    }));

  return { total: registrations.length, delivered, pending };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib-kit-delivery.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add lib/kit-delivery.ts tests/lib-kit-delivery.test.ts
git commit -m "feat: helpers de busca e relatorio de entrega de kits"
```

---

### Task 3: Permissões — catálogos de assistente

**Files:**
- Modify: `app/organizador/assistentes/page.tsx`
- Modify: `app/admin/assistentes/page.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: chaves `kits.view`/`kits.deliver` disponíveis pra grant de assistente,
  consumidas pelas Tasks 4 e 5 via `checkApiPermission`.

- [ ] **Step 1: Acrescentar as 2 entradas em `app/organizador/assistentes/page.tsx`**

Ler o arquivo primeiro pra confirmar a formatação exata do bloco `coupons.*`/
`social-links.*` já existente (mesmo array de objetos `{ key, label }`), e acrescentar
logo depois:

```ts
  { key: "kits.view", label: "Ver retirada de kits de um evento" },
  { key: "kits.deliver", label: "Confirmar entrega de kit" },
```

- [ ] **Step 2: Acrescentar as mesmas 2 entradas em `app/admin/assistentes/page.tsx`**

Ler o arquivo primeiro pra confirmar a formatação exata (pode diferir levemente do
arquivo do organizador) e acrescentar as entradas equivalentes, mesmas chaves
(`kits.view`, `kits.deliver`), rótulos iguais ou adaptados ao contexto do admin.

- [ ] **Step 3: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add app/organizador/assistentes/page.tsx app/admin/assistentes/page.tsx
git commit -m "feat: permissoes de assistente para entrega de kits"
```

---

### Task 4: API — busca e confirmação de entrega

**Files:**
- Create: `app/api/events/[id]/kit-deliveries/search/route.ts`
- Create: `app/api/events/[id]/kit-deliveries/route.ts`
- Test: `tests/events-kit-deliveries-route.test.ts`

**Interfaces:**
- Consumes: `findRegistrationForKitDelivery` (Task 2); chaves `kits.view`/`kits.deliver`
  (Task 3).
- Produces: `GET /api/events/[id]/kit-deliveries/search?q=...`,
  `POST /api/events/[id]/kit-deliveries`, consumidos pela Task 6.

- [ ] **Step 1: Write the failing tests**

Criar `tests/events-kit-deliveries-route.test.ts`, seguindo o padrão de mock de
`tests/events-social-links-route.test.ts` (mock de `@/lib/auth`, `@/lib/kit-delivery`,
`db as any`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { findRegistrationForKitDelivery } from "@/lib/kit-delivery";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/kit-delivery", () => ({ findRegistrationForKitDelivery: vi.fn() }));

import { GET } from "@/app/api/events/[id]/kit-deliveries/search/route";
import { POST } from "@/app/api/events/[id]/kit-deliveries/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const findMock = vi.mocked(findRegistrationForKitDelivery);

function makeGetRequest(q: string) {
  return new Request(`http://localhost/api/events/event-1/kit-deliveries/search?q=${encodeURIComponent(q)}`) as any;
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/events/event-1/kit-deliveries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("GET /api/events/[id]/kit-deliveries/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("busca e retorna os resultados", async () => {
    findMock.mockResolvedValueOnce([{ id: "reg-1" } as any]);

    const res = await GET(makeGetRequest("João"), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results).toHaveLength(1);
    expect(findMock).toHaveBeenCalledWith("event-1", "João");
  });

  it("retorna vazio sem consultar o helper quando não há query", async () => {
    const res = await GET(makeGetRequest(""), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(data.results).toEqual([]);
    expect(findMock).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET(makeGetRequest("João"), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/events/[id]/kit-deliveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("confirma a entrega com sucesso", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ id: "reg-1", eventId: "event-1", status: "CONFIRMED" });
    dbMock.kitDelivery.create.mockResolvedValueOnce({ id: "kd-1" });

    const res = await POST(
      makePostRequest({ registrationId: "reg-1", receivedByName: "João Silva" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.kitDelivery.create).toHaveBeenCalledWith({
      data: {
        registrationId: "reg-1",
        deliveredByUserId: "organizer-1",
        receivedByName: "João Silva",
        receivedByDocument: null,
      },
    });
  });

  it("rejeita corpo inválido (sem receivedByName)", async () => {
    const res = await POST(
      makePostRequest({ registrationId: "reg-1" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("retorna 404 quando a inscrição não existe ou não está confirmada no evento", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await POST(
      makePostRequest({ registrationId: "reg-1", receivedByName: "João Silva" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(404);
    expect(dbMock.kitDelivery.create).not.toHaveBeenCalled();
  });

  it("retorna 409 quando o kit já foi entregue por outro ponto (unique constraint)", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ id: "reg-1", eventId: "event-1", status: "CONFIRMED" });
    dbMock.kitDelivery.create.mockRejectedValueOnce({ code: "P2002" });

    const res = await POST(
      makePostRequest({ registrationId: "reg-1", receivedByName: "João Silva" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/já foi entregue/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/events-kit-deliveries-route.test.ts`
Expected: FAIL — os arquivos de rota ainda não existem.

- [ ] **Step 3: Implementar `app/api/events/[id]/kit-deliveries/search/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { findRegistrationForKitDelivery } from "@/lib/kit-delivery";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("kits.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ results: [] });

  const results = await findRegistrationForKitDelivery(id, q);
  return NextResponse.json({ results });
}
```

- [ ] **Step 4: Implementar `app/api/events/[id]/kit-deliveries/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const confirmSchema = z.object({
  registrationId: z.string().trim().min(1),
  receivedByName: z.string().trim().min(1),
  receivedByDocument: z.string().trim().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("kits.deliver");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const registration = await db.registration.findFirst({
    where: { id: parsed.data.registrationId, eventId: id, status: "CONFIRMED" },
  });
  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada ou não confirmada" }, { status: 404 });
  }

  try {
    const kitDelivery = await db.kitDelivery.create({
      data: {
        registrationId: parsed.data.registrationId,
        deliveredByUserId: session.user.id,
        receivedByName: parsed.data.receivedByName,
        receivedByDocument: parsed.data.receivedByDocument || null,
      },
    });
    return NextResponse.json({ kitDelivery }, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "Kit já foi entregue (por outro ponto de retirada)" }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/events-kit-deliveries-route.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 6: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add "app/api/events/[id]/kit-deliveries" tests/events-kit-deliveries-route.test.ts
git commit -m "feat: API de busca e confirmacao de entrega de kits"
```

---

### Task 5: API — relatório (JSON e CSV)

**Files:**
- Create: `app/api/events/[id]/kit-deliveries/report/route.ts`
- Create: `app/api/events/[id]/kit-deliveries/report-export/route.ts`
- Test: `tests/events-kit-deliveries-report-route.test.ts`

**Interfaces:**
- Consumes: `getKitDeliveryProgress` (Task 2); `escapeCsvValue` de
  `@/lib/admin/events` (já existe).
- Produces: `GET /api/events/[id]/kit-deliveries/report` (JSON),
  `GET /api/events/[id]/kit-deliveries/report-export` (CSV) — consumidos pelas Tasks 6 e
  8.

- [ ] **Step 1: Write the failing tests**

Criar `tests/events-kit-deliveries-report-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getKitDeliveryProgress } from "@/lib/kit-delivery";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/kit-delivery", () => ({ getKitDeliveryProgress: vi.fn() }));

import { GET as GET_REPORT } from "@/app/api/events/[id]/kit-deliveries/report/route";
import { GET as GET_EXPORT } from "@/app/api/events/[id]/kit-deliveries/report-export/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const progressMock = vi.mocked(getKitDeliveryProgress);

function makeRequest() {
  return new Request("http://localhost/api/events/event-1/kit-deliveries/report") as any;
}

describe("GET /api/events/[id]/kit-deliveries/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("retorna o progresso do evento", async () => {
    progressMock.mockResolvedValueOnce({ total: 5, delivered: 2, pending: [] });

    const res = await GET_REPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ total: 5, delivered: 2, pending: [] });
  });

  it("retorna 404 quando o evento não é do organizador", async () => {
    dbMock.event.findFirst.mockResolvedValueOnce(null);
    const res = await GET_REPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/events/[id]/kit-deliveries/report-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", title: "Corrida Teste" });
  });

  it("gera CSV com cabeçalho e linhas dos pendentes", async () => {
    progressMock.mockResolvedValueOnce({
      total: 2,
      delivered: 1,
      pending: [{ id: "reg-2", athleteName: "Atleta B", bibNumber: "2", categoryName: "Geral", email: "b@example.com", phone: "11999990000" }],
    });

    const res = await GET_EXPORT(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(text).toContain("Nome,Número de peito,Categoria,E-mail,Telefone");
    expect(text).toContain("Atleta B");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/events-kit-deliveries-report-route.test.ts`
Expected: FAIL — os arquivos de rota ainda não existem.

- [ ] **Step 3: Implementar `app/api/events/[id]/kit-deliveries/report/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getKitDeliveryProgress } from "@/lib/kit-delivery";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("kits.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const progress = await getKitDeliveryProgress(id);
  return NextResponse.json(progress);
}
```

- [ ] **Step 4: Implementar `app/api/events/[id]/kit-deliveries/report-export/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getKitDeliveryProgress } from "@/lib/kit-delivery";
import { escapeCsvValue } from "@/lib/admin/events";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("kits.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id }, select: { id: true, title: true } })
    : await db.event.findFirst({
        where: { id, organizerId: scope.organizerId ?? "__none__" },
        select: { id: true, title: true },
      });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const { pending } = await getKitDeliveryProgress(id);

  const header = "Nome,Número de peito,Categoria,E-mail,Telefone\n";
  const rows = pending
    .map((r) =>
      [r.athleteName, r.bibNumber ?? "", r.categoryName ?? "", r.email, r.phone ?? ""]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\n");

  const eventSlug = event.title.toLowerCase().replace(/\s+/g, "-").slice(0, 30);
  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kits-pendentes-${eventSlug}.csv"`,
    },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/events-kit-deliveries-report-route.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 6: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add "app/api/events/[id]/kit-deliveries" tests/events-kit-deliveries-report-route.test.ts
git commit -m "feat: API de relatorio (JSON e CSV) de entrega de kits"
```

---

### Task 6: UI — tela de retirada do organizador

**Files:**
- Create: `app/organizador/eventos/[id]/entrega-kits/page.tsx`
- Modify: `app/organizador/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/events/[id]/kit-deliveries*` (Tasks 4, 5).
- Produces: nada consumido por outras tasks (Task 7 modifica este arquivo em seguida
  pra acrescentar o botão de câmera).

- [ ] **Step 1: Criar a página de retirada**

Criar `app/organizador/eventos/[id]/entrega-kits/page.tsx`, client component. Sem
`ConfirmModal` nesta tela (não há nenhuma ação de excluir) — erros usam
`components/ui/ErrorModal.tsx` como manda o `CLAUDE.md`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ErrorModal from "@/components/ui/ErrorModal";

interface SearchResult {
  id: string;
  athleteName: string;
  bibNumber: string | null;
  shirtSize: string | null;
  categoryName: string | null;
  status: string;
  delivered: boolean;
  deliveredAt: string | null;
  deliveredByName: string | null;
  receivedByName: string | null;
}

interface ReportData {
  total: number;
  delivered: number;
  pending: Array<{ id: string; athleteName: string; bibNumber: string | null; categoryName: string | null }>;
}

export default function EntregaKitsPage() {
  const { id } = useParams<{ id: string }>();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [receivedByName, setReceivedByName] = useState("");
  const [receivedByDocument, setReceivedByDocument] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [report, setReport] = useState<ReportData | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  async function loadReport() {
    const res = await fetch(`/api/events/${id}/kit-deliveries/report`);
    if (!res.ok) {
      setReportError("Não foi possível carregar o relatório de progresso.");
      return;
    }
    setReportError(null);
    setReport(await res.json());
  }

  useEffect(() => {
    void loadReport();
  }, [id]);

  async function runSearch(q: string) {
    setSearchError(null);
    setSearching(true);
    const res = await fetch(`/api/events/${id}/kit-deliveries/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      setSearchError("Erro ao buscar. Tente novamente.");
      setResults([]);
    } else {
      const data = await res.json();
      setResults(data.results ?? []);
    }
    setSearching(false);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  function openConfirm(result: SearchResult) {
    setConfirmingId(result.id);
    setReceivedByName(result.athleteName);
    setReceivedByDocument("");
    setConfirmError(null);
  }

  async function handleConfirm(registrationId: string) {
    setConfirming(true);
    setConfirmError(null);
    const res = await fetch(`/api/events/${id}/kit-deliveries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registrationId,
        receivedByName,
        receivedByDocument: receivedByDocument.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setConfirmError(
        data.error?.formErrors?.[0] ??
          Object.values(fieldErrors ?? {})[0]?.[0] ??
          (typeof data.error === "string" ? data.error : null) ??
          "Erro ao confirmar entrega",
      );
      setConfirming(false);
      return;
    }
    setConfirmingId(null);
    setConfirming(false);
    await runSearch(query);
    void loadReport();
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ErrorModal message={searchError} onClose={() => setSearchError(null)} />

      <div>
        <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">
          ← Voltar
        </Link>
        <h1 className="text-xl font-bold mt-1">Entrega de kits</h1>
        <p className="text-sm text-gray-500">
          Busque por nome, CPF ou número de peito, ou aponte um leitor de código de barras/QR pro
          campo abaixo.
        </p>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nome, CPF, número de peito ou código do QR"
          className="input flex-1"
        />
        <button type="submit" disabled={searching} className="btn-primary">
          {searching ? "Buscando..." : "Buscar"}
        </button>
      </form>

      <div className="space-y-3">
        {results.map((r) => (
          <div key={r.id} className="card space-y-2">
            <div>
              <p className="font-semibold">{r.athleteName}</p>
              <p className="text-sm text-gray-500">
                {r.categoryName ?? "Sem categoria"} · Camiseta {r.shirtSize ?? "—"} · Peito{" "}
                {r.bibNumber ?? "—"}
              </p>
            </div>

            {r.delivered ? (
              <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded px-3 py-2">
                ✓ Já entregue em {r.deliveredAt ? new Date(r.deliveredAt).toLocaleString("pt-BR") : ""} por{" "}
                {r.deliveredByName} — retirado por {r.receivedByName}
              </p>
            ) : confirmingId === r.id ? (
              <div className="space-y-2 border-t dark:border-gray-700 pt-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Retirado por</label>
                  <input
                    value={receivedByName}
                    onChange={(e) => setReceivedByName(e.target.value)}
                    className="input w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Documento (opcional)</label>
                  <input
                    value={receivedByDocument}
                    onChange={(e) => setReceivedByDocument(e.target.value)}
                    className="input w-full"
                  />
                </div>
                {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirm(r.id)}
                    disabled={confirming || !receivedByName.trim()}
                    className="btn-primary text-sm"
                  >
                    {confirming ? "Confirmando..." : "Confirmar entrega"}
                  </button>
                  <button onClick={() => setConfirmingId(null)} className="btn-secondary text-sm">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => openConfirm(r)} className="btn-primary text-sm">
                Confirmar entrega
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Progresso de entrega</h2>
        {reportError && <p className="text-sm text-red-600">{reportError}</p>}
        {report && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {report.delivered} de {report.total} kits entregues
            </p>
            <a
              href={`/api/events/${id}/kit-deliveries/report-export`}
              className="btn-secondary text-sm inline-block"
            >
              Exportar pendentes (CSV)
            </a>
            {report.pending.length > 0 && (
              <ul className="text-sm divide-y dark:divide-gray-700">
                {report.pending.map((p) => (
                  <li key={p.id} className="py-1.5">
                    {p.athleteName} — {p.categoryName ?? "Sem categoria"}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Acrescentar o link na página do evento**

Em `app/organizador/eventos/[id]/page.tsx`, ler o bloco "Ações" existente primeiro
(mesma área onde "Relatório Geral"/"Redes sociais"/"Importar resultados" já estão) e
acrescentar, mantendo a estrutura `grid`/`flex` já usada pelos outros links dessa
sessão:

```tsx
        <Link href={`/organizador/eventos/${id}/entrega-kits`} className="btn-secondary flex-1 text-center">
          Entrega de kits
        </Link>
```

- [ ] **Step 3: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Rodar a suíte completa**

Run: `npm test`
Expected: PASS em todos os arquivos (garante que nada quebrou nas rotas usadas por esta
página).

- [ ] **Step 5: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/organizador/eventos/<id>/entrega-kits`. Confirmar:
- Buscar por nome/CPF/peito mostra os resultados certos.
- Confirmar entrega funciona, e a mesma inscrição buscada de novo mostra "Já entregue".
- O card de progresso atualiza depois de confirmar uma entrega.
- O link "Entrega de kits" aparece na página do evento e leva pra essa tela.
- Nenhum `alert()`/`confirm()` nativo aparece em nenhum momento.

- [ ] **Step 6: Commit**

```bash
git add "app/organizador/eventos/[id]/entrega-kits" "app/organizador/eventos/[id]/page.tsx"
git commit -m "feat: tela de retirada de kits do organizador"
```

---

### Task 7: UI — leitura por câmera

**Files:**
- Create: `components/organizer/QrCameraScanner.tsx`
- Modify: `app/organizador/eventos/[id]/entrega-kits/page.tsx`
- Modify: `package.json` (nova dependência `qr-scanner`)

**Interfaces:**
- Consumes: nada de tasks anteriores além da página da Task 6, que este task modifica.
- Produces: botão "📷 Usar câmera" funcional na tela de retirada.

- [ ] **Step 1: Instalar a dependência**

Run: `npm install qr-scanner`
Expected: adiciona `qr-scanner` a `package.json`/`package-lock.json`, sem erro.

- [ ] **Step 2: Verificar a API real da versão instalada antes de escrever o componente**

**Importante:** não existe garantia de que a assinatura do construtor/callback abaixo
bate exatamente com a versão que o `npm install` trouxe — confirme lendo
`node_modules/qr-scanner/qr-scanner.d.ts` (ou o `README.md` do pacote instalado) antes
de escrever o Step 3. Pontos a confirmar especificamente:
- Assinatura do construtor `new QrScanner(videoElement, onDecodeCallback, options?)`.
- Formato do resultado recebido no callback — objeto `{ data: string, ... }` ou string
  pura, dependendo da versão.
- Nomes exatos dos métodos de iniciar/parar/destruir (`start()`/`stop()`/`destroy()` são
  os nomes esperados, mas confirme).

Se a API divergir do Step 3 abaixo, ajuste o código pra bater com o que o
`.d.ts`/`README.md` realmente documentam — a estrutura do componente (props `onScan`/
`onClose`, modal, estado de erro) continua a mesma, só a chamada à biblioteca muda.

- [ ] **Step 3: Implementar o componente**

Criar `components/organizer/QrCameraScanner.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

export default function QrCameraScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        onScan(typeof result === "string" ? result : result.data);
        onClose();
      },
      { highlightScanRegion: true, highlightCodeOutline: true },
    );
    scanner.start().catch(() => setError("Não foi possível acessar a câmera. Verifique a permissão do navegador."));
    return () => scanner.destroy();
  }, [onScan, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl p-4 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Escanear QR code</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fechar">
            ✕
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <video ref={videoRef} className="w-full rounded-lg" />
      </div>
    </div>
  );
}
```

(A linha `typeof result === "string" ? result : result.data` cobre as duas formas
possíveis de resultado até você confirmar qual a versão instalada realmente devolve no
Step 2 — depois de confirmar, pode simplificar pra só a forma correta.)

- [ ] **Step 4: Integrar na tela de retirada**

Em `app/organizador/eventos/[id]/entrega-kits/page.tsx`, importar o componente e
acrescentar:

```tsx
import QrCameraScanner from "@/components/organizer/QrCameraScanner";
```

Novo estado, junto dos outros `useState` do topo do componente:

```tsx
const [showCamera, setShowCamera] = useState(false);
```

No formulário de busca, acrescentar o botão ao lado do de "Buscar":

```tsx
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nome, CPF, número de peito ou código do QR"
          className="input flex-1"
        />
        <button type="submit" disabled={searching} className="btn-primary">
          {searching ? "Buscando..." : "Buscar"}
        </button>
        <button type="button" onClick={() => setShowCamera(true)} className="btn-secondary" aria-label="Usar câmera">
          📷
        </button>
      </form>

      {showCamera && (
        <QrCameraScanner
          onScan={(value) => {
            setQuery(value);
            void runSearch(value);
          }}
          onClose={() => setShowCamera(false)}
        />
      )}
```

- [ ] **Step 5: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos (confirma que os tipos de `qr-scanner` resolvem certo —
se o pacote não trouxer tipos próprios, pode ser necessário `npm install -D
@types/qr-scanner` ou um `declare module "qr-scanner"` local; ajuste conforme o erro
real do typecheck).

- [ ] **Step 6: Conferir visualmente no navegador (dispositivo com câmera)**

Run: `npm run dev`, abrir `/organizador/eventos/<id>/entrega-kits`, clicar "📷 Usar
câmera". Confirmar:
- O navegador pede permissão de câmera.
- Apontar um QR code (ex.: o de uma inscrição, gerado na Task 8) preenche o campo de
  busca e já dispara a busca automaticamente.
- Fechar o modal (X ou clique fora) libera a câmera (sem indicador de gravação ativo
  depois de fechado).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json components/organizer/QrCameraScanner.tsx "app/organizador/eventos/[id]/entrega-kits/page.tsx"
git commit -m "feat: leitura de QR code por camera na tela de entrega de kits"
```

---

### Task 8: UI — página de relatório do admin (só leitura)

**Files:**
- Create: `components/organizer/KitDeliveryReportCard.tsx`
- Create: `app/admin/eventos/[id]/entrega-kits/page.tsx`
- Modify: `app/organizador/eventos/[id]/entrega-kits/page.tsx` (passa a reaproveitar o
  componente novo em vez do bloco de relatório inline da Task 6)

**Interfaces:**
- Consumes: `getKitDeliveryProgress` (Task 2), `requirePermission` de `@/lib/auth/rbac`
  (já existe), `resolveActingScope` (já existe).
- Produces: `KitDeliveryReportCard` reutilizado pela tela do organizador e pela nova
  página do admin.

- [ ] **Step 1: Extrair o componente de relatório**

Criar `components/organizer/KitDeliveryReportCard.tsx` — componente puro (sem `"use
client"`, sem estado — só exibe dados recebidos via props, pode ser usado tanto de uma
página server component quanto de uma client component):

```tsx
interface KitDeliveryReportCardProps {
  eventId: string;
  total: number;
  delivered: number;
  pending: Array<{ id: string; athleteName: string; bibNumber: string | null; categoryName: string | null }>;
  headingClassName?: string;
}

export default function KitDeliveryReportCard({
  eventId,
  total,
  delivered,
  pending,
  headingClassName = "font-semibold",
}: KitDeliveryReportCardProps) {
  return (
    <div className="card space-y-3">
      <h2 className={headingClassName}>Progresso de entrega</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {delivered} de {total} kits entregues
      </p>
      <a
        href={`/api/events/${eventId}/kit-deliveries/report-export`}
        className="btn-secondary text-sm inline-block"
      >
        Exportar pendentes (CSV)
      </a>
      {pending.length > 0 && (
        <ul className="text-sm divide-y dark:divide-gray-700">
          {pending.map((p) => (
            <li key={p.id} className="py-1.5">
              {p.athleteName} — {p.categoryName ?? "Sem categoria"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Reaproveitar o componente na tela do organizador**

Em `app/organizador/eventos/[id]/entrega-kits/page.tsx`, importar
`KitDeliveryReportCard` e substituir todo o bloco `<div className="card space-y-3">
<h2>Progresso de entrega</h2> ... </div>` (escrito inline na Task 6) por:

```tsx
import KitDeliveryReportCard from "@/components/organizer/KitDeliveryReportCard";
```

```tsx
      <div className="space-y-1">
        {reportError && <p className="text-sm text-red-600">{reportError}</p>}
        {report && (
          <KitDeliveryReportCard
            eventId={id}
            total={report.total}
            delivered={report.delivered}
            pending={report.pending}
          />
        )}
      </div>
```

(Remove a duplicação — a interface local `ReportData` desta página continua igual, já
bate com as props do componente.)

- [ ] **Step 3: Criar a página do admin**

Criar `app/admin/eventos/[id]/entrega-kits/page.tsx`, server component, mesmo padrão de
`app/admin/eventos/[id]/relatorio-geral/page.tsx` se existir (ou de qualquer página
server-side já revisada nesta sessão, ex.: `app/admin/mensagens/page.tsx`, pra
`requirePermission`):

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getKitDeliveryProgress } from "@/lib/kit-delivery";
import KitDeliveryReportCard from "@/components/organizer/KitDeliveryReportCard";

export const metadata: Metadata = { title: "Entrega de kits — Admin" };

export default async function AdminEntregaKitsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("kits.view");
  const { id } = await params;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id }, select: { id: true, title: true } })
    : await db.event.findFirst({
        where: { id, organizerId: scope.organizerId ?? "__none__" },
        select: { id: true, title: true },
      });
  if (!event) notFound();

  const progress = await getKitDeliveryProgress(id);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href={`/admin/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">
          ← Voltar
        </Link>
        <h1 className="text-xl font-bold mt-1">Entrega de kits — {event.title}</h1>
        <p className="text-sm text-gray-500">Acompanhamento só leitura — a confirmação de entrega é feita pelo organizador.</p>
      </div>

      <KitDeliveryReportCard
        eventId={id}
        total={progress.total}
        delivered={progress.delivered}
        pending={progress.pending}
      />
    </div>
  );
}
```

- [ ] **Step 4: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 6: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/admin/eventos/<id>/entrega-kits` logado como admin.
Confirmar:
- Mostra o mesmo progresso/lista de pendentes que a tela do organizador.
- Não tem campo de busca nem botão de confirmar entrega.
- O botão de exportar CSV funciona.

- [ ] **Step 7: Commit**

```bash
git add components/organizer/KitDeliveryReportCard.tsx "app/admin/eventos/[id]/entrega-kits" "app/organizador/eventos/[id]/entrega-kits/page.tsx"
git commit -m "feat: pagina de relatorio de entrega de kits do admin (so leitura)"
```

---

### Task 9: QR code na página "Minha inscrição"

**Files:**
- Modify: `app/dashboard/inscricoes/[id]/page.tsx`

**Interfaces:**
- Consumes: `react-qr-code` (já instalada).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Renderizar o QR code**

Em `app/dashboard/inscricoes/[id]/page.tsx`, importar `QRCode` de `react-qr-code` no
topo do arquivo:

```tsx
import QRCode from "react-qr-code";
```

Acrescentar um card novo, condicionado a `isConfirmed` (variável já existente no
arquivo — ver o fix de 2026-08-16 nesta mesma sessão pra confirmar o nome exato),
logo depois do card "Resumo financeiro" e antes do `<div className="flex gap-3">` final
com os botões "Ver página do evento"/"Cancelar inscrição":

```tsx
      {isConfirmed && (
        <div className="card text-center space-y-3">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">QR code de retirada do kit</h3>
          <p className="text-sm text-gray-500">Apresente este código no ponto de retirada do kit no dia do evento.</p>
          <div className="flex justify-center bg-white p-4 rounded-lg w-fit mx-auto">
            <QRCode value={registration.id} size={180} />
          </div>
        </div>
      )}
```

(O `bg-white p-4` no container do QR é necessário mesmo em dark mode — o leitor de QR
precisa de contraste alto entre o código e o fundo, e o componente `react-qr-code` não
adapta cor sozinho.)

- [ ] **Step 2: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Rodar a suíte completa**

Run: `npm test`
Expected: PASS em todos os arquivos (nenhum teste dedicado a este componente de página,
convenção já estabelecida nesta sessão — mas confirma que nada mais quebrou).

- [ ] **Step 4: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/dashboard/inscricoes/<id>` de uma inscrição `CONFIRMED`.
Confirmar:
- O QR code aparece, legível (testar escaneando com o celular, se possível).
- Não aparece em inscrições `PENDING_PAYMENT`/`CANCELLED`.

- [ ] **Step 5: Commit**

```bash
git add "app/dashboard/inscricoes/[id]/page.tsx"
git commit -m "feat: QR code de retirada de kit na pagina Minha inscricao"
```

---

### Task 10: QR code anexado na confirmação de inscrição

**Files:**
- Create: `lib/kit-qr-code.ts`
- Test: `tests/lib-kit-qr-code.test.ts`
- Modify: `lib/email.ts`
- Modify: `lib/whatsapp.ts` (nenhuma mudança de código — só confirmar que
  `sendWhatsAppDocument` já serve, ver Step 4)
- Modify: `lib/notifications.ts`
- Test: `tests/notifications.test.ts` (ajustar os mocks existentes)
- Modify: `package.json` (nova dependência `qrcode`)

**Interfaces:**
- Consumes: `sendMail` (`@/lib/email`, já existe, aceita `attachments`),
  `sendWhatsAppDocument` (`@/lib/whatsapp`, já existe).
- Produces: `generateKitQrCodePng(registrationId: string): Promise<Buffer>` — usado só
  dentro de `lib/notifications.ts` nesta task.

- [ ] **Step 1: Instalar as dependências**

Run: `npm install qrcode && npm install -D @types/qrcode`
Expected: adiciona `qrcode` e `@types/qrcode` ao `package.json`, sem erro.

- [ ] **Step 2: Write the failing test**

Criar `tests/lib-kit-qr-code.test.ts` (sem mock — testa a geração real, mesmo padrão de
`tests/generate-ad-report-pdf.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { generateKitQrCodePng } from "@/lib/kit-qr-code";

describe("generateKitQrCodePng", () => {
  it("gera um Buffer PNG não vazio a partir do id da inscrição", async () => {
    const buffer = await generateKitQrCodePng("reg-abc123");

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // Assinatura de arquivo PNG: 0x89 "PNG" \r\n \x1a \n
    expect(buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib-kit-qr-code.test.ts`
Expected: FAIL — `Cannot find module '@/lib/kit-qr-code'`.

- [ ] **Step 4: Implementar o gerador**

Criar `lib/kit-qr-code.ts`:

```ts
import QRCode from "qrcode";

/** Gera a imagem PNG do QR code de retirada de kit de uma inscrição — codifica só o
 * `registration.id`, mesmo valor lido pela tela de retirada. Usado pra anexar no e-mail/WhatsApp
 * de confirmação de inscrição (lib/notifications.ts). */
export async function generateKitQrCodePng(registrationId: string): Promise<Buffer> {
  return QRCode.toBuffer(registrationId, { type: "png", width: 300, margin: 2 });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib-kit-qr-code.test.ts`
Expected: PASS.

- [ ] **Step 6: Acrescentar o anexo em `sendRegistrationConfirmationEmail`**

Em `lib/email.ts`, acrescentar `kitQrCodePng?: Buffer` aos `params` de
`sendRegistrationConfirmationEmail` (ao lado de `socialPromo`), e passar pra `sendMail`:

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
  sponsorLink?: string | null;
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
    link_patrocinio: params.sponsorLink ?? "",
    redes_sociais: params.socialPromo ?? "",
  };
  const template = await getEffectiveTemplate(params.alertKey, "EMAIL", params.recipientRole, params.eventId);
  const subject = renderTemplateSubject(template.subject ?? "", values);
  const body = renderTemplate(template.body, values, "EMAIL");
  await sendMail({
    to: params.to,
    subject,
    html: body ? layout(appName, body) : layout(appName, ""),
    messageType: params.alertKey,
    ...(params.kitQrCodePng
      ? { attachments: [{ filename: "qrcode-retirada-kit.png", content: params.kitQrCodePng }] }
      : {}),
    ...(params.eventId ? { relatedEntityType: "Event", relatedEntityId: params.eventId } : {}),
  });
}
```

(A troca de `html: layout(appName, body)` pra um `body ? ... : ...` é só uma
precaução redundante contra `body` vazio — mantenha exatamente como estava se preferir,
o comportamento é idêntico já que `layout()` sempre recebe uma string.)

- [ ] **Step 7: Acrescentar o parâmetro de destino do QR em `sendWhatsAppIfActive`**

Em `lib/notifications.ts`, a função `sendWhatsAppIfActive` ganha um parâmetro novo
`kitQrCodeBase64: string`, e — só depois do envio de texto ter sido bem sucedido, dentro
do mesmo `try`, mas em seu **próprio** `try/catch aninhado** (uma falha aqui NUNCA pode
desfazer o claim de dedupe do texto que já saiu, nem interromper o resto da função) —
manda o documento:

```ts
async function sendWhatsAppIfActive(
  phone: string | null | undefined,
  alertKey: "ORDER_CONFIRMED" | "ORDER_CONFIRMED_PROXY_BUYER" | "ORDER_CONFIRMED_PROXY_ATHLETE",
  recipientRole: "BUYER" | "ATHLETE",
  values: Record<string, string | undefined>,
  eventId: string | undefined,
  claimEntityId: string,
  bypassDedupe: boolean,
  resolveSocialPromo: () => Promise<string>,
  kitQrCodeBase64: string,
): Promise<void> {
  if (!phone) return;
  let claimed = false;
  try {
    if (!(await isWhatsAppConnectionActive())) return;
    claimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");
    if (!claimed) return;
    const template = await getEffectiveTemplate(alertKey, "WHATSAPP", recipientRole, eventId);
    const text = renderTemplate(template.body, { ...values, redes_sociais: await resolveSocialPromo() }, "WHATSAPP");
    await sendWhatsAppMessage(
      phone,
      text,
      alertKey,
      eventId ? { relatedEntityType: "Event", relatedEntityId: eventId } : undefined,
    );
    if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");

    try {
      await sendWhatsAppDocument(phone, kitQrCodeBase64, "qrcode-retirada-kit.png", "Apresente este QR code na retirada do kit");
    } catch (err) {
      console.error("[notifyOrderConfirmed] whatsapp kit QR attachment failed:", err);
    }
  } catch (err) {
    if (claimed && !bypassDedupe) await unclaimAlert(ALERT_TYPE, claimEntityId, "WHATSAPP");
    console.error("[notifyOrderConfirmed] whatsapp failed:", err);
  }
}
```

Acrescentar o import de `sendWhatsAppDocument` no topo do arquivo, ao lado do import já
existente de `sendWhatsAppMessage`:

```ts
import { sendWhatsAppMessage, sendWhatsAppDocument } from "./whatsapp";
```

- [ ] **Step 8: Gerar o QR uma vez e passar pra todos os pontos de envio**

Em `lib/notifications.ts`, dentro de `notifyOrderConfirmed`, logo depois da linha `const
registration = order.registrations[0];`, gerar o QR uma única vez (é puro, sem efeito
colateral — ao contrário do `resolveSocialPromo`, não precisa de memoização condicionada
a guardas de envio):

```ts
    const kitQrCodePng = await generateKitQrCodePng(registration.id);
    const kitQrCodeBase64 = kitQrCodePng.toString("base64");
```

Import no topo do arquivo:

```ts
import { generateKitQrCodePng } from "@/lib/kit-qr-code";
```

Passar `kitQrCodePng` nas duas chamadas de `sendRegistrationConfirmationEmail` (bloco do
comprador e bloco do atleta) — acrescentar `kitQrCodePng,` ao objeto de parâmetros de
cada uma.

Passar `kitQrCodeBase64` como último argumento nas duas chamadas de
`sendWhatsAppIfActive` (bloco do comprador e bloco do atleta) já existentes.

- [ ] **Step 9: Ajustar `tests/notifications.test.ts`**

Os testes existentes de `notifyOrderConfirmed` mockam `sendRegistrationConfirmationEmail`
e `sendWhatsAppMessage` — como a função agora também chama `generateKitQrCodePng` e
(dentro do fluxo de WhatsApp) `sendWhatsAppDocument`, acrescentar mocks pra essas duas
no topo do arquivo de teste, ao lado dos mocks já existentes:

```ts
vi.mock("@/lib/kit-qr-code", () => ({ generateKitQrCodePng: vi.fn().mockResolvedValue(Buffer.from("fake-png")) }));
```

E no mock existente de `@/lib/whatsapp` (ou de onde `sendWhatsAppMessage` for
importado), acrescentar `sendWhatsAppDocument: vi.fn()` ao objeto mockado — sem isso, os
testes existentes que exercitam o caminho de WhatsApp vão tentar chamar a função real e
falhar (ela lança se o WhatsApp não estiver configurado). Ler o arquivo de teste
primeiro pra confirmar a forma exata do mock já existente antes de estender.

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run tests/lib-kit-qr-code.test.ts tests/notifications.test.ts`
Expected: PASS em todos os casos (nenhuma asserção de texto/corpo das mensagens deveria
quebrar — o anexo é um campo adicional, não muda o texto renderizado).

- [ ] **Step 11: Rodar typecheck e a suíte completa**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm test`
Expected: PASS em todos os arquivos (garante que o `generateKitQrCodePng`/
`sendWhatsAppDocument` novos não quebraram nenhum outro teste que exercite
`notifyOrderConfirmed` indiretamente, ex.: `tests/checkout-route.test.ts` se ele chamar
esse fluxo).

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json lib/kit-qr-code.ts lib/email.ts lib/notifications.ts tests/lib-kit-qr-code.test.ts tests/notifications.test.ts
git commit -m "feat: anexa QR code de retirada de kit na confirmacao de inscricao (email e whatsapp)"
```

---

## Self-Review Notes

- **Spec coverage:** model + trava de dupla entrega no banco (Task 1) ✓; busca única
  (id/peito/nome/CPF) + relatório (Task 2) ✓; permissões novas (Task 3) ✓; API de busca
  + confirmação, com 409 em corrida entre pontos simultâneos (Task 4) ✓; API de
  relatório JSON + CSV (Task 5) ✓; tela do organizador com busca/confirmação/relatório
  embutido (Task 6) ✓; leitura por câmera como reforço do campo único (Task 7) ✓;
  página do admin só-leitura reaproveitando o componente de relatório (Task 8) ✓; QR na
  página "Minha inscrição" (Task 9) ✓; QR anexado no e-mail/WhatsApp de confirmação,
  sem mexer no motor de templates (Task 10) ✓.
- **Placeholder scan:** nenhum "TBD"/"similar to Task N" — cada task tem código
  completo, inclusive os testes. A única ressalva documentada é a Task 7 (API exata da
  biblioteca `qr-scanner` depende da versão instalada) — não é um placeholder, é uma
  instrução explícita de verificação porque a API real não pôde ser confirmada durante o
  planejamento (sem acesso à documentação ao vivo nesta sessão); o Step 2 da Task 7 diz
  exatamente o que checar e onde antes de escrever código.
- **Type consistency:** `KitDeliverySearchResult`/`KitDeliveryProgress` (Task 2) usados
  de forma idêntica nas rotas (Tasks 4, 5), na tela do organizador (Task 6) e no
  componente compartilhado (Task 8) — mesmos nomes de campo em todos os pontos
  (`athleteName`, `bibNumber`, `categoryName`, `delivered`, `deliveredAt`,
  `deliveredByName`, `receivedByName`). `generateKitQrCodePng(registrationId: string):
  Promise<Buffer>` (Task 10) é a única assinatura nova em `lib/notifications.ts`/
  `lib/email.ts`, coerente com o padrão já usado por `getSocialPromoText`.
- **Risco de produção:** a única ação que toca o banco de produção (aplicar a migration)
  fica fora das tasks, igual ao padrão já estabelecido nas features anteriores desta
  sessão (redes sociais, link de patrocínio). A Task 10 mexe num fluxo de notificação já
  em produção (`notifyOrderConfirmed`) — mitigado seguindo exatamente o padrão já
  usado por `getSocialPromoText`/`resolveSocialPromo` (falha isolada em try/catch
  aninhado, nunca derruba o envio principal) e testado explicitamente.
- **Risco de corrida entre pontos simultâneos:** a Task 4 usa `create` (não `upsert`) +
  a constraint `@@unique(registrationId)` do banco (Task 1) — duas confirmações
  simultâneas pra a mesma inscrição sempre resultam numa única linha em `kit_deliveries`
  e a segunda chamada recebe 409 com mensagem clara, nunca sobrescreve nem duplica.
