# Usuários Assistentes — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin e organizador podem criar/promover usuários assistentes com permissões granulares, provado de ponta a ponta no domínio Eventos.

**Architecture:** Papel novo `ASSISTANT` no `UserRole`, sem alterar o significado de `ADMIN`/`ORGANIZER` titulares. Um assistente aponta pra quem o criou (`createdByUserId`) e tem um conjunto de `AssistantPermission` (chaves de ação, ex. `"events.approve"`). Um helper central (`resolveActingScope`) resolve, a partir da sessão, se o usuário atual "age como admin" (acesso irrestrito) ou está confinado a um `organizerId` — usado tanto pelos gates de layout quanto pelas rotas de API. Cada rota do domínio Eventos troca sua checagem de papel manual por `checkApiPermission(actionKey)`.

**Tech Stack:** Next.js App Router, Prisma/Postgres, NextAuth, Vitest, Zod — sem dependências novas.

## Global Constraints

- `UserRole` ganha `ASSISTANT`. `ADMIN`/`ORGANIZER` titulares mantêm comportamento idêntico ao de hoje — nenhuma rota titular pode ganhar uma query extra por causa desta feature.
- `User` ganha `createdByUserId` (auto-relação nullable, `onDelete` não em cascata — se o criador for excluído, o assistente permanece órfão mas não quebra, resolvido caso a caso; não implementar cascata nesta fase).
- Nova tabela `AssistantPermission { id, userId, actionKey, createdAt }`, `@@unique([userId, actionKey])`.
- Chaves de permissão da Fase 1 (domínio Eventos): `events.view`, `events.approve`, `events.reject`, `events.set-fee`, `events.edit`, `events.delete`, `events.archive`, `events.create`, `events.duplicate`. Ver a spec para quem concede cada uma.
- Marcar qualquer ação de escrita implica `events.view` automaticamente — a UI de criação garante isso (não é responsabilidade do backend enforçar, já que o backend nunca checa "tem view" antes de uma ação de escrita, só checa a ação específica).
- Se o e-mail já pertence a um `ATHLETE` → promove em pé, preserva dados, não dispara e-mail de convite. Se já pertence a `ADMIN`/`ORGANIZER`/`ASSISTANT`/`SUPPORT`/`PARTNER` → bloqueia com 400. Se não existe → cria novo `User` sem senha, dispara e-mail de convite reaproveitando o fluxo de token de `app/api/auth/reset-password/route.ts` (nenhuma mudança nesse arquivo — ele já funciona pra um usuário sem senha prévia).
- Revogação reaproveita o campo `active` já existente em `User`.
- Telas dedicadas: `/admin/assistentes` (lista todos os assistentes da plataforma, qualquer admin vê) e `/organizador/assistentes` (lista só os assistentes cujo `createdByUserId` é o organizador logado).
- Nunca usar `alert()`/`confirm()`/`prompt()` nativos — usar `components/ui/ConfirmModal.tsx`/`components/ui/ErrorModal.tsx` (regra do `CLAUDE.md`).

---

### Task 1: Schema — `ASSISTANT`, `createdByUserId`, `AssistantPermission`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260714010000_add_assistant_users/migration.sql`
- Modify: `app/admin/usuarios/page.tsx` (ROLE_LABELS, ROLE_COLOR)
- Modify: `app/admin/usuarios/[id]/page.tsx` (ROLE_LABELS)
- Modify: `components/admin/UserForm.tsx` (ROLE_LABELS — **não** adicionar a `ROLES`)
- Modify: `components/admin/ChangeUserRoleButton.tsx` (ROLE_LABELS — **não** adicionar a `ROLES`)

**Interfaces:**
- Produces: `UserRole.ASSISTANT`, `User.createdByUserId: string | null`, `User.createdBy: User | null`, model `AssistantPermission { id, userId, actionKey, createdAt }` — consumidos por todas as tarefas seguintes.

- [ ] **Step 1: Adicionar `ASSISTANT` ao enum e os campos novos ao `User`**

Em `prisma/schema.prisma`, altere o enum (linha ~15-21):

```prisma
enum UserRole {
  ATHLETE
  ORGANIZER
  ADMIN
  SUPPORT
  PARTNER
  ASSISTANT
}
```

No `model User { ... }`, adicione os campos e relações (junto dos demais campos/relations, mantendo o resto intacto):

```prisma
  createdByUserId String?
  createdBy         User?   @relation("AssistantCreator", fields: [createdByUserId], references: [id])
  createdAssistants User[]  @relation("AssistantCreator")
  assistantPermissions AssistantPermission[]
```

- [ ] **Step 2: Adicionar o model `AssistantPermission`**

No final de `prisma/schema.prisma`:

```prisma
model AssistantPermission {
  id        String   @id @default(cuid())
  userId    String
  actionKey String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, actionKey])
  @@map("assistant_permissions")
}
```

- [ ] **Step 3: Corrigir os `Record<UserRole, ...>` existentes pra incluir `ASSISTANT`**

Em `app/admin/usuarios/page.tsx`, no `ROLE_LABELS` (linha ~17-23):

```ts
const ROLE_LABELS: Record<UserRole, string> = {
  ATHLETE: "Atleta",
  ORGANIZER: "Organizador",
  ADMIN: "Admin",
  SUPPORT: "Suporte",
  PARTNER: "Parceiro",
  ASSISTANT: "Assistente",
};
```

E no `ROLE_COLOR` (linha ~25-31):

```ts
const ROLE_COLOR: Record<UserRole, string> = {
  ATHLETE: BADGE.gray,
  ORGANIZER: BADGE.blue,
  ADMIN: BADGE.red,
  SUPPORT: BADGE.yellow,
  PARTNER: BADGE.purple,
  ASSISTANT: BADGE.green,
};
```

**Não** adicione `"ASSISTANT"` ao array `ROLE_OPTIONS` (linha ~33-40) nem a `ROLES` em `ChangeUserRoleButton.tsx`/`UserForm.tsx` — assistentes só são criados pelo fluxo dedicado (Task 4), nunca pelo seletor genérico de papel, porque promover alguém a `ASSISTANT` sem gravar `createdByUserId`/`AssistantPermission` deixaria um usuário num estado inconsistente (assistente sem nenhuma permissão e sem saber de quem).

Em `app/admin/usuarios/[id]/page.tsx`, aplique a mesma adição ao `ROLE_LABELS` local (mesmo formato, `ASSISTANT: "Assistente"`).

Em `components/admin/UserForm.tsx` e `components/admin/ChangeUserRoleButton.tsx`, adicione `ASSISTANT: "Assistente"` ao `ROLE_LABELS` local de cada arquivo, mas **não** toque no array `ROLES`/`ROLE_OPTIONS` desses arquivos (mantém sem `ASSISTANT`).

- [ ] **Step 4: Gerar o client e verificar compilação**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sem erros.

Run: `npx tsc --noEmit`
Expected: sem erros — se algum `Record<UserRole,...>` tiver ficado de fora, o TypeScript vai apontar exatamente o arquivo/linha faltante aqui.

