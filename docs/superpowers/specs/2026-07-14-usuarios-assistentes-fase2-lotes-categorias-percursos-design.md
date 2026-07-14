# Usuários Assistentes — Fase 2, domínio 1: Lotes/Categorias/Percursos — Design

## Contexto

A Fase 1 (`docs/superpowers/specs/2026-07-14-usuarios-assistentes-fase1-design.md`) construiu toda
a infraestrutura de usuários assistentes (schema `ASSISTANT`/`createdByUserId`/
`AssistantPermission`, helpers de RBAC `resolveActingScope`/`checkApiPermission`/
`checkAdminOnlyApiPermission`, fluxo de criação/promoção, telas de gestão) e provou o padrão de
ponta a ponta no domínio Eventos. Está implementada, revisada e aprovada, mas **ainda não
deployada** (decisão do usuário de seguir direto pra Fase 2 antes de deployar).

A Fase 2 é o rollout desse mesmo padrão já validado pros domínios restantes do escopo v1
(`docs/superpowers/specs/2026-07-14-analise-acoes-sistema.md`), um domínio por vez — decisão já
tomada de dividir em sub-projetos sequenciais em vez de um plano único gigante, já que o escopo
completo (~50 ações em 7 domínios) seria grande demais pra revisar com segurança de uma vez.

Este documento cobre o **primeiro domínio da Fase 2: Lotes, Categorias e Percursos** — escolhido
por complementar diretamente o domínio Eventos já pronto (mesmo fluxo de trabalho do organizador
ao configurar um evento).

## Achados da leitura do código real (corrigem premissas da análise inicial)

Ao ler o conteúdo completo das 6 rotas antes de escrever o plano, dois pontos corrigem a análise
original:

1. **Os 3 `GET` (listar lotes/categorias/percursos) são públicos hoje** — nenhuma checagem de
   sessão, nem de propriedade. Isso é esperado: uma página pública de evento precisa mostrar
   lotes/categorias/percursos disponíveis pra quem ainda nem tem conta. **Não existe, portanto,
   uma chave `.view` neste domínio** — não há nada a restringir na leitura, e criar uma permissão
   pra "ver" algo que já é público seria só burocracia sem efeito de segurança.
2. **A uniformidade "sem bypass de admin" não é real em todas as 6 rotas.** `POST
   app/api/events/[id]/batches/route.ts` (criar lote) já tem bypass de admin hoje:
   `event.findFirst({where: {id, ...(role !== "ADMIN" ? {organizerId: organizer?.id} : {})}})` —
   se `role === "ADMIN"`, o filtro de dono desaparece e qualquer evento serve. As outras 5 ações
   de escrita (`batches` PATCH/DELETE, `categories` POST, `routes` POST/PATCH/DELETE) usam
   `organizer: {userId: session.user.id}` diretamente, sem bypass nenhum.

**Decisão confirmada com o usuário ("manter como está") aplicada com essa precisão:** cada rota
mantém exatamente o comportamento de bypass que já tem hoje — `batches.create` continua com
bypass de admin (usa `checkApiPermission`, que já libera `ADMIN`/`ORGANIZER` titular igualmente, e
a resolução do evento usa `scope.actingAsAdmin` pra decidir se filtra por `organizerId` ou não,
mesmo padrão já usado em `app/api/events/[id]/route.ts` PATCH/DELETE na Fase 1); as outras 9 ações
continuam sem bypass (resolução do evento sempre via `scope.organizerId`, ignorando
`scope.actingAsAdmin`).

## Escopo

**Sem chave `.view`** (leitura já é pública, ver achado acima). `batches.create` é a única chave
deste domínio que aparece tanto pro assistente-de-admin quanto pro assistente-de-organizador (já
que reproduz um bypass de admin que já existe hoje); as outras 9 chaves só fazem sentido pro
assistente-de-organizador.

## Chaves de permissão

| Chave | Ação | Rota afetada | Bypass de admin? |
|---|---|---|---|
| `batches.create` | Criar lote de ingresso | `POST app/api/events/[id]/batches/route.ts` | Sim (já existe hoje) |
| `batches.edit` | Editar lote (preço, capacidade, ativação, datas, ativo/inativo) | `PATCH app/api/events/[id]/batches/[batchId]/route.ts` | Não |
| `batches.delete` | Excluir lote | `DELETE app/api/events/[id]/batches/[batchId]/route.ts` | Não |
| `categories.create` | Criar categoria | `POST app/api/events/[id]/categories/route.ts` | Não |
| `categories.edit` | Editar categoria | `PATCH app/api/events/[id]/categories/[categoryId]/route.ts` | Não |
| `categories.delete` | Excluir categoria | `DELETE app/api/events/[id]/categories/[categoryId]/route.ts` | Não |
| `routes.create` | Criar percurso | `POST app/api/events/[id]/routes/route.ts` | Não |
| `routes.edit` | Editar percurso | `PATCH app/api/events/[id]/routes/[routeId]/route.ts` | Não |
| `routes.delete` | Excluir percurso | `DELETE app/api/events/[id]/routes/[routeId]/route.ts` | Não |

