# Correção: assistente (acesso negado + promoção + escopo por evento)

Você trabalha NESTE worktree isolado: `C:/Users/dougl/workspace2/corridas-assistfix`, branch `fix/assistant-event-scope` (baseada em `main`). **NÃO** rode `git checkout` de outra branch, **NÃO** toque no diretório `../sistema_inscricoes_corridas_codex` (outro trabalho roda lá).

**Primeiro:** `npm ci` (este worktree não tem `node_modules`), depois `npx prisma generate`.

Projeto: Next.js 16 App Router + TypeScript + Prisma 5 + PostgreSQL + Vitest. `db` é auto-mockado em `tests/setup.ts`.

Contexto de RBAC atual:
- `lib/auth/rbac.ts`: `checkApiPermission(actionKey)` (rotas), `requirePermission(actionKey)` / `requireAnyPermission(actionKeys[])` (páginas server component), `resolveActingScope(session)` (→ `{ actingAsAdmin, organizerId }`). Para ASSISTANT, `checkApiPermission` consulta `db.assistantPermission.findUnique({ where: { userId_actionKey: {...} } })`.
- `AssistantPermission` model: `{ id, userId, actionKey, createdAt }`, `@@unique([userId, actionKey])`. Hoje um assistente com `kits.deliver` pode entregar kit em QUALQUER evento do organizador que o criou.
- `lib/assistants/create-or-promote.ts`: `createOrPromoteAssistant({ email, name, actionKeys, createdByUserId, invitedByName })` — cria usuário ASSISTANT novo (+convite), ou promove ATHLETE existente, ou reenvia convite pra ASSISTANT pendente do mesmo criador, ou erra. `issueAssistantInvite` helper (token 72h).
- Rota do organizador: `app/api/organizer/assistants/route.ts` (POST valida `{ email, name, actionKeys }` do `AssistantManager`), GET lista.
- UI: `components/assistants/AssistantManager.tsx` (compartilhado admin+organizador), `app/organizador/assistentes/page.tsx` (`ORGANIZER_EVENT_ACTIONS` — lista de actionKeys com label; inclui `kits.view`, `kits.deliver`), `app/admin/assistentes/page.tsx`.
- Páginas de entrega de kit (já existem): `app/{organizador,admin}/entrega-kits/page.tsx` (landing que lista eventos, guard `requireAnyPermission(["kits.view","kits.deliver"])`), `app/{organizador,admin}/eventos/[id]/entrega-kits/page.tsx` (client component, tela de entrega). APIs: `app/api/events/[id]/kit-deliveries/{route,search,report,report-export}.ts` (usam `checkApiPermission("kits.view")` / `("kits.deliver")`).

---

## Requisito 1 — "Acesso negado" pro assistente de entrega de kit (BUG)

Um assistente criado por um organizador, com permissão `kits.deliver` (e/ou `kits.view`), ao entrar no sistema vê a página `/acesso-negado` ("Você não tem permissão para acessar esta página").

**Reproduza e ache a causa exata:** trace o fluxo de login → redirect (`components/auth/LoginForm.tsx` manda pra `/dashboard`) → `/dashboard` (layout + page) → o link "Organizador" que o `DashboardNav` mostra pro assistente → `/organizador` (layout `requireOrganizer()` → `app/organizador/page.tsx`) → e o link "Entrega de kits" do `OrganizerNav` → `/organizador/entrega-kits`.

Candidatos prováveis (confirme qual é):
- `app/organizador/page.tsx`: pra um assistente, `db.organizerProfile.findUnique({ where: { userId: session.user.id } })` é `null` → mostra "Configure seu perfil de organizador" (confuso, não é "acesso negado", mas também está errado). O assistente deveria cair direto numa tela útil (ex.: redirect pra `/organizador/entrega-kits` se ele só tem permissão de kit).
- Algum `requirePermission`/`requireRole` numa página que o assistente acessa (ex.: `/organizador/eventos/[id]` completo — `requireOrganizer()` passa, mas veja se há guard mais abaixo).
- `requireAnyPermission` / `requireOrganizer` retornando `acesso-negado` pra um assistente cujo criador (organizador) tem `organizerProfile` — não deveria; confirme.

**Correção esperada:**
- O assistente de organizador NUNCA deve ver `/acesso-negado` só por acessar o sistema. Depois do login ele deve ter um caminho claro até o que pode fazer.
- Ajuste `app/organizador/page.tsx` (e/ou o redirect pós-login / o `DashboardNav`) para que um ASSISTANT que só tem permissão de kit seja levado a `/organizador/entrega-kits` (ou uma tela de "suas ações disponíveis") em vez de "Configure seu perfil de organizador" ou `/acesso-negado`.
- Garanta que `/organizador/entrega-kits` → clicar num evento → `/organizador/eventos/[id]/entrega-kits` funciona ponta a ponta pra um assistente com só `kits.deliver` (as APIs de kit precisam aceitar esse assistente — ver Requisito 3).
- Se o assistente tiver `kits.view` mas não `kits.deliver` (ou vice-versa), ambos os casos devem funcionar na tela de entrega (a busca usa `kits.view`, o confirmar usa `kits.deliver` — um assistente "só entrega" precisa das duas; ajuste o catálogo/UI pra deixar isso claro OU faça a tela de entrega aceitar `kits.deliver` também na busca).