- [ ] **Step 5: Escrever a migração SQL à mão**

Sem conexão de banco neste ambiente — escrever a migração diretamente, seguindo o formato padrão do Prisma (mesmo estilo das migrações recentes deste repo).

Create `prisma/migrations/20260714010000_add_assistant_users/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ASSISTANT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "createdByUserId" TEXT;

-- CreateTable
CREATE TABLE "assistant_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_permissions_userId_actionKey_key" ON "assistant_permissions"("userId", "actionKey");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_permissions" ADD CONSTRAINT "assistant_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Nota: `ALTER TYPE ... ADD VALUE` no Postgres não pode rodar dentro da mesma transação que outros comandos que usam o novo valor — como esta migração só adiciona o valor e não o usa em nenhuma outra instrução dentro do mesmo arquivo, isso é seguro. Se o `prisma db push` reclamar (raro, mas `ADD VALUE` tem uma restrição de "não pode ser usado antes de commitado" em versões antigas do Postgres), aplicar em dois passos manuais no deploy é a solução — documentar isso na tarefa de deploy quando chegar lá, não é um problema do código.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260714010000_add_assistant_users/migration.sql app/admin/usuarios/page.tsx app/admin/usuarios/[id]/page.tsx components/admin/UserForm.tsx components/admin/ChangeUserRoleButton.tsx
git commit -m "feat: add ASSISTANT role, createdByUserId, and AssistantPermission table"
```

---

### Task 2: `lib/auth/rbac.ts` — `resolveActingScope` + `checkApiPermission`

**Files:**
- Modify: `lib/auth/rbac.ts`
- Test: `tests/rbac.test.ts` (arquivo novo — não existe teste pra este arquivo hoje)

