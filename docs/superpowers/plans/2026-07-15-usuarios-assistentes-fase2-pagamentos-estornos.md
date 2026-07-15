# Usuários Assistentes — Fase 2, domínio 4: Pagamentos/Estornos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o suporte a usuários assistentes (já construído na Fase 1) ao domínio
Pagamentos/Estornos, usando o padrão de resolução local de `organizerUserId` já validado em
`app/api/organizer/expire-payments/route.ts` (Fase 2 domínio 2).

**Architecture:** Reaproveita 100% da infraestrutura da Fase 1 (`checkApiPermission`,
`checkAdminOnlyApiPermission`) — nenhuma peça nova de infraestrutura, `lib/auth/rbac.ts`
permanece intocado. 8 chaves de permissão novas aplicadas a 7 arquivos de rota já existentes
(8 handlers), mais a atualização das 2 páginas de gestão de assistentes.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest, Zod — sem dependências novas.

## Global Constraints

- Nenhuma migração de schema — `AssistantPermission.actionKey` já aceita qualquer string.
- **As 3 chaves de organizador (`payments.refund`, `payments.manual-resolve`,
  `payments.reconciliation`) usam resolução LOCAL de `organizerUserId`, NÃO
  `resolveActingScope`** — o padrão exato já usado em `app/api/organizer/expire-payments/
  route.ts`:
  ```ts
  let organizerUserId = session.user.id;
  if (session.user.role === "ASSISTANT") {
    const assistant = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    organizerUserId = assistant?.createdByUserId ?? "__none__";
  }
  ```
  Motivo: as queries destas 3 rotas filtram por `organizer: {userId: ...}` (relação até
  `User.id`), não por `organizerId` (campo direto de `OrganizerProfile.id` usado nos domínios já
  convertidos). `resolveActingScope` resolve `OrganizerProfile.id`, não serve aqui.
- **Nenhuma das 3 chaves de organizador tem bypass de admin** — replica o "bug" já visto em
  todos os domínios anteriores (role check aceita `ADMIN`, mas a resolução nunca dá acesso
  funcional, porque a conta do `ADMIN` titular — ou o `createdByUserId` de um assistente-de-admin
  — nunca é dona de nenhum evento).
- **As 5 chaves admin usam `checkAdminOnlyApiPermission`, sem nenhuma resolução de escopo** —
  acesso total a qualquer pagamento/estorno/conciliação já é o comportamento atual dessas 5
  rotas.
- **`initiatedByUserId`/`resolvedByUserId` continuam sendo `session.user.id`** (o ator real, seja
  titular ou assistente) mesmo quando `organizerUserId` é resolvido para o `createdByUserId` do
  criador — é o mesmo padrão de auditoria já usado em `createdById`/`resolvedByUserId` nos
  domínios anteriores (quem fez a ação, não de quem é a conta).
- **6 das 8 rotas já têm teste hoje** (diferente do que uma leitura só do catálogo sugeriria) —
  `manual-resolve` (organizador e admin), `reconciliation` (organizador e admin), e as 2 rotas de
  exportação de pagamento já têm arquivo de teste; cada um será lido e estendido com os casos
  novos de permissão, nunca recriado do zero. Só as 2 rotas de `refund` (organizador e admin,
  Task 1) não têm teste nenhum hoje — únicas escritas do zero neste plano.
- `app/admin/assistentes/page.tsx` ganha 5 chaves (`payments.refund-any`,
  `.manual-resolve-any`, `.reconciliation-any`, `.export`, `.export-all`).
  `app/organizador/assistentes/page.tsx` ganha 3 chaves (`payments.refund`, `.manual-resolve`,
  `.reconciliation`).
- `app/api/cron/reconciliation/route.ts` não é tocado por este plano (autenticação por segredo
  de cron, não sessão de usuário — fora do sistema de assistentes).

---

### Task 1: Estorno de pagamento (`payments.refund` + `payments.refund-any`)

