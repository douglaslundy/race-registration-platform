# Usuários Assistentes — Fase 2, domínio 5: Resultados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o suporte a usuários assistentes ao domínio Resultados (importar/publicar
CSV), fechando junto o gap de posse do PATCH (publicar hoje não verifica dono do evento).

**Architecture:** Reaproveita `checkApiPermission` + `resolveActingScope` (Fase 1, intocados).
2 chaves novas (`results.import`, `results.publish`), ambas compartilhadas com bypass de admin,
num único arquivo de rota + UI.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest — sem dependências novas.

## Global Constraints

- Nenhuma migração de schema.
- Ambas as chaves têm bypass de admin: `scope.actingAsAdmin ? db.event.findUnique({where:{id}})
  : db.event.findFirst({where:{id, organizerId: scope.organizerId ?? "__none__"}})` — este
  arquivo usa `organizerId` (`OrganizerProfile.id`), então `resolveActingScope` serve
  diretamente (diferente do domínio Pagamentos).
- **Fix de segurança embutido:** o `PATCH` hoje não verifica posse do evento (qualquer
  organizador publica import de qualquer evento). O fix adiciona a mesma resolução de evento do
  `POST` antes do update. O `where: {id: importId, eventId}` do update permanece.
- `importedBy`/`auditLog.userId` continuam `session.user.id` (ator real, assistente ou titular).
- `tests/event-results-route.test.ts` já existe (12 testes) — estender, não recriar. O
  `beforeEach` usa `mockResolvedValue` (não `Once`) com cenário-default de organizador titular.
- `lib/auth/rbac.ts` não é tocado.

---

### Task 1: Gatear POST/PATCH de resultados + fix de posse do PATCH

**Files:**
- Modify: `app/api/events/[id]/results/route.ts`
- Test: `tests/event-results-route.test.ts` (estender)

**Interfaces:**
- Consumes: `checkApiPermission`, `resolveActingScope` de `@/lib/auth/rbac` (Fase 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Estender o teste com os casos novos (falham antes do fix)**

Adicionar dentro do `describe("POST (import)")`:

```ts
    it("admin titular importa em qualquer evento (bypass)", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1", organizerId: "org-99" });

      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);

      expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
      expect(res.status).toBe(200);
    });

    it("assistente de organizador com a permissão importa no evento do criador", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
      dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
      dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);

      expect(res.status).toBe(200);
    });

    it("assistente sem a permissão é barrado com 403", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
      dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);

      expect(res.status).toBe(403);
      expect(dbMock.resultImport.create).not.toHaveBeenCalled();
    });
```

Adicionar dentro do `describe("PATCH (publish)")`:

```ts
    it("organizador titular recebe 404 ao tentar publicar import de evento de outro organizador (fix de posse)", async () => {
      dbMock.event.findFirst.mockResolvedValueOnce(null);

      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(res.status).toBe(404);
      expect(dbMock.resultImport.update).not.toHaveBeenCalled();
    });

    it("admin titular publica em qualquer evento (bypass)", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1", organizerId: "org-99" });

      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(res.status).toBe(200);
    });

    it("assistente de organizador com a permissão publica no evento do criador", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
      dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
      dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });

      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(res.status).toBe(200);
    });

    it("assistente sem a permissão é barrado com 403", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
      dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(res.status).toBe(403);
      expect(dbMock.resultImport.update).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Rodar e confirmar FAIL nos casos novos**

Run: `npx vitest run tests/event-results-route.test.ts`

- [ ] **Step 3: Trocar o arquivo de rota**

Import: de `import { auth } from "@/lib/auth";` para
`import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";`.

`POST` — trocar:

```ts
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
```

por:

```ts
  const check = await checkApiPermission("results.import");
  if (!check.allowed) return check.response;
  const { session } = check;
```

e trocar:

```ts
  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  const event = await db.event.findFirst({
    where: { id: eventId, ...(session.user.role !== "ADMIN" ? { organizerId: organizer?.id } : {}) },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

por:

```ts
  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

`PATCH` — trocar:

```ts
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const { importId } = await req.json();
```

por:

```ts
  const check = await checkApiPermission("results.publish");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id: eventId } = await params;
  const { importId } = await req.json();

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
```

- [ ] **Step 4: Rodar e confirmar PASS (19 testes), depois suíte completa + tsc**
- [ ] **Step 5: Commit**

```bash
git add app/api/events/[id]/results/route.ts tests/event-results-route.test.ts
git commit -m "feat: gate results import/publish with checkApiPermission, fix missing ownership check on publish"
```

---

### Task 2: UI — adicionar as 2 chaves às páginas de gestão de assistentes

**Files:**
- Modify: `app/admin/assistentes/page.tsx` — adicionar ao final de `ADMIN_EVENT_ACTIONS`:

```ts
  { key: "results.import", label: "Importar resultados via CSV (qualquer evento)" },
  { key: "results.publish", label: "Publicar resultados (qualquer evento)" },
```

- Modify: `app/organizador/assistentes/page.tsx` — adicionar ao final de
  `ORGANIZER_EVENT_ACTIONS`:

```ts
  { key: "results.import", label: "Importar resultados via CSV" },
  { key: "results.publish", label: "Publicar resultados" },
```

- [ ] **Step 1: Aplicar as duas edições**
- [ ] **Step 2: `npx tsc --noEmit` + `npx vitest run` (tudo verde)**
- [ ] **Step 3: Commit**

```bash
git add app/admin/assistentes/page.tsx app/organizador/assistentes/page.tsx
git commit -m "feat: add Resultados permission keys to assistant management UI"
```