**Interfaces:**
- Consumes: `db.user.findUnique`, `db.organizerProfile.findUnique`, `db.assistantPermission.findUnique` (Task 1's schema).
- Produces:
  - `interface AssistantScope { actingAsAdmin: boolean; organizerId: string | null }`
  - `resolveActingScope(session: Session): Promise<AssistantScope>` — usado por Task 3 (rotas de Eventos) e por `requireAdmin`/`requireOrganizer` neste mesmo arquivo.
  - `checkApiPermission(actionKey: string): Promise<{ allowed: true; session: Session } | { allowed: false; response: NextResponse }>` — usado por Task 3.
  - `requireAdmin()`/`requireOrganizer()` mantêm as mesmas assinaturas de hoje (`Promise<Session>`, via `redirect()`), mas agora também deixam `ASSISTANT` passar quando aplicável.

- [ ] **Step 1: Escrever os testes que falham**

Create `tests/rbac.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));

const authMock = vi.mocked(auth);
const dbMock = db as any;

import { resolveActingScope, checkApiPermission, requireAdmin, requireOrganizer } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";

describe("resolveActingScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ADMIN titular: actingAsAdmin=true, sem consulta ao banco", async () => {
    const scope = await resolveActingScope({ user: { id: "admin-1", role: "ADMIN" } } as any);
    expect(scope).toEqual({ actingAsAdmin: true, organizerId: null });
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    expect(dbMock.organizerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("ORGANIZER titular: resolve o próprio organizerId", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    const scope = await resolveActingScope({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    expect(dbMock.organizerProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "org-user-1" } });
    expect(scope).toEqual({ actingAsAdmin: false, organizerId: "org-1" });
  });

  it("ASSISTANT criado por ADMIN: actingAsAdmin=true", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ADMIN", organizerProfile: null },
    });
    const scope = await resolveActingScope({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    expect(scope).toEqual({ actingAsAdmin: true, organizerId: null });
  });

  it("ASSISTANT criado por ORGANIZER: resolve o organizerId do criador", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({
      createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-5" } },
    });
    const scope = await resolveActingScope({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    expect(scope).toEqual({ actingAsAdmin: false, organizerId: "org-5" });
  });

  it("ASSISTANT órfão (criador excluído): sem escopo nenhum", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: null });
    const scope = await resolveActingScope({ user: { id: "assistant-3", role: "ASSISTANT" } } as any);
    expect(scope).toEqual({ actingAsAdmin: false, organizerId: null });
  });

  it("ATHLETE: sem escopo nenhum, sem consulta ao banco", async () => {
    const scope = await resolveActingScope({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    expect(scope).toEqual({ actingAsAdmin: false, organizerId: null });
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("checkApiPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(401);
  });

  it("ADMIN sempre permitido, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(true);
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });

  it("ORGANIZER sempre permitido, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const result = await checkApiPermission("events.edit");
    expect(result.allowed).toBe(true);
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT com a permissão concedida é permitido", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    const result = await checkApiPermission("events.approve");
    expect(dbMock.assistantPermission.findUnique).toHaveBeenCalledWith({
      where: { userId_actionKey: { userId: "assistant-1", actionKey: "events.approve" } },
    });
    expect(result.allowed).toBe(true);
  });

  it("ASSISTANT sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
  });

  it("ATHLETE é barrado com 403, sem consultar AssistantPermission", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    const result = await checkApiPermission("events.approve");
    expect(result.allowed).toBe(false);
    expect(dbMock.assistantPermission.findUnique).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ADMIN passa sem consultar o banco", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    const session = await requireAdmin();
    expect(session.user.id).toBe("admin-1");
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ADMIN passa", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ADMIN", organizerProfile: null } });
    const session = await requireAdmin();
    expect(session.user.id).toBe("assistant-1");
  });

  it("ASSISTANT criado por ORGANIZER é redirecionado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/acesso-negado");
  });

  it("ATHLETE é redirecionado sem consultar o banco", async () => {
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("requireOrganizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ORGANIZER passa sem consultar o banco", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const session = await requireOrganizer();
    expect(session.user.id).toBe("org-1");
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("ASSISTANT criado por ORGANIZER passa", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-2", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    const session = await requireOrganizer();
    expect(session.user.id).toBe("assistant-2");
  });

  it("ASSISTANT órfão é redirecionado", async () => {
    authMock.mockResolvedValue({ user: { id: "assistant-3", role: "ASSISTANT" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: null });
    await expect(requireOrganizer()).rejects.toThrow("NEXT_REDIRECT");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/rbac.test.ts`
Expected: FAIL — `resolveActingScope`/`checkApiPermission` ainda não existem, e `dbMock.assistantPermission`/`dbMock.user.findUnique` com o shape usado ainda não são exercitados pela implementação atual.

- [ ] **Step 3: Adicionar o mock de `assistantPermission` em `tests/setup.ts`**

Adicione esta linha ao objeto `db` mockado em `tests/setup.ts` (junto dos demais, ex. logo após a linha do `dailySummaryRecipient`):

```ts
    assistantPermission: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
```

- [ ] **Step 4: Reescrever `lib/auth/rbac.ts`**

Replace `lib/auth/rbac.ts` com:

```ts
import type { UserRole } from "@prisma/client";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { auth } from "./index";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  return session;
}

export async function requireRole(roles: UserRole[]) {
  const session = await requireAuth();
  if (!roles.includes(session.user.role as UserRole)) {
    redirect("/acesso-negado");
  }
  return session;
}

export interface AssistantScope {
  actingAsAdmin: boolean;
  organizerId: string | null;
}

/**
 * Resolve o escopo efetivo de atuação de uma sessão. ADMIN/ORGANIZER titulares
 * resolvem sem consulta extra (ADMIN) ou com a mesma consulta que as rotas já
 * faziam individualmente (ORGANIZER). Só ASSISTANT precisa de uma consulta nova,
 * subindo até o criador pra saber se ele age como admin (irrestrito) ou como
 * organizador (confinado ao organizerId do criador).
 */
export async function resolveActingScope(session: Session): Promise<AssistantScope> {
  if (session.user.role === "ADMIN") return { actingAsAdmin: true, organizerId: null };

  if (session.user.role === "ORGANIZER") {
    const profile = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
    return { actingAsAdmin: false, organizerId: profile?.id ?? null };
  }

  if (session.user.role === "ASSISTANT") {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdBy: { select: { role: true, organizerProfile: { select: { id: true } } } } },
    });
    if (user?.createdBy?.role === "ADMIN") return { actingAsAdmin: true, organizerId: null };
    if (user?.createdBy?.organizerProfile) {
      return { actingAsAdmin: false, organizerId: user.createdBy.organizerProfile.id };
    }
    return { actingAsAdmin: false, organizerId: null };
  }

  return { actingAsAdmin: false, organizerId: null };
}

export type PermissionCheck =
  | { allowed: true; session: Session }
  | { allowed: false; response: NextResponse };

/** Checagem de permissão pra uso em Route Handlers (retorna NextResponse, não redireciona). */
export async function checkApiPermission(actionKey: string): Promise<PermissionCheck> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return { allowed: true, session };
  }

  if (session.user.role === "ASSISTANT") {
    const granted = await db.assistantPermission.findUnique({
      where: { userId_actionKey: { userId: session.user.id, actionKey } },
    });
    if (granted) return { allowed: true, session };
  }

  return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
}

export async function requireAdmin() {
  const session = await requireAuth();
  if (session.user.role === "ADMIN") return session;
  if (session.user.role === "ASSISTANT") {
    const scope = await resolveActingScope(session);
    if (scope.actingAsAdmin) return session;
  }
  redirect("/acesso-negado");
}

export async function requireOrganizer() {
  const session = await requireAuth();
  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") return session;
  if (session.user.role === "ASSISTANT") {
    const scope = await resolveActingScope(session);
    if (scope.actingAsAdmin || scope.organizerId !== null) return session;
  }
  redirect("/acesso-negado");
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/rbac.test.ts`
Expected: PASS (19 testes).

- [ ] **Step 6: Rodar o suite completo e o typecheck**

Run: `npx vitest run`
Expected: nenhuma regressão nos testes existentes (nenhum outro arquivo importa `lib/auth/rbac.ts` de um jeito que quebre com a assinatura nova — `requireAdmin`/`requireOrganizer` mantêm o mesmo tipo de retorno).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/rbac.ts tests/rbac.test.ts tests/setup.ts
git commit -m "feat: add resolveActingScope and checkApiPermission for assistant users"
```

---

### Task 3: Aplicar `checkApiPermission`/`resolveActingScope` às rotas de Eventos

**Files:**
- Modify: `app/api/admin/events/[id]/approve/route.ts`
- Modify: `app/api/admin/events/[id]/reject/route.ts`
- Modify: `app/api/admin/events/[id]/fee/route.ts`
- Modify: `app/api/admin/events/export/route.ts`
- Modify: `app/api/events/route.ts` (só o `POST`)
- Modify: `app/api/events/[id]/route.ts` (`PATCH` e `DELETE`)
- Modify: `app/api/events/[id]/archive/route.ts`
- Modify: `app/api/events/[id]/duplicate/route.ts`
- Modify: `app/api/organizer/events/export/route.ts`
- Test: `tests/admin-events-route.test.ts` (estender)
- Test: outros arquivos de teste existentes para essas rotas — localizar e estender caso a caso (ver Step 1)

**Interfaces:**
- Consumes: `checkApiPermission(actionKey)`, `resolveActingScope(session)` (Task 2).
- Produces: nenhuma interface nova — só troca a checagem interna de cada rota.

- [ ] **Step 1: Localizar todos os testes de rota existentes pra este domínio**

Antes de editar, rode: `npx vitest run --reporter=verbose -t "event" 2>&1 | head -60` só pra ter uma ideia dos arquivos de teste que tocam rotas de evento (não é um comando obrigatório de fixar na esteira, é orientação de descoberta). Os arquivos já confirmados nesta pesquisa: `tests/admin-events-route.test.ts` (cobre `app/api/admin/events/export/route.ts`). Para `app/api/admin/events/[id]/approve|reject|fee/route.ts` e `app/api/events/**`, procure por `tests/*event*.test.ts` e ajuste cada um seguindo o mesmo padrão de mock já usado neles (mock de `@/lib/auth` retornando `session.user.role`), adicionando: (a) um caso onde `role: "ASSISTANT"` com a permissão certa é permitido, (b) um caso onde é barrado sem a permissão. Não é possível listar aqui o conteúdo exato de arquivos de teste não lidos ainda — ao chegar nesta tarefa, leia cada arquivo de teste afetado antes de editá-lo, seguindo exatamente a convenção já usada nele (mesmo padrão `vi.mock`/`authMock.mockResolvedValue` visto em `tests/admin-events-route.test.ts`).

- [ ] **Step 2: `app/api/admin/events/[id]/approve/route.ts`**

Replace o conteúdo com:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission } from "@/lib/auth/rbac";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.approve");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const event = await db.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  await db.event.update({
    where: { id },
    data: {
      status: "REGISTRATIONS_OPEN",
      publishedAt: new Date(),
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_APPROVED",
      entityType: "Event",
      entityId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
```

Nota: `"events.approve"` só é concedida a assistentes criados por ADMIN (ver Task 6, o formulário de criação filtra as chaves disponíveis por quem está criando) — mas o servidor não precisa verificar isso de novo aqui: se um assistente-de-organizador de alguma forma tivesse essa `AssistantPermission` gravada (não deveria acontecer via UI), ele conseguiria aprovar qualquer evento, já que esta rota nunca teve escopo por organizador. Esse é o mesmo nível de confiança que o resto do sistema já deposita na UI de criação — não é uma regressão de segurança introduzida por esta tarefa.

- [ ] **Step 3: `app/api/admin/events/[id]/reject/route.ts`**

Replace com:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission } from "@/lib/auth/rbac";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.reject");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  await db.event.update({
    where: { id },
    data: { status: "DRAFT" },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_REJECTED",
      entityType: "Event",
      entityId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: `app/api/admin/events/[id]/fee/route.ts`**

Replace com:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkApiPermission } from "@/lib/auth/rbac";

const schema = z.object({
  platformFeePercent: z.number().int().min(0).max(5000),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.set-fee");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const event = await db.event.update({
    where: { id },
    data: { platformFeePercent: parsed.data.platformFeePercent },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_FEE_UPDATED",
      entityType: "Event",
      entityId: id,
      metadata: { platformFeePercent: parsed.data.platformFeePercent },
    },
  });

  return NextResponse.json({ event });
}
```

- [ ] **Step 5: `app/api/admin/events/export/route.ts`**

Troque só as 4 primeiras linhas do `GET` — de:

```ts
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
```

para:

```ts
export async function GET(req: NextRequest) {
  const check = await checkApiPermission("events.view");
  if (!check.allowed) return check.response;
```

E troque o import de `auth` por `checkApiPermission`:

```ts
import { checkApiPermission } from "@/lib/auth/rbac";
```

(remova o import de `auth` de `@/lib/auth` se não for mais usado em nenhum outro lugar do arquivo — confirme lendo o restante do arquivo antes de remover).

- [ ] **Step 6: `app/api/events/route.ts` (`POST`)**

Troque o bloco de checagem — de:

```ts
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
```

para:

```ts
export async function POST(req: NextRequest) {
  const check = await checkApiPermission("events.create");
  if (!check.allowed) return check.response;
  const { session } = check;
```

E troque a resolução do organizador — de:

```ts
  const organizer = await db.organizerProfile.findUnique({
    where: { userId: session.user.id },
  });
  if (!organizer) {
    return NextResponse.json({ error: "Perfil de organizador não encontrado" }, { status: 404 });
  }
```

para:

```ts
  const scope = await resolveActingScope(session);
  if (!scope.organizerId) {
    return NextResponse.json({ error: "Perfil de organizador não encontrado" }, { status: 404 });
  }
```

E troque `organizerId: organizer.id` (no `db.event.create`) por `organizerId: scope.organizerId`.

Adicione `resolveActingScope` ao import de `checkApiPermission` no topo do arquivo:

```ts
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
```

Nota: um ADMIN titular chamando esta rota diretamente hoje falharia (`organizer` seria `null`, já que admin não tem `OrganizerProfile` próprio) — esse comportamento **não muda**: `resolveActingScope` pra `ADMIN` retorna `{actingAsAdmin: true, organizerId: null}`, então `scope.organizerId` continua `null` e a rota continua devolvendo 404 pro admin, exatamente como hoje. Só `events.create` nunca é oferecida no checklist de um assistente-de-admin (Task 6), então esse caminho nunca é exercitado por um assistente-de-admin de qualquer forma.

- [ ] **Step 7: `app/api/events/[id]/route.ts` (`PATCH` e `DELETE`)**

Troque a função `getEventAndVerifyOwner` — de:

```ts
async function getEventAndVerifyOwner(eventId: string, userId: string) {
  const organizer = await db.organizerProfile.findUnique({ where: { userId } });
  if (!organizer) return null;

  const event = await db.event.findFirst({
    where: { id: eventId, organizerId: organizer.id },
  });
  return event;
}
```

para:

```ts
async function getEventAndVerifyOwnerByOrganizerId(eventId: string, organizerId: string) {
  return db.event.findFirst({ where: { id: eventId, organizerId } });
}
```

No `PATCH`, troque:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const event = session.user.role === "ADMIN"
    ? await db.event.findUnique({ where: { id } })
    : await getEventAndVerifyOwner(id, session.user.id);
```

para:

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : scope.organizerId
      ? await getEventAndVerifyOwnerByOrganizerId(id, scope.organizerId)
      : null;
```

No `DELETE`, aplique a mesma troca (o `DELETE` tem o mesmo bloco de resolução de `event` no início, seguido da lógica de contagem/exclusão que **não muda**):

```ts
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : scope.organizerId
      ? await getEventAndVerifyOwnerByOrganizerId(id, scope.organizerId)
      : null;
```

(o restante do `DELETE`, a partir de `if (!event) return NextResponse.json(...)`, permanece idêntico ao arquivo atual).

Adicione o import no topo do arquivo:

```ts
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
```

(remova o import de `auth` se não sobrar nenhum outro uso dele no arquivo).

- [ ] **Step 8: `app/api/events/[id]/archive/route.ts`**

Replace com:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.archive");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: {
      id,
      ...(scope.actingAsAdmin ? {} : { organizerId: scope.organizerId ?? "__none__" }),
    },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  if (["COMPLETED", "CANCELLED"].includes(event.status)) {
    return NextResponse.json({ error: "Evento já arquivado/cancelado" }, { status: 400 });
  }

  await db.event.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_CANCELLED",
      entityType: "Event",
      entityId: id,
    },
  });

  return NextResponse.json({ success: true });
}
```

`"__none__"` é um sentinel que nunca bate com nenhum `organizerId` real (todos os IDs são `cuid()`), usado só pra manter a query bem formada quando `scope.organizerId` é `null` (ex.: assistente órfão) — resulta em "evento não encontrado" em vez de um erro de tipo.

- [ ] **Step 9: `app/api/events/[id]/duplicate/route.ts`**

Troque o bloco de checagem — de:

```ts
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    include: {
```

para:

```ts
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.duplicate");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
    include: {
```

(mantém o comportamento pré-existente de que `duplicate` nunca teve bypass de admin — `events.duplicate` só é oferecida a assistentes-de-organizador em Task 6, então `scope.organizerId` sempre é o valor relevante aqui, nunca `actingAsAdmin`).

Adicione o import: `import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";` (remova `auth` se não sobrar outro uso).

- [ ] **Step 10: `app/api/organizer/events/export/route.ts`**

Replace com:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { escapeCsvValue } from "@/lib/admin/events";
import { formatCurrency } from "@/lib/format";

export async function GET() {
  const check = await checkApiPermission("events.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  if (!scope.organizerId) return NextResponse.json({ error: "Perfil de organizador não encontrado" }, { status: 404 });

  const events = await db.event.findMany({
    where: { organizerId: scope.organizerId },
```

(o restante do arquivo, a partir de `orderBy: { createdAt: "desc" }, include: {...`, permanece idêntico ao original).

- [ ] **Step 11: Rodar o suite completo e o typecheck**

Run: `npx vitest run`
Expected: os testes existentes para essas rotas continuam passando (verifique cada arquivo de teste tocado — se algum mock antigo dependia da forma antiga de `session.user.role !== "ADMIN"` sem passar por `checkApiPermission`, ajuste o mock de `@/lib/auth/rbac` nesse arquivo de teste, adicionando `vi.mock("@/lib/auth/rbac", ...)` com `checkApiPermission`/`resolveActingScope` mockados, seguindo o padrão já usado nas outras suítes deste plano).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 12: Commit**

```bash
git add app/api/admin/events app/api/events app/api/organizer/events/export tests/
git commit -m "feat: gate Eventos routes with checkApiPermission and resolveActingScope"
```

---

### Task 4: Fluxo de criação/promoção de assistente

**Files:**
- Modify: `lib/email.ts` (nova `sendAssistantInviteEmail`)
- Create: `lib/assistants/create-or-promote.ts`
- Create: `app/api/admin/assistants/route.ts`
- Create: `app/api/organizer/assistants/route.ts`
- Test: `tests/assistants-create-or-promote.test.ts`
- Test: `tests/admin-assistants-route.test.ts`
- Test: `tests/organizer-assistants-route.test.ts`

**Interfaces:**
- Consumes: `AssistantPermission`, `User.createdByUserId` (Task 1); `sendPasswordResetEmail`'s token pattern (não reutilizado como função, replicado — ver Step 2).
- Produces:
  - `createOrPromoteAssistant(params: { email: string; name: string; actionKeys: string[]; createdByUserId: string }): Promise<{ ok: true; userId: string; isNew: boolean } | { ok: false; error: string; status: number }>` — usado por Task 6 indiretamente (via as duas rotas) e diretamente pelas duas rotas desta tarefa.
  - `POST /api/admin/assistants` e `POST /api/organizer/assistants` — usados pela UI da Task 6.

- [ ] **Step 1: Escrever o teste que falha para `createOrPromoteAssistant`**

Create `tests/assistants-create-or-promote.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendAssistantInviteEmail: vi.fn(),
}));

import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAssistantInviteEmail } from "@/lib/email";

const dbMock = db as any;

describe("createOrPromoteAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("cria um usuário novo, dispara convite e grava as permissões", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);
    dbMock.user.create.mockResolvedValueOnce({ id: "new-user-1", email: "maria@example.com", name: "Maria" });

    const result = await createOrPromoteAssistant({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["events.view", "events.edit"],
      createdByUserId: "admin-1",
    });

    expect(dbMock.user.create).toHaveBeenCalledWith({
      data: {
        email: "maria@example.com",
        name: "Maria",
        role: "ASSISTANT",
        createdByUserId: "admin-1",
        passwordHash: null,
      },
    });
    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "new-user-1", actionKey: "events.view" },
        { userId: "new-user-1", actionKey: "events.edit" },
      ],
    });
    expect(dbMock.verificationToken.create).toHaveBeenCalled();
    expect(sendAssistantInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "maria@example.com", name: "Maria" }),
    );
    expect(result).toEqual({ ok: true, userId: "new-user-1", isNew: true });
  });

  it("promove um ATHLETE existente sem disparar convite nem apagar dados", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "joao@example.com", role: "ATHLETE" });
    dbMock.user.update.mockResolvedValueOnce({ id: "athlete-1" });

    const result = await createOrPromoteAssistant({
      email: "joao@example.com",
      name: "João",
      actionKeys: ["events.view"],
      createdByUserId: "org-1",
    });

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "athlete-1" },
      data: { role: "ASSISTANT", createdByUserId: "org-1", name: "João" },
    });
    expect(dbMock.user.create).not.toHaveBeenCalled();
    expect(sendAssistantInviteEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, userId: "athlete-1", isNew: false });
  });

  it("bloqueia quando o e-mail já pertence a uma conta titular (ADMIN)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "admin-2", role: "ADMIN" });

    const result = await createOrPromoteAssistant({
      email: "outro-admin@example.com",
      name: "X",
      actionKeys: [],
      createdByUserId: "admin-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "Este e-mail já pertence a uma conta titular e não pode virar assistente.",
      status: 400,
    });
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("bloqueia quando o e-mail já pertence a um ASSISTANT existente", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "assistant-9", role: "ASSISTANT" });

    const result = await createOrPromoteAssistant({
      email: "ja-e-assistente@example.com",
      name: "X",
      actionKeys: [],
      createdByUserId: "admin-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("substitui o conjunto de permissões por completo ao promover um existente", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "joao@example.com", role: "ATHLETE" });
    dbMock.user.update.mockResolvedValueOnce({ id: "athlete-1" });

    await createOrPromoteAssistant({
      email: "joao@example.com",
      name: "João",
      actionKeys: ["events.view"],
      createdByUserId: "org-1",
    });

    expect(dbMock.assistantPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: "athlete-1" } });
    expect(dbMock.assistantPermission.createMany).toHaveBeenCalledWith({
      data: [{ userId: "athlete-1", actionKey: "events.view" }],
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/assistants-create-or-promote.test.ts`
Expected: FAIL — `@/lib/assistants/create-or-promote` ainda não existe.

- [ ] **Step 3: Adicionar `sendAssistantInviteEmail` a `lib/email.ts`**

Adicione esta função ao final de `lib/email.ts` (mesmo padrão de `sendPasswordResetEmail`, já existente no arquivo):

```ts
/** E-mail de convite pra um novo usuário assistente definir a senha e acessar o sistema. */
export async function sendAssistantInviteEmail(params: {
  to: string;
  name: string;
  invitedByName: string;
  resetUrl: string;
}): Promise<void> {
  const appName = await getAppName();
  await sendMail({
    to: params.to,
    subject: `Você foi convidado como assistente — ${appName}`,
    html: layout(
      appName,
      `<p>Olá ${params.name},</p>
       <p><strong>${params.invitedByName}</strong> te convidou para acessar o ${appName} como usuário assistente.</p>
       <p>Clique no botão abaixo para definir sua senha e acessar sua conta:</p>
       <p><a href="${params.resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Definir senha e acessar</a></p>
       <p style="font-size:13px;color:#6b7280">Se você não esperava este convite, ignore este e-mail. O link expira em 1 hora.</p>`
    ),
  });
}
```

- [ ] **Step 4: Escrever `lib/assistants/create-or-promote.ts`**

```ts
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAssistantInviteEmail } from "@/lib/email";

