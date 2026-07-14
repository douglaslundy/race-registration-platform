# Usuários Assistentes — Fase 2: Inscrições/Pedidos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o suporte a usuários assistentes (Fase 1 + Fase 2 domínio 1, já construídos) ao domínio Inscrições/Pedidos.

**Architecture:** Reaproveita 100% a infraestrutura já existente (`checkApiPermission`, `checkAdminOnlyApiPermission`, `resolveActingScope`) — 11 chaves de permissão novas aplicadas a 11 handlers em 11 arquivos de rota já existentes (todos já com teste — este plano estende, não cria do zero), mais a atualização das 2 páginas de gestão de assistentes.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest, Zod — sem dependências novas.

## Global Constraints

- **`registrations.view`** (`GET app/api/events/[id]/registrations/route.ts`) é a única chave `.view` deste domínio, com bypass de admin (mesmo padrão de `batches.create`): `scope.actingAsAdmin ? db.event.findUnique(...) : db.event.findFirst({...organizerId: scope.organizerId ?? "__none__"})`.
- **4 chaves com sufixo `-any`** (`registrations.cancellation-decision-any`, `registrations.resend-confirmation-email-any`, `registrations.resend-payment-notification-any`, `registrations.expire-payments-any`) usam `checkAdminOnlyApiPermission` — nenhuma tem filtro de escopo (bypass total já é o comportamento atual dessas 4 rotas admin).
- **6 chaves sem sufixo** (`registrations.cancellation-decision`, `registrations.manual-confirm`, `registrations.edit-athlete`, `registrations.resend-confirmation-email`, `registrations.resend-payment-notification`, `registrations.expire-payments`) usam `checkApiPermission` — a resolução do registro/evento **sempre** usa `scope.organizerId ?? "__none__"`, nunca `scope.actingAsAdmin`, preservando fielmente que `ADMIN` titular nunca tem acesso funcional por essas 6 rotas (ele já tem acesso pelas 4 rotas `-any`, ou não tem rota equivalente nenhuma no caso de `manual-confirm`/`edit-athlete`).
- **Mudança de forma de query (não de comportamento):** as rotas organizer que hoje filtram via `event: { organizer: { userId: session.user.id } } }` passam a filtrar via `event: { organizerId: scope.organizerId ?? "__none__" } }` — mesmo resultado final (mesmo evento, mesmo dono), só a forma da cláusula Prisma muda (direto por `organizerId`, não indiretamente por `organizer.userId`), por consistência com o padrão já usado nas Fases anteriores. Os testes existentes que afirmam o `where` exato precisam ser atualizados para a nova forma.
- **`registrations.expire-payments`** é a única chave que precisa resolver o `organizerUserId` (não `organizerId`) esperado por `lib/payment/expire-payments.ts` — para `ORGANIZER` titular é `session.user.id`; para `ASSISTANT` é o `createdByUserId` do assistente (já é o `userId` do criador diretamente, sem precisar de outra tradução) — ver Task 7 para o código exato.
- Nenhuma migração de schema.
- Todas as 11 rotas já têm teste — este plano ESTENDE cada arquivo, preservando os casos existentes que continuam válidos e ajustando os que dependiam da forma antiga de checagem/query.
- `app/admin/assistentes/page.tsx` ganha 5 chaves (`registrations.view` + as 4 com sufixo `-any`). `app/organizador/assistentes/page.tsx` ganha 7 chaves (`registrations.view` + as 6 sem sufixo).

---

### Task 1: `registrations.view` — listar/exportar inscritos

**Files:**
- Modify: `app/api/events/[id]/registrations/route.ts`
- Modify: `tests/events-registrations-export-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope` de `@/lib/auth/rbac` (já existentes).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Ler o arquivo de teste atual e adicionar os casos novos**

O arquivo já existe com 2 testes (verificando o formato CSV). Adicione estes 4 casos ao `describe` existente, sem remover os 2 já presentes (o `beforeEach` atual já funciona sem mudança — `resolveActingScope` para `ORGANIZER` titular consulta `organizerProfile.findUnique`, já mockado no `beforeEach` existente):

