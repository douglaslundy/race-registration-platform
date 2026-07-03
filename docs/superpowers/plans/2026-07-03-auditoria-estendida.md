# Auditoria Estendida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender a auditoria já existente (`AuditLog` + `/admin/auditoria`) com um filtro de ambiente (Admin/Organizador/Atleta/Sistema), registro de páginas acessadas dentro das áreas logadas, e visibilidade de carrinhos abandonados — sem migração de schema.

**Architecture:** O "ambiente" é derivado do `User.role` via join, não uma coluna nova. Páginas acessadas usam um componente client (`usePathname`) inserido nos 3 layouts logados, disparando uma nova rota que grava `AuditLog`. Carrinho abandonado passa a gravar `AuditLog` incondicionalmente dentro da rotina de detecção já existente (`checkAbandonedCarts`, sub-projeto 6b), independente dos canais de e-mail/WhatsApp estarem ligados.

**Tech Stack:** Next.js App Router, Prisma, Vitest, TypeScript.

## Global Constraints

- Nenhuma migração de schema — o filtro de ambiente é derivado de `User.role`, não uma coluna nova em `AuditLog`.
- Rastreamento de página só dentro de `/dashboard`, `/organizador` e `/admin` (áreas logadas) — nunca páginas públicas ou visitantes anônimos.
- `checkAbandonedCarts()` grava `AuditLog` (`CART_ABANDONED`) para todo pedido elegível **mesmo com e-mail e WhatsApp desligados** — a auditoria não depende da configuração de alerta.
- Sem telas novas — tudo aparece dentro do já existente `/admin/auditoria`, com um novo filtro "Ambiente".
- Nenhum componente React tem teste automatizado (convenção já estabelecida).

---

## Task 1: Filtro de ambiente em `buildAdminAuditWhere`

**Files:**
- Modify: `lib/admin/audit.ts`
- Test: `tests/admin-audit-helpers.test.ts`

**Interfaces:**
- Produces: `AdminAuditSearchParams.environment?: "ADMIN" | "ORGANIZER" | "ATHLETE" | "SYSTEM"`; `buildAdminAuditWhere` aceita esse campo — consumido pela Task 5.

Nota: este arquivo (`lib/admin/audit.ts`) não tinha nenhum teste dedicado antes desta task — os testes abaixo cobrem só o comportamento novo (filtro de ambiente), não uma reescrita completa da cobertura existente.

- [ ] **Step 1: Escrever os testes (falhando)**

Create `tests/admin-audit-helpers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildAdminAuditWhere } from "@/lib/admin/audit";

describe("buildAdminAuditWhere — filtro de ambiente", () => {
  it("sem filtro de ambiente, não adiciona nenhuma condição extra", () => {
    const where = buildAdminAuditWhere({});
    expect(where).toEqual({});
  });

  it("filtra por role ADMIN quando environment=ADMIN", () => {
    const where = buildAdminAuditWhere({ environment: "ADMIN" });
    expect(where).toEqual({ AND: [{ user: { role: "ADMIN" } }] });
  });

  it("filtra por role ORGANIZER quando environment=ORGANIZER", () => {
    const where = buildAdminAuditWhere({ environment: "ORGANIZER" });
    expect(where).toEqual({ AND: [{ user: { role: "ORGANIZER" } }] });
  });

  it("filtra por role ATHLETE quando environment=ATHLETE", () => {
    const where = buildAdminAuditWhere({ environment: "ATHLETE" });
    expect(where).toEqual({ AND: [{ user: { role: "ATHLETE" } }] });
  });

  it("filtra por userId nulo quando environment=SYSTEM", () => {
    const where = buildAdminAuditWhere({ environment: "SYSTEM" });
    expect(where).toEqual({ AND: [{ userId: null }] });
  });

  it("combina o filtro de ambiente com os filtros já existentes", () => {
    const where = buildAdminAuditWhere({ environment: "ORGANIZER", entity: "Event" });
    expect(where).toEqual({ AND: [{ entityType: "Event" }, { user: { role: "ORGANIZER" } }] });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-audit-helpers.test.ts`
Expected: FAIL — o parâmetro `environment` não é aceito ainda (os 5 testes com `environment` falham; o teste vazio pode passar por acidente).