## Requisito 2 — Promover usuário já cadastrado a assistente

Quando o organizador cadastra um assistente informando um e-mail que **já tem conta na plataforma** (papel ATHLETE), a conta deve ser **promovida a ASSISTANT** com exatamente as permissões (e o escopo de evento — Requisito 3) informadas, sem criar conta nova e sem exigir novo convite (a pessoa já tem senha).

`createOrPromoteAssistant` já trata `existing.role === "ATHLETE"` → promove. **Verifique** que:
- A rota do organizador (`app/api/organizer/assistants/route.ts`) chama isso corretamente e não bloqueia antes.
- A UI (`AssistantManager`) mostra uma mensagem clara ("Usuário existente promovido a assistente" vs "Assistente criado — convite enviado").
- Se houver algum bug real impedindo a promoção de um ATHLETE existente pelo organizador, corrija.
- Um e-mail que já é ASSISTANT de OUTRO organizador continua sendo recusado (não roubar).

## Requisito 3 — Obrigar a informar o evento (com opção "Todos os eventos") + escopo por evento

Hoje as permissões de assistente valem para TODOS os eventos do organizador. O organizador precisa poder **restringir um assistente a um evento específico**.

### Schema
`AssistantPermission` ganha `eventId String?` (nullable):
- `eventId = null` → permissão vale para **todos os eventos** do organizador (comportamento atual).
- `eventId = <id>` → permissão vale **só para aquele evento**.

Relação opcional `event Event? @relation(fields: [eventId], references: [id], onDelete: Cascade)`. Trocar `@@unique([userId, actionKey])` por `@@unique([userId, actionKey, eventId])`.

**Migração:** `prisma/migrations/<timestamp>_add_assistant_permission_event/migration.sql` — `ALTER TABLE "assistant_permissions" ADD COLUMN "eventId" TEXT;` + dropar o índice único antigo e criar o novo (`DROP INDEX ...; CREATE UNIQUE INDEX ... ON ... ("userId","actionKey","eventId");`). Confira o nome real do índice atual com o padrão Prisma (`assistant_permissions_userId_actionKey_key`). Backfill: nada — todas as linhas existentes ficam com `eventId = NULL` = "todos os eventos", zero mudança de comportamento pros assistentes atuais. `git add -f` a migração (`prisma/migrations/` é gitignored neste projeto — confira em `.gitignore`).

### Backend — `createOrPromoteAssistant` + rota
`CreateOrPromoteAssistantParams` ganha `eventId: string | null` (`null` = todos os eventos). As linhas de `assistantPermission` criadas passam a levar `eventId`. A rota `POST /api/organizer/assistants` valida:
- `eventId` **obrigatório** no body: ou um id de evento que o organizador (via `resolveActingScope().organizerId`) possui, ou o sentinela `"ALL"` → mapeia pra `null`.
- Rejeitar (400) se `eventId` ausente, ou se for um id de evento que não pertence ao organizador.
- A rota do admin (`app/api/admin/assistants/route.ts`) pode continuar sem escopo por evento (admin é global) — mas aceite `eventId` opcional; se vier, valide que o evento existe.

### RBAC — `checkApiPermission` / `requirePermission` ficam event-aware
- `checkApiPermission(actionKey, opts?: { eventId?: string })`: para ASSISTANT, autoriza se existir uma `AssistantPermission` com `actionKey` E (`eventId IS NULL` **OU** `eventId = opts.eventId`). Se `opts.eventId` não for passado, só linhas com `eventId IS NULL` contam (permissão global).
- `requirePermission(actionKey, opts?)` e `requireAnyPermission(actionKeys, opts?)`: mesma lógica.
- **ADMIN/ORGANIZER titulares continuam passando sempre** (sem mudança).
- Assinaturas retrocompatíveis: `opts` opcional; chamadas atuais sem `opts` seguem funcionando (só linhas globais autorizam — o que é o comportamento seguro: um assistente restrito a 1 evento NÃO ganha acesso global por engano).

