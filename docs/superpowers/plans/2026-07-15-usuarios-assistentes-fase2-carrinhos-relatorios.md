# Usuários Assistentes — Fase 2, domínio 6: Carrinhos Abandonados + Relatórios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o suporte a usuários assistentes às 4 rotas de carrinhos abandonados e
relatório financeiro (admin + organizador), fechando a Fase 2.

**Architecture:** Reaproveita `checkApiPermission`/`checkAdminOnlyApiPermission` (Fase 1,
intocados). 4 chaves novas. A rota organizer de carrinhos usa resolução LOCAL de
`organizerUserId` (padrão Pagamentos); a de relatório usa `resolveActingScope` (filtra por
`OrganizerProfile.id`).

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest — sem dependências novas.

## Global Constraints

- Nenhuma migração de schema. `lib/auth/rbac.ts` não é tocado.
- `abandoned-carts.notify` (organizer): resolução LOCAL de `organizerUserId` (bloco idêntico ao
  do domínio Pagamentos); `organizerUserId` substitui `session.user.id` no `where` do pedido
  individual E no `scope` do envio em massa. `auditLog.userId` continua `session.user.id`.
- `reports.export` (organizer): `resolveActingScope`; `scope.organizerId` null → 404 "Perfil de
  organizador não encontrado" (admin titular/assistente-de-admin continuam sem acesso funcional,
  como hoje); senão o filtro usa `scope.organizerId`.
- `abandoned-carts.notify-any` e `reports.export-all` (admin): `checkAdminOnlyApiPermission`,
  sem escopo.
- Testes: estender `organizer-abandoned-carts-notify-route.test.ts` (9 testes),
  `admin-abandoned-carts-notify-route.test.ts` e `admin-report-route.test.ts`; casos de
  `organizer/report/export` são novos (rota sem teste hoje) — adicionar num arquivo novo
  `tests/organizer-report-export-route.test.ts`. Ajustes 403→401 de sem-sessão são aceitáveis
  (padrão dos domínios anteriores). O teste existente do organizer de carrinhos tem um caso
  "permite admin acessar e envia em massa" que documenta o escopo pelo userId do admin — esse
  comportamento é preservado (admin continua passando o check e sendo escopado ao próprio
  userId, sem acesso funcional).

---

### Task 1: Carrinhos abandonados (`abandoned-carts.notify` + `-any`)

**Files:**
- Modify: `app/api/organizer/abandoned-carts/notify/route.ts`
- Modify: `app/api/admin/abandoned-carts/notify/route.ts`
- Test: `tests/organizer-abandoned-carts-notify-route.test.ts` (estender: +2 casos assistente)
- Test: `tests/admin-abandoned-carts-notify-route.test.ts` (estender: +3 casos assistente)

Organizer route — import: `auth` → `checkApiPermission` de `@/lib/auth/rbac` (manter `db`).
Prologue:

```ts
  const check = await checkApiPermission("abandoned-carts.notify");
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
```

E trocar `session.user.id` por `organizerUserId` em: `const scope = { organizerUserId: ... }` e
no `where` do pedido individual (`organizer: { userId: organizerUserId }`). `auditLog` intocado.

Admin route — trocar o role check por `checkAdminOnlyApiPermission("abandoned-carts.notify-any")`
(+ `const { session } = check;` — o `session.user.id` do auditLog continua).

Casos de teste novos (organizer): assistente com permissão notifica individual escopado ao
`createdByUserId` do criador (mock `user.findUnique` → `{createdByUserId: "org-user-1"}`, assert
no `where`); assistente sem permissão 403. Casos novos (admin): assistente-de-admin com permissão
funciona; assistente-de-organizador com chave por engano 403; assistente sem permissão 403.

- [ ] Testes primeiro (FAIL), rota depois (PASS), suíte completa + tsc, commit:

```bash
git commit -m "feat: gate abandoned cart notify routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 2: Relatório financeiro (`reports.export` + `reports.export-all`)

**Files:**
- Modify: `app/api/organizer/report/export/route.ts`
- Modify: `app/api/admin/report/export/route.ts`
- Test: `tests/organizer-report-export-route.test.ts` (novo)
- Test: `tests/admin-report-route.test.ts` (estender: +3 casos assistente)

Organizer route — import: `auth` → `checkApiPermission, resolveActingScope`. Prologue:

```ts
  const check = await checkApiPermission("reports.export");
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  if (!scope.organizerId) {
    return NextResponse.json({ error: "Perfil de organizador não encontrado" }, { status: 404 });
  }
```

E `filter = { organizerId: scope.organizerId, from, to, eventId }` (a consulta manual de
`organizerProfile` sai).

Admin route — trocar o role check por `checkAdminOnlyApiPermission("reports.export-all")`.

Teste novo (organizer): titular exporta (200, CSV); assistente-de-organizador exporta com o
`organizerId` do criador (mock `assistantPermission` + `user.findUnique` com
`createdBy.organizerProfile.id`); admin titular recebe 404 (sem acesso funcional); assistente sem
permissão 403. Casos novos (admin): mesmos 3 de assistente do padrão.

- [ ] Testes primeiro (FAIL), rotas depois (PASS), suíte completa + tsc, commit:

```bash
git commit -m "feat: gate financial report export routes with checkApiPermission/checkAdminOnlyApiPermission"
```

---

### Task 3: UI — 4 chaves

- `app/admin/assistentes/page.tsx`, ao final:

```ts
  { key: "abandoned-carts.notify-any", label: "Reenviar alerta de carrinho abandonado (plataforma inteira)" },
  { key: "reports.export-all", label: "Exportar relatório financeiro da plataforma" },
```

- `app/organizador/assistentes/page.tsx`, ao final:

```ts
  { key: "abandoned-carts.notify", label: "Reenviar alerta de carrinho abandonado (meus eventos)" },
  { key: "reports.export", label: "Exportar relatório financeiro (meus eventos)" },
```

- [ ] `npx tsc --noEmit` + `npx vitest run` verdes, commit:

```bash
git commit -m "feat: add Carrinhos/Relatorios permission keys to assistant management UI"
```
