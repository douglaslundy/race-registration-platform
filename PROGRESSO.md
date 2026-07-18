# Progresso do Projeto

## Última atualização
2026-07-18

## Corrigido fora dos 4 sub-projetos (achado pelo usuário)
Bug real confirmado e corrigido: lotes de inscrição em modo de ativação "Manual" (padrão do
schema e do formulário) ignoravam completamente o campo `startAt` — só o toggle `active`
controlava se o lote aceitava inscrições. Organizador configurava "início dia 5" mas, deixando o
modo em Manual (padrão), inscrições abriam imediatamente. `lib/batch-status.ts`: `startAt` agora
é limite absoluto em qualquer modo de ativação. TDD (13 testes novos, `tests/unit/batch-status.test.ts`,
zero cobertura existia antes). Suíte 907/907, `tsc` limpo. Commit `11accd7`, não deployado ainda
(decisão do usuário: bater tudo num deploy único no final da sessão).

## Tarefa em andamento
4 sub-projetos pedidos pelo usuário nesta sessão, ordem confirmada: **filtros de eventos**
(✅ implementado, revisado E DEPLOYADO) → **caixa de entrada de mensagens** (✅ implementado e
revisado, deploy pendente) → **anúncios — posições e Google AdSense** (✅ implementado e revisado,
deploy pendente) → anúncios — marketplace de anunciantes privados (depende do anterior, próximo).

**2º sub-projeto (caixa de entrada de mensagens WhatsApp/E-mail) implementado via
subagent-driven-development, direto na main** — spec
`docs/superpowers/specs/2026-07-17-caixa-entrada-alertas-design.md` (commit `3bf8cb8`), plano
`docs/superpowers/plans/2026-07-17-caixa-entrada-alertas.md` (commit `bf93a7a`). 15 tasks, todas
implementadas e revisadas individualmente (spec ✅ + qualidade ✅), sem nenhum achado
Critical/Important nas revisões de task — resumo por área:
- Schema: novo modelo `MessageLog` (14 campos) + migração manual (banco de dev inacessível,
  validado só por `prisma validate`/`generate`).
- `lib/message-logs.ts`: módulo central (`recordMessageLog` best-effort, nunca lança;
  `updateMessageLogStatusByProviderMessageId` nunca regride; `listMessageLogs`;
  `resolveMessageOwnerUserId`).
- Instrumentação centralizada: `sendMail()` (`lib/email.ts`) e `sendWhatsAppMessage()`
  (`lib/whatsapp.ts`) logam todo envio real (SENT/FAILED) sem precisar tocar em nenhum dos ~15
  chamadores existentes.
- WhatsApp ganhou leitura real: `evolution-client.ts` captura `providerMessageId` +
  `setWebhook`; rota de status registra o webhook automaticamente quando conectado (best-effort);
  novo receptor `POST /api/webhooks/whatsapp` (secret via query param) atualiza
  SENT→DELIVERED→READ.
- Sistema de permissões: nova `requirePermission(actionKey)` em `rbac.ts`; chave `messages.view`
  adicionada às 2 telas de gestão de assistentes (mesmo padrão dos 6 domínios anteriores).
- UI: `MessageLogList` compartilhado (2 abas E-mail/WhatsApp, ícones de status, `<details>` pro
  assunto); `/admin/mensagens` (vê tudo) e `/organizador/mensagens` (escopado por
  `recipientUserId`, com sentinel `"__none__"` pra nunca vazar dados de outro organizador se a
  resolução falhar).

Suíte final 894/894, `tsc --noEmit` limpo. Revisão final de branch inteira (opus, com foco extra
em segurança/isolamento de tenant): **pronto pra merge, com ajustes**. Zero Critical. 2 Important:
(1) corrigido a pedido do usuário — filtro "Até" tinha off-by-one (excluía o próprio dia
selecionado por causa de meia-noite UTC), commit `2259bfb`, nas 2 páginas; (2) **pendência
conhecida, sem correção especulativa** — o payload real do webhook `MESSAGES_UPDATE` da Evolution
API nunca foi validado contra uma entrega de verdade (sem WhatsApp conectado nesta sessão); o spec
falava em ACK numérico, o código mapeia strings (`DELIVERY_ACK`/`READ`) — falha de forma segura
(mensagem fica em SENT se o formato não bater), mas **a confirmação de leitura pode não funcionar
até validar com um webhook real assim que o WhatsApp for conectado em produção**. 4 Minor não
corrigidos (guard do admin genérico mas seguro por causa do layout; `<details>` do assunto mostra
texto duplicado; paginação sem limite de links; lookup de telefone exact-match) — cosméticos ou já
documentados como limitação conhecida no spec.

