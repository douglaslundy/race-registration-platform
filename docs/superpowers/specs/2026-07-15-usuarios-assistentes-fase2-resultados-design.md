# Usuários Assistentes — Fase 2, domínio 5: Resultados — Design

## Contexto

Quinto domínio da Fase 2 (rollout sequencial do sistema de usuários assistentes). Cobre as 2
ações do catálogo (`docs/superpowers/specs/2026-07-14-analise-acoes-sistema.md`, seção 14):
importar resultados via CSV (POST) e publicar um import (PATCH), ambas em
`app/api/events/[id]/results/route.ts` — um único arquivo compartilhado por organizador (evento
próprio) e admin (qualquer evento, via bypass de dono).

Sessão em modo piloto automático (usuário pediu pra seguir em frente decidindo sempre pelo
recomendado, sem pausar por confirmação).

## Achados da leitura do código real

1. **`POST` (importar) já tem bypass de admin funcional hoje** — `session.user.role !== "ADMIN"
   ? {organizerId: organizer?.id} : {}`, mesmo padrão exato de `registrations.view` e
   `coupons.report-export`. Este arquivo usa `organizerId` (`OrganizerProfile.id`), então a
   conversão usa `resolveActingScope` normalmente (não a resolução local de `organizerUserId`
   do domínio Pagamentos).

2. **`PATCH` (publicar) NÃO verifica posse do evento hoje — gap de autorização real e
   preexistente.** Ele checa só o papel (`ORGANIZER`/`ADMIN`) e atualiza `resultImport` com
   `where: {id: importId, eventId}` — o `eventId` vem da URL, mas nada liga o evento ao usuário
   logado. Na prática, qualquer organizador pode publicar o import de resultados de qualquer
   evento de outro organizador, bastando saber `importId` e `eventId`. **Decisão (autopilot,
   pelo recomendado — mesmo tipo de gap que o usuário aprovou corrigir no domínio Cupons e cujos
   achados Minor depois pediu pra corrigir também): corrigir junto**, adicionando a mesma
   resolução de evento do `POST` (admin/assistente-de-admin publica qualquer evento; organizador/
   assistente-de-organizador só evento próprio, 404 caso contrário).

3. **`tests/event-results-route.test.ts` já existe** (12 testes, cobrindo parse de CSV, colunas
   obrigatórias, escopo do organizador no POST, e o fluxo de publicação) — será estendido com os
   casos novos de assistente e com o teste de regressão do fix do PATCH, sem tocar nos testes
   existentes. Atenção: o `beforeEach` desse arquivo usa `mockResolvedValue` (não `Once`) pros
   mocks de banco, com um cenário-default de organizador titular — os testes novos sobrescrevem
   só o que precisa.

## Chaves de permissão

| Chave | Rota | Escopo | Bypass de admin? |
|---|---|---|---|
| `results.import` | `POST app/api/events/[id]/results/route.ts` | Compartilhado | Sim (já existe hoje, padrão `registrations.view`) |
| `results.publish` | `PATCH app/api/events/[id]/results/route.ts` | Compartilhado | Sim (novo — hoje o PATCH nem verifica posse; o fix dá ao organizador o escopo que faltava e preserva acesso total pro admin) |

2 chaves, ambas compartilhadas com bypass de admin.

## Arquitetura

- **`POST` (import)**: troca a checagem manual de papel + resolução manual de `organizerProfile`
  por `checkApiPermission("results.import")` + `resolveActingScope(session)`, com
  `scope.actingAsAdmin ? db.event.findUnique({where:{id}}) : db.event.findFirst({where:{id,
  organizerId: scope.organizerId ?? "__none__"}})`. `importedBy`/`auditLog.userId` continuam
  `session.user.id` (ator real).
- **`PATCH` (publish)**: troca a checagem manual de papel por
  `checkApiPermission("results.publish")` + `resolveActingScope(session)` + a MESMA resolução de
  evento do POST (fechando o gap de posse), antes do `db.resultImport.update` — que continua com
  `where: {id: importId, eventId}` (o vínculo import↔evento já estava correto; o que faltava era
  o vínculo evento↔usuário).
- **UI**: `app/admin/assistentes/page.tsx` e `app/organizador/assistentes/page.tsx` ganham as 2
  chaves cada (compartilhadas, labels adaptados ao papel).

## Testes

Estender `tests/event-results-route.test.ts` com: assistente-de-organizador com a permissão
importa/publica no evento do criador; assistente sem a permissão barrado com 403 (import e
publish); admin titular importa/publica em qualquer evento (bypass, via `findUnique`);
**regressão do fix**: organizador titular recebe 404 ao tentar publicar import de evento que não
é dele (hoje isso passaria — é o gap). Os 12 testes existentes permanecem intactos.

## Fora de escopo

- Rotas públicas de visualização de resultados (não são ações de gestão).
- Domínios restantes (Carrinhos Abandonados, Relatórios) — ciclos próprios.
- Deploy (decisão separada do usuário).