- [ ] **Step 3: Implementar o filtro**

Find (em `lib/admin/audit.ts`):
```ts
export interface AdminAuditSearchParams {
  action?: string;
  entity?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: string;
}

export function buildAdminAuditWhere(params: Pick<AdminAuditSearchParams, "action" | "entity" | "userId" | "dateFrom" | "dateTo">): Prisma.AuditLogWhereInput {
  const filters: Prisma.AuditLogWhereInput[] = [];

  if (params.action) {
    filters.push({ action: { contains: params.action, mode: "insensitive" as const } });
  }

  if (params.entity) {
    filters.push({ entityType: params.entity });
  }

  if (params.userId) {
    filters.push({ userId: params.userId });
  }

  const from = parseDateInput(params.dateFrom, false);
  if (from) {
    filters.push({ createdAt: { gte: from } });
  }

  const to = parseDateInput(params.dateTo, true);
  if (to) {
    filters.push({ createdAt: { lte: to } });
  }

  return filters.length ? { AND: filters } : {};
}
```

Replace it with:
```ts
export interface AdminAuditSearchParams {
  action?: string;
  entity?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  environment?: "ADMIN" | "ORGANIZER" | "ATHLETE" | "SYSTEM";
  sort?: string;
  dir?: string;
}

export function buildAdminAuditWhere(
  params: Pick<AdminAuditSearchParams, "action" | "entity" | "userId" | "dateFrom" | "dateTo" | "environment">,
): Prisma.AuditLogWhereInput {
  const filters: Prisma.AuditLogWhereInput[] = [];

  if (params.action) {
    filters.push({ action: { contains: params.action, mode: "insensitive" as const } });
  }

  if (params.entity) {
    filters.push({ entityType: params.entity });
  }

  if (params.userId) {
    filters.push({ userId: params.userId });
  }

  const from = parseDateInput(params.dateFrom, false);
  if (from) {
    filters.push({ createdAt: { gte: from } });
  }

  const to = parseDateInput(params.dateTo, true);
  if (to) {
    filters.push({ createdAt: { lte: to } });
  }

  if (params.environment === "SYSTEM") {
    filters.push({ userId: null });
  } else if (params.environment === "ADMIN" || params.environment === "ORGANIZER" || params.environment === "ATHLETE") {
    filters.push({ user: { role: params.environment } });
  }

  return filters.length ? { AND: filters } : {};
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-audit-helpers.test.ts`
Expected: PASS — 6/6 testes.

- [ ] **Step 5: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/audit.ts tests/admin-audit-helpers.test.ts
git commit -m "feat: filtro de ambiente em buildAdminAuditWhere"
```

---

## Task 2: Rota de registro de página acessada

**Files:**
- Create: `app/api/audit/pageview/route.ts`
- Test: `tests/audit-pageview-route.test.ts`

**Interfaces:**
- Produces: `POST /api/audit/pageview` com corpo `{ path: string }` → `{ ok: true }` (200) — consumida pela Task 3.

- [ ] **Step 1: Escrever os testes (falhando)**

Create `tests/audit-pageview-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/audit/pageview/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/audit/pageview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as any;
}

