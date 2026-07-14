# Progresso do Projeto

## Última atualização
2026-07-14

## Tarefa em andamento
Fase 2 domínio 2 (Inscrições/Pedidos) do sistema de usuários assistentes: spec aprovada, **plano
de implementação escrito e commitado**
(`docs/superpowers/plans/2026-07-14-usuarios-assistentes-fase2-inscricoes-pedidos.md`, commit
`fe58bc5`), 8 tarefas (7 rotas/pares de rota + 1 de UI). Aguardando o usuário escolher o modo de
execução (subagent-driven vs inline) para começar a implementação.

Fase 1 (infraestrutura + Eventos) E Fase 2 domínio 1 (Lotes/Categorias/Percursos) continuam
concluídas, revisadas e aprovadas — **nenhuma das duas ainda foi deployada** (usuário decidiu
seguir implementando antes de deployar).

- Fase 1: commits `ae4c4b1..df24a04`. Tem migração de banco pendente (`ASSISTANT` enum,
  `createdByUserId`, tabela `assistant_permissions`).
- Fase 2 domínio 1: commits `faddd4c..3b9198b`. Sem migração própria (reusa o schema da Fase 1).

Suíte completa (antes desta tarefa): 705/705 testes, `tsc --noEmit` limpo.

Decisão técnica tomada ao escrever o plano (Task 7, `registrations.expire-payments`): a lib
`lib/payment/expire-payments.ts` espera `organizerUserId` (um `User.id`), não `organizerId` (um
`OrganizerProfile.id`, que é o que `resolveActingScope` retorna). Em vez de alterar a interface
`AssistantScope` em `lib/auth/rbac.ts` (já revisado/fechado), a rota organizer resolve o
`organizerUserId` localmente: `session.user.id` para `ORGANIZER` titular, ou uma consulta pontual
a `createdByUserId` quando `role === "ASSISTANT"`.

## Contexto necessário
- `TODO-RETOMAR-DESENVOLVIMENTO.md` é o histórico completo e detalhado de toda a sessão (todos os
  lotes de tarefas, decisões, deploys) — este `PROGRESSO.md` é só um resumo do estado *atual*,
  não substitui aquele arquivo.
- Ledger local (git-ignored, não versionado) com o histórico task-a-task desta feature:
  `.superpowers/sdd/progress.md`.
- Spec: `docs/superpowers/specs/2026-07-14-usuarios-assistentes-fase1-design.md`.
- Plano: `docs/superpowers/plans/2026-07-14-usuarios-assistentes-fase1.md`.
- Catálogo de ações do sistema (base pra qualquer trabalho futuro de permissões):
  `docs/superpowers/specs/2026-07-14-analise-acoes-sistema.md`.
- Migração pendente de deploy: `prisma/migrations/20260714010000_add_assistant_users` — enum
  `ASSISTANT`, coluna `createdByUserId`, tabela `assistant_permissions`. Aditiva, sem
  sequenciamento especial necessário.

## Concluído
- [x] Fase 1 de usuários assistentes (schema, RBAC, gate das 9 rotas de Eventos, fluxo de
  criação/promoção, listar/revogar, telas de gestão) — commits `ae4c4b1..df24a04`, revisado e
  aprovado, não deployado ainda.
- [x] Todos os lotes anteriores desta sessão (ver `TODO-RETOMAR-DESENVOLVIMENTO.md`): correções de
  notificação/performance/dashboard, resumo diário + destinatários extras — todos implementados,
  revisados e **já deployados em produção**.

## Próxima tarefa
Executar o plano de Fase 2 domínio 2 (Inscrições/Pedidos), assim que o usuário escolher o modo de
execução. Depois: próximos domínios da Fase 2 (cupons, pagamentos/estornos, resultados, carrinhos
abandonados, relatórios/exportações CSV) — cada um seu próprio ciclo spec→plano→implementação→
revisão. Perguntar sobre deploy das Fases já concluídas continua pendente (usuário recusou duas
vezes, mas ainda vai precisar acontecer em algum momento).
