# Progresso do Projeto

## Última atualização
2026-07-15

## Tarefa em andamento
Nenhuma. **FASE 2 COMPLETA E DEPLOYADA EM PRODUÇÃO (2026-07-15)** — todos os 6 domínios do
rollout de usuários assistentes implementados, testados (843/843, tsc limpo), revisados e no ar.
Deploy feito na ordem segura: git push → git pull na VPS → docker build → `prisma db push` com a
imagem nova (aplicou enum `ASSISTANT`, tabela `assistant_permissions`, coluna
`users.createdByUserId` — verificado no banco antes e depois) → `docker compose up -d --no-deps
app`. Só o container `corridas-app` foi recriado; todos os outros sistemas da VPS intactos.
Smoke test pós-deploy: home 200, /eventos 200, GET de cupons sem login agora 401 (fix de
segurança confirmado no ar), 0 erros nos logs. Migração de cupons globais conferida no banco:
já estava aplicada desde 2026-06-20, nada a fazer.

Fixes de segurança preexistentes embutidos nesta sessão (todos revisados e confirmados
fechados): gap de auth no GET de cupons; IDOR no PATCH/DELETE de cupom; falta de verificação de
posse no PATCH de publicar resultados. Fora do rollout por decisão de escopo (registrado nos
specs): Usuários, Configurações da Plataforma, WhatsApp, Auditoria, Backup/Restore, Repasses.

Particularidades deste domínio: as 3 rotas de organizador (refund, manual-resolve,
reconciliation) filtram por `organizer: {userId}` (User.id), então usam resolução LOCAL de
`organizerUserId` (padrão do expire-payments), não `resolveActingScope`. As tarefas foram
executadas inline pelo controller (subagente caiu por limite de sessão na Task 1) com TDD
red-green por tarefa; a revisão final (opus) foi o único olhar independente e aprovou sem achados
Críticos/Importantes. Minor registrados no ledger: sem teste do fallback `createdByUserId` null;
bloco de resolução duplicado 4x inline (extrair helper se uma 5ª rota precisar).

Domínio 3 (Cupons) também concluído nesta sessão: commits `f8712bc..af01786` + fixup `d55d6a2`
(4 achados Minor corrigidos a pedido do usuário). Inclui 2 correções de segurança preexistentes
aprovadas pelo usuário (gap de auth no GET de cupons; IDOR no PATCH/DELETE de cupom).

Os sete incrementos (Fase 1 + Fase 2 domínios 1-6) foram **deployados juntos em produção em
2026-07-15**, incluindo a migração de banco da Fase 1 (aplicada via `db push` durante o deploy):

- Fase 1: commits `ae4c4b1..df24a04` (migração `add_assistant_users` aplicada ✅).
- Fase 2 domínio 1: commits `faddd4c..3b9198b`.
- Fase 2 domínio 2: commits `3ab3aa3..0f2792c`.
- Fase 2 domínio 3: commits `f8712bc..af01786` + `d55d6a2`.
- Fase 2 domínio 4: commits `8d2f018..9a1c10a`.
- Fase 2 domínio 5: commits `7cb62f1, 32ab426, 09f2e0f`.
- Fase 2 domínio 6: commits `e6e0837, f991965, 5ec7b2d, becb964`.

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
  `...-fase2-cupons-design.md`, `...-fase2-pagamentos-estornos-design.md` (2026-07-15).
- Planos: `docs/superpowers/plans/2026-07-14-usuarios-assistentes-fase1.md`,
  `...-fase2-lotes-categorias-percursos.md`, `...-fase2-inscricoes-pedidos.md`,
  `...-fase2-cupons.md`, `...-fase2-pagamentos-estornos.md` (2026-07-15).
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
  `f8712bc..af01786` + fixup `d55d6a2`, revisado tarefa-a-tarefa e em revisão final de branch
  inteira (pronto pra merge), não deployado ainda. Corrigiu junto 2 achados de segurança
  preexistentes (gap de auth + IDOR, ambos aprovados previamente pelo usuário).
- [x] Fase 2 domínio 4 (Pagamentos/Estornos) — 8 chaves de permissão em 7 rotas + UI, commits
  `8d2f018..9a1c10a`, executado inline com TDD e revisão final independente (pronto pra merge),
  não deployado ainda.
- [x] Fase 2 domínio 5 (Resultados) — 2 chaves + fix de posse no publicar, commits `7cb62f1,
  32ab426, 09f2e0f`, revisado (pronto pra merge), não deployado ainda.
- [x] Fase 2 domínio 6 (Carrinhos Abandonados + Relatórios) — 4 chaves em 4 rotas + UI, commits
  `e6e0837, f991965, 5ec7b2d, becb964`, revisado (pronto pra merge), não deployado ainda.
  **FASE 2 COMPLETA.**
- [x] Todos os lotes anteriores desta sessão (ver `TODO-RETOMAR-DESENVOLVIMENTO.md`): correções de
  notificação/performance/dashboard, resumo diário + destinatários extras — todos implementados,
  revisados e **já deployados em produção**.

## Próxima tarefa
Nenhuma pendente — sistema de usuários assistentes completo e em produção. Trabalho futuro
possível (só com pedido do usuário): estender o modelo de permissões aos grupos admin-only de
alto risco deixados fora do rollout (Usuários, Configurações, WhatsApp, Auditoria,
Backup/Restore, Repasses — dois deles exigem dividir rotas multi-responsabilidade antes); sistema
de rating (só com pedido explícito — ver memória); dívidas técnicas menores registradas no ledger
(validação de importId no PATCH de resultados, helper pra resolução de organizerUserId, padrão de
mock dos 2 testes de cancelamento).