describe("POST /api/audit/pageview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await POST(makeRequest({ path: "/dashboard/inscricoes" }));
    expect(res.status).toBe(401);
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("retorna 400 com corpo inválido", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("grava o AuditLog com o caminho da página", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
    const res = await POST(makeRequest({ path: "/dashboard/inscricoes" }));

    expect(res.status).toBe(200);
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "PAGE_VIEWED",
        entityType: "Page",
        entityId: "/dashboard/inscricoes",
        metadata: { path: "/dashboard/inscricoes" },
      },
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/audit-pageview-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/audit/pageview/route'`.

- [ ] **Step 3: Implementar a rota**

Create `app/api/audit/pageview/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  path: z.string().min(1).max(500),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Caminho inválido" }, { status: 400 });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "PAGE_VIEWED",
      entityType: "Page",
      entityId: parsed.data.path,
      metadata: { path: parsed.data.path },
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/audit-pageview-route.test.ts`
Expected: PASS — 3/3 testes.

- [ ] **Step 5: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/audit/pageview/route.ts tests/audit-pageview-route.test.ts
git commit -m "feat: rota de registro de pagina acessada"
```

---

## Task 3: Componente de registro de página + inserção nos 3 layouts logados

**Files:**
- Create: `components/audit/PageViewLogger.tsx`
- Modify: `app/dashboard/layout.tsx`
- Modify: `app/organizador/layout.tsx`
- Modify: `app/admin/layout.tsx`

**Interfaces:**
- Consumes: `POST /api/audit/pageview` (Task 2).

Sem testes automatizados de UI (convenção já estabelecida); verificação manual na Task 6.

- [ ] **Step 1: Criar o componente**

Create `components/audit/PageViewLogger.tsx`:
```tsx
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function PageViewLogger() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    fetch("/api/audit/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
    }).catch(() => {
      // Registro de auditoria é best-effort; falha de rede não deve afetar a navegação.
    });
  }, [pathname]);

  return null;
}
```

- [ ] **Step 2: Inserir no layout do atleta**

Find (arquivo inteiro de `app/dashboard/layout.tsx`):
```tsx
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import DashboardNav from "@/components/dashboard/DashboardNav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <DashboardNav userName={session.user.name} userRole={session.user.role} appName={appName} />
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

Replace it with:
```tsx
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import DashboardNav from "@/components/dashboard/DashboardNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <DashboardNav userName={session.user.name} userRole={session.user.role} appName={appName} />
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Inserir no layout do organizador**

Find (arquivo inteiro de `app/organizador/layout.tsx`):
```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import OrganizerNav from "@/components/organizer/OrganizerNav";

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireOrganizer(), getAppName()]);
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <OrganizerNav userName={session.user.name} appName={appName} />
      <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

Replace it with:
```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import OrganizerNav from "@/components/organizer/OrganizerNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireOrganizer(), getAppName()]);
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <OrganizerNav userName={session.user.name} appName={appName} />
      <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Inserir no layout do admin**

Find (arquivo inteiro de `app/admin/layout.tsx`):
```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
      <AdminNav />
      <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

Replace it with:
```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import AdminNav from "@/components/admin/AdminNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
      <PageViewLogger />
      <AdminNav />
      <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add components/audit/PageViewLogger.tsx app/dashboard/layout.tsx app/organizador/layout.tsx app/admin/layout.tsx
git commit -m "feat: registra pagina acessada nas 3 areas logadas"
```

---

## Task 4: Carrinho abandonado grava auditoria incondicionalmente

**Files:**
- Modify: `lib/alerts/abandoned-cart.ts`
- Modify: `tests/alert-abandoned-cart.test.ts`

**Interfaces:**
- Sem mudança de assinatura pública: `checkAbandonedCarts(): Promise<{ checked: number; notified: number }>` continua igual, mas agora **sempre** consulta os pedidos elegíveis e grava `AuditLog`, mesmo com os dois canais desligados (antes, retornava `{checked: 0, notified: 0}` sem consultar nada quando os canais estavam desligados).

**⚠️ Atenção**: este módulo já foi implementado, revisado e testado no sub-projeto 6b. Esta task muda deliberadamente seu comportamento (remove o retorno antecipado quando os canais estão desligados) para que a auditoria funcione independente da configuração de alerta — decisão confirmada com o usuário no design deste sub-projeto. Siga o código exato abaixo.

- [ ] **Step 1: Atualizar os testes (o antigo teste de "não consulta" é substituído)**

Find (arquivo inteiro de `tests/alert-abandoned-cart.test.ts`):
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendAbandonedCartEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getAbandonedCartAlertSettings: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  claimAlert: vi.fn(),
  unclaimAlert: vi.fn(),
}));