**Files:**
- Modify: `app/api/organizer/registrations/[id]/refund/route.ts`
- Modify: `app/api/admin/payments/[id]/refund/route.ts`
- Test: `tests/organizer-payment-refund-route.test.ts`
- Test: `tests/admin-payment-refund-route.test.ts`

**Interfaces:**
- Consumes: `checkApiPermission`, `checkAdminOnlyApiPermission` de `@/lib/auth/rbac` (Fase 1, já
  existentes, não modificados por esta tarefa). `refundPayment(params: {paymentId, initiatedByUserId,
  reason?}): Promise<{alreadySynced: boolean}>` de `@/lib/payment/refund-service` (já existente,
  não modificado).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Escrever os testes que falham — rota de organizador**

Create `tests/organizer-payment-refund-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));

import { POST } from "@/app/api/organizer/registrations/[id]/refund/route";
import { refundPayment } from "@/lib/payment/refund-service";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const refundPaymentMock = vi.mocked(refundPayment);

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

describe("POST /api/organizer/registrations/[id]/refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const res = await POST(makeRequest({ reason: "pedido do atleta" }), makeContext("reg-1"));

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

  it("assistente de organizador com a permissão estorna usando o userId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-user-1" });
    dbMock.registration.findFirst.mockResolvedValueOnce(registrationWithPayment);
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest(), makeContext("reg-1"));

    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "reg-1", event: { organizer: { userId: "org-user-1" } } } })
    );
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

    const res = await POST(makeRequest(), makeContext("reg-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Gateway indisponível");
  });
});
```

- [ ] **Step 2: Escrever os testes que falham — rota admin**

Create `tests/admin-payment-refund-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/refund-service", () => ({ refundPayment: vi.fn() }));

import { POST } from "@/app/api/admin/payments/[id]/refund/route";
import { refundPayment } from "@/lib/payment/refund-service";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const refundPaymentMock = vi.mocked(refundPayment);

function makeRequest(body: unknown = {}) {
  return new Request("http://localhost/api/admin/payments/pay-1/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/payments/[id]/refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(), makeContext("pay-1"));
    expect(res.status).toBe(403);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("admin titular estorna qualquer pagamento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest({ reason: "fraude" }), makeContext("pay-1"));

    expect(refundPaymentMock).toHaveBeenCalledWith({
      paymentId: "pay-1",
      initiatedByUserId: "admin-1",
      reason: "fraude",
    });
    expect(res.status).toBe(200);
  });

  it("assistente de admin com a permissão estorna qualquer pagamento", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    refundPaymentMock.mockResolvedValueOnce({ alreadySynced: false } as any);

    const res = await POST(makeRequest(), makeContext("pay-1"));

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest(), makeContext("pay-1"));

    expect(res.status).toBe(403);
    expect(refundPaymentMock).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeContext("pay-1"));

    expect(res.status).toBe(403);
  });

  it("retorna 400 quando refundPayment lança erro", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    refundPaymentMock.mockRejectedValueOnce(new Error("Pagamento já estornado"));

    const res = await POST(makeRequest(), makeContext("pay-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Pagamento já estornado");
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/organizer-payment-refund-route.test.ts tests/admin-payment-refund-route.test.ts`
Expected: FAIL — os handlers ainda checam papel manualmente.

- [ ] **Step 4: Trocar `app/api/organizer/registrations/[id]/refund/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";
```

Troque o início do `POST` — de:

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
```

(o restante da função, a partir de `include: {...}` até o final, permanece idêntico — continua
usando `session.user.id` em `initiatedByUserId`).

- [ ] **Step 5: Trocar `app/api/admin/payments/[id]/refund/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { refundPayment } from "@/lib/payment/refund-service";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { refundPayment } from "@/lib/payment/refund-service";
```

Troque o início do `POST` — de:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  try {
    const result = await refundPayment({ paymentId: id, initiatedByUserId: session.user.id, reason });
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payments.refund-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  try {
    const result = await refundPayment({ paymentId: id, initiatedByUserId: session.user.id, reason });
```