**Verificação manual no navegador ainda não feita** (mesmo motivo do sub-projeto 1: banco de dev
local inacessível). Fica pendente testar as duas telas, os filtros, e — assim que o WhatsApp for
conectado — a evolução real do status SENT→DELIVERED→READ.

**Decisão do usuário sobre deploy (2026-07-18): NÃO fazer deploy agora.** Quer o deploy completo
(migração `MessageLog` + env var `WHATSAPP_WEBHOOK_SECRET`) mas pediu pra **continuar o
desenvolvimento dos sub-projetos 3 e 4 até tudo estar pronto, e então fazer um único deploy
batendo tudo de uma vez** — mudança do padrão anterior (deploy após cada sub-projeto). Sub-projeto
2 fica commitado local/GitHub, não deployado, até essa decisão mudar.

**3º sub-projeto (anúncios — posições + Google AdSense) implementado via
subagent-driven-development, direto na main** — spec
`docs/superpowers/specs/2026-07-18-anuncios-google-adsense-design.md` (commit `0019b94`), plano
`docs/superpowers/plans/2026-07-18-anuncios-google-adsense.md` (commit `fbd9a01`). 17 tasks, todas
implementadas e revisadas individualmente, sem nenhum achado Critical — resumo por área:
- Schema: `AdSlot` (5 posições fixas, seed via migration.sql — **não roda automático no deploy**,
  `db push` não executa `migration.sql`, precisa INSERT manual) + `AdMetricsSnapshot`.
- 5 posições reais inseridas em `/eventos` (3) e `/eventos/[slug]` (2), via `<AdSlotRenderer>` —
  só renderiza quando a posição está ativa, com fonte Google e `googleAdUnitId` configurado.
- Script do AdSense carrega no layout público só quando há posição ativa — primeira exceção de JS
  de terceiro no sistema (justificada, documentada no spec).
- Admin `/admin/anuncios`: liga/desliga posição, define fonte, cola o ID do bloco do AdSense.
  ADMIN-only (sem delegação a assistente, mesmo critério do WhatsApp/Configurações).
- OAuth completo com o Google (`/admin/anuncios/conectar-google`): fluxo authorization-code sem
  SDK, cron diário (`/api/cron/ad-metrics-sync`) puxa métricas via AdSense Management API v2,
  painel de métricas com estado vazio explícito antes de conectar.
- **2 bugs reais encontrados e corrigidos durante a implementação** (não no código deste
  controller, no próprio texto do plano): rotas OAuth (`req.nextUrl` não existe em `Request` puro
  nos testes; fallback de URL base terminava em string vazia e quebrava `redirect`) e um vazamento
  de mock nos testes (`clearAllMocks` não limpa `mockResolvedValueOnce` não consumido). Ambos
  verificados de forma independente pelos revisores.
- **Bug de projeto encontrado no meio da implementação** (não específico desta feature):
  `tsconfig.json` tinha `target: ES2017`, que não permite sintaxe de literal BigInt — quebrava o
  `tsc` desde 2 tasks atrás sem ninguém perceber. Corrigido pra `ES2020` (commit `5d3d134`).

Suíte final 944/944, `tsc --noEmit` limpo. Revisão final de branch inteira (opus, 1 desconexão por
limite de sessão, resumida): **pronto pra merge, com ajustes**. Zero Critical. 1 Important
corrigido a pedido do usuário — `google_adsense_client_id` nunca tinha um formulário/rota pra ser
salvo (lacuna do próprio plano), então **nenhum anúncio jamais apareceria** mesmo com tudo
configurado; corrigido com um campo simples em `/admin/anuncios` reaproveitando a rota genérica de
configurações já existente (commit `f825303`). 3 Minor não corrigidos (settings órfãs em
desconexão; moeda fixa em BRL na tela de métricas; variável não usada em 2 testes) — cosméticos.

**Pendências reais, fora do nosso controle**: o fluxo OAuth/métricas nunca foi testado contra uma
conta de verdade — falta (1) criar um projeto no Google Cloud, ativar a AdSense Management API, e
gerar `GOOGLE_ADS_OAUTH_CLIENT_ID`/`SECRET`; (2) ter uma conta Google AdSense aprovada pro site.
Sem isso, a infraestrutura está pronta mas os anúncios reais e as métricas não vão funcionar —
mesmo padrão do WhatsApp nesta sessão (infraestrutura pronta, ativação real depende de aprovação
externa).

**Verificação manual no navegador ainda não feita** (mesmo motivo dos 2 sub-projetos anteriores:
banco de dev local inacessível).