import { checkAbandonedCarts } from "@/lib/alerts/abandoned-cart";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const orderFixture = {
  id: "order-1",
  event: { title: "Corrida Teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

describe("checkAbandonedCarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
  });

  it("não consulta pedidos quando os dois canais estão desligados", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 30 });

    const result = await checkAbandonedCarts();

    expect(dbMock.order.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, notified: 0 });
  });

  it("filtra por status PENDING e createdAt mais antigo que o limiar de minutos", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await checkAbandonedCarts();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING", createdAt: { lte: expect.any(Date) } } }),
    );
  });

  it("envia e-mail e reivindica o alerta para um pedido pendente", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(claimAlert).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "EMAIL");
    expect(sendAbandonedCartEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", orderId: "order-1" }),
    );
    expect(result).toEqual({ checked: 1, notified: 1 });
  });

  it("não reenvia por e-mail quando outra execução já reivindicou o alerta", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("libera a reivindicação quando o envio falha, para permitir nova tentativa depois", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await checkAbandonedCarts();

    expect(unclaimAlert).toHaveBeenCalledWith("ABANDONED_CART", "order-1", "EMAIL");
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("pula o WhatsApp sem quebrar quando o atleta não tem telefone cadastrado", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, buyer: { ...orderFixture.buyer, athleteProfile: null } },
    ]);

    const result = await checkAbandonedCarts();

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("continua processando os demais pedidos quando um falha", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, id: "order-1" },
      { ...orderFixture, id: "order-2" },
    ]);
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 2, notified: 1 });
  });
});
```

Replace it with:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendAbandonedCartEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getAbandonedCartAlertSettings: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  claimAlert: vi.fn(),
  unclaimAlert: vi.fn(),
}));

import { checkAbandonedCarts } from "@/lib/alerts/abandoned-cart";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const orderFixture = {
  id: "order-1",
  buyerUserId: "athlete-1",
  event: { title: "Corrida Teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

describe("checkAbandonedCarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
  });

  it("consulta pedidos e grava auditoria mesmo com os dois canais desligados, mas não envia nada", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(dbMock.order.findMany).toHaveBeenCalled();
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "athlete-1",
        action: "CART_ABANDONED",
        entityType: "Order",
        entityId: "order-1",
        metadata: { eventTitle: "Corrida Teste" },
      },
    });
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("filtra por status PENDING e createdAt mais antigo que o limiar de minutos", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await checkAbandonedCarts();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING", createdAt: { lte: expect.any(Date) } } }),
    );
  });

  it("grava auditoria e envia e-mail para um pedido pendente quando o canal está ligado", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CART_ABANDONED", entityId: "order-1" }) }),
    );
    expect(claimAlert).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "EMAIL");
    expect(sendAbandonedCartEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", orderId: "order-1" }),
    );
    expect(result).toEqual({ checked: 1, notified: 1 });
  });

  it("não reenvia por e-mail quando outra execução já reivindicou o alerta", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("libera a reivindicação quando o envio falha, para permitir nova tentativa depois", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await checkAbandonedCarts();

    expect(unclaimAlert).toHaveBeenCalledWith("ABANDONED_CART", "order-1", "EMAIL");
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("pula o WhatsApp sem quebrar quando o atleta não tem telefone cadastrado", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, buyer: { ...orderFixture.buyer, athleteProfile: null } },
    ]);

    const result = await checkAbandonedCarts();

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("continua processando os demais pedidos quando um falha", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, id: "order-1" },
      { ...orderFixture, id: "order-2" },
    ]);
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 2, notified: 1 });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que a primeira falha**

Run: `npx vitest run tests/alert-abandoned-cart.test.ts`
Expected: FAIL — o teste "consulta pedidos e grava auditoria mesmo com os dois canais desligados" falha (`db.order.findMany` ainda não é chamado quando os canais estão desligados na implementação atual).

- [ ] **Step 3: Atualizar a implementação**

Find (arquivo inteiro de `lib/alerts/abandoned-cart.ts`):
```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "./dedupe";

const ALERT_TYPE = "ABANDONED_CART";

