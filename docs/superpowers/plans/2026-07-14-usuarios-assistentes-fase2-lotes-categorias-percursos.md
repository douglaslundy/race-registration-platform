# Usuários Assistentes — Fase 2: Lotes/Categorias/Percursos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o suporte a usuários assistentes (já construído na Fase 1) ao domínio Lotes/Categorias/Percursos.

**Architecture:** Reaproveita 100% da infraestrutura da Fase 1 (`checkApiPermission`, `resolveActingScope`, schema, UI) — nenhuma peça nova de infraestrutura, só 9 chaves de permissão novas aplicadas a 6 handlers de escrita em 6 arquivos de rota já existentes, mais a atualização das 2 páginas de gestão de assistentes.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest, Zod — sem dependências novas.

## Global Constraints

- **Sem chave `.view` neste domínio.** Os 3 `GET` (listar lotes/categorias/percursos) são públicos hoje (sem checagem de sessão) e continuam exatamente assim — não são tocados por este plano.
- **Só `batches.create` tem bypass de admin** — reproduz o bypass que a rota `POST app/api/events/[id]/batches/route.ts` já tem hoje. As outras 8 chaves (`batches.edit`, `batches.delete`, `categories.create/edit/delete`, `routes.create/edit/delete`) nunca têm bypass de admin — a resolução do evento pai sempre usa `scope.organizerId`, nunca `scope.actingAsAdmin`, mesmo que a sessão seja um ADMIN titular ou um assistente-de-admin.
- Nenhuma rota deste domínio usa `checkAdminOnlyApiPermission` — todas usam `checkApiPermission`.
- Nenhuma migração de schema — `AssistantPermission.actionKey` já aceita qualquer string.
- Não existe teste hoje pras 6 rotas deste domínio — todos os testes desta tarefa são escritos do zero.
- `app/admin/assistentes/page.tsx` ganha só `batches.create` na lista de `actionOptions` (única chave deste domínio com bypass de admin). `app/organizador/assistentes/page.tsx` ganha as 9 chaves.
- `components/assistants/AssistantManager.tsx` não é modificado — a regra "escrita implica view" já existente não afeta estas chaves (nenhuma delas termina em `.view`, então `viewKeys` nunca inclui nada deste domínio).

---

### Task 1: Rotas de Lotes (`batches`)

**Files:**
- Modify: `app/api/events/[id]/batches/route.ts` (`POST`)
- Modify: `app/api/events/[id]/batches/[batchId]/route.ts` (`PATCH`, `DELETE`)
- Test: `tests/event-batches-route.test.ts`
- Test: `tests/event-batch-detail-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission(actionKey)`, `resolveActingScope(session)` de `@/lib/auth/rbac` (Fase 1, já existentes, não modificados por esta tarefa).
- Produces: nenhuma interface nova — só troca a checagem interna de cada handler.

- [ ] **Step 1: Escrever os testes que falham — `batches/route.ts` POST**