export interface CreateOrPromoteAssistantParams {
  email: string;
  name: string;
  actionKeys: string[];
  createdByUserId: string;
  invitedByName?: string;
}

export type CreateOrPromoteAssistantResult =
  | { ok: true; userId: string; isNew: boolean }
  | { ok: false; error: string; status: number };

export async function createOrPromoteAssistant(
  params: CreateOrPromoteAssistantParams,
): Promise<CreateOrPromoteAssistantResult> {
  const email = params.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });

  let userId: string;
  let isNew: boolean;

  if (!existing) {
    const created = await db.user.create({
      data: {
        email,
        name: params.name,
        role: "ASSISTANT",
        createdByUserId: params.createdByUserId,
        passwordHash: null,
      },
    });
    userId = created.id;
    isNew = true;
  } else if (existing.role === "ATHLETE") {
    const updated = await db.user.update({
      where: { id: existing.id },
      data: { role: "ASSISTANT", createdByUserId: params.createdByUserId, name: params.name },
    });
    userId = updated.id;
    isNew = false;
  } else {
    // Qualquer papel que não seja "não existe" ou ATHLETE (ADMIN/ORGANIZER/ASSISTANT/
    // SUPPORT/PARTNER) é tratado como conta titular e bloqueado — não há um terceiro
    // caminho no enum UserRole, então este branch cobre tudo que sobra.
    return {
      ok: false,
      error: "Este e-mail já pertence a uma conta titular e não pode virar assistente.",
      status: 400,
    };
  }

  await db.assistantPermission.deleteMany({ where: { userId } });
  if (params.actionKeys.length > 0) {
    await db.assistantPermission.createMany({
      data: params.actionKeys.map((actionKey) => ({ userId, actionKey })),
    });
  }

  if (isNew) {
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 60);
    await db.verificationToken.deleteMany({ where: { identifier: email } });
    await db.verificationToken.create({ data: { identifier: email, token, expires } });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const resetUrl = `${baseUrl}/auth/nova-senha?token=${token}&email=${encodeURIComponent(email)}`;

    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg)) {
      try {
        await sendAssistantInviteEmail({
          to: email,
          name: params.name,
          invitedByName: params.invitedByName ?? "Um administrador",
          resetUrl,
        });
      } catch (err) {
        console.error("[createOrPromoteAssistant] invite email failed:", err);
      }
    }
  }

  return { ok: true, userId, isNew };
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/assistants-create-or-promote.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Escrever os testes de rota**