```ts
  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
  });

  it("admin titular vê inscritos de qualquer evento (bypass)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-9" });
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    const res = await GET(
      new Request("http://localhost/api/events/event-9/registrations?format=csv") as any,
      { params: Promise.resolve({ id: "event-9" }) },
    );

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-9" } });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão vê inscritos do evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1" });
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(dbMock.event.findUnique).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que os novos falham**

Run: `npx vitest run tests/events-registrations-export-route.test.ts`
Expected: os 2 testes antigos continuam passando; os 4 novos FALHAM (a rota ainda não usa `checkApiPermission`).

- [ ] **Step 3: Trocar a rota**

Troque o import — de:

```ts
import { auth } from "@/lib/auth";
```

para:

```ts
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
```

Troque:

```ts
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");

  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  const event = await db.event.findFirst({
    where: { id: eventId, ...(session.user.role !== "ADMIN" ? { organizerId: organizer?.id } : {}) },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

para:

```ts
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id: eventId } = await params;
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

(o restante do arquivo, a partir de `const registrations = await db.registration.findMany(...)`, permanece idêntico).

- [ ] **Step 4: Rodar os testes e confirmar que todos passam**

Run: `npx vitest run tests/events-registrations-export-route.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/events/[id]/registrations tests/events-registrations-export-route.test.ts
git commit -m "feat: gate event registrations listing with checkApiPermission (registrations.view)"
```

---

### Task 2: Decidir cancelamento (`cancellation-decision` + `cancellation-decision-any`)

**Files:**
- Modify: `app/api/admin/registrations/[id]/cancellation-decision/route.ts`
- Modify: `app/api/organizer/registrations/[id]/cancellation-decision/route.ts`
- Modify: `tests/admin-cancellation-decision-route.test.ts`
- Modify: `tests/organizer-cancellation-decision-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `checkAdminOnlyApiPermission`, `resolveActingScope`.
- Produces: nenhuma interface nova. `decideRegistrationCancellation` (`lib/registrations/cancellation-decision-service.ts`) não é modificada — continua recebendo um `where` já montado por cada rota.

- [ ] **Step 1: Adicionar casos novos a `tests/admin-cancellation-decision-route.test.ts`**

Adicione ao `describe` existente (os 2 testes já presentes continuam válidos sem mudança — `checkAdminOnlyApiPermission` para `role: "ADMIN"` titular passa direto, igual `role !== "ADMIN"` fazia antes):

```ts
  it("assistente de admin com a permissão decide o cancelamento (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    decideMock.mockResolvedValueOnce({ ok: true, refund: "not_applicable" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(decideMock).toHaveBeenCalledWith({ where: { id: "reg-1" }, decision: "APPROVE", actingUserId: "assistant-1" });
  });

  it("assistente de organizador é barrado com 403 mesmo com a chave -any concedida por engano", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npx vitest run tests/admin-cancellation-decision-route.test.ts`
Expected: os 2 testes antigos passam; os 2 novos FALHAM.

- [ ] **Step 3: Trocar `app/api/admin/registrations/[id]/cancellation-decision/route.ts`**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.cancellation-decision-any");
  if (!check.allowed) return check.response;
  const { session } = check;
```

(o restante do arquivo permanece idêntico).

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `npx vitest run tests/admin-cancellation-decision-route.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Adicionar casos novos a `tests/organizer-cancellation-decision-route.test.ts`**

O teste "escopa a decisão às inscrições de eventos do organizador logado" precisa ser **atualizado** (não só estendido) — a forma do `where` muda de `event: { organizer: { userId: "organizer-1" } } }` para `event: { organizerId: "org-1" } }`. Substitua o `describe` inteiro por:

```ts
describe("POST /api/organizer/registrations/[id]/cancellation-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
  });

  it("retorna 403 para quem não tem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("retorna 400 para um corpo com decision inválida", async () => {
    const res = await POST(makeRequest({ decision: "MAYBE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("escopa a decisão às inscrições de eventos do organizador logado", async () => {
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, refund: "processed" });
    expect(decideMock).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizerId: "org-1" } },
      decision: "APPROVE",
      actingUserId: "organizer-1",
    });
  });

  it("repassa erro e status quando o serviço falha", async () => {
    decideMock.mockResolvedValueOnce({ ok: false, status: 404, error: "Inscrição não encontrada" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Inscrição não encontrada");
  });

  it("assistente de organizador com a permissão decide o cancelamento escopado ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    decideMock.mockResolvedValueOnce({ ok: true, refund: "processed" });

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(decideMock).toHaveBeenCalledWith({
      where: { id: "reg-1", event: { organizerId: "org-1" } },
      decision: "APPROVE",
      actingUserId: "assistant-1",
    });
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ decision: "APPROVE" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar e confirmar RED**

Run: `npx vitest run tests/organizer-cancellation-decision-route.test.ts`
Expected: FAIL (a rota ainda usa a forma antiga de checagem/query).

- [ ] **Step 7: Trocar `app/api/organizer/registrations/[id]/cancellation-decision/route.ts`**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await decideRegistrationCancellation({
    where: { id, event: { organizer: { userId: session.user.id } } },
    decision: parsed.data.decision,
    actingUserId: session.user.id,
  });
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.cancellation-decision");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const scope = await resolveActingScope(session);
  const result = await decideRegistrationCancellation({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
    decision: parsed.data.decision,
    actingUserId: session.user.id,
  });
```

(o restante do arquivo permanece idêntico).

- [ ] **Step 8: Rodar e confirmar GREEN**

Run: `npx vitest run tests/organizer-cancellation-decision-route.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/registrations/[id]/cancellation-decision app/api/organizer/registrations/[id]/cancellation-decision tests/admin-cancellation-decision-route.test.ts tests/organizer-cancellation-decision-route.test.ts
git commit -m "feat: gate registration cancellation-decision routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 3: Confirmação manual (`manual-confirm`)

**Files:**
- Modify: `app/api/organizer/registrations/[id]/manual-confirm/route.ts`
- Modify: `tests/organizer-manual-confirm-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope`.
- Produces: nenhuma interface nova.

Não existe rota admin equivalente pra esta ação — só uma chave (`registrations.manual-confirm`, sem sufixo `-any`).

- [ ] **Step 1: Atualizar `tests/organizer-manual-confirm-route.test.ts`**

Adicione `dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });` ao `beforeEach` existente (logo após o `authMock.mockResolvedValue(...)`, antes do `dbMock.$transaction.mockImplementation(...)`).

Troque o teste "retorna 403 para quem não é organizador nem admin" — de:

```ts
  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