(o restante permanece idêntico).

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/organizer-payment-refund-route.test.ts tests/admin-payment-refund-route.test.ts`
Expected: PASS (6 testes no primeiro arquivo, 6 no segundo).

- [ ] **Step 7: Commit**

```bash
git add app/api/organizer/registrations/[id]/refund/route.ts app/api/admin/payments/[id]/refund/route.ts tests/organizer-payment-refund-route.test.ts tests/admin-payment-refund-route.test.ts
git commit -m "feat: gate payment refund routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 2: Resolução manual de estorno (`payments.manual-resolve` + `payments.manual-resolve-any`)

**Files:**
- Modify: `app/api/organizer/refunds/[paymentId]/manual-resolve/route.ts`
- Modify: `app/api/admin/refunds/[paymentId]/manual-resolve/route.ts`
- Test: `tests/organizer-manual-refund-resolve-route.test.ts` (já existe — 4 testes hoje; será
  estendido com 2 casos novos de assistente)
- Test: `tests/admin-manual-refund-resolve-route.test.ts` (já existe — 2 testes hoje; será
  estendido com 3 casos novos de assistente)

**Interfaces:**
- Consumes: `checkApiPermission`, `checkAdminOnlyApiPermission` (Fase 1).
  `resolveRefundManually(params: {where: Prisma.PaymentWhereInput, resolvedByUserId: string,
  resolutionNote: string}): Promise<{ok: true} | {ok: false, status: number, error: string}>` de
  `@/lib/payment/manual-refund-resolution` (já existente, não modificado).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Estender `tests/organizer-manual-refund-resolve-route.test.ts` com os casos novos**

O arquivo hoje tem exatamente este conteúdo:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
import { POST } from "@/app/api/organizer/refunds/[paymentId]/manual-resolve/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/manual-refund-resolution", () => ({ resolveRefundManually: vi.fn() }));

const authMock = vi.mocked(auth);
const resolveMock = vi.mocked(resolveRefundManually);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/refunds/pay-1/manual-resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/organizer/refunds/[paymentId]/manual-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando resolutionNote está vazio", async () => {
    const res = await POST(makeRequest({ resolutionNote: "   " }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(400);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("escopa a resolução aos pagamentos de eventos do organizador logado", async () => {
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "Estorno feito via PIX manual" }), {
      params: Promise.resolve({ paymentId: "pay-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(resolveMock).toHaveBeenCalledWith({
      where: { id: "pay-1", order: { event: { organizer: { userId: "org-1" } } } },
      resolvedByUserId: "org-1",
      resolutionNote: "Estorno feito via PIX manual",
    });
  });

  it("repassa erro e status quando o serviço falha", async () => {
    resolveMock.mockResolvedValueOnce({ ok: false, status: 404, error: "Pagamento não encontrado" });

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Pagamento não encontrado");
  });
});
```

Não altere nenhum dos 4 testes existentes nem o `beforeEach` (o default `ORGANIZER` continua
correto — `checkApiPermission` também libera `ORGANIZER` titular sem checar
`AssistantPermission`, então os 4 testes preexistentes continuam passando sem mudança de
comportamento). Adicione `import { db } from "@/lib/db";` ao topo e `const dbMock = db as any;`
junto de `authMock`/`resolveMock`. Depois, adicione estes 2 `it(...)` novos dentro do mesmo
`describe`, após o teste `"repassa erro e status quando o serviço falha"`:

```ts
  it("assistente de organizador com a permissão resolve usando o userId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-1" });
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "resolvido" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(resolveMock).toHaveBeenCalledWith({
      where: { id: "pay-1", order: { event: { organizer: { userId: "org-1" } } } },
      resolvedByUserId: "assistant-1",
      resolutionNote: "resolvido",
    });
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Estender `tests/admin-manual-refund-resolve-route.test.ts` com os casos novos**

O arquivo hoje tem exatamente este conteúdo:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
import { POST } from "@/app/api/admin/refunds/[paymentId]/manual-resolve/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/manual-refund-resolution", () => ({ resolveRefundManually: vi.fn() }));