Create `tests/admin-assistants-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/assistants/create-or-promote", () => ({
  createOrPromoteAssistant: vi.fn(),
}));

import { POST } from "@/app/api/admin/assistants/route";
import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";

const authMock = vi.mocked(auth);
const createMock = vi.mocked(createOrPromoteAssistant);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/assistants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/assistants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ email: "x@example.com", name: "X", actionKeys: ["events.approve"] }));
    expect(res.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o e-mail é inválido", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } } as any);
    const res = await POST(makeRequest({ email: "não-é-email", name: "X", actionKeys: [] }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("cria o assistente com as permissões informadas", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin Principal" } } as any);
    createMock.mockResolvedValueOnce({ ok: true, userId: "new-1", isNew: true });

    const res = await POST(makeRequest({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["events.approve", "events.view"],
    }));
    const body = await res.json();

    expect(createMock).toHaveBeenCalledWith({
      email: "maria@example.com",
      name: "Maria",
      actionKeys: ["events.approve", "events.view"],
      createdByUserId: "admin-1",
      invitedByName: "Admin Principal",
    });
    expect(res.status).toBe(201);
    expect(body).toEqual({ userId: "new-1", isNew: true });
  });

  it("repassa o erro quando a criação/promoção falha", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", name: "Admin" } } as any);
    createMock.mockResolvedValueOnce({ ok: false, error: "Este e-mail já pertence a uma conta titular e não pode virar assistente.", status: 400 });

    const res = await POST(makeRequest({ email: "existente@example.com", name: "X", actionKeys: [] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Este e-mail já pertence a uma conta titular e não pode virar assistente." });
  });
});
```