para:

```ts
  it("retorna 403 para quem não tem a permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

Adicione estes 2 casos ao final do `describe` (antes do último `});`):

```ts
  it("assistente de organizador com a permissão confirma a inscrição escopada ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizerId: "org-1" } } }),
    );
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ reason: "Pagamento recebido via PIX manual" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npx vitest run tests/organizer-manual-confirm-route.test.ts`
Expected: os testes que checam o `where` de `registration.findFirst` (404, 400, sucesso) falham — a rota ainda usa `organizer: {userId}}`.

- [ ] **Step 3: Trocar a rota**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe uma justificativa" }, { status: 400 });
  }

  const reason = parsed.data.reason.trim();
  if (reason.length < 5) {
    return NextResponse.json({ error: "Justifique o motivo da confirmação manual" }, { status: 400 });
  }

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.manual-confirm");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe uma justificativa" }, { status: 400 });
  }

  const reason = parsed.data.reason.trim();
  if (reason.length < 5) {
    return NextResponse.json({ error: "Justifique o motivo da confirmação manual" }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  const registration = await db.registration.findFirst({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
```

(o restante da função, a partir de `select: {...`, permanece idêntico).

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `npx vitest run tests/organizer-manual-confirm-route.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/organizer/registrations/[id]/manual-confirm tests/organizer-manual-confirm-route.test.ts
git commit -m "feat: gate manual-confirm route with checkApiPermission (registrations.manual-confirm)"
```

---

### Task 4: Editar dados do atleta (`edit-athlete`)