### Ligar o `eventId` nas rotas de kit (mínimo obrigatório) e nas rotas `/api/events/[id]/*`
- **Obrigatório:** `app/api/events/[id]/kit-deliveries/{route,search,report,report-export}.ts` — passar `checkApiPermission("kits.view" | "kits.deliver", { eventId: id })` (o `id` já vem no path).
- **Fortemente recomendado (mecânico):** qualquer rota `app/api/events/[id]/**/route.ts` que faz `checkApiPermission(...)` — passar `{ eventId: id }`. É extração do param que a rota já tem.
- Rotas `/api/organizer/registrations/[id]/*` (o `[id]` é o registrationId, não o eventId): buscar o `registration.eventId` (a rota já busca a inscrição pra validar escopo) e passar `{ eventId }`.
- Rotas sem um evento óbvio no escopo: deixar `checkApiPermission(actionKey)` sem `opts` — um assistente restrito a evento simplesmente não terá permissão global e será negado (fail-safe, correto).
- Páginas: `app/{organizador,admin}/entrega-kits/page.tsx` continuam com `requireAnyPermission(["kits.view","kits.deliver"])` (sem eventId — só lista os eventos que ele tem acesso). Adicione: a landing deve listar SÓ os eventos aos quais o assistente tem permissão de kit (`eventId = null` → todos; senão só os `eventId` das linhas dele). `app/{organizador,admin}/eventos/[id]/entrega-kits/page.tsx` — adicionar guard server-side `requireAnyPermission(["kits.view","kits.deliver"], { eventId: id })` no topo (hoje não tem guard nenhum — é só client component; transforme num server component que renderiza o client, OU adicione um pequeno server wrapper).

### UI — form de criar assistente (`AssistantManager` + página do organizador)
- No `AssistantManager`, quando `apiBase === "/api/organizer"`, adicionar um `<select>` **obrigatório** "Evento" com:
  - opção "Todos os eventos" (value `"ALL"`)
  - uma opção por evento do organizador (buscar a lista — nova prop `events: {id,title}[]` passada pela página server component `app/organizador/assistentes/page.tsx`, que já é server e pode consultar `db.event.findMany({ where: { organizerId } })`).
- O POST passa `eventId` (o value selecionado; `"ALL"` ou o id).
- A listagem de assistentes (`GET`) passa a mostrar o escopo: "todos os eventos" ou o nome do evento (agrupar as permissões por eventId).
- O admin (`apiBase === "/api/admin"`) NÃO mostra o select (admin é global) — condicione a UI ao `apiBase`.

---

## Testes (Vitest)
- `lib/auth/rbac.ts`: `checkApiPermission` com `{ eventId }` — assistente com linha `eventId: null` autoriza qualquer evento; assistente com linha `eventId: "e1"` autoriza `{ eventId: "e1" }` e nega `{ eventId: "e2" }` e nega sem `opts`; ADMIN/ORGANIZER sempre passam.
- `createOrPromoteAssistant`: cria linhas com o `eventId` informado; promove ATHLETE existente com escopo; `eventId: null` = todos.
- `app/api/organizer/assistants/route.ts`: 400 sem `eventId`; 400 com evento de outro organizador; 201 com `"ALL"` (grava null); 201 com evento próprio.
- Rota de kit (`kit-deliveries/search` ou `route`): assistente restrito ao evento X passa em X, é negado em Y.
- Estender os testes existentes de assistente que quebrarem (assinatura de `checkApiPermission`, shape do `createOrPromoteAssistant`).
- Página de entrega-kits landing: lista só os eventos permitidos (se der pra testar via a função de query; senão, teste a função de resolução de eventos permitidos).

## Verificação final (rodar e reportar a saída de cada um)
- `npx vitest run` — tudo verde. NÃO desabilite teste; corrija mocks.
- `npx tsc --noEmit` — limpo.
- `npm run build` — limpo.
- `npx prisma validate` + confirmar que a migração SQL é coerente com o `schema.prisma`.

## Commits
Commits pequenos e lógicos (schema+migração / rbac / create-or-promote+rota / rotas de kit / UI / testes). Mensagens em pt-BR. Rodapé:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YXhC99BmzynKpyGZ3e5feD
```
**NÃO faça deploy** — o controlador faz o deploy e a verificação em produção.

## Você NÃO dispara subagentes
Faça tudo você mesmo. Nunca crie subagente nem reviewer.

## Report
Escreva o report completo em `C:/Users/dougl/workspace2/corridas-assistfix/FIX_REPORT.md`:
- Causa raiz do "acesso negado" (Requisito 1) — o guard/arquivo:linha exato.
- O que mudou em cada requisito, arquivos, migração.
- Resultado de `vitest` / `tsc` / `build` (contagens + saída).
- Rotas que passaram a receber `{ eventId }` e as que ficaram sem (e por quê).
- Riscos residuais.

Depois responda com < 15 linhas: Status, commits (SHA+subject), contagem de testes/tsc/build, causa raiz do Req 1 em 1 linha, concerns, caminho do report.
