# Usuários Assistentes — Fase 2, domínio 3: Cupons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o suporte a usuários assistentes (já construído na Fase 1) ao domínio Cupons, corrigindo junto dois achados de segurança preexistentes e não relacionados a assistentes (rota de listagem sem autenticação nenhuma, e IDOR nas rotas de editar/excluir cupom de organizador).

**Architecture:** Reaproveita 100% da infraestrutura da Fase 1 (`checkApiPermission`, `checkAdminOnlyApiPermission`, `resolveActingScope`) — nenhuma peça nova de infraestrutura, 9 chaves de permissão novas aplicadas a 6 arquivos de rota já existentes, mais a atualização das 2 páginas de gestão de assistentes.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest, Zod — sem dependências novas.

## Global Constraints

- Nenhuma migração de schema — `AssistantPermission.actionKey` já aceita qualquer string.
- `coupons.view` e `coupons.report-export` são as únicas chaves com bypass de admin (mesmo padrão de `registrations.view`) — resolução do evento usa `scope.actingAsAdmin ? findUnique : findFirst({organizerId: scope.organizerId ?? "__none__"})`.
- `coupons.create`, `coupons.edit`, `coupons.delete` NUNCA têm bypass de admin — resolução do evento sempre usa `scope.organizerId ?? "__none__"`, mesmo que a sessão seja um ADMIN titular ou um assistente-de-admin (replica o comportamento atual, onde essas 3 rotas nem aceitam `ADMIN` no *role check*).
- As 4 chaves admin (`coupons.create-any`, `coupons.edit-any`, `coupons.delete-any`, `coupons.export-all`) usam `checkAdminOnlyApiPermission`, sem nenhuma resolução de escopo — acesso total a qualquer cupom/evento já é o comportamento atual dessas 4 rotas.
- **Fix de segurança 1 (fora do sistema de assistentes, mas corrigido nesta mesma mudança):** `GET app/api/events/[id]/coupons/route.ts` não tinha nenhuma autenticação. Ganha `checkApiPermission("coupons.view")` — que já exige sessão — fechando o gap.
- **Fix de segurança 2 (idem):** `PATCH`/`DELETE app/api/events/[id]/coupons/[couponId]/route.ts` atualizavam/excluíam o cupom só por `couponId`, sem confirmar que ele pertence ao evento `id` da URL (IDOR). Ambas ganham uma consulta `db.coupon.findFirst({ where: { id: couponId, eventId: id } })` antes de mutar — se não encontrar, 404.
- `GET app/api/events/[id]/coupons/preview/route.ts` **não é tocado neste plano** — ação de checkout do atleta, fora do escopo (decisão confirmada no spec).
- Nenhuma das 6 rotas tocadas tem teste hoje — todos os testes deste plano são escritos do zero (não há arquivo existente pra estender).
- `app/admin/assistentes/page.tsx` ganha 6 chaves: `coupons.view`, `coupons.report-export`, `coupons.create-any`, `coupons.edit-any`, `coupons.delete-any`, `coupons.export-all`. `app/organizador/assistentes/page.tsx` ganha 5 chaves: `coupons.view`, `coupons.create`, `coupons.edit`, `coupons.delete`, `coupons.report-export`.
- `components/assistants/AssistantManager.tsx` não é modificado — a regra "escrita implica view" já existente (`viewKeys = actionOptions.filter(o => o.key.endsWith(".view"))`) já vai pegar `coupons.view` automaticamente assim que a chave for adicionada aos arrays de `actionOptions`.

---

### Task 1: Rota de organizador — listar (`coupons.view`) e criar (`coupons.create`)