**Files:**
- Modify: `app/api/organizer/registrations/[id]/athlete/route.ts`
- Modify: `tests/organizer-registration-athlete-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope`.
- Produces: nenhuma interface nova.

Hoje esta rota exige `role === "ORGANIZER"` estritamente (nem `ADMIN` é aceito). Trocando para
`checkApiPermission`, `ADMIN` titular passa a checagem de permissão inicial (já que
`checkApiPermission` sempre aceita `ADMIN`/`ORGANIZER` titular) — mas como a resolução do
registro sempre usa `scope.organizerId` (que é `null` para `ADMIN`, virando o sentinel
`"__none__"`), o resultado final é idêntico ao comportamento atual: `ADMIN` sempre recebe 404
aqui. Não é necessário nenhum tratamento especial para preservar essa exclusão.

- [ ] **Step 1: Atualizar `tests/organizer-registration-athlete-route.test.ts`**

Adicione `dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });` ao `beforeEach` existente.

Troque o teste "retorna 404 quando a inscrição não pertence a evento do organizador" — de:

```ts
  it("retorna 404 quando a inscrição não pertence a evento do organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizer: { userId: "organizer-1" } } },
      }),
    );
  });
```

para:

```ts
  it("retorna 404 quando a inscrição não pertence a evento do organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizerId: "org-1" } },
      }),
    );
  });
```

Adicione estes 3 casos ao final do `describe` (antes do último `});`):

```ts
  it("retorna 404 para admin titular (sem acesso funcional a esta rota, mesmo passando a checagem de permissão)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizerId: "__none__" } } }),
    );
    expect(res.status).toBe(404);
  });

  it("assistente de organizador com a permissão edita o atleta escopado ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique
      .mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } })
      .mockResolvedValueOnce({ athleteUserId: "athlete-1" } as any);
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });

    const res = await PATCH(makeRequest({ name: "Nome Ajustado" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ name: "Nome Ajustado" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

Nota: o mock de `dbMock.user.findUnique` no caso do assistente precisa de cuidado — `resolveActingScope`
chama `db.user.findUnique` (pra resolver `createdBy`) e a própria lógica da rota TAMBÉM chama
`db.user.findUnique` (pra buscar o `existing` do atleta). Encadeie os `mockResolvedValueOnce` na
ordem exata em que são chamados: primeiro o de `resolveActingScope` (dentro de `checkApiPermission`
não — `resolveActingScope` só é chamado depois, então a ordem real é: 1) `assistantPermission.findUnique`
dentro de `checkApiPermission`, 2) `user.findUnique` dentro de `resolveActingScope` (resolve
`createdBy`), 3) `registration.findFirst` (resolve a inscrição), 4) `user.findUnique` de novo
(busca o atleta `existing`). Ajuste a ordem dos `mockResolvedValueOnce` no teste acima para bater
com essa sequência real de chamadas se o teste falhar por ordem errada — rode e observe a mensagem
de erro para confirmar a sequência antes de fechar este passo.

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npx vitest run tests/organizer-registration-athlete-route.test.ts`
Expected: os testes que checam o `where` de `registration.findFirst` falham.

- [ ] **Step 3: Trocar a rota**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: { athleteUserId: true },
  });
```

para:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.edit-athlete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const scope = await resolveActingScope(session);
  const registration = await db.registration.findFirst({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
    select: { athleteUserId: true },
  });
```

(o restante do arquivo permanece idêntico — inclusive o uso de `session.user.id` no `auditLog.create` no final, que continua correto já que `check.session`/`session` é a mesma sessão completa de sempre).

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `npx vitest run tests/organizer-registration-athlete-route.test.ts`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/organizer/registrations/[id]/athlete tests/organizer-registration-athlete-route.test.ts
git commit -m "feat: gate athlete-edit route with checkApiPermission (registrations.edit-athlete)"
```

---

### Task 5: Reenviar e-mail de confirmação (`resend-confirmation-email` + `-any`)

**Files:**
- Modify: `app/api/admin/registrations/[id]/resend-confirmation-email/route.ts`
- Modify: `app/api/organizer/registrations/[id]/resend-confirmation-email/route.ts`
- Modify: `tests/admin-resend-confirmation-email-route.test.ts`
- Modify: `tests/organizer-resend-confirmation-email-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `checkAdminOnlyApiPermission`, `resolveActingScope`.
- Produces: nenhuma interface nova.