const authMock = vi.mocked(auth);
const resolveMock = vi.mocked(resolveRefundManually);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/refunds/pay-1/manual-resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/refunds/[paymentId]/manual-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);

    const res = await POST(makeRequest({ resolutionNote: "nota" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("não restringe por dono do evento (admin vê qualquer pagamento)", async () => {
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "Estorno feito via PIX manual" }), {
      params: Promise.resolve({ paymentId: "pay-1" }),
    });

    expect(res.status).toBe(200);
    expect(resolveMock).toHaveBeenCalledWith({
      where: { id: "pay-1" },
      resolvedByUserId: "admin-1",
      resolutionNote: "Estorno feito via PIX manual",
    });
  });
});
```

Não altere os 2 testes existentes nem o `beforeEach`. Adicione `import { db } from "@/lib/db";`
ao topo e `const dbMock = db as any;` junto de `authMock`/`resolveMock`. Depois, adicione estes 3
`it(...)` novos dentro do mesmo `describe`, após o teste `"não restringe por dono do evento..."`:

```ts
  it("assistente de admin com a permissão resolve qualquer estorno", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    resolveMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest({ resolutionNote: "x" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST(makeRequest({ resolutionNote: "x" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ resolutionNote: "x" }), { params: Promise.resolve({ paymentId: "pay-1" }) });

    expect(res.status).toBe(403);
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/organizer-manual-refund-resolve-route.test.ts tests/admin-manual-refund-resolve-route.test.ts`
Expected: FAIL nos casos novos (os testes preexistentes de ambos os arquivos continuam
passando).

- [ ] **Step 4: Trocar `app/api/organizer/refunds/[paymentId]/manual-resolve/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
```

Troque o corpo do `POST` — de:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { paymentId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Justificativa obrigatória para registrar o estorno manual" }, { status: 400 });

  const result = await resolveRefundManually({
    where: { id: paymentId, order: { event: { organizer: { userId: session.user.id } } } },
    resolvedByUserId: session.user.id,
    resolutionNote: parsed.data.resolutionNote,
  });
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const check = await checkApiPermission("payments.manual-resolve");
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

  const { paymentId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Justificativa obrigatória para registrar o estorno manual" }, { status: 400 });

  const result = await resolveRefundManually({
    where: { id: paymentId, order: { event: { organizer: { userId: organizerUserId } } } },
    resolvedByUserId: session.user.id,
    resolutionNote: parsed.data.resolutionNote,
  });
```

(o restante permanece idêntico).

- [ ] **Step 5: Trocar `app/api/admin/refunds/[paymentId]/manual-resolve/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveRefundManually } from "@/lib/payment/manual-refund-resolution";
```

Troque o início do `POST` — de:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { paymentId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Justificativa obrigatória para registrar o estorno manual" }, { status: 400 });

  const result = await resolveRefundManually({
    where: { id: paymentId },
    resolvedByUserId: session.user.id,
    resolutionNote: parsed.data.resolutionNote,
  });
```

para:

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const check = await checkAdminOnlyApiPermission("payments.manual-resolve-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { paymentId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Justificativa obrigatória para registrar o estorno manual" }, { status: 400 });

  const result = await resolveRefundManually({
    where: { id: paymentId },
    resolvedByUserId: session.user.id,
    resolutionNote: parsed.data.resolutionNote,
  });
```

(o restante permanece idêntico).

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/organizer-manual-refund-resolve-route.test.ts tests/admin-manual-refund-resolve-route.test.ts`
Expected: PASS (6 testes no primeiro arquivo — 4 preexistentes + 2 novos; 5 no segundo — 2
preexistentes + 3 novos).

- [ ] **Step 7: Commit**

```bash
git add app/api/organizer/refunds/[paymentId]/manual-resolve/route.ts app/api/admin/refunds/[paymentId]/manual-resolve/route.ts tests/organizer-manual-refund-resolve-route.test.ts tests/admin-manual-refund-resolve-route.test.ts
git commit -m "feat: gate manual refund resolution routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 3: Conciliação de pagamentos (`payments.reconciliation` + `payments.reconciliation-any`)

**Files:**
- Modify: `app/api/organizer/reconciliation/route.ts`
- Modify: `app/api/admin/reconciliation/route.ts`
- Test: `tests/organizer-reconciliation-route.test.ts` (já existe — 3 testes hoje; será
  estendido com 2 casos novos de assistente)
- Test: `tests/admin-reconciliation-route.test.ts` (já existe — 2 testes hoje; será estendido
  com 3 casos novos de assistente)

**Interfaces:**
- Consumes: `checkApiPermission`, `checkAdminOnlyApiPermission` (Fase 1).
  `reconcilePayments(options?: {organizerUserId?: string}): Promise<{checked: number, mismatches:
  PaymentMismatch[]}>` de `@/lib/payment/reconciliation` (já existente, não modificado).
  `notifyReconciliationMismatches(mismatches: PaymentMismatch[]): Promise<void>` de
  `@/lib/alerts/reconciliation` (já existente, não modificado).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Estender `tests/organizer-reconciliation-route.test.ts` com os casos novos**

O arquivo hoje tem exatamente este conteúdo:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));
vi.mock("@/lib/alerts/reconciliation", () => ({ notifyReconciliationMismatches: vi.fn() }));

import { POST } from "@/app/api/organizer/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

const authMock = vi.mocked(auth);

describe("POST /api/organizer/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é organizador nem admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação escopada ao organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 2, mismatches: [] });

    await POST();

    expect(reconcilePayments).toHaveBeenCalledWith({ organizerUserId: "org-1" });
  });

  it("dispara o alerta para o admin quando encontra divergências", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const mismatches = [{ paymentId: "p1", orderId: "o1", eventTitle: "Corrida", localStatus: "PENDING", gatewayStatus: "PAID", corrected: false }];
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 1, mismatches });

    await POST();

    expect(notifyReconciliationMismatches).toHaveBeenCalledWith(mismatches);
  });
});
```

Não altere nenhum dos 3 testes existentes (o `beforeEach` deste arquivo não fixa um papel
default — cada teste já define `authMock.mockResolvedValue` explicitamente, então não há default
pra preservar). Adicione `import { db } from "@/lib/db";` ao topo e `const dbMock = db as any;`
junto de `authMock`. Depois, adicione estes 2 `it(...)` novos dentro do mesmo `describe`, após o
teste `"dispara o alerta para o admin quando encontra divergências"`:

```ts
  it("assistente de organizador com a permissão concilia usando o userId do criador", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdByUserId: "org-1" });
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 0, mismatches: [] });

    const res = await POST();

    expect(reconcilePayments).toHaveBeenCalledWith({ organizerUserId: "org-1" });
    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST();

    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Estender `tests/admin-reconciliation-route.test.ts` com os casos novos**