**Files:**
- Modify: `app/api/events/[id]/coupons/route.ts` (`GET`, `POST`)
- Test: `tests/event-coupons-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission(actionKey)`, `resolveActingScope(session)` de `@/lib/auth/rbac` (Fase 1, já existentes, não modificados por esta tarefa).
- Produces: nenhuma interface nova — só troca a checagem interna de cada handler.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/event-coupons-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/coupons/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeGetRequest() {
  return new Request("http://localhost/api/events/ev-1/coupons") as any;
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const validBody = { code: "PROMO10", discountType: "PERCENT", discountValue: 10 };

describe("GET /api/events/[id]/coupons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão (rota deixou de ser pública)", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await GET(makeGetRequest(), makeContext("ev-1"));
    expect(res.status).toBe(401);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("retorna 403 para quem não tem a permissão nem é titular", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeGetRequest(), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("organizador titular vê cupons do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findMany.mockResolvedValueOnce([{ id: "c1", code: "PROMO10" }]);

    const res = await GET(makeGetRequest(), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(200);
  });

  it("organizador titular recebe 404 pra evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest(), makeContext("ev-2"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("admin titular vê cupons de qualquer evento (bypass)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", organizerId: "org-99" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeGetRequest(), makeContext("ev-9"));

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "ev-9" } });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão vê os cupons", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeGetRequest(), makeContext("ev-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest(), makeContext("ev-1"));

    expect(res.status).toBe(403);
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão vê cupons de qualquer evento (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", organizerId: "org-99" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeGetRequest(), makeContext("ev-9"));

    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/[id]/coupons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makePostRequest(validBody), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("organizador titular cria cupom no próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c1", ...validBody });

    const res = await POST(makePostRequest(validBody), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-1", organizerId: "org-1" } });
    expect(res.status).toBe(201);
  });

  it("organizador titular recebe 404 ao tentar criar cupom em evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makePostRequest(validBody), makeContext("ev-2"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("admin titular recebe 404 (SEM bypass — coupons.create não tem)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await POST(makePostRequest(validBody), makeContext("ev-9"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({ where: { id: "ev-9", organizerId: "__none__" } });
    expect(res.status).toBe(404);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão cria cupom no evento do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c2", ...validBody });

    const res = await POST(makePostRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(201);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makePostRequest(validBody), makeContext("ev-1"));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/event-coupons-route.test.ts`
Expected: FAIL — o handler ainda não usa `checkApiPermission`/`resolveActingScope`, e o `GET` ainda não checa sessão.

- [ ] **Step 3: Trocar `app/api/events/[id]/coupons/route.ts`**

Troque o import no topo — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";
```

Troque o `GET` — de:

```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const coupons = await db.coupon.findMany({ where: { eventId: id } });
  return NextResponse.json({ coupons });
}
```

para:

```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("coupons.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const coupons = await db.coupon.findMany({ where: { eventId: id } });
  return NextResponse.json({ coupons });
}
```

Troque o início do `POST` — de:

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
  const check = await checkApiPermission("coupons.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

(o restante do `POST`, a partir de `const body = await req.json();`, permanece idêntico — continua usando `session.user.id` em `createdById`).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/event-coupons-route.test.ts`
Expected: PASS (8 testes em `GET`, 6 em `POST`).

- [ ] **Step 5: Commit**

```bash
git add app/api/events/[id]/coupons/route.ts tests/event-coupons-route.test.ts
git commit -m "feat: gate coupon list/create routes with checkApiPermission, add auth to public list route"
```

---

### Task 2: Rota de organizador — editar (`coupons.edit`) e excluir (`coupons.delete`), com fix de IDOR

**Files:**
- Modify: `app/api/events/[id]/coupons/[couponId]/route.ts` (`PATCH`, `DELETE`)
- Test: `tests/event-coupon-detail-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/event-coupon-detail-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/events/[id]/coupons/[couponId]/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string, couponId: string) {
  return { params: Promise.resolve({ id, couponId }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/coupons/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/events/ev-1/coupons/c1", { method: "DELETE" }) as any;
}

describe("PATCH /api/events/[id]/coupons/[couponId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("organizador titular edita cupom do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });
    dbMock.coupon.update.mockResolvedValueOnce({ id: "c1", maxUses: 5 });

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));

    expect(dbMock.coupon.findFirst).toHaveBeenCalledWith({ where: { id: "c1", eventId: "ev-1" } });
    expect(res.status).toBe(200);
  });

  it("organizador titular recebe 404 ao tentar editar cupom de outro evento (fix do IDOR)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c-de-outro-evento"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão edita o cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });
    dbMock.coupon.update.mockResolvedValueOnce({ id: "c1", maxUses: 5 });

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ maxUses: 5 }), makeContext("ev-1", "c1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/events/[id]/coupons/[couponId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("organizador titular exclui cupom do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));
    const body = await res.json();

    expect(dbMock.coupon.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(body).toEqual({ success: true });
  });

  it("organizador titular recebe 404 ao tentar excluir cupom de outro evento (fix do IDOR)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c-de-outro-evento"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("assistente de organizador com a permissão exclui o cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce({ id: "c1", eventId: "ev-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("ev-1", "c1"));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/event-coupon-detail-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Trocar `app/api/events/[id]/coupons/[couponId]/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";
```

Troque o `PATCH` — de:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; couponId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, couponId } = await params;
  const event = await db.event.findFirst({ where: { id, organizer: { userId: session.user.id } } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { maxUses, expiresAt } = parsed.data;
  const coupon = await db.coupon.update({
    where: { id: couponId },
    data: {
      ...(maxUses !== undefined ? { maxUses } : {}),
      ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
    },
  });
  return NextResponse.json({ coupon });
}
```

para:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; couponId: string }> }) {
  const check = await checkApiPermission("coupons.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, couponId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingCoupon = await db.coupon.findFirst({ where: { id: couponId, eventId: id } });
  if (!existingCoupon) return NextResponse.json({ error: "Cupom não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { maxUses, expiresAt } = parsed.data;
  const coupon = await db.coupon.update({
    where: { id: couponId },
    data: {
      ...(maxUses !== undefined ? { maxUses } : {}),
      ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
    },
  });
  return NextResponse.json({ coupon });
}
```

Troque o `DELETE` — de:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; couponId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, couponId } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  await db.coupon.delete({ where: { id: couponId } });
  return NextResponse.json({ success: true });
}
```

para:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; couponId: string }> }) {
  const check = await checkApiPermission("coupons.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, couponId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingCoupon = await db.coupon.findFirst({ where: { id: couponId, eventId: id } });
  if (!existingCoupon) return NextResponse.json({ error: "Cupom não encontrado" }, { status: 404 });

  await db.coupon.delete({ where: { id: couponId } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/event-coupon-detail-route.test.ts`
