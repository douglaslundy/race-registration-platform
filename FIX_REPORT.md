# FIX_REPORT — assistente (acesso negado + promoção + escopo por evento)

Branch: `fix/assistant-event-scope` (base `main`, worktree `corridas-assistfix`).

## Requisito 1 — "Acesso negado" do assistente de kit (BUG)

### Causa raiz (arquivo:linha)

**`proxy.ts:27-33`** (o middleware do Next — `proxy.ts` neste projeto).

```ts
if (
  organizerOnly.some((p) => pathname.startsWith(p)) &&
  role !== "ORGANIZER" &&
  role !== "ADMIN"
) {
  return NextResponse.redirect(new URL("/acesso-negado", req.url));
}
```

O middleware roda **antes de qualquer layout/página**. Para um usuário `ASSISTANT`,
qualquer rota `/organizador/*` (e `/admin/*`) batia nesse `if` e era redirecionada
direto pra `/acesso-negado` — o clique em "Organizador" no `/dashboard` nunca
chegava a executar `requireOrganizer()`. O papel `ASSISTANT` sozinho não diz a que
áreas ele tem acesso: isso depende das `AssistantPermission` e do papel/perfil do
criador, e o middleware (edge) não faz essa consulta.

Beco secundário (não era "acesso negado", mas também estava errado):
`app/organizador/page.tsx:65` — para um assistente, `db.organizerProfile.findUnique`
é `null` e a página renderizava "Configure seu perfil de organizador".

### Correção

- **`proxy.ts`**: `if (role === "ASSISTANT") return NextResponse.next();` antes dos
  dois blocos de bloqueio por prefixo. Os guards de página/rota
  (`requireOrganizer` / `requireAdmin` / `requirePermission` / `requireAnyPermission`)
  passam a ser a única autoridade para o assistente — e todos já tratam `ASSISTANT`
  corretamente (com consulta ao banco).
- **`app/organizador/page.tsx`**: se `session.user.role === "ASSISTANT"`,
  `redirect("/organizador/entrega-kits")` — leva o assistente direto ao que ele pode
  fazer, em vez do beco do perfil.
- **`app/organizador/eventos/[id]/entrega-kits/page.tsx`**: era um client component
  **sem guard nenhum**. Virou server component (`page.tsx`) que chama
  `requireAnyPermission(["kits.view","kits.deliver"], { eventId: id })` e renderiza
  o client (`EntregaKitsClient.tsx`, renomeado via `git mv`).
- **Busca/relatório na tela de entrega** aceitam `kits.view` **OU** `kits.deliver`
  (`checkAnyApiPermission`) — um assistente "só entrega" (`kits.deliver` sem
  `kits.view`) agora funciona ponta a ponta.

Fluxo verificado (por leitura de código): login → `/dashboard` (mostra link
"Organizador", via `resolveActingScope`) → `/organizador` (layout `requireOrganizer`
passa; page redireciona pra entrega-kits) → `/organizador/entrega-kits`
(`requireAnyPermission` passa) → clique no evento →
`/organizador/eventos/[id]/entrega-kits` (guard server com `{ eventId }`) → APIs de
kit (`checkApiPermission("kits.deliver", { eventId })` / `checkAnyApiPermission`).

## Requisito 2 — Promover ATHLETE já cadastrado

`createOrPromoteAssistant` já tratava `existing.role === "ATHLETE"` → promove sem
criar conta nova nem convite. **Nenhum bug real de bloqueio encontrado** na rota do
organizador. Ajustes feitos:

- `AssistantManager`: mensagem clara após o POST — usa `data.isNew`:
  `isNew === false` → "Usuário existente promovido a assistente…"; `isNew === true`
  → "Assistente criado — convite enviado…"; `inviteResent` → mensagem de reenvio.
- E-mail que já é `ASSISTANT` de **outro** criador continua recusado (código
  inalterado; coberto por teste existente).
- A promoção agora também aplica o `eventId` (Requisito 3).

## Requisito 3 — Evento obrigatório + escopo por evento

### Schema + migração

- `prisma/schema.prisma`: `AssistantPermission.eventId String?`,
  `event Event? @relation(fields: [eventId], references: [id], onDelete: Cascade)`,
  `@@unique([userId, actionKey])` → `@@unique([userId, actionKey, eventId])`,
  novo `@@index([eventId])`; `Event.assistantPermissions AssistantPermission[]`.
