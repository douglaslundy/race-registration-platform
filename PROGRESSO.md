# Progresso do Projeto

## Última atualização
2026-07-15

## Tarefa em andamento
Nenhuma. **Fase 2 domínio 3 (Cupons) concluída, revisada (7/7 tarefas + revisão final de branch
inteira) e aprovada como pronta pra merge** — executada em modo piloto automático (usuário saiu,
pediu decidir sempre pelo recomendado e não pausar por confirmação, exceto deploy). Commits
`f8712bc..af01786`. **Ainda não foi deployada.**

Duas correções de segurança preexistentes (não relacionadas a assistentes) corrigidas junto, com
aprovação prévia do usuário: (1) `GET .../coupons` não tinha autenticação nenhuma — agora exige
`coupons.view`; (2) `PATCH`/`DELETE .../coupons/[couponId]` tinham IDOR (qualquer organizador
dono de 1 evento podia editar/excluir qualquer cupom do sistema, inclusive cupom global de admin)
— agora verificam `eventId` do cupom antes de mutar. Revisor final confirmou as duas fechadas
ponta-a-ponta.

Achados Minor registrados no ledger (não bloqueantes, não implementados por estarem fora do
escopo pré-aprovado): (1) DELETE do organizador não tem a guarda "cupom já usado em pedido" que o
DELETE do admin tem — provável 500 em vez de 409 amigável, bug pré-existente só ficou visível
agora; (2) falta teste "admin sem bypass" nas rotas edit/delete do organizador (existe só em
create); (3) `event-coupon-detail-route.test.ts` sem caso explícito de 401; (4) CSV do
report-export não reusa o helper `escapeCsvValue` que o export do admin já usa.

Agora são **quatro incrementos prontos, revisados, sem nenhum deployado ainda**:

- Fase 1: commits `ae4c4b1..df24a04`. Tem migração de banco pendente (`ASSISTANT` enum,
  `createdByUserId`, tabela `assistant_permissions`).
- Fase 2 domínio 1: commits `faddd4c..3b9198b`. Sem migração própria.
- Fase 2 domínio 2: commits `3ab3aa3..0f2792c`. Sem migração própria (reusa a infra da Fase 1).
- Fase 2 domínio 3: commits `f8712bc..af01786`. Sem migração própria (reusa a infra da Fase 1).

**Deploy segue exigindo confirmação explícita do usuário**, não incluído no autopilot.

Junto com Fase 1 (infraestrutura + Eventos) e Fase 2 domínio 1 (Lotes/Categorias/Percursos), já
concluídas em sessões anteriores, agora são **três incrementos prontos, revisados, sem nenhum
deployado ainda**:

- Fase 1: commits `ae4c4b1..df24a04`. Tem migração de banco pendente (`ASSISTANT` enum,
  `createdByUserId`, tabela `assistant_permissions`).
- Fase 2 domínio 1: commits `faddd4c..3b9198b`. Sem migração própria.
- Fase 2 domínio 2: commits `3ab3aa3, 00a4021, 0cc522a, 5d858ee, 5fce192, 80d5837, bffafb1,
  0f2792c`. Sem migração própria (reusa a infra da Fase 1).

Suíte completa: 730/730 testes, `tsc --noEmit` limpo (confirmado nesta sessão, após todas as 8
tarefas).

Achado Minor registrado no ledger (não bloqueante, decisão de não corrigir agora): os testes de
`admin-cancellation-decision-route.test.ts` e `organizer-cancellation-decision-route.test.ts`
mockam o módulo `@/lib/auth/rbac` inteiro (diferente das outras 9 rotas do domínio, que mockam só
`@/lib/auth` e exercitam a lógica real de `resolveActingScope`/`checkApiPermission`) — os casos de
assistente nesses 2 arquivos não pegariam uma regressão real de chave/escopo. Se algum dia mexer
nesses 2 arquivos de teste, considerar alinhar ao padrão mais forte dos outros 9.

## Contexto necessário
- `TODO-RETOMAR-DESENVOLVIMENTO.md` é o histórico completo e detalhado de toda a sessão — este
  `PROGRESSO.md` é só um resumo do estado *atual*.
- Ledger local (git-ignored, não versionado) com o histórico task-a-task de todas as 3 fases:
  `.superpowers/sdd/progress.md`.
- Specs: `docs/superpowers/specs/2026-07-14-usuarios-assistentes-fase1-design.md`,
  `...-fase2-lotes-categorias-percursos-design.md`, `...-fase2-inscricoes-pedidos-design.md`,
  `...-fase2-cupons-design.md` (2026-07-15).
- Planos: `docs/superpowers/plans/2026-07-14-usuarios-assistentes-fase1.md`,
  `...-fase2-lotes-categorias-percursos.md`, `...-fase2-inscricoes-pedidos.md`,
  `...-fase2-cupons.md` (2026-07-15).
- Catálogo de ações do sistema (base pra qualquer trabalho futuro de permissões):
  `docs/superpowers/specs/2026-07-14-analise-acoes-sistema.md`.
- Migração pendente de deploy: `prisma/migrations/20260714010000_add_assistant_users` — enum
  `ASSISTANT`, coluna `createdByUserId`, tabela `assistant_permissions`. Aditiva, sem
  sequenciamento especial necessário. Nenhuma migração nova nas Fases 2 domínio 1/2/3.

## Concluído
- [x] Fase 1 de usuários assistentes (schema, RBAC, gate das 9 rotas de Eventos, fluxo de
  criação/promoção, listar/revogar, telas de gestão) — commits `ae4c4b1..df24a04`, revisado e
  aprovado, não deployado ainda.
- [x] Fase 2 domínio 1 (Lotes/Categorias/Percursos) — commits `faddd4c..3b9198b`, revisado e
  aprovado, não deployado ainda.
- [x] Fase 2 domínio 2 (Inscrições/Pedidos) — 11 chaves de permissão em 11 rotas + UI, commits
  `3ab3aa3..0f2792c`, revisado tarefa-a-tarefa e em revisão final de branch inteira (pronto pra
  merge), não deployado ainda.
- [x] Fase 2 domínio 3 (Cupons) — 9 chaves de permissão em 6 rotas + UI, commits
  `f8712bc..af01786`, revisado tarefa-a-tarefa e em revisão final de branch inteira (pronto pra
  merge), não deployado ainda. Corrigiu junto 2 achados de segurança preexistentes (gap de auth
  + IDOR, ambos aprovados previamente pelo usuário).
- [x] Todos os lotes anteriores desta sessão (ver `TODO-RETOMAR-DESENVOLVIMENTO.md`): correções de
  notificação/performance/dashboard, resumo diário + destinatários extras — todos implementados,
  revisados e **já deployados em produção**.

## Próxima tarefa
Apresentar ao usuário o resumo desta sessão (Fase 2 domínio 3 / Cupons concluída) e perguntar
sobre deploy conjunto das 4 fases de usuários assistentes já prontas (Fase 1 + Fase 2 domínios 1,
2 e 3) — envolve 1 migração de banco (`20260714010000_add_assistant_users`) e um `git pull` +
rebuild na VPS. Se optar por seguir implementando em vez de deployar: próximos domínios da Fase 2
(pagamentos/estornos, resultados, carrinhos abandonados, relatórios/exportações CSV) — cada um
seu próprio ciclo spec→plano→implementação→revisão. Os 4 achados Minor do domínio Cupons (ver
seção "Tarefa em andamento" acima) também podem virar tarefas próprias se o usuário quiser
corrigi-los.