export async function checkAbandonedCarts(): Promise<{ checked: number; notified: number }> {
  const settings = await getAbandonedCartAlertSettings();
  if (!settings.emailEnabled && !settings.whatsappEnabled) return { checked: 0, notified: 0 };

  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const orders = await db.order.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    select: {
      id: true,
      event: { select: { title: true } },
      buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
    },
  });

  let notified = 0;

  for (const order of orders) {
    try {
      let sentSomething = false;

      if (settings.emailEnabled) {
        const cfg = await getSmtpConfig();
        if (isSmtpReady(cfg) && (await claimAlert(ALERT_TYPE, "Order", order.id, "EMAIL"))) {
          try {
            await sendAbandonedCartEmail({
              to: order.buyer.email,
              name: order.buyer.name,
              eventTitle: order.event.title,
              orderId: order.id,
            });
            sentSomething = true;
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, order.id, "EMAIL");
            throw err;
          }
        }
      }

      if (settings.whatsappEnabled && order.buyer.athleteProfile?.phone) {
        if (await claimAlert(ALERT_TYPE, "Order", order.id, "WHATSAPP")) {
          try {
            await sendWhatsAppMessage(
              order.buyer.athleteProfile.phone,
              `Sua inscrição em "${order.event.title}" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
            );
            sentSomething = true;
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, order.id, "WHATSAPP");
            throw err;
          }
        }
      }

      if (sentSomething) notified++;
    } catch (err) {
      console.error("[checkAbandonedCarts] failed for order", order.id, err);
    }
  }

  return { checked: orders.length, notified };
}
```

Replace it with:
```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "./alert-settings";
import { claimAlert, unclaimAlert } from "./dedupe";

const ALERT_TYPE = "ABANDONED_CART";

export async function checkAbandonedCarts(): Promise<{ checked: number; notified: number }> {
  const settings = await getAbandonedCartAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const orders = await db.order.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    select: {
      id: true,
      buyerUserId: true,
      event: { select: { title: true } },
      buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
    },
  });

  let notified = 0;

  for (const order of orders) {
    try {
      await db.auditLog.create({
        data: {
          userId: order.buyerUserId,
          action: "CART_ABANDONED",
          entityType: "Order",
          entityId: order.id,
          metadata: { eventTitle: order.event.title },
        },
      });

      let sentSomething = false;

      if (settings.emailEnabled) {
        const cfg = await getSmtpConfig();
        if (isSmtpReady(cfg) && (await claimAlert(ALERT_TYPE, "Order", order.id, "EMAIL"))) {
          try {
            await sendAbandonedCartEmail({
              to: order.buyer.email,
              name: order.buyer.name,
              eventTitle: order.event.title,
              orderId: order.id,
            });
            sentSomething = true;
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, order.id, "EMAIL");
            throw err;
          }
        }
      }

      if (settings.whatsappEnabled && order.buyer.athleteProfile?.phone) {
        if (await claimAlert(ALERT_TYPE, "Order", order.id, "WHATSAPP")) {
          try {
            await sendWhatsAppMessage(
              order.buyer.athleteProfile.phone,
              `Sua inscrição em "${order.event.title}" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
            );
            sentSomething = true;
          } catch (err) {
            await unclaimAlert(ALERT_TYPE, order.id, "WHATSAPP");
            throw err;
          }
        }
      }

      if (sentSomething) notified++;
    } catch (err) {
      console.error("[checkAbandonedCarts] failed for order", order.id, err);
    }
  }

  return { checked: orders.length, notified };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/alert-abandoned-cart.test.ts`
Expected: PASS — 7/7 testes.

- [ ] **Step 5: Rodar a suíte inteira + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros (nenhuma regressão na rota de cron, que mocka `checkAbandonedCarts` inteiro e não depende do seu comportamento interno).

- [ ] **Step 6: Commit**

```bash
git add lib/alerts/abandoned-cart.ts tests/alert-abandoned-cart.test.ts
git commit -m "feat: carrinho abandonado grava auditoria independente dos canais de alerta"
```

---

## Task 5: UI de `/admin/auditoria` — filtro de ambiente e novos rótulos

**Files:**
- Modify: `lib/admin/labels.ts`
- Modify: `app/admin/auditoria/page.tsx`

**Interfaces:**
- Consumes: `buildAdminAuditWhere` com `environment` (Task 1).

Sem testes automatizados de UI (convenção já estabelecida); verificação manual na Task 6.

- [ ] **Step 1: Adicionar os novos rótulos**

Find (em `lib/admin/labels.ts`):
```ts
  WHATSAPP_INSTANCE_CREATED: "Instância do WhatsApp criada",
  WHATSAPP_INSTANCE_DELETED: "Instância do WhatsApp excluída",
};
```

Replace it with:
```ts
  WHATSAPP_INSTANCE_CREATED: "Instância do WhatsApp criada",
  WHATSAPP_INSTANCE_DELETED: "Instância do WhatsApp excluída",
  PAGE_VIEWED: "Página acessada",
  CART_ABANDONED: "Carrinho abandonado",
};
```

Find:
```ts
export const ENTITY_LABEL: Record<string, string> = {
  Event: "Evento",
  Registration: "Inscrição",
  User: "Usuário",
  Order: "Pedido",
  Payment: "Pagamento",
  PlatformSetting: "Configuração",
  TransferPayout: "Repasse",
};
```

Replace it with:
```ts
export const ENTITY_LABEL: Record<string, string> = {
  Event: "Evento",
  Registration: "Inscrição",
  User: "Usuário",
  Order: "Pedido",
  Payment: "Pagamento",
  PlatformSetting: "Configuração",
  TransferPayout: "Repasse",
  Page: "Página",
};
```

- [ ] **Step 2: Adicionar o campo `environment` aos tipos e leitura de parâmetros**

Find (em `app/admin/auditoria/page.tsx`):
```tsx
interface SearchParams {
  action?: string;
  entity?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  sort?: string;
  dir?: string;
  compact?: string;
}
```

Replace it with:
```tsx
interface SearchParams {
  action?: string;
  entity?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  environment?: string;
  page?: string;
  sort?: string;
  dir?: string;
  compact?: string;
}
```

Find:
```tsx
const ACTION_COLOR: Record<string, string> = {
  EVENT_CREATED: BADGE.blue,
  EVENT_UPDATED: BADGE.yellow,
  EVENT_CANCELLED: BADGE.red,
  EVENT_APPROVED: BADGE.green,
  EVENT_REJECTED: BADGE.red,
  EVENT_FEE_UPDATED: BADGE.purple,
  REGISTRATION_CANCELLED: BADGE.red,
  USER_CREATED: BADGE.green,
  USER_UPDATED: BADGE.yellow,
  USER_DELETED: BADGE.red,
  USER_ROLE_CHANGED: BADGE.purple,
  USER_DEACTIVATED: BADGE.red,
  USER_ACTIVATED: BADGE.green,
  CHECKOUT_COMPLETED: BADGE.green,
};
```

Replace it with:
```tsx
const ACTION_COLOR: Record<string, string> = {
  EVENT_CREATED: BADGE.blue,
  EVENT_UPDATED: BADGE.yellow,
  EVENT_CANCELLED: BADGE.red,
  EVENT_APPROVED: BADGE.green,
  EVENT_REJECTED: BADGE.red,
  EVENT_FEE_UPDATED: BADGE.purple,
  REGISTRATION_CANCELLED: BADGE.red,
  USER_CREATED: BADGE.green,
  USER_UPDATED: BADGE.yellow,
  USER_DELETED: BADGE.red,
  USER_ROLE_CHANGED: BADGE.purple,
  USER_DEACTIVATED: BADGE.red,
  USER_ACTIVATED: BADGE.green,
  CHECKOUT_COMPLETED: BADGE.green,
  PAGE_VIEWED: BADGE.gray,
  CART_ABANDONED: BADGE.yellow,
};
```

Find:
```tsx
  const action = params.action?.trim() ?? "";
  const entity = params.entity?.trim() ?? "";
  const userId = params.userId?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