- [ ] **Step 1: Adicionar casos novos a `tests/admin-resend-confirmation-email-route.test.ts`**

Troque o teste "retorna 403 para quem não é admin (inclusive organizador)" — de:

```ts
  it("retorna 403 para quem não é admin (inclusive organizador)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

para (mesmo corpo, só o nome do teste muda para refletir que agora é um bloqueio de permissão, não de role bruto):

```ts
  it("retorna 403 para quem não tem a permissão (inclusive organizador titular)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

Adicione estes 2 casos ao final do `describe`:

```ts
  it("assistente de admin com a permissão reenvia o e-mail (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente de organizador é barrado com 403 mesmo com a chave -any concedida por engano", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npx vitest run tests/admin-resend-confirmation-email-route.test.ts`
Expected: os 2 novos testes falham.

- [ ] **Step 3: Trocar `app/api/admin/registrations/[id]/resend-confirmation-email/route.ts`**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.resend-confirmation-email-any");
  if (!check.allowed) return check.response;
  const { session } = check;
```

(o restante do arquivo permanece idêntico).

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `npx vitest run tests/admin-resend-confirmation-email-route.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Adicionar casos novos a `tests/organizer-resend-confirmation-email-route.test.ts`**

Adicione `dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });` ao `beforeEach`.

Troque o teste "retorna 403 para quem não é organizador nem admin" — de:

```ts
  it("retorna 403 para quem não é organizador nem admin", async () => {
```

para:

```ts
  it("retorna 403 para quem não tem a permissão", async () => {
```

(corpo idêntico).

Troque o teste de sucesso — de:

```ts
  it("chama notifyOrderConfirmed e grava auditoria", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizer: { userId: "organizer-1" } } },
      }),
    );
```

para:

```ts
  it("chama notifyOrderConfirmed e grava auditoria", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizerId: "org-1" } },
      }),
    );
```

(o restante desse teste, a partir de `expect(notifyOrderConfirmed)...`, permanece idêntico).

Adicione estes 2 casos ao final do `describe`:

```ts
  it("assistente de organizador com a permissão reenvia o e-mail escopado ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Rodar e confirmar RED**

Run: `npx vitest run tests/organizer-resend-confirmation-email-route.test.ts`
Expected: FAIL nos testes que checam o `where` novo.

- [ ] **Step 7: Trocar `app/api/organizer/registrations/[id]/resend-confirmation-email/route.ts`**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: { id: true, status: true, order: { select: { id: true } } },
  });
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.resend-confirmation-email");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);

  const registration = await db.registration.findFirst({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
    select: { id: true, status: true, order: { select: { id: true } } },
  });
```

(o restante do arquivo permanece idêntico).

- [ ] **Step 8: Rodar e confirmar GREEN**

Run: `npx vitest run tests/organizer-resend-confirmation-email-route.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/registrations/[id]/resend-confirmation-email app/api/organizer/registrations/[id]/resend-confirmation-email tests/admin-resend-confirmation-email-route.test.ts tests/organizer-resend-confirmation-email-route.test.ts
git commit -m "feat: gate resend-confirmation-email routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 6: Reenviar notificação de erro de pagamento (`resend-payment-notification` + `-any`)

**Files:**
- Modify: `app/api/admin/registrations/[id]/resend-payment-notification/route.ts`
- Modify: `app/api/organizer/registrations/[id]/resend-payment-notification/route.ts`
- Modify: `tests/admin-resend-payment-notification-route.test.ts`
- Modify: `tests/organizer-resend-payment-notification-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `checkAdminOnlyApiPermission`, `resolveActingScope`.
- Produces: nenhuma interface nova.

- [ ] **Step 1: Adicionar casos novos a `tests/admin-resend-payment-notification-route.test.ts`**

Troque "retorna 403 para quem não é admin (inclusive organizador)" para "retorna 403 para quem não tem a permissão (inclusive organizador titular)" (mesmo corpo).

Adicione ao final do `describe`:

```ts
  it("assistente de admin com a permissão reenvia a notificação (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente de organizador é barrado com 403 mesmo com a chave -any concedida por engano", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npx vitest run tests/admin-resend-payment-notification-route.test.ts`
Expected: os 2 novos testes falham.

- [ ] **Step 3: Trocar `app/api/admin/registrations/[id]/resend-payment-notification/route.ts`**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.resend-payment-notification-any");
  if (!check.allowed) return check.response;
  const { session } = check;
```

(o restante permanece idêntico).

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `npx vitest run tests/admin-resend-payment-notification-route.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Adicionar casos novos a `tests/organizer-resend-payment-notification-route.test.ts`**

Adicione `dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });` ao `beforeEach`.

Troque "retorna 403 para quem não é organizador nem admin" para "retorna 403 para quem não tem a permissão" (mesmo corpo).

Troque o `where` esperado no teste "chama notifyPaymentError com bypassDedupe e grava auditoria" — de `event: { organizer: { userId: "organizer-1" } } }` para `event: { organizerId: "org-1" } }`.

Adicione ao final do `describe`:

```ts
  it("assistente de organizador com a permissão reenvia a notificação escopada ao evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationFixture);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Rodar e confirmar RED**

Run: `npx vitest run tests/organizer-resend-payment-notification-route.test.ts`
Expected: FAIL nos testes que checam o `where` novo.

- [ ] **Step 7: Trocar `app/api/organizer/registrations/[id]/resend-payment-notification/route.ts`**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.resend-payment-notification");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);

  const registration = await db.registration.findFirst({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
```

(o restante do arquivo, a partir de `select: {`, permanece idêntico).

- [ ] **Step 8: Rodar e confirmar GREEN**

Run: `npx vitest run tests/organizer-resend-payment-notification-route.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/registrations/[id]/resend-payment-notification app/api/organizer/registrations/[id]/resend-payment-notification tests/admin-resend-payment-notification-route.test.ts tests/organizer-resend-payment-notification-route.test.ts
git commit -m "feat: gate resend-payment-notification routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 7: Expirar pagamentos pendentes (`expire-payments` + `-any`)

**Files:**
- Modify: `app/api/admin/expire-payments/route.ts`
- Modify: `app/api/organizer/expire-payments/route.ts`
- Modify: `tests/admin-expire-payments-route.test.ts`
- Modify: `tests/organizer-expire-payments-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `checkAdminOnlyApiPermission`, `resolveActingScope`.
- Produces: nenhuma interface nova.

`lib/payment/expire-payments.ts` espera `organizerUserId` (o `User.id` do organizador titular),
não `organizerId` (o `OrganizerProfile.id`) — essa rota é a única do domínio que precisa dessa
tradução extra. Para `ORGANIZER` titular, `organizerUserId` é o próprio `session.user.id`. Para
`ASSISTANT`, é o `createdByUserId` do assistente (já é o `User.id` do criador diretamente — não
precisa de outra consulta além da que `resolveActingScope` já faz internamente, mas como
`resolveActingScope` não expõe esse valor no seu retorno, esta rota faz sua própria consulta
pontual quando `session.user.role === "ASSISTANT"`).

- [ ] **Step 1: Adicionar casos novos a `tests/admin-expire-payments-route.test.ts`**

Adicione ao final do `describe`:

```ts
  it("assistente de admin com a permissão dispara a expiração sem filtro (bypass também vale pra ele)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 1, expired: 1 });
    vi.mocked(expireAbandonedOrders).mockResolvedValueOnce({ checked: 0, expired: 0 });

    const res = await POST();

    expect(expirePendingPayments).toHaveBeenCalledWith();
    expect(expireAbandonedOrders).toHaveBeenCalledWith();
    expect(res.status).toBe(200);
  });

  it("assistente de organizador é barrado com 403 mesmo com a chave -any concedida por engano", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST();

    expect(res.status).toBe(403);
    expect(expirePendingPayments).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npx vitest run tests/admin-expire-payments-route.test.ts`
Expected: os 2 novos testes falham.

- [ ] **Step 3: Trocar `app/api/admin/expire-payments/route.ts`**

Troque o import — de `import { auth } from "@/lib/auth";` para `import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";`.

Troque:

```ts
export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
```

para:

```ts
export async function POST() {
  const check = await checkAdminOnlyApiPermission("registrations.expire-payments-any");
  if (!check.allowed) return check.response;
```

(o restante do arquivo permanece idêntico — note que esta rota nunca usou `session` no corpo, então não é necessário extrair `const { session } = check;`).

- [ ] **Step 4: Rodar e confirmar GREEN**

Run: `npx vitest run tests/admin-expire-payments-route.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Adicionar casos novos a `tests/organizer-expire-payments-route.test.ts`**

Troque "retorna 403 para quem não é organizador nem admin" para "retorna 403 para quem não tem a permissão" (mesmo corpo).

Adicione ao final do `describe`:

```ts
  it("assistente de organizador com a permissão roda os mecanismos escopados ao userId do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique
      .mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } })
      .mockResolvedValueOnce({ createdByUserId: "org-user-1" });
    vi.mocked(expirePendingPayments).mockResolvedValueOnce({ checked: 1, expired: 0 });
    vi.mocked(expireAbandonedOrders).mockResolvedValueOnce({ checked: 0, expired: 0 });

    const res = await POST();

    expect(expirePendingPayments).toHaveBeenCalledWith({ organizerUserId: "org-user-1" });
    expect(expireAbandonedOrders).toHaveBeenCalledWith({ organizerUserId: "org-user-1" });
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST();

    expect(res.status).toBe(403);
    expect(expirePendingPayments).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Rodar e confirmar RED**