Expected: PASS (5 testes em `PATCH`, 5 em `DELETE`).

- [ ] **Step 5: Commit**

```bash
git add app/api/events/[id]/coupons/[couponId]/route.ts tests/event-coupon-detail-route.test.ts
git commit -m "feat: gate coupon edit/delete routes with checkApiPermission, fix IDOR on coupon ownership check"
```

---

### Task 3: Rota de organizador — exportar relatório de uso (`coupons.report-export`)

**Files:**
- Modify: `app/api/events/[id]/coupons/report-export/route.ts` (`GET`)
- Test: `tests/event-coupons-report-export-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/event-coupons-report-export-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/events/[id]/coupons/report-export/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/events/ev-1/coupons/report-export") as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/events/[id]/coupons/report-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeRequest(), makeContext("ev-1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("organizador titular exporta relatório do próprio evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", title: "Corrida X", organizerId: "org-1" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), makeContext("ev-1"));

    expect(dbMock.event.findFirst).toHaveBeenCalledWith({
      where: { id: "ev-1", organizerId: "org-1" },
      select: { id: true, title: true },
    });
    expect(res.status).toBe(200);
  });

  it("organizador titular recebe 404 pra evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), makeContext("ev-2"));

    expect(res.status).toBe(404);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("admin titular exporta relatório de qualquer evento (bypass)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", title: "Corrida Y", organizerId: "org-99" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), makeContext("ev-9"));

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "ev-9" }, select: { id: true, title: true } });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão exporta", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", title: "Corrida X", organizerId: "org-1" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), makeContext("ev-1"));

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), makeContext("ev-1"));

    expect(res.status).toBe(403);
  });

  it("assistente de admin com a permissão exporta de qualquer evento (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-9", title: "Corrida Y", organizerId: "org-99" });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), makeContext("ev-9"));

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/event-coupons-report-export-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Trocar `app/api/events/[id]/coupons/report-export/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
```

Troque o início do `GET` — de:

```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  const event = await db.event.findFirst({
    where: { id, ...(session.user.role !== "ADMIN" ? { organizerId: organizer?.id } : {}) },
    select: { id: true, title: true },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("coupons.report-export");
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
```

(o restante da função, a partir de `const coupons = await db.coupon.findMany(...)`, permanece idêntico).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/event-coupons-report-export-route.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/events/[id]/coupons/report-export/route.ts tests/event-coupons-report-export-route.test.ts
git commit -m "feat: gate coupon report-export route with checkApiPermission"
```

---

### Task 4: Rota admin — criar cupom (`coupons.create-any`)

**Files:**
- Modify: `app/api/admin/coupons/route.ts` (`POST`)
- Test: `tests/admin-coupons-route.test.ts`

**Interfaces:**
- Consumes: `checkAdminOnlyApiPermission(actionKey)` de `@/lib/auth/rbac` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/admin-coupons-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/admin/coupons/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const validBody = { code: "GLOBAL10", discountType: "PERCENT", discountValue: 10, eventId: null };

describe("POST /api/admin/coupons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("admin titular cria cupom global", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c1", ...validBody });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(201);
  });

  it("admin titular cria cupom de um evento específico", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "ev-1" });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c2", ...validBody, eventId: "ev-1" });

    const res = await POST(makeRequest({ ...validBody, eventId: "ev-1" }));

    expect(res.status).toBe(201);
  });

  it("assistente de admin com a permissão cria cupom global", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.coupon.findFirst.mockResolvedValueOnce(null);
    dbMock.coupon.create.mockResolvedValueOnce({ id: "c3", ...validBody });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(201);
  });

  it("assistente de organizador com a chave concedida por engano é barrado (não é assistente de admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(403);
    expect(dbMock.coupon.create).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-coupons-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Trocar `app/api/admin/coupons/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";
```

Troque o início do `POST` — de:

```ts
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
```

para:

```ts
export async function POST(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("coupons.create-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const body = await req.json();
```

(o restante da função permanece idêntico — continua usando `session.user.id` em `createdById` e no `auditLog.create`).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-coupons-route.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/coupons/route.ts tests/admin-coupons-route.test.ts
git commit -m "feat: gate admin coupon create route with checkAdminOnlyApiPermission"
```

---

### Task 5: Rotas admin — editar (`coupons.edit-any`) e excluir (`coupons.delete-any`) qualquer cupom

**Files:**
- Modify: `app/api/admin/coupons/[id]/route.ts` (`PATCH`, `DELETE`)
- Test: `tests/admin-coupon-detail-route.test.ts`

**Interfaces:**
- Consumes: `checkAdminOnlyApiPermission` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/admin-coupon-detail-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH, DELETE } from "@/app/api/admin/coupons/[id]/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/coupons/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeDeleteRequest() {
  return new Request("http://localhost/api/admin/coupons/c1", { method: "DELETE" }) as any;
}

describe("PATCH /api/admin/coupons/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("admin titular edita qualquer cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.coupon.update.mockResolvedValueOnce({ id: "c1", active: false });

    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));

    expect(res.status).toBe(200);
  });

  it("assistente de admin com a permissão edita qualquer cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.coupon.update.mockResolvedValueOnce({ id: "c1", active: false });

    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));

    expect(res.status).toBe(403);
    expect(dbMock.coupon.update).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makePatchRequest({ active: false }), makeContext("c1"));

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/coupons/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));
    expect(res.status).toBe(403);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("admin titular exclui qualquer cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));
    const body = await res.json();

    expect(dbMock.coupon.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(body).toEqual({ ok: true });
  });

  it("admin titular recebe 409 ao excluir cupom já usado em pedido (regra de negócio preexistente, sem regressão)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.order.findFirst.mockResolvedValueOnce({ id: "order-1" });

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));

    expect(res.status).toBe(409);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão exclui qualquer cupom", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.order.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));

    expect(res.status).toBe(403);
    expect(dbMock.coupon.delete).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await DELETE(makeDeleteRequest(), makeContext("c1"));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-coupon-detail-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Trocar `app/api/admin/coupons/[id]/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";
```

Troque o início do `PATCH` — de:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
```

para:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("coupons.edit-any");
  if (!check.allowed) return check.response;

  const { id } = await params;
```

Troque o início do `DELETE` — de:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
```

para:

```ts
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("coupons.delete-any");
  if (!check.allowed) return check.response;

  const { id } = await params;
```

(o restante de ambas as funções permanece idêntico).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-coupon-detail-route.test.ts`
Expected: PASS (5 testes em `PATCH`, 6 em `DELETE`).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/coupons/[id]/route.ts tests/admin-coupon-detail-route.test.ts
git commit -m "feat: gate admin coupon edit/delete routes with checkAdminOnlyApiPermission"
```

---

### Task 6: Rota admin — exportar CSV de todos os cupons (`coupons.export-all`)

**Files:**
- Modify: `app/api/admin/coupons/export/route.ts` (`GET`)
- Test: `tests/admin-coupons-export-route.test.ts`

**Interfaces:**
- Consumes: `checkAdminOnlyApiPermission` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/admin-coupons-export-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/admin/coupons/export/route.ts";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("GET /api/admin/coupons/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("admin titular exporta CSV de todos os cupons", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.groupBy.mockResolvedValueOnce([]);

    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("assistente de admin com a permissão exporta CSV", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.coupon.findMany.mockResolvedValueOnce([]);
    dbMock.order.groupBy.mockResolvedValueOnce([]);

    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(dbMock.coupon.findMany).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-coupons-export-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Trocar `app/api/admin/coupons/export/route.ts`**

Troque o import — de:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue } from "@/lib/admin/events";
```

para:

```ts
import { NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { escapeCsvValue } from "@/lib/admin/events";
```

Troque o início do `GET` — de:

```ts
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const [coupons, usage] = await Promise.all([
```

para:

```ts
export async function GET() {
  const check = await checkAdminOnlyApiPermission("coupons.export-all");
  if (!check.allowed) return check.response;

  const [coupons, usage] = await Promise.all([
```

(o restante da função permanece idêntico).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-coupons-export-route.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/coupons/export/route.ts tests/admin-coupons-export-route.test.ts
git commit -m "feat: gate admin coupon export route with checkAdminOnlyApiPermission"
```

---

### Task 7: UI — adicionar as 9 chaves às páginas de gestão de assistentes

**Files:**
- Modify: `app/admin/assistentes/page.tsx`
- Modify: `app/organizador/assistentes/page.tsx`

**Interfaces:**
- Consumes: `components/assistants/AssistantManager.tsx` (Fase 1, não modificado por esta tarefa).
- Produces: nenhuma interface nova.

Sem testes automatizados nesta tarefa (mesma convenção já usada nos domínios anteriores — as duas páginas são só arrays de configuração passados a um componente já testado indiretamente via suas rotas).

- [ ] **Step 1: Adicionar as 6 chaves a `app/admin/assistentes/page.tsx`**

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
  { key: "batches.create", label: "Criar lote de ingresso (qualquer evento)" },
  { key: "registrations.view", label: "Ver e exportar inscritos (qualquer evento)" },
  { key: "registrations.cancellation-decision-any", label: "Decidir cancelamento (qualquer inscrição)" },
  { key: "registrations.resend-confirmation-email-any", label: "Reenviar e-mail de confirmação (qualquer inscrição)" },
  { key: "registrations.resend-payment-notification-any", label: "Reenviar notificação de erro de pagamento (qualquer inscrição)" },
  { key: "registrations.expire-payments-any", label: "Expirar pagamentos pendentes (plataforma inteira)" },
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
  { key: "registrations.view", label: "Ver e exportar inscritos (qualquer evento)" },
  { key: "registrations.cancellation-decision-any", label: "Decidir cancelamento (qualquer inscrição)" },
  { key: "registrations.resend-confirmation-email-any", label: "Reenviar e-mail de confirmação (qualquer inscrição)" },
  { key: "registrations.resend-payment-notification-any", label: "Reenviar notificação de erro de pagamento (qualquer inscrição)" },
  { key: "registrations.expire-payments-any", label: "Expirar pagamentos pendentes (plataforma inteira)" },
  { key: "coupons.view", label: "Ver cupons de um evento" },
  { key: "coupons.report-export", label: "Exportar relatório de uso de cupons de um evento" },
  { key: "coupons.create-any", label: "Criar cupom (qualquer evento ou global)" },
  { key: "coupons.edit-any", label: "Editar cupom (qualquer)" },
  { key: "coupons.delete-any", label: "Excluir cupom (qualquer)" },
  { key: "coupons.export-all", label: "Exportar CSV de todos os cupons (plataforma inteira)" },
];
```

- [ ] **Step 2: Adicionar as 5 chaves a `app/organizador/assistentes/page.tsx`**

Troque o array `ORGANIZER_EVENT_ACTIONS` — de:

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
  { key: "registrations.view", label: "Ver e exportar meus inscritos" },
  { key: "registrations.cancellation-decision", label: "Decidir cancelamento" },
  { key: "registrations.manual-confirm", label: "Confirmar inscrição manualmente" },
  { key: "registrations.edit-athlete", label: "Editar dados do atleta" },
  { key: "registrations.resend-confirmation-email", label: "Reenviar e-mail de confirmação" },
  { key: "registrations.resend-payment-notification", label: "Reenviar notificação de erro de pagamento" },
  { key: "registrations.expire-payments", label: "Expirar pagamentos pendentes (meus eventos)" },
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
  { key: "registrations.view", label: "Ver e exportar meus inscritos" },
  { key: "registrations.cancellation-decision", label: "Decidir cancelamento" },
  { key: "registrations.manual-confirm", label: "Confirmar inscrição manualmente" },
  { key: "registrations.edit-athlete", label: "Editar dados do atleta" },
  { key: "registrations.resend-confirmation-email", label: "Reenviar e-mail de confirmação" },
  { key: "registrations.resend-payment-notification", label: "Reenviar notificação de erro de pagamento" },
  { key: "registrations.expire-payments", label: "Expirar pagamentos pendentes (meus eventos)" },
  { key: "coupons.view", label: "Ver cupons de um evento" },
  { key: "coupons.create", label: "Criar cupom" },
  { key: "coupons.edit", label: "Editar cupom" },
  { key: "coupons.delete", label: "Excluir cupom" },
  { key: "coupons.report-export", label: "Exportar relatório de uso de cupons" },
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
git commit -m "feat: add Cupons permission keys to assistant management UI"
```