Create `tests/organizer-assistants-route.test.ts` com o mesmo formato, trocando: o papel testado no primeiro caso pra `"ATHLETE"` (não-organizador), a URL/import para `@/app/api/organizer/assistants/route`, e o `session.user.role` de sucesso para `"ORGANIZER"`.

- [ ] **Step 7: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-assistants-route.test.ts tests/organizer-assistants-route.test.ts`
Expected: FAIL — as rotas ainda não existem.

- [ ] **Step 8: Criar `app/api/admin/assistants/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  name: z.string().min(1, "Nome é obrigatório"),
  actionKeys: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await createOrPromoteAssistant({
    email: parsed.data.email,
    name: parsed.data.name,
    actionKeys: parsed.data.actionKeys,
    createdByUserId: session.user.id,
    invitedByName: session.user.name,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ userId: result.userId, isNew: result.isNew }, { status: 201 });
}
```

- [ ] **Step 9: Criar `app/api/organizer/assistants/route.ts`**

Idêntico ao arquivo acima, exceto: `session.user.role !== "ORGANIZER"` no lugar de `!== "ADMIN"`.

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  name: z.string().min(1, "Nome é obrigatório"),
  actionKeys: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await createOrPromoteAssistant({
    email: parsed.data.email,
    name: parsed.data.name,
    actionKeys: parsed.data.actionKeys,
    createdByUserId: session.user.id,
    invitedByName: session.user.name,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ userId: result.userId, isNew: result.isNew }, { status: 201 });
}
```

- [ ] **Step 10: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-assistants-route.test.ts tests/organizer-assistants-route.test.ts`
Expected: PASS (4 testes em cada arquivo).

- [ ] **Step 11: Rodar o suite completo e o typecheck**

Run: `npx vitest run`
Run: `npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 12: Commit**

```bash
git add lib/email.ts lib/assistants app/api/admin/assistants app/api/organizer/assistants tests/assistants-create-or-promote.test.ts tests/admin-assistants-route.test.ts tests/organizer-assistants-route.test.ts
git commit -m "feat: add assistant creation/promotion flow with invite email"
```

---

### Task 5: Listar e revogar assistentes

**Files:**
- Create: `app/api/admin/assistants/[id]/route.ts`
- Create: `app/api/organizer/assistants/[id]/route.ts`
- Test: `tests/admin-assistants-id-route.test.ts`
- Test: `tests/organizer-assistants-id-route.test.ts`

**Interfaces:**
- Consumes: nada novo (usa `db.user` diretamente).
- Produces:
  - `GET /api/admin/assistants` → `{ assistants: { id, name, email, active, createdAt, permissions: string[] }[] }` (todos os assistentes da plataforma).
  - `PATCH /api/admin/assistants/[id]` (body `{ active: boolean }`) → revoga/reativa, só se `role === "ASSISTANT"`.
  - `GET /api/organizer/assistants` → mesma forma, mas só os assistentes com `createdByUserId === session.user.id`.
  - `PATCH /api/organizer/assistants/[id]` — mesma regra, escopado por dono.

- [ ] **Step 1: Escrever os testes que falham — admin**

Create `tests/admin-assistants-id-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PATCH } from "@/app/api/admin/assistants/route";
import { PATCH as PATCH_BY_ID } from "@/app/api/admin/assistants/[id]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/assistants/a1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("GET /api/admin/assistants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lista todos os assistentes da plataforma com suas permissões", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "a1",
        name: "Maria",
        email: "maria@example.com",
        active: true,
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
        assistantPermissions: [{ actionKey: "events.view" }, { actionKey: "events.approve" }],
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ASSISTANT" } }),
    );
    expect(body.assistants[0]).toEqual(
      expect.objectContaining({ id: "a1", permissions: ["events.view", "events.approve"] }),
    );
  });
});

describe("PATCH /api/admin/assistants/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    expect(res.status).toBe(403);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o alvo não é um assistente", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ATHLETE" });

    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    expect(res.status).toBe(404);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("revoga um assistente (active: false)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "a1", role: "ASSISTANT" });
    dbMock.user.update.mockResolvedValueOnce({ id: "a1", active: false });

    const res = await PATCH_BY_ID(makePatchRequest({ active: false }), makeContext("a1"));
    const body = await res.json();

    expect(dbMock.user.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { active: false } });
    expect(body).toEqual({ ok: true });
  });
});
```