9 chaves no total (não 10 — a chave `.view` da versão anterior desta spec foi removida). Como não
há chave `.view` neste domínio, a regra "escrita implica view" (Fase 1) simplesmente não se aplica
aqui — cada ação de escrita é seu próprio nó de permissão independente, sem nenhuma implicação.

## Arquitetura

Nenhuma peça de infraestrutura nova — reaproveita 100% do que a Fase 1 já construiu:

- **Sem migração de schema.** `AssistantPermission.actionKey` já é uma string livre; as 9 chaves
  novas são só valores novos gravados na mesma tabela existente.
- **Os 3 `GET` (listar) não são tocados.** Continuam públicos, exatamente como estão hoje — sem
  checagem de sessão nem de permissão. Nenhuma mudança nesses 3 handlers.
- **`POST app/api/events/[id]/batches/route.ts` (criar lote)**: troca a checagem manual
  (`["ORGANIZER","ADMIN"].includes(role)` + resolução condicional de `organizerId`) por
  `checkApiPermission("batches.create")` + `resolveActingScope(session)`, e a resolução do evento
  pai vira `scope.actingAsAdmin ? db.event.findUnique({where:{id}}) : db.event.findFirst({where:
  {id, organizerId: scope.organizerId ?? "__none__"}})` — mesmo padrão de bypass condicional já
  usado em `app/api/events/[id]/route.ts` PATCH/DELETE na Fase 1, preservando o bypass de admin
  que essa rota específica já tem hoje.
- **As outras 5 rotas de escrita** (`batches` PATCH/DELETE, `categories` POST, `routes`
  POST/PATCH/DELETE) trocam a checagem manual (`organizer: {userId: session.user.id}` ou
  equivalente) por `checkApiPermission(actionKey)` + `resolveActingScope(session)`, mas a
  resolução do evento pai usa **sempre** `scope.organizerId` (nunca `scope.actingAsAdmin`),
  preservando a ausência de bypass que essas 5 rotas já têm hoje — `db.event.findFirst({where:
  {id, organizerId: scope.organizerId ?? "__none__"}})`, sem branch condicional.
- Nenhuma rota deste domínio usa `checkAdminOnlyApiPermission` (isso é reservado a ações que
  devem ser NEGADAS a organizador titular — não é o caso aqui, já que todas as 9 ações já
  aceitavam organizador titular hoje; a diferença entre `batches.create` e as outras 5 está só em
  ACEITAR ou NÃO admin também, não em negar organizador).
- **UI**: `app/organizador/assistentes/page.tsx` ganha as 9 chaves novas na lista de
  `actionOptions`. `app/admin/assistentes/page.tsx` ganha só `batches.create` (única chave deste
  domínio que um assistente-de-admin pode receber, já que é a única com bypass de admin).
  `components/assistants/AssistantManager.tsx` não muda de código — só as listas de
  `actionOptions` passadas por cada página crescem. Como não há chave `.view` neste domínio, a
  regra "escrita implica view" da Fase 1 não entra em ação pra nenhuma das 9 chaves novas — elas
  continuam candidatas independentes no checklist, sem nenhuma implicação automática.

## Testes

Não existe hoje nenhum teste pras 6 rotas deste domínio (`tests/` não tem nenhum arquivo
cobrindo `app/api/events/[id]/batches|categories|routes/**`) — os testes desta tarefa são
escritos do zero, não uma extensão de suíte existente. Pra cada uma das 6 ações de escrita: teste
de organizador titular funcionando como antes (sem regressão), teste de assistente-de-organizador
com a permissão certa funcionando, teste de assistente sem a permissão barrado com 403. Só pra
`batches.create`: teste adicional de admin titular funcionando (bypass), e teste de
assistente-de-admin com a permissão funcionando em qualquer evento (não só os do organizador que
o criou). Os 3 `GET` não precisam de teste novo nesta tarefa (não foram tocados, continuam
públicos).

## Fora de escopo

- Adicionar bypass de admin às 5 rotas que hoje não têm (decisão explícita — só
  `batches.create` reproduz o bypass que já existe hoje, as outras 5 continuam sem).
- Alterar o comportamento público dos 3 `GET` (continuam sem checagem nenhuma).
- Qualquer outro domínio da Fase 2 (inscrições/pedidos, cupons, pagamentos/estornos, resultados,
  carrinhos abandonados, relatórios) — cada um vira seu próprio ciclo spec→plano→implementação
  depois deste.
- Deploy da Fase 1 (ainda pendente, decisão separada do usuário).