Create `tests/event-batches-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/events/[id]/batches/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const validBody = {
  name: "Lote 1",
  priceAmount: 5000,
  capacity: 100,
  startAt: "2026-08-01T00:00:00.000Z",
  endAt: "2026-08-10T00:00:00.000Z",
};

describe("POST /api/events/[id]/batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não tem a permissão nem é titular", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(validBody), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.ticketBatch.create).not.toHaveBeenCalled();
  });

  it("organizador titular cria lote no próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-1", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(201);
  });

  it("organizador titular recebe 404 ao tentar criar lote em evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-2"));

    expect(res.status).toBe(404);
    expect(dbMock.ticketBatch.create).not.toHaveBeenCalled();
  });

  it("admin titular cria lote em qualquer evento (bypass)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", organizerId: "org-99" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-2", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-9"));

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "ev-9" } });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
  });

  it("assistente de organizador com a permissão cria lote no evento do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-3", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(201);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(403);
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(dbMock.event.findUnique).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão cria lote em qualquer evento (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", organizerId: "org-99" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-4", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-9"));

    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Escrever os testes que falham — `batches/[batchId]/route.ts` PATCH/DELETE**

Create `tests/event-batch-detail-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/events/[id]/batches/[batchId]/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, batchId: string) {
  return { params: Promise.resolve({ id, batchId }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/batches/batch-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/events/ev-1/batches/batch-1", { method: "DELETE" }) as any;
}

describe("PATCH /api/events/[id]/batches/[batchId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-1", "batch-1"));
    expect(res.status).toBe(403);
    expect(dbMock.ticketBatch.update).not.toHaveBeenCalled();
  });

  it("organizador titular edita lote do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.update.mockResolvedValueOnce({ id: "batch-1", name: "Novo nome" });

    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-1", "batch-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
  });

  it("admin titular recebe 404 ao tentar editar lote de qualquer evento (SEM bypass — batches.edit não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce(null);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-9", "batch-9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
    expect(dbMock.ticketBatch.update).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão edita o lote", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.update.mockResolvedValueOnce({ id: "batch-1", name: "Novo nome" });

    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-1", "batch-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "Novo nome" }), makeContext("ev-1", "batch-1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/batches/[batchId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "batch-1"));
    expect(res.status).toBe(403);
    expect(dbMock.ticketBatch.delete).not.toHaveBeenCalled();
  });

  it("organizador titular exclui lote do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "batch-1"));
    const body = await res.json();

    expect(dbMock.ticketBatch.delete).toHaveBeenCalledWith({ where: { id: "batch-1" } });
    expect(body).toEqual({ success: true });
  });

  it("assistente de organizador com a permissão exclui o lote", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "batch-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "batch-1"));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/event-batches-route.test.ts tests/event-batch-detail-route.test.ts`
Expected: FAIL — os handlers ainda checam papel manualmente, não `checkApiPermission`.

- [ ] **Step 4: Trocar `app/api/events/[id]/batches/route.ts` (`POST`)**

Troque o import no topo — de:

```ts
import { auth } from "@/lib/auth";
```

para:

```ts
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
```

Troque o corpo do `POST` — de:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const body = await req.json();
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  const event = await db.event.findFirst({
    where: { id: eventId, ...(session.user.role !== "ADMIN" ? { organizerId: organizer?.id } : {}) },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("batches.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id: eventId } = await params;
  const body = await req.json();
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

(o restante da função, a partir de `const batch = await db.ticketBatch.create(...)`, permanece idêntico).

- [ ] **Step 5: Trocar `app/api/events/[id]/batches/[batchId]/route.ts` (`PATCH` e `DELETE`)**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

No `PATCH`, troque:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, batchId } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const check = await checkApiPermission("batches.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, batchId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

No `DELETE`, troque:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, batchId } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const check = await checkApiPermission("batches.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, batchId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

(o restante de ambas as funções, a partir da montagem do `body`/`parsed` no `PATCH` e do `db.ticketBatch.delete` no `DELETE`, permanece idêntico).

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/event-batches-route.test.ts tests/event-batch-detail-route.test.ts`
Expected: PASS (7 testes no primeiro arquivo, 8 no segundo).

- [ ] **Step 7: Commit**

```bash
git add app/api/events/[id]/batches tests/event-batches-route.test.ts tests/event-batch-detail-route.test.ts
git commit -m "feat: gate ticket batch routes with checkApiPermission (batches.create keeps existing admin bypass)"
```

---

### Task 2: Rotas de Categorias (`categories`)

**Files:**
- Modify: `app/api/events/[id]/categories/route.ts` (`POST`)
- Modify: `app/api/events/[id]/categories/[categoryId]/route.ts` (`PATCH`, `DELETE`)
- Test: `tests/event-categories-route.test.ts`
- Test: `tests/event-category-detail-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Escrever os testes que falham — `categories/route.ts` POST**

Create `tests/event-categories-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/events/[id]/categories/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const validBody = { name: "Categoria M30" };

describe("POST /api/events/[id]/categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(validBody), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventCategory.create).not.toHaveBeenCalled();
  });

  it("organizador titular cria categoria no próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.create.mockResolvedValueOnce({ id: "cat-1", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(201);
  });

  it("admin titular recebe 404 (SEM bypass — categories.create não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce(null);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
  });

  it("assistente de organizador com a permissão cria categoria no evento do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.create.mockResolvedValueOnce({ id: "cat-2", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(201);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Escrever os testes que falham — `categories/[categoryId]/route.ts` PATCH/DELETE**

Create `tests/event-category-detail-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/events/[id]/categories/[categoryId]/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, categoryId: string) {
  return { params: Promise.resolve({ id, categoryId }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/categories/cat-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/events/ev-1/categories/cat-1", { method: "DELETE" }) as any;
}

describe("PATCH /api/events/[id]/categories/[categoryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventCategory.update).not.toHaveBeenCalled();
  });

  it("organizador titular edita categoria do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.update.mockResolvedValueOnce({ id: "cat-1", name: "M35" });

    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão edita a categoria", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventCategory.update.mockResolvedValueOnce({ id: "cat-1", name: "M35" });

    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "M35" }), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/categories/[categoryId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventCategory.delete).not.toHaveBeenCalled();
  });

  it("organizador titular exclui categoria do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-1"));
    const body = await res.json();

    expect(dbMock.eventCategory.delete).toHaveBeenCalledWith({ where: { id: "cat-1" } });
    expect(body).toEqual({ success: true });
  });

  it("assistente de organizador com a permissão exclui a categoria", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "cat-1"));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/event-categories-route.test.ts tests/event-category-detail-route.test.ts`
Expected: FAIL.

- [ ] **Step 4: Trocar `app/api/events/[id]/categories/route.ts` (`POST`)**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("categories.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

(o `GET` neste mesmo arquivo não é tocado).

- [ ] **Step 5: Trocar `app/api/events/[id]/categories/[categoryId]/route.ts` (`PATCH` e `DELETE`)**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

No `PATCH`, troque:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, categoryId } = await params;
  const event = await db.event.findFirst({ where: { id, organizer: { userId: session.user.id } } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const check = await checkApiPermission("categories.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, categoryId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

No `DELETE`, troque:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, categoryId } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const check = await checkApiPermission("categories.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, categoryId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/event-categories-route.test.ts tests/event-category-detail-route.test.ts`
Expected: PASS (5 testes no primeiro arquivo, 8 no segundo).