- `prisma/migrations/20260828000000_add_assistant_permission_event/migration.sql`
  (`git add -f` — `prisma/migrations/` é gitignored):
  - `ADD COLUMN "eventId" TEXT;`
  - `DROP INDEX "assistant_permissions_userId_actionKey_key";`
  - `CREATE UNIQUE INDEX "assistant_permissions_userId_actionKey_eventId_key" … ("userId","actionKey","eventId");`
  - `CREATE INDEX "assistant_permissions_eventId_idx" … ("eventId");`
  - `ADD CONSTRAINT "assistant_permissions_eventId_fkey" … ON DELETE CASCADE`.
  - Sem backfill — linhas existentes ficam `NULL` = "todos os eventos".
- `npx prisma validate` → **válido**. Migração coerente com o schema.

### RBAC (`lib/auth/rbac.ts`)

- Helper interno `assistantHasAnyPermission(userId, actionKeys, eventId?)`:
  `findFirst` com `actionKey IN (...)` e — se `eventId` informado —
  `OR: [{ eventId: null }, { eventId }]`; **sem** `eventId` → `eventId: null`
  (só linhas globais; fail-safe).
- `checkApiPermission(actionKey, opts?: { eventId? })`,
  `requirePermission(actionKey, opts?)`,
  `requireAnyPermission(actionKeys, opts?)` — todas event-aware, assinaturas
  retrocompatíveis (`opts` opcional).
- Novo `checkAnyApiPermission(actionKeys, opts?)` (rota, "qualquer uma").
- Novo `assistantPermittedEventIds(userId, actionKeys)` → `string[] | null`
  (`null` = tem permissão global = todos os eventos).
- `checkApiPermission` e `checkAdminOnlyApiPermission` trocaram `findUnique`
  (`userId_actionKey`, que deixou de existir) por `findFirst`.
- **ADMIN/ORGANIZER titulares**: caminho inalterado — passam sempre, sem consulta.

### `createOrPromoteAssistant` + rotas

- `CreateOrPromoteAssistantParams.eventId?: string | null` (default `null`).
  As linhas criadas levam `eventId`.
- `POST /api/organizer/assistants`: `eventId` **obrigatório** no body. `"ALL"` →
  `null`; qualquer outro valor tem que ser um evento do
  `resolveActingScope().organizerId` (senão **400**); ausente → **400** (zod).
- `POST /api/admin/assistants`: `eventId` **opcional** (admin é global); se vier e
  `!= "ALL"`, valida existência do evento (**400** se não existe).
- `GET` (ambas): novo campo `scopes[]` por assistente — `{ eventId, eventTitle,
  permissions[] }`, agrupado por evento, "Todos os eventos" primeiro
  (`lib/assistants/list.ts` `buildScopes`).

### Rotas que receberam `{ eventId }`

**Obrigatórias (kit):**
`app/api/events/[id]/kit-deliveries/route.ts` (`checkApiPermission("kits.deliver", { eventId: id })`),
`…/search/route.ts`, `…/report/route.ts`, `…/report-export/route.ts`
(estas três: `checkAnyApiPermission(["kits.view","kits.deliver"], { eventId: id })`).

**Mecânicas — todas as `app/api/events/[id]/**/route.ts` com `checkApiPermission`**
(33 arquivos, via script; `id`/`{ id: eventId }` extraído do path e movido pra antes
da checagem):
archive, batches (+[batchId]), campaigns (route, variables, alert-options,
[campaignId] route/cancel/duplicate/pause/prepare-recipients/preview/resume/
schedule/test-send, recipients/failures, recipients/summary), categories
(+[categoryId]), coupons (route, [couponId], report-export), duplicate,
registrations, results, route.ts (PATCH/DELETE), routes (+[routeId]), seo/generate,
social-links (+[linkId]), sponsors (+[sponsorId]).

**Páginas:** `/{organizador,admin}/entrega-kits` (landing) filtram os eventos
listados por `assistantPermittedEventIds`; `/{organizador,admin}/eventos/[id]/entrega-kits`
com guard `requireAnyPermission([...], { eventId: id })`.

### Rotas que NÃO receberam `{ eventId }` (e por quê)

- **`app/api/organizer/registrations/[id]/*`** (11 rotas: athlete, cancel-confirmed
  [+request-code], cancel-pending, cancellation-decision [+request-code],
  manual-confirm, refund [+request-code], resend-confirmation-email,
  resend-payment-notification). O `[id]` é o `registrationId`, não o evento; obter o
  `eventId` exige mover a checagem de permissão pra **depois** do fetch da inscrição
  (hoje ela vem antes), mudando a ordem 403-antes-de-404 em ~11 arquivos + testes.
  Risco alto, valor baixo. Ficam com checagem **global-only** → um assistente
  restrito a um evento simplesmente não usa essas rotas (fail-safe correto). **Risco
  residual documentado.**
