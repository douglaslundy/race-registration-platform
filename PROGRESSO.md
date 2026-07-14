# Progresso do Projeto

## Última atualização
2026-07-14

## Tarefa em andamento
Nenhuma. O plano `docs/superpowers/plans/2026-07-14-usuarios-assistentes-fase1.md` (Fase 1 de
usuários assistentes com permissões granulares) foi concluído: 6 tarefas implementadas, revisadas
e aprovadas (com uma correção Crítica de segurança encontrada e fechada durante a Tarefa 3 —
`checkApiPermission` liberava organizador titular pra ações admin-only; corrigido com
`checkAdminOnlyApiPermission`). Revisão final de toda a branch: pronto pra merge, 663/663 testes,
`tsc --noEmit` 100% limpo. Commits `ae4c4b1..df24a04`.

**Ainda não deployado na VPS.** Próximo passo: perguntar ao usuário se quer fazer o deploy agora
antes de iniciar a Fase 2 (rollout do mesmo padrão pros demais domínios: lotes/categorias/
percursos, inscrições/pedidos, cupons, pagamentos/estornos, resultados, carrinhos abandonados,
relatórios).

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
Perguntar ao usuário sobre deploy da Fase 1 de assistentes. Depois: Fase 2 (rollout do padrão de
permissões pros demais domínios) — ainda não tem spec nem plano escritos.