Sub-projeto 3 completo e revisado, **não deployado** (mesma decisão de bater tudo num deploy único
no final, junto com o sub-projeto 4).

Próximo passo: brainstorm do sub-projeto 4 (marketplace de anunciantes privados). Deploy fica
para o final, depois do sub-projeto 4 (marketplace de anunciantes) — não esquecer de aplicar a
migração do MessageLog E a env var do webhook nesse deploy único.

**1º sub-projeto (filtros de eventos) implementado via subagent-driven-development, direto na
main** — spec `docs/superpowers/specs/2026-07-17-filtros-eventos-publicos-design.md` (commit
`a4c669f`), plano `docs/superpowers/plans/2026-07-17-filtros-eventos-publicos.md` (commit
`feabae0`). 5 tasks, todas implementadas e revisadas (spec ✅ + qualidade ✅ em cada uma, sem
achados Critical/Important):
- Task 1 (`f19b817`): `listPublicEvents` ganha filtro `status` (ativa/encerrada) + `state`,
  ordenação condicional asc/desc.
- Task 2 (`ec1192f`): `listDistinctCities` → `listDistinctLocations`, cobre status encerrados.
- Task 3 (`0b8355a`): badge "Realizado" pro status `COMPLETED` no `EventCard`.
- Task 4 (`659cf28`): `EventFilters` reescrito — selects Status/Estado, cascata Estado→Cidade.
- Task 5 (`ca0ef73`): wiring final em `app/(public)/eventos/page.tsx`.

tsc limpo, suíte 855/855. Revisão final de branch inteira (opus): **pronto pra merge**, sem
achado Crítico/Importante. 2 Minor: (1) corrigido a pedido do usuário — botão "Inscreva-se"
escondido nos cards de eventos `REGISTRATIONS_CLOSED`/`COMPLETED` (commit `b33f718`); (2) dropdown
de estado pode duplicar por variação de caixa (SP/sp) — explicitamente fora de escopo no spec,
sem ação.

**Verificação manual no navegador pulada** (decisão do usuário): o banco de dev local
(`db.usgslzpuovvrkvvrhljt.supabase.co`, referenciado em `DATABASE_URL`/`DIRECT_URL` do `.env`) não
resolve DNS — parece offline/descontinuado. **Fica pendente testar manualmente em produção**
(filtro Status/Estado, cascata, badge "Realizado", botão escondido) na próxima vez que mexer
nessa página — smoke test automatizado (curl) já confirmou as rotas no ar, mas ninguém olhou a
UI com os próprios olhos ainda.

**Deploy feito em 2026-07-17**: `git push origin main` (`a8c9168..14d84dd`) → `deploy.sh` na VPS
(git pull + docker build + `docker compose up -d --no-deps app`, sem migração — mudança só de
query/UI). Smoke test pós-deploy: `/`, `/eventos`, `/eventos?status=encerrada`,
`/eventos?estado=SP` todos 200; `docker logs corridas-app` sem erros nos primeiros 3 minutos.

Sub-projeto 1 (filtros de eventos) **completo e no ar**. Próximo passo: brainstorm do
sub-projeto 2 (caixa de entrada de alertas WhatsApp/E-mail).

Corrigido no meio do brainstorm (achado pelo usuário, não fazia parte dos 4 sub-projetos): resumo
diário do organizador (`lib/alerts/daily-summary-metrics.ts`) somava `order.totalAmount` (com taxa
de plataforma embutida) em vez de `order.subtotalAmount` — mesmo bug que já tinha sido corrigido
no dashboard do organizador (commit `2fa5e66`), só que não foi replicado aqui na época. Rótulo
"Receita bruta" também virou "Receita" nas linhas do organizador (e-mail/WhatsApp), já que não
inclui mais taxa. TDD (teste vermelho confirmado antes da correção), 25/25 testes do arquivo,
`tsc --noEmit` limpo. Não deployado ainda.

Sessão anterior (2026-07-17, já resolvida): encontrados 3 commits pós-deploy (`08e6f85`, `2fa5e66`,
`a8c9168` — reenvio de e-mail de confirmação mesmo já enviado, receita do organizador mostrando só
subtotal sem taxas da plataforma, filtro "sem cupom" + gráficos multi-linha por cupom nos
dashboards) que não tinham sido registrados aqui. Verificado direto na VPS: já estavam deployados
(commit `a8c9168` rodando em `/opt/corridas/src`, imagem `corridas-app:latest` buildada em
2026-07-17 01:17, container `Up`, site 200 em `/` e `/eventos`). Nada a fazer, só documentar.

**FASE 2 COMPLETA E DEPLOYADA EM PRODUÇÃO (2026-07-15)** — todos os 6 domínios do
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