Create `tests/organizer-assistants-id-route.test.ts` com o mesmo formato, importando de `@/app/api/organizer/assistants/route` e `@/app/api/organizer/assistants/[id]/route`, com um caso a mais: "retorna 404 ao tentar revogar um assistente de outro organizador" (`dbMock.user.findUnique` retorna um assistente cujo `createdByUserId` é diferente do `session.user.id` do teste).

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-assistants-id-route.test.ts tests/organizer-assistants-id-route.test.ts`
Expected: FAIL — `GET`/`PATCH` ainda não existem em `app/api/admin/assistants/route.ts` (só `POST` existe, da Task 4), e `app/api/admin/assistants/[id]/route.ts` não existe.

- [ ] **Step 3: Adicionar `GET` a `app/api/admin/assistants/route.ts`**

Adicione ao arquivo já existente (não remova o `POST` da Task 4), com o import de `db` adicionado ao topo:

```ts
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const users = await db.user.findMany({
    where: { role: "ASSISTANT" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      createdAt: true,
      assistantPermissions: { select: { actionKey: true } },
    },
  });

  const assistants = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    active: u.active,
    createdAt: u.createdAt,
    permissions: u.assistantPermissions.map((p) => p.actionKey),
  }));

  return NextResponse.json({ assistants });
}
```

- [ ] **Step 4: Criar `app/api/admin/assistants/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({ active: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.role !== "ASSISTANT") {
    return NextResponse.json({ error: "Assistente não encontrado" }, { status: 404 });
  }

  await db.user.update({ where: { id }, data: { active: parsed.data.active } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Adicionar `GET` a `app/api/organizer/assistants/route.ts`**

Mesma estrutura do Step 3, com duas diferenças: `session.user.role !== "ORGANIZER"` e `where: { role: "ASSISTANT", createdByUserId: session.user.id }`.

- [ ] **Step 6: Criar `app/api/organizer/assistants/[id]/route.ts`**

Mesma estrutura do Step 4, com duas diferenças: checagem de papel `!== "ORGANIZER"`, e a busca do alvo escopada por dono:

```ts
  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.role !== "ASSISTANT" || target.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: "Assistente não encontrado" }, { status: 404 });
  }
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-assistants-id-route.test.ts tests/organizer-assistants-id-route.test.ts`
Expected: PASS.

- [ ] **Step 8: Rodar o suite completo e o typecheck**

Run: `npx vitest run`
Run: `npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 9: Commit**

```bash
git add app/api/admin/assistants app/api/organizer/assistants tests/admin-assistants-id-route.test.ts tests/organizer-assistants-id-route.test.ts
git commit -m "feat: add list and revoke endpoints for assistant users"
```

---

### Task 6: Telas de gestão + redirecionamento pós-login

**Files:**
- Create: `app/admin/assistentes/page.tsx`
- Create: `app/organizador/assistentes/page.tsx`
- Create: `components/assistants/AssistantManager.tsx`
- Modify: `components/admin/AdminNav.tsx` (link pra `/admin/assistentes`)
- Modify: `components/organizer/OrganizerNav.tsx` (link pra `/organizador/assistentes`)
- Modify: `app/completar-cadastro/page.tsx` (ROLE_HOME pro assistente)

**Interfaces:**
- Consumes: `GET`/`POST /api/{admin,organizer}/assistants`, `PATCH /api/{admin,organizer}/assistants/[id]` (Tasks 4-5); `components/ui/ConfirmModal.tsx`/`components/ui/ErrorModal.tsx` (existentes).
- Produces: nenhuma interface nova — é a camada de UI final.

Este componente não tem teste automatizado, seguindo a mesma convenção já usada por
`components/profile/DailySummaryRecipientsManager.tsx` (client component só de wiring, sem lógica
de negócio própria — a lógica já está testada nas rotas).

- [ ] **Step 1: Criar `components/assistants/AssistantManager.tsx`**

Componente compartilhado por admin e organizador, parametrizado pela base da API e pelas chaves de
permissão disponíveis (que diferem entre admin e organizador, conforme a spec):

```tsx
"use client";

import { useEffect, useState } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

type Assistant = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  permissions: string[];
};

type ActionOption = { key: string; label: string };

export default function AssistantManager({
  apiBase,
  actionOptions,
}: {
  apiBase: string;
  actionOptions: ActionOption[];
}) {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"view" | "custom">("view");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; nextActive: boolean } | null>(null);

  const viewKeys = actionOptions.filter((o) => o.key.endsWith(".view")).map((o) => o.key);

  useEffect(() => {
    fetch(`${apiBase}/assistants`)
      .then((res) => res.json())
      .then(({ assistants }) => setAssistants(assistants ?? []))
      .finally(() => setLoading(false));
  }, [apiBase]);

  function toggleKey(key: string) {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const actionKeys = mode === "view" ? viewKeys : Array.from(new Set([...selectedKeys, ...viewKeys.filter((v) => selectedKeys.some((k) => k.startsWith(v.split(".")[0])))]));
    try {
      const res = await fetch(`${apiBase}/assistants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), actionKeys }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Erro ao criar assistente.");
        return;
      }
      const refreshed = await fetch(`${apiBase}/assistants`).then((r) => r.json());
      setAssistants(refreshed.assistants ?? []);
      setName("");
      setEmail("");
      setSelectedKeys([]);
      setMode("view");
    } finally {
      setSaving(false);
    }
  }

  async function doToggle() {
    if (!confirmToggle) return;
    setTogglingId(confirmToggle.id);
    try {
      const res = await fetch(`${apiBase}/assistants/${confirmToggle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: confirmToggle.nextActive }),
      });
      if (!res.ok) {
        setError("Erro ao atualizar o assistente.");
        return;
      }
      setAssistants((prev) =>
        prev.map((a) => (a.id === confirmToggle.id ? { ...a, active: confirmToggle.nextActive } : a)),
      );
    } finally {
      setTogglingId(null);
      setConfirmToggle(null);
    }
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="card space-y-2">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Assistentes</h2>
        {assistants.length === 0 && <p className="text-sm text-gray-500">Nenhum assistente cadastrado.</p>}
        {assistants.length > 0 && (
          <ul className="space-y-2">
            {assistants.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-800 rounded px-3 py-2">
                <span>
                  <strong>{a.name}</strong> — {a.email} — {a.active ? "Ativo" : "Bloqueado"} — {a.permissions.length} permissões
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmToggle({ id: a.id, nextActive: !a.active })}
                  disabled={togglingId === a.id}
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium disabled:opacity-50"
                >
                  {a.active ? "Bloquear" : "Reativar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Criar assistente</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-field w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field w-full" required />
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={mode === "view"} onChange={() => setMode("view")} />
            Somente visualização e exportação
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} />
            Ações específicas
          </label>
        </div>

        {mode === "custom" && (
          <div className="grid grid-cols-2 gap-2 border-t border-gray-200 dark:border-gray-700 pt-3">
            {actionOptions.map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedKeys.includes(opt.key)}
                  onChange={() => toggleKey(opt.key)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        )}

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Criando..." : "Criar assistente"}
        </button>
      </form>

      <ConfirmModal
        open={!!confirmToggle}
        title={confirmToggle?.nextActive ? "Reativar assistente" : "Bloquear assistente"}
        message={
          confirmToggle?.nextActive
            ? "Tem certeza que deseja reativar o acesso deste assistente?"
            : "Tem certeza que deseja bloquear o acesso deste assistente?"
        }
        tone={confirmToggle?.nextActive ? "success" : "danger"}
        loading={!!togglingId}
        onConfirm={doToggle}
        onCancel={() => setConfirmToggle(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
```

Nota: no modo "Ações específicas", a linha de cálculo de `actionKeys` em `handleCreate` já inclui automaticamente a chave `.view` correspondente sempre que qualquer ação daquele domínio for marcada — implementando a regra "marcar escrita implica visualização" descrita na spec.

- [ ] **Step 2: Criar `app/admin/assistentes/page.tsx`**

```tsx
import type { Metadata } from "next";
import AssistantManager from "@/components/assistants/AssistantManager";

export const metadata: Metadata = { title: "Assistentes — Admin" };

const ADMIN_EVENT_ACTIONS = [
  { key: "events.view", label: "Ver eventos e exportar CSV" },
  { key: "events.approve", label: "Aprovar evento" },
  { key: "events.reject", label: "Rejeitar evento" },
  { key: "events.set-fee", label: "Definir taxa de plataforma" },
  { key: "events.edit", label: "Editar evento (qualquer)" },
  { key: "events.delete", label: "Excluir evento (qualquer)" },
  { key: "events.archive", label: "Arquivar/cancelar evento (qualquer)" },
];

export default function AdminAssistentesPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Usuários Assistentes</h1>
      <AssistantManager apiBase="/api/admin" actionOptions={ADMIN_EVENT_ACTIONS} />
    </div>
  );
}
```

- [ ] **Step 3: Criar `app/organizador/assistentes/page.tsx`**

```tsx
import type { Metadata } from "next";
import AssistantManager from "@/components/assistants/AssistantManager";

export const metadata: Metadata = { title: "Assistentes — Organizador" };

const ORGANIZER_EVENT_ACTIONS = [
  { key: "events.view", label: "Ver meus eventos e exportar CSV" },
  { key: "events.create", label: "Criar evento" },
  { key: "events.edit", label: "Editar meus eventos" },
  { key: "events.delete", label: "Excluir meus eventos" },
  { key: "events.archive", label: "Arquivar/cancelar meus eventos" },
  { key: "events.duplicate", label: "Duplicar meus eventos" },
];

export default function OrganizerAssistentesPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Usuários Assistentes</h1>
      <AssistantManager apiBase="/api/organizer" actionOptions={ORGANIZER_EVENT_ACTIONS} />
    </div>
  );
}
```

- [ ] **Step 4: Adicionar o link de navegação**

Leia `components/admin/AdminNav.tsx` e `components/organizer/OrganizerNav.tsx` antes de editar, e adicione um item de menu "Assistentes" apontando para `/admin/assistentes` (no primeiro) e `/organizador/assistentes` (no segundo), seguindo exatamente o mesmo padrão de item de menu já usado pelos demais links desses componentes (mesma estrutura de `<Link>`, mesmas classes CSS).

- [ ] **Step 5: Resolver o redirecionamento pós-login do assistente**

Em `app/completar-cadastro/page.tsx`, o `ROLE_HOME` é um `Record<UserRole, string>` estático — não dá pra resolver o destino de um `ASSISTANT` sem saber quem o criou. Troque:

```ts
const ROLE_HOME: Record<UserRole, string> = {
  ATHLETE: "/dashboard",
  ORGANIZER: "/organizador",
  ADMIN: "/admin",
  SUPPORT: "/admin",
  PARTNER: "/dashboard",
};
```

para:

```ts
const ROLE_HOME: Record<Exclude<UserRole, "ASSISTANT">, string> = {
  ATHLETE: "/dashboard",
  ORGANIZER: "/organizador",
  ADMIN: "/admin",
  SUPPORT: "/admin",
  PARTNER: "/dashboard",
};
```

E troque o uso (linha ~23-25):

```ts
  if (session.user.role !== "ATHLETE") {
    redirect(ROLE_HOME[session.user.role as UserRole] ?? "/dashboard");
  }
```

para:

```ts
  if (session.user.role === "ASSISTANT") {
    const scope = await resolveActingScope(session);
    redirect(scope.actingAsAdmin ? "/admin" : scope.organizerId ? "/organizador" : "/dashboard");
  }
  if (session.user.role !== "ATHLETE") {
    redirect(ROLE_HOME[session.user.role as Exclude<UserRole, "ASSISTANT">] ?? "/dashboard");
  }
```

Adicione o import: `import { requireAuth, resolveActingScope } from "@/lib/auth/rbac";` (troque o import existente de `requireAuth`, que já vem de `@/lib/auth/rbac`, adicionando `resolveActingScope` na mesma linha).

- [ ] **Step 6: Rodar o suite completo e o typecheck**

Run: `npx vitest run`
Expected: tudo passa (nenhum teste cobre estas páginas/componentes diretamente, então não deve haver regressão).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/admin/assistentes app/organizador/assistentes components/assistants components/admin/AdminNav.tsx components/organizer/OrganizerNav.tsx app/completar-cadastro/page.tsx
git commit -m "feat: add assistant management UI and post-login redirect resolution"
```

---

## Verificação manual (fazer depois de todas as tarefas, antes de considerar a Fase 1 completa)

Como não há acesso ao banco de dados de produção neste ambiente sandboxed, os seguintes passos
precisam ser verificados manualmente pelo usuário após o deploy, seguindo o mesmo padrão já
adotado nas fases anteriores desta sessão:

1. Criar um assistente-de-admin com só `events.view` → confirmar que ele consegue ver `/admin/eventos` mas não vê/consegue clicar em aprovar/rejeitar/editar.
2. Criar um assistente-de-organizador com `events.create` + `events.edit` → confirmar que ele só vê os eventos daquele organizador, nunca de outro.
3. Tentar criar um assistente com um e-mail que já é ADMIN titular → confirmar bloqueio com a mensagem correta.
4. Promover um ATHLETE existente a assistente → confirmar que as inscrições dele como atleta continuam no banco (só o `role` mudou).
5. Revogar (`Bloquear`) um assistente → confirmar que ele não consegue mais logar/acessar nada (mesmo comportamento de `active: false` já usado pra outros usuários).