- **Rotas admin `checkAdminOnlyApiPermission`** e rotas sem evento no escopo
  (`/api/admin/*`, `/api/organizer/*` sem `[id]` de evento): sem `opts` — mesmo
  fail-safe. Conforme o brief.

### UI

- `AssistantManager`: `scopedByEvent = apiBase === "/api/organizer"`. `<select>`
  "Evento" obrigatório (só nesse caso) com "Todos os eventos" (`"ALL"`) + um
  `<option>` por evento (nova prop `events`). POST manda `eventId` quando
  `scopedByEvent`. Listagem mostra `scopes`. Admin não vê o select.
- `app/organizador/assistentes/page.tsx`: virou `async` server component,
  `requireOrganizer` + `resolveActingScope`, consulta
  `db.event.findMany({ where: { organizerId } })` e passa `events`.

## Verificação

| Comando | Resultado |
|---|---|
| `npx vitest run` | **263 arquivos, 1996 testes, todos passando** (0 falhas) |
| `npx tsc --noEmit` | **limpo** (exit 0) |
| `npm run build` | **limpo** — "Compiled successfully in 33.4s", 96/96 páginas |
| `npx prisma validate` | **válido** |

Testes adicionados/alterados:
- `tests/rbac.test.ts`: +4 (event-aware — global autoriza qualquer evento; restrito
  a e1 nega e2 e nega sem opts; ADMIN/ORGANIZER passam com `{ eventId }`).
- `tests/assistants-create-or-promote.test.ts`: +2 (grava `eventId` em novo usuário
  e em promoção de ATHLETE) + `eventId: null` nos asserts de `createMany` existentes.
- `tests/organizer-assistants-route.test.ts`: reescrito — 400 sem eventId, 400 com
  evento de outro organizador, 201 com `"ALL"` (grava `null`), 201 com evento próprio.
- `tests/events-kit-deliveries-route.test.ts`: +2 (POST e search passam `{ eventId }`).
- `tests/events-kit-deliveries-report-route.test.ts`: mock de `checkAnyApiPermission`.
- 46 testes de rota: `assistantPermission.findUnique` → `findFirst` (mecânico, sed);
  4 (`admin-event-{approve,fee,reject}`, `admin-events`) tiveram o shape do `where`
  do assert ajustado.
- `tests/setup.ts`: `assistantPermission` ganha `findFirst`; `findMany` default `[]`.

## Riscos residuais

1. **Rotas `/api/organizer/registrations/[id]/*` sem escopo de evento** (ver acima) —
   assistente restrito a evento não as usa. Fail-safe, mas não é a granularidade
   ideal do brief.
2. **Middleware agora deixa `ASSISTANT` alcançar qualquer `/admin/*` e
   `/organizador/*`.** Depende de todo layout/página dessas áreas ter guard próprio.
   Os layouts (`app/organizador/layout.tsx`, `app/admin/layout.tsx`) chamam
   `requireOrganizer`/`requireAdmin`, então a cobertura base existe; páginas soltas
   sem guard ficariam expostas a um assistente autenticado (não a um estranho).
3. **`@@unique([userId, actionKey, eventId])` com `eventId NULL`**: no Postgres NULLs
   são distintos, então a constraint não impede duas linhas globais idênticas.
   Na prática `createOrPromoteAssistant` faz `deleteMany` antes de recriar, então não
   há duplicidade — mas inserts manuais fora desse caminho não seriam barrados.
4. **`checkAdminOnlyApiPermission`** virou `findFirst({ where: { userId, actionKey } })`
   sem filtro de evento — uma linha event-scoped autorizaria uma ação admin global.
   Só alcançável se um admin criar assistente com `eventId` via API (o form não
   oferece). Impacto mínimo.
5. **Migração dropa o índice pelo nome exato** `assistant_permissions_userId_actionKey_key`.
   Se produção divergir do nome padrão do Prisma, o `migrate deploy` falha (baixo
   risco — o índice foi criado pela migração `20260714010000_add_assistant_users`
   com esse nome).
6. Sem teste do `proxy.ts` em si (não há harness pra ele no projeto); a correção é
   por remoção de bloqueio e os guards por trás estão cobertos.