```

Replace it with:
```tsx
  const action = params.action?.trim() ?? "";
  const entity = params.entity?.trim() ?? "";
  const userId = params.userId?.trim() ?? "";
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const environment = params.environment?.trim() ?? "";
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
```

Find:
```tsx
  const where = buildAdminAuditWhere({ action, entity, userId, dateFrom, dateTo });
```

Replace it with:
```tsx
  const where = buildAdminAuditWhere({
    action,
    entity,
    userId,
    dateFrom,
    dateTo,
    environment: environment ? (environment as "ADMIN" | "ORGANIZER" | "ATHLETE" | "SYSTEM") : undefined,
  });
```

- [ ] **Step 3: Persistir o filtro nos links de paginação/ordenação e no "Limpar"**

Find:
```tsx
  const buildQuery = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) => {
    const query = new URLSearchParams();
    if (action) query.set("action", action);
    if (entity) query.set("entity", entity);
    if (userId) query.set("userId", userId);
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    if (compact) query.set("compact", "1");
```

Replace it with:
```tsx
  const buildQuery = (targetPage: number, overrides: Partial<Record<"sort" | "dir" | "compact", string>> = {}) => {
    const query = new URLSearchParams();
    if (action) query.set("action", action);
    if (entity) query.set("entity", entity);
    if (userId) query.set("userId", userId);
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    if (environment) query.set("environment", environment);
    if (compact) query.set("compact", "1");
```

Find:
```tsx
  const hasFilters = Boolean(action) || Boolean(entity) || Boolean(userId) || Boolean(dateFrom) || Boolean(dateTo);
```

Replace it with:
```tsx
  const hasFilters = Boolean(action) || Boolean(entity) || Boolean(userId) || Boolean(dateFrom) || Boolean(dateTo) || Boolean(environment);
```

- [ ] **Step 4: Adicionar o campo de filtro no formulário**

Find:
```tsx
        <div>
          <label className="block text-xs text-gray-500 mb-1">Entidade</label>
          <select name="entity" defaultValue={entity} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {["Event", "Registration", "User", "Order", "Payment"].map((e) => (
              <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">User ID</label>
```

Replace it with:
```tsx
        <div>
          <label className="block text-xs text-gray-500 mb-1">Entidade</label>
          <select name="entity" defaultValue={entity} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {["Event", "Registration", "User", "Order", "Payment", "Page"].map((e) => (
              <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ambiente</label>
          <select name="environment" defaultValue={environment} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="ADMIN">Admin</option>
            <option value="ORGANIZER">Organizador</option>
            <option value="ATHLETE">Atleta</option>
            <option value="SYSTEM">Sistema</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">User ID</label>
```

- [ ] **Step 5: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/labels.ts app/admin/auditoria/page.tsx
git commit -m "feat: filtro de ambiente e novos rotulos em admin/auditoria"
```

---

## Task 6: Verificação manual

**Files:** nenhum (só verificação).

- [ ] **Step 1: Preparar o ambiente**

Mesmo padrão de VPS descartável usado nos sub-projetos anteriores (clone + `npx prisma db push` + `npx prisma generate` + reiniciar o servidor — **neste sub-projeto não há mudança de schema**, então o `db push` só é necessário se o banco de teste ainda não tiver os campos dos sub-projetos anteriores).

- [ ] **Step 2: Páginas acessadas**

Logar como atleta, organizador e admin (em sessões/abas separadas) e navegar por 2-3 páginas em cada área. Consultar `/admin/auditoria` (ou via SQL em `audit_logs`) e confirmar que cada navegação gerou uma linha `PAGE_VIEWED` com o `entityId`/`metadata.path` correto e o `userId` do usuário certo.

- [ ] **Step 3: Filtro de ambiente**

Em `/admin/auditoria`, filtrar por cada valor de "Ambiente" (Admin, Organizador, Atleta, Sistema) e confirmar que só aparecem as entradas esperadas — em particular, que uma entrada `PAYMENT_WEBHOOK` (sem `userId`) só aparece em "Sistema", e uma `PAGE_VIEWED` do organizador só aparece em "Organizador".

- [ ] **Step 4: Carrinho abandonado**

Criar um `Order` `PENDING` via SQL com `createdAt` no passado além do limiar configurado (mesmo processo do sub-projeto 6b). Chamar `POST /api/cron/abandoned-carts` com o segredo correto **com os alertas de e-mail/WhatsApp desligados** — confirmar que mesmo assim aparece uma entrada `CART_ABANDONED` em `/admin/auditoria` associada ao atleta comprador, e que nenhum e-mail/WhatsApp foi tentado.

- [ ] **Step 5: Relatar ao usuário**

Resumir o que foi verificado e aguardar autorização explícita antes de qualquer push/deploy em produção — esta mudança altera o comportamento de uma rotina já existente (`checkAbandonedCarts`, que agora sempre consulta pedidos) e adiciona uma nova fonte de escrita em `AuditLog` (páginas acessadas) que roda em toda navegação das áreas logadas.