Run: `npx vitest run tests/organizer-expire-payments-route.test.ts`
Expected: os 2 novos testes falham.

- [ ] **Step 7: Trocar `app/api/organizer/expire-payments/route.ts`**

Replace o arquivo inteiro com:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission } from "@/lib/auth/rbac";
import { expirePendingPayments, expireAbandonedOrders } from "@/lib/payment/expire-payments";

export async function POST() {
  const check = await checkApiPermission("registrations.expire-payments");
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

  const [payments, orders] = await Promise.all([
    expirePendingPayments({ organizerUserId }),
    expireAbandonedOrders({ organizerUserId }),
  ]);
  return NextResponse.json({ checked: payments.checked + orders.checked, expired: payments.expired + orders.expired });
}
```

- [ ] **Step 8: Rodar e confirmar GREEN**

Run: `npx vitest run tests/organizer-expire-payments-route.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 9: Rodar o suite completo e o typecheck**

Run: `npx vitest run`
Expected: nenhuma regressão nos testes de outras rotas.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add app/api/admin/expire-payments app/api/organizer/expire-payments tests/admin-expire-payments-route.test.ts tests/organizer-expire-payments-route.test.ts
git commit -m "feat: gate expire-payments routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 8: UI — adicionar as 11 chaves às páginas de gestão de assistentes

**Files:**
- Modify: `app/admin/assistentes/page.tsx`
- Modify: `app/organizador/assistentes/page.tsx`

**Interfaces:**
- Consumes: `components/assistants/AssistantManager.tsx` (não modificado).
- Produces: nenhuma interface nova.

Sem testes automatizados nesta tarefa (mesma convenção já usada nas tarefas de UI anteriores).

- [ ] **Step 1: Adicionar as 5 chaves admin a `app/admin/assistentes/page.tsx`**

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
];
```

- [ ] **Step 2: Adicionar as 7 chaves organizador a `app/organizador/assistentes/page.tsx`**

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
];
```

- [ ] **Step 3: Verificar com typecheck e suíte completa**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 4: Commit**

```bash
git add app/admin/assistentes/page.tsx app/organizador/assistentes/page.tsx
git commit -m "feat: add Inscrições/Pedidos permission keys to assistant management UI"
```