- [ ] **Step 7: Commit**

```bash
git add app/api/events/[id]/categories tests/event-categories-route.test.ts tests/event-category-detail-route.test.ts
git commit -m "feat: gate event category routes with checkApiPermission"
```

---

### Task 3: Rotas de Percursos (`routes`)

**Files:**
- Modify: `app/api/events/[id]/routes/route.ts` (`POST`)
- Modify: `app/api/events/[id]/routes/[routeId]/route.ts` (`PATCH`, `DELETE`)
- Test: `tests/event-routes-route.test.ts`
- Test: `tests/event-route-detail-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Escrever os testes que falham — `routes/route.ts` POST**

Create `tests/event-routes-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/events/[id]/routes/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const validBody = { name: "21km", distanceKm: 21 };

describe("POST /api/events/[id]/routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest(validBody), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventRoute.create).not.toHaveBeenCalled();
  });

  it("organizador titular cria percurso no próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventRoute.create.mockResolvedValueOnce({ id: "route-1", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(201);
  });

  it("admin titular recebe 404 (SEM bypass — routes.create não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce(null);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
  });

  it("assistente de organizador com a permissão cria percurso no evento do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventRoute.create.mockResolvedValueOnce({ id: "route-2", ...validBody });

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(201);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Escrever os testes que falham — `routes/[routeId]/route.ts` PATCH/DELETE**

Create `tests/event-route-detail-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/events/[id]/routes/[routeId]/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, routeId: string) {
  return { params: Promise.resolve({ id, routeId }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/routes/route-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/events/ev-1/routes/route-1", { method: "DELETE" }) as any;
}

describe("PATCH /api/events/[id]/routes/[routeId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makePatchRequest({ name: "42km" }), makeContext("ev-1", "route-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventRoute.update).not.toHaveBeenCalled();
  });

  it("organizador titular edita percurso do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventRoute.update.mockResolvedValueOnce({ id: "route-1", name: "42km" });

    const res = await PATCH(makePatchRequest({ name: "42km" }), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão edita o percurso", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventRoute.update.mockResolvedValueOnce({ id: "route-1", name: "42km" });

    const res = await PATCH(makePatchRequest({ name: "42km" }), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ name: "42km" }), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/routes/[routeId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "route-1"));
    expect(res.status).toBe(403);
    expect(dbMock.eventRoute.delete).not.toHaveBeenCalled();
  });

  it("organizador titular exclui percurso do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "route-1"));
    const body = await res.json();

    expect(dbMock.eventRoute.delete).toHaveBeenCalledWith({ where: { id: "route-1" } });
    expect(body).toEqual({ success: true });
  });

  it("assistente de organizador com a permissão exclui o percurso", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "route-1"));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/event-routes-route.test.ts tests/event-route-detail-route.test.ts`
Expected: FAIL.

- [ ] **Step 4: Trocar `app/api/events/[id]/routes/route.ts` (`POST`)**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

Remova a função auxiliar `getOrganizerEvent` (não será mais usada — a resolução do evento passa a acontecer inline no `POST`, seguindo o mesmo padrão dos outros arquivos deste plano):

```ts
async function getOrganizerEvent(eventId: string, userId: string) {
  return db.event.findFirst({
    where: { id: eventId, organizer: { userId } },
  });
}
```

Troque o corpo do `POST` — de:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const event = await getOrganizerEvent(id, session.user.id);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("routes.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

(o `GET` neste mesmo arquivo não usa `getOrganizerEvent` — confirme lendo o arquivo antes de remover a função, ela é usada só pelo `POST`).

- [ ] **Step 5: Trocar `app/api/events/[id]/routes/[routeId]/route.ts` (`PATCH` e `DELETE`)**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

No `PATCH`, troque:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, routeId } = await params;
  const event = await db.event.findFirst({ where: { id, organizer: { userId: session.user.id } } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  const check = await checkApiPermission("routes.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, routeId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

No `DELETE`, troque:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, routeId } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  const check = await checkApiPermission("routes.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, routeId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/event-routes-route.test.ts tests/event-route-detail-route.test.ts`
Expected: PASS (5 testes no primeiro arquivo, 8 no segundo).

- [ ] **Step 7: Commit**

```bash
git add app/api/events/[id]/routes tests/event-routes-route.test.ts tests/event-route-detail-route.test.ts
git commit -m "feat: gate event route (percursos) routes with checkApiPermission"
```

---

### Task 4: UI — adicionar as 9 chaves às páginas de gestão de assistentes

**Files:**
- Modify: `app/admin/assistentes/page.tsx`
- Modify: `app/organizador/assistentes/page.tsx`

**Interfaces:**
- Consumes: `components/assistants/AssistantManager.tsx` (Fase 1, não modificado por esta tarefa).
- Produces: nenhuma interface nova.

Sem testes automatizados nesta tarefa (mesma convenção já usada na Fase 1 — as duas páginas são
só arrays de configuração passados a um componente já testado indiretamente via suas rotas).

- [ ] **Step 1: Adicionar `batches.create` a `app/admin/assistentes/page.tsx`**

Troque o array `ADMIN_EVENT_ACTIONS` — de:

```ts
const ADMIN_EVENT_ACTIONS = [
  { key: "events.view", label: "Ver eventos e exportar CSV" },
  { key: "events.approve", label: "Aprovar evento" },
  { key: "events.reject", label: "Rejeitar evento" },
  { key: "events.set-fee", label: "Definir taxa de plataforma" },
  { key: "events.edit", label: "Editar evento (qualquer)" },
  { key: "events.delete", label: "Excluir evento (qualquer)" },
  { key: "events.archive", label: "Arquivar/cancelar evento (qualquer)" },
];
```

para:

```ts
const ADMIN_EVENT_ACTIONS = [
  { key: "events.view", label: "Ver eventos e exportar CSV" },
  { key: "events.approve", label: "Aprovar evento" },
  { key: "events.reject", label: "Rejeitar evento" },
  { key: "events.set-fee", label: "Definir taxa de plataforma" },
  { key: "events.edit", label: "Editar evento (qualquer)" },
  { key: "events.delete", label: "Excluir evento (qualquer)" },
  { key: "events.archive", label: "Arquivar/cancelar evento (qualquer)" },
  { key: "batches.create", label: "Criar lote de ingresso (qualquer evento)" },
];
```

- [ ] **Step 2: Adicionar as 9 chaves a `app/organizador/assistentes/page.tsx`**

Troque o array `ORGANIZER_EVENT_ACTIONS` — de:

```ts
const ORGANIZER_EVENT_ACTIONS = [
  { key: "events.view", label: "Ver meus eventos e exportar CSV" },
  { key: "events.create", label: "Criar evento" },
  { key: "events.edit", label: "Editar meus eventos" },
  { key: "events.delete", label: "Excluir meus eventos" },
  { key: "events.archive", label: "Arquivar/cancelar meus eventos" },
  { key: "events.duplicate", label: "Duplicar meus eventos" },
];
```

para:

```ts
const ORGANIZER_EVENT_ACTIONS = [
  { key: "events.view", label: "Ver meus eventos e exportar CSV" },
  { key: "events.create", label: "Criar evento" },
  { key: "events.edit", label: "Editar meus eventos" },
  { key: "events.delete", label: "Excluir meus eventos" },
  { key: "events.archive", label: "Arquivar/cancelar meus eventos" },
  { key: "events.duplicate", label: "Duplicar meus eventos" },
  { key: "batches.create", label: "Criar lote de ingresso" },
  { key: "batches.edit", label: "Editar lote de ingresso" },
  { key: "batches.delete", label: "Excluir lote de ingresso" },
  { key: "categories.create", label: "Criar categoria" },
  { key: "categories.edit", label: "Editar categoria" },
  { key: "categories.delete", label: "Excluir categoria" },
  { key: "routes.create", label: "Criar percurso" },
  { key: "routes.edit", label: "Editar percurso" },
  { key: "routes.delete", label: "Excluir percurso" },
];
```

- [ ] **Step 3: Verificar com typecheck e suíte completa**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npx vitest run`
Expected: todos os testes passam (nenhum teste toca estas duas páginas diretamente).

- [ ] **Step 4: Commit**

```bash
git add app/admin/assistentes/page.tsx app/organizador/assistentes/page.tsx
git commit -m "feat: add Lotes/Categorias/Percursos permission keys to assistant management UI"
```