O arquivo hoje tem exatamente este conteúdo:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/reconciliation", () => ({ reconcilePayments: vi.fn() }));

import { POST } from "@/app/api/admin/reconciliation/route";
import { reconcilePayments } from "@/lib/payment/reconciliation";

const authMock = vi.mocked(auth);

describe("POST /api/admin/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("roda a conciliação sem filtro de organizador e retorna o resultado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 5, mismatches: [] });

    const res = await POST();
    const body = await res.json();

    expect(reconcilePayments).toHaveBeenCalledWith();
    expect(body).toEqual({ checked: 5, mismatches: [] });
  });
});
```

Não remova nem altere nenhum dos 2 testes acima — eles continuam válidos e devem continuar
passando (a checagem `role !== "ADMIN"` retornando 403, e o admin titular chamando
`reconcilePayments()` sem args, são exatamente o comportamento que `checkAdminOnlyApiPermission`
preserva).

Adicione `import { db } from "@/lib/db";` ao topo e `const dbMock = db as any;` junto de
`authMock`. Depois, adicione estes 3 `it(...)` novos dentro do mesmo `describe`, após o teste
"roda a conciliação sem filtro...":

```ts
  it("assistente de admin com a permissão concilia a plataforma inteira", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    vi.mocked(reconcilePayments).mockResolvedValueOnce({ checked: 5, mismatches: [] });

    const res = await POST();

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await POST();

    expect(res.status).toBe(403);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await POST();

    expect(res.status).toBe(403);
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/organizer-reconciliation-route.test.ts tests/admin-reconciliation-route.test.ts`
Expected: FAIL nos casos novos de assistente (os 2 testes preexistentes do arquivo admin
continuam passando, já que a rota ainda não mudou).

- [ ] **Step 4: Trocar `app/api/organizer/reconciliation/route.ts`**

Troque o arquivo inteiro — de:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

export async function POST() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await reconcilePayments({ organizerUserId: session.user.id });
  if (result.mismatches.length > 0) {
    void notifyReconciliationMismatches(result.mismatches);
  }

  return NextResponse.json(result);
}
```

para:

```ts
import { NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { reconcilePayments } from "@/lib/payment/reconciliation";
import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";

export async function POST() {
  const check = await checkApiPermission("payments.reconciliation");
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

  const result = await reconcilePayments({ organizerUserId });
  if (result.mismatches.length > 0) {
    void notifyReconciliationMismatches(result.mismatches);
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 5: Trocar `app/api/admin/reconciliation/route.ts`**

Troque o arquivo inteiro — de:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reconcilePayments } from "@/lib/payment/reconciliation";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await reconcilePayments();
  return NextResponse.json(result);
}
```

para:

```ts
import { NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { reconcilePayments } from "@/lib/payment/reconciliation";

export async function POST() {
  const check = await checkAdminOnlyApiPermission("payments.reconciliation-any");
  if (!check.allowed) return check.response;

  const result = await reconcilePayments();
  return NextResponse.json(result);
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/organizer-reconciliation-route.test.ts tests/admin-reconciliation-route.test.ts`
Expected: PASS (5 testes no arquivo de organizador — 3 preexistentes + 2 novos; 5 no de admin —
2 preexistentes + 3 novos).

- [ ] **Step 7: Commit**

```bash
git add app/api/organizer/reconciliation/route.ts app/api/admin/reconciliation/route.ts tests/organizer-reconciliation-route.test.ts tests/admin-reconciliation-route.test.ts
git commit -m "feat: gate reconciliation routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 4: Exportar CSV de um pagamento (`payments.export`)

**Files:**
- Modify: `app/api/admin/payments/[id]/export/route.ts`
- Test: `tests/admin-payment-detail-export.test.ts` (já existe — 1 teste hoje, cobrindo o
  conteúdo do CSV com sessão admin fixa; será estendido com 4 casos novos de permissão)

**Interfaces:**
- Consumes: `checkAdminOnlyApiPermission` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Estender `tests/admin-payment-detail-export.test.ts` com os casos novos**

O arquivo hoje tem exatamente este conteúdo (1 teste, `beforeEach` fixa `authMock` como ADMIN
titular pra todo o arquivo):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/payments/[id]/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin payment detail export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports a payment detail csv", async () => {
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      orderId: "order-1",
      status: "PAID",
      method: "PIX",
      amount: 15000,
      provider: "mercadopago",
      providerPaymentId: "prov-123",
      idempotencyKey: "idem-123",
      paidAt: new Date("2026-01-10T10:00:00.000Z"),
      expiresAt: null,
      order: {
        buyer: { name: "Ana Silva", email: "ana@exemplo.com" },
        coupon: { code: "BEMVINDO10" },
        registrations: [{ event: { title: "Corrida das Pedras" } }],
        totalAmount: 15000,
        subtotalAmount: 15000,
        discountAmount: 0,
        platformFeeAmount: 1650,
      },
      refunds: [
        {
          amount: 5000,
          reason: "Cancelamento",
        },
      ],
    });

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export", { method: "GET" }) as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("pagamento-pay-1.csv");
    const csv = await res.text();
    expect(csv).toContain('"Payment ID"');
    expect(csv).toContain('"pay-1"');
    expect(csv).toContain('"Corrida das Pedras"');
    expect(csv).toContain("Cancelamento");
  });
});
```

Não altere o teste `"exports a payment detail csv"` nem o `beforeEach` — o default de ADMIN
titular no `beforeEach` continua correto (ele é sobrescrito individualmente pelos testes novos
que precisam de outro papel). Adicione estes 4 `it(...)` novos dentro do mesmo `describe`, após
o teste existente:

```ts
  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export") as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(403);
    expect(dbMock.payment.findUnique).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão exporta qualquer pagamento", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.payment.findUnique.mockResolvedValueOnce({
      id: "pay-1",
      orderId: "order-1",
      status: "PAID",
      method: "PIX",
      amount: 5000,
      provider: "mercadopago",
      providerPaymentId: "mp-1",
      idempotencyKey: "idem-1",
      paidAt: new Date("2026-01-01"),
      expiresAt: null,
      order: {
        buyer: { name: "Atleta", email: "atleta@example.com" },
        coupon: null,
        registrations: [],
        totalAmount: 5000,
        subtotalAmount: 5000,
        discountAmount: 0,
        platformFeeAmount: 0,
      },
      refunds: [],
    });

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export") as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export") as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(403);
    expect(dbMock.payment.findUnique).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(
      new Request("http://localhost/api/admin/payments/pay-1/export") as any,
      { params: Promise.resolve({ id: "pay-1" }) },
    );

    expect(res.status).toBe(403);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-payment-detail-export.test.ts`
Expected: FAIL nos casos novos (o teste preexistente `"exports a payment detail csv"` continua
passando, já que a rota ainda não mudou).

- [ ] **Step 3: Trocar `app/api/admin/payments/[id]/export/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue } from "@/lib/admin/payments";
import { formatCurrency, formatDate } from "@/lib/format";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { escapeCsvValue } from "@/lib/admin/payments";
import { formatCurrency, formatDate } from "@/lib/format";
```

Troque o início do `GET` — de:

```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
```

para:

```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payments.export");
  if (!check.allowed) return check.response;

  const { id } = await params;
```

(o restante permanece idêntico).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-payment-detail-export.test.ts`
Expected: PASS (5 testes — 1 preexistente + 4 novos).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/payments/[id]/export/route.ts tests/admin-payment-detail-export.test.ts
git commit -m "feat: gate single payment export route with checkAdminOnlyApiPermission"
```

---

### Task 5: Exportar CSV de todos os pagamentos (`payments.export-all`)

**Files:**
- Modify: `app/api/admin/payments/export/route.ts`
- Test: `tests/admin-payments-route.test.ts` (já existe — 1 teste hoje, cobrindo o conteúdo do
  CSV com filtros, sessão admin fixa; será estendido com 4 casos novos de permissão)

**Interfaces:**
- Consumes: `checkAdminOnlyApiPermission` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Estender `tests/admin-payments-route.test.ts` com os casos novos**

O arquivo hoje tem exatamente este conteúdo (1 teste, `beforeEach` fixa `authMock` como ADMIN
titular pra todo o arquivo):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/payments/export/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("admin payments export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("exports payments as csv with filters", async () => {
    dbMock.payment.findMany.mockResolvedValueOnce([
      {
        method: "PIX",
        status: "PAID",
        amount: 15000,
        createdAt: new Date("2026-01-05T10:00:00.000Z"),
        order: {
          buyer: { name: "Ana Silva", email: "ana@exemplo.com" },
          registrations: [{ event: { title: "Corrida das Pedras" } }],
        },
      },
    ]);

    const res = await GET(
      new Request("http://localhost/api/admin/payments/export?status=PAID&method=PIX&q=ana&sort=amount&dir=asc", { method: "GET" }) as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("pagamentos.csv");
    expect(dbMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ status: "PAID" }),
            expect.objectContaining({ method: "PIX" }),
          ]),
        }),
        orderBy: expect.arrayContaining([expect.objectContaining({ amount: "asc" })]),
      }),
    );

    const csv = await res.text();
    expect(csv).toContain('"Corrida das Pedras"');
    expect(csv).toContain('"Ana Silva"');
    expect(csv).toContain('"PAID"');
  });
});
```

Não altere o teste `"exports payments as csv with filters"` nem o `beforeEach`. Adicione estes 4
`it(...)` novos dentro do mesmo `describe`, após o teste existente:

```ts
  it("retorna 403 pra organizador titular (não é admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);

    const res = await GET(new Request("http://localhost/api/admin/payments/export") as any);

    expect(res.status).toBe(403);
    expect(dbMock.payment.findMany).not.toHaveBeenCalled();
  });

  it("assistente de admin com a permissão exporta todos os pagamentos", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    dbMock.payment.findMany.mockResolvedValueOnce([]);

    const res = await GET(new Request("http://localhost/api/admin/payments/export") as any);

    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a chave concedida por engano é barrado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-2" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

    const res = await GET(new Request("http://localhost/api/admin/payments/export") as any);

    expect(res.status).toBe(403);
    expect(dbMock.payment.findMany).not.toHaveBeenCalled();
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost/api/admin/payments/export") as any);

    expect(res.status).toBe(403);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-payments-route.test.ts`
Expected: FAIL nos casos novos (o teste preexistente `"exports payments as csv with filters"`
continua passando).

- [ ] **Step 3: Trocar `app/api/admin/payments/export/route.ts`**

Troque o import — de:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAdminPaymentOrderBy, buildAdminPaymentWhere, escapeCsvValue } from "@/lib/admin/payments";
```

para:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { buildAdminPaymentOrderBy, buildAdminPaymentWhere, escapeCsvValue } from "@/lib/admin/payments";
```

Troque o início do `GET` — de:

```ts
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
```

para:

```ts
export async function GET(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("payments.export-all");
  if (!check.allowed) return check.response;

  const { searchParams } = new URL(req.url);
```

(o restante permanece idêntico).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-payments-route.test.ts`
Expected: PASS (5 testes — 1 preexistente + 4 novos).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/payments/export/route.ts tests/admin-payments-route.test.ts
git commit -m "feat: gate bulk payment export route with checkAdminOnlyApiPermission"
```

---

### Task 6: UI — adicionar as 8 chaves às páginas de gestão de assistentes

**Files:**
- Modify: `app/admin/assistentes/page.tsx`
- Modify: `app/organizador/assistentes/page.tsx`

**Interfaces:**
- Consumes: `components/assistants/AssistantManager.tsx` (Fase 1, não modificado por esta
  tarefa).
- Produces: nenhuma interface nova.

Sem testes automatizados nesta tarefa (mesma convenção já usada nos domínios anteriores).

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
  { key: "payments.refund-any", label: "Estornar pagamento (qualquer)" },
  { key: "payments.manual-resolve-any", label: "Resolver estorno manualmente (qualquer)" },
  { key: "payments.reconciliation-any", label: "Conciliar pagamentos com o gateway (plataforma inteira)" },
  { key: "payments.export", label: "Exportar CSV de um pagamento específico" },
  { key: "payments.export-all", label: "Exportar CSV de todos os pagamentos" },
];
```

- [ ] **Step 2: Adicionar as 3 chaves organizador a `app/organizador/assistentes/page.tsx`**

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
  { key: "coupons.view", label: "Ver cupons de um evento" },
  { key: "coupons.create", label: "Criar cupom" },
  { key: "coupons.edit", label: "Editar cupom" },
  { key: "coupons.delete", label: "Excluir cupom" },
  { key: "coupons.report-export", label: "Exportar relatório de uso de cupons" },
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
  { key: "payments.refund", label: "Estornar pagamento" },
  { key: "payments.manual-resolve", label: "Resolver estorno manualmente" },
  { key: "payments.reconciliation", label: "Conciliar pagamentos com o gateway (meus eventos)" },
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
git commit -m "feat: add Pagamentos/Estornos permission keys to assistant management UI"
```
