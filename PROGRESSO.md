# Progresso do Projeto

## PRÓXIMA TAREFA: sistema de rating de atletas — AGUARDAR usuário pedir pra começar

Usuário pediu explicitamente, em 2026-07-24, pra eu **aguardar** antes de iniciar o sistema de
rating — não começar nada sozinho, nem brainstorm, até ele retomar o assunto. Quando ele pedir:

1. Rodar `superpowers:brainstorming` primeiro (é criação de feature nova do zero — schema, UI,
   regra de pontuação — não existe nada disso no código hoje, confirmado por busca no repo
   inteiro numa sessão anterior).
2. Requisito já conhecido de antemão (não esquecer de perguntar/considerar): precisa de
   **pontuação retroativa pros atletas já cadastrados/inscritos**, não só pra inscrições novas
   dali pra frente.
3. Depois do brainstorm: spec → plano → `superpowers:subagent-driven-development` → revisão →
   perguntar sobre deploy no final, mesmo padrão usado nas últimas sessões.

**Contexto necessário pra retomar**: nenhum arquivo específico ainda — a feature não existe, o
primeiro passo real é o brainstorm com o usuário pra definir escopo (ex.: o que gera pontos,
quem vê o rating, como funciona a retroatividade).

## Fila de acesso a anunciante — CONCLUÍDA e DEPLOYADA em 2026-07-24

Plano `docs/superpowers/plans/2026-07-24-acesso-anunciante.md` (4 tasks — link público no rodapé
+ fluxo dedicado de promoção admin→anunciante) + os 2 achados Minor da revisão final, corrigidos
na sequência pedida pelo usuário:
1. Bloqueio da promoção quando `ads_marketplace_enabled` está desligado (commit `4f2e2d6`).
2. Notificação por e-mail (`sendAdvertiserPromotionEmail`) pro usuário promovido (commit
   `289b24d`).
3. Deploy: `git push origin main` (`54b0ab9..d8f9656`) → `/opt/corridas/deploy.sh` na VPS (`git
   pull` → `docker build` → `docker compose up -d --no-deps app`) → smoke test:
   `https://circuitodascorridas.com.br` `/`, `/eventos`, `/auth/cadastro-anunciante` 200;
   `/admin/usuarios`, `/anunciante` 307 (redirect de login, esperado sem sessão). `docker logs
   corridas-app` limpo. Sem mudança de schema nesta leva.

Suíte final 1181/1181, `tsc --noEmit` limpo, `npm run build` OK.

## DEPLOY (2026-07-24) — feature anúncio da casa + correções + backlog técnico

`git push origin main` (`db19664..54b0ab9`, 27 commits) → `git pull` na VPS → `docker build` →
`docker compose run --rm app sh -c "npx prisma db push --skip-generate --accept-data-loss"`
(schema novo: `AdSlot.houseAdImageUrl`/`houseAdTargetUrl`, `AdMetricsSnapshot.source` — o
`--accept-data-loss` era só o aviso esperado da nova constraint única `[adSlotId,date,source]`,
seguro porque toda linha já era única em `[adSlotId,date]` e o backfill usa o mesmo valor
constante `'PRIVATE'`) → `docker compose up -d --no-deps app`. Smoke test: `/`, `/eventos` 200;
`/admin`, `/admin/anuncios`, `/admin/anuncios/moderacao`, `/admin/eventos/1/inscritos`,
`/organizador`, `/anunciante/anuncios`, `/dashboard/inscricoes` 307 (redirect de login, esperado
sem sessão). `docker logs corridas-app` limpo.

## Backlog técnico (4 itens, 5 tasks) — completo (2026-07-23)

Usuário pediu pra resolver, nesta ordem: backlog técnico → Google Ads OAuth → sistema de rating.
Plano `docs/superpowers/plans/2026-07-23-backlog-tecnico.md`, 5 tasks via
subagent-driven-development, todas revisadas individualmente, zero Critical/Important em aberto:

1. `lib/ads/private-ads.ts::listAvailableSlotsForAdvertiser` agora filtra `source:"PRIVATE"` +
   `enabled:true` — antes oferecia até posições Google/House pro anunciante comprar.
2. `lib/private-ad-status.ts` novo, unifica o mapa de status do `PrivateAd` entre
   `/anunciante/anuncios` e `/admin/anuncios/privados/[id]` — **corrige bug real**: um anúncio
   `CANCELLED` aparecia com badge vazio + texto cru no admin, agora mostra "Cancelado" cinza.
3. As 2 páginas de "Inscritos" (`/organizador/eventos/[id]/inscritos`,
   `/admin/eventos/[id]/inscritos`) reaproveitam `lib/registration-status.ts` pros 6 status reais
   do filtro, mantendo `REFUNDED`/`REFUND_PENDING` locais (são valores sintéticos de filtro, não
   status reais do enum — não fazia sentido poluir o lib compartilhado com eles).
4. `PageViewLogger` usa `navigator.sendBeacon` (com fallback pra `fetch`) em vez de `fetch`
   bloqueante em toda navegação client-side.
5. `recharts` dos dashboards do admin/organizador agora carrega sob demanda
   (`next/dynamic(ssr:false)`, via wrappers `LineChartLazy`/`MultiLineChartLazy`) — **verificado
   com evidência real** (não só teoria): os chunks do recharts (349KB+13.9KB) têm zero referência
   no client-reference-manifest de `/admin`/`/organizador`, confirmando que saíram do bundle
   inicial dessas 2 páginas.

Suite final 1171/1171, `tsc --noEmit` limpo, `npm run build` OK. Ainda não deployado.

## Fix: link da Moderação de anúncios privados faltava no admin (2026-07-22)

Usuário reportou que não achava onde o anunciante cadastra anúncio privado nem onde o admin
"cadastra" (gerencia) o anúncio dentro da plataforma. Investigação:
1. **Anunciante**: `/anunciante/anuncios/novo` existe e funciona, mas redireciona silenciosamente
   pra `/anunciante/planos` se o anunciante não tiver nenhum `AdPurchase` PAID com vaga livre
   (`app/anunciante/anuncios/novo/page.tsx:43-45`) — comportamento correto, só precisa comprar um
   plano antes. Não é bug.
2. **Admin — bug real**: a página `/admin/anuncios/moderacao` (aprovar/rejeitar anúncios privados
   pendentes) existia no código desde o sub-projeto 4, mas nunca foi linkada em lugar nenhum — nem
   no `AdminNav.tsx`, nem nos botões da própria página `/admin/anuncios` (que só linkava
   "Conectar Google AdSense", "Métricas", "Planos"). Só era acessível digitando a URL direto.
   Corrigido: adicionado botão "Moderação" em `app/admin/anuncios/page.tsx`, mesmo padrão dos
   outros 3. `tsc --noEmit` limpo, sem teste dedicado (página sem cobertura antes, mesma convenção
   já estabelecida pra Server Components deste domínio).

## Anúncio da casa — admin publica anúncio direto numa posição (2026-07-23) — completo, ainda não deployado

Usuário perguntou se o admin conseguia cadastrar um anúncio ele mesmo (não só aprovar os do
marketplace de anunciantes) — resposta era não, então virou feature nova. Spec
`docs/superpowers/specs/2026-07-23-anuncio-da-casa-admin-design.md`, plano de implementação
`docs/superpowers/plans/2026-07-23-anuncio-da-casa-admin.md` (7 tasks, todas revisadas
individualmente, zero Critical/Important). `AdSlot.source` ganha valor `"HOUSE"`; admin sobe
imagem+URL direto em `/admin/anuncios` (novo endpoint `POST
/api/admin/ads/slots/[id]/house-ad`), ativo na hora, sem aprovação — zero mudança no marketplace
de anunciantes existente (`PrivateAd`/`AdPurchase`/`AdvertiserProfile` intocados).

**Revisão final de branch inteira (opus) achou 1 problema real**: métricas do anúncio da casa
(mesma tabela `AdMetricsSnapshot`, só por posição+dia, sem distinguir origem) podiam contaminar o
relatório em PDF de um anunciante pagante se a mesma posição fosse usada como anúncio da casa
enquanto ele ainda tinha campanha ativa. Usuário pediu correção completa (não só aceitar como
risco). Plano de correção `docs/superpowers/plans/2026-07-23-anuncio-da-casa-fixes.md` (6 tasks,
a 6ª adicionada depois — reupload de imagem também deixava arquivo órfão no storage, achado
extra):
- `AdMetricsSnapshot` ganha coluna `source` (`@default("PRIVATE")`, backfill automático) — separa
  métricas de `HOUSE`/`PRIVATE`/`GOOGLE` na mesma posição/dia.
- `buildAdReportData` (relatório do anunciante) só soma `source:"PRIVATE"` — fechou o vazamento de
  verdade.
- URL de destino do anúncio da casa restrita a http/https (antes aceitava `javascript:` etc,
  emitido sem validação pela rota de redirecionamento de clique).
- Arquivo órfão no storage limpo automaticamente (best-effort) quando a fonte muda ou quando a
  imagem é reenviada — **verificado contra o bucket real de produção que a chave anon tem
  permissão de DELETE** (testado via API do Supabase: upload 200 + delete 200 confirmados).
- Achado extra descoberto durante a implementação (não fazia parte da revisão original):
  `lib/ads/metrics-sync.ts` (cron de métricas reais do Google AdSense) também escrevia na mesma
  tabela com a chave composta antiga — teria quebrado em runtime depois da migração da coluna
  `source`; corrigido junto.

Suite final 1171/1171, `tsc --noEmit` limpo, `npm run build` OK. Revisão final da leva de correção:
"Ready to merge: Yes", zero Critical/Important. **Ambos os planos completos, nada deployado ainda
— falta perguntar ao usuário sobre push/deploy.**

## PRÓXIMA TAREFA

Perguntar ao usuário sobre push/deploy das 2 levas acima (feature + correções). Mudança de schema
nesta leva (`AdSlot.houseAdImageUrl`/`houseAdTargetUrl`, `AdMetricsSnapshot.source`) — se
aprovado, vai precisar de `prisma db push --skip-generate` na VPS, mesmo padrão já usado nos
deploys anteriores. Acesso à VPS via chave SSH `~/.ssh/id_ed25519` (sem senha).

Fora isso, nenhuma tarefa pendente conhecida. Sistema de rating de atletas continua adiado (ver
memória `rating_system_pending`) — só retomar se o usuário pedir explicitamente.

## Última atualização
2026-07-22 (sessão: cupom vencido + backlog técnico + tag do AdSense (2ª correção, confirmada) +
anúncio privado destravado + início da inscrição por procuração) — commit `3ac06f2` deployado

## Correção #2 da tag do AdSense — o fix anterior não funcionava de verdade (2026-07-22) — DEPLOYADO e CONFIRMADO

Usuário confirmou que já tinha colado `ca-pub-6911820306119064` no campo (o fix de configuração
estava certo), mas o Google continuava não verificando o site. Investigação: o primeiro fix
(`strategy="beforeInteractive"` via `next/script`, commit `212857e`) **não resolvia de verdade** —
confirmado direto no HTML servido em produção via `curl`: o `next/script` só emite um
`<link rel="preload">` no `<head>` e monta a `<script>` de verdade via hidratação no navegador
(payload RSC do React 19/Next 16), nunca aparecendo como tag `<script>` literal no HTML inicial.
Corrigido de vez: tag `<script>` nativa escrita à mão dentro de um `<head>` explícito no layout
raiz, sem passar pelo componente `Script` do Next em nenhum momento. **Confirmado via `curl` direto
no HTML de produção depois do deploy**: a tag aparece literalmente dentro de `<head>...</head>`,
exatamente como o Google exige. Suite 1132/1132, tsc limpo, build OK.

**Lição registrada**: `next/script` com `strategy="beforeInteractive"` não é confiável pra casos
onde um crawler externo precisa achar uma tag `<script>` literal no HTML puro (verificação de
site, meta tags de terceiros) — nesses casos, usar uma tag `<script>` nativa direto no JSX do
layout raiz, nunca o componente `Script`.

## Inscrição por procuração (2026-07-22/23) — COMPLETO, ainda não deployado

Ver spec `docs/superpowers/specs/2026-07-22-inscricao-por-procuracao-design.md` e plano
`docs/superpowers/plans/2026-07-22-inscricao-por-procuracao.md`. Feature completa: schema
(`Event.allowProxyRegistration`, `Registration.proxyAthleteDisplayName`), e-mail sintético
(`lib/proxy-athlete.ts`), resolução/criação do atleta por procuração dentro de `createCheckout`
(reaproveita conta existente por CPF ou cria nova), convite de acesso por e-mail, rota de checkout
aceitando `proxyAthlete`, notificação dupla (comprador + atleta), toggle na edição de evento (+
fix de acesso do admin em `/organizador/eventos/[id]/editar`), "Minhas Inscrições" mostrando
procurações criadas, modal + seletor no frontend do checkout.

**Achado de segurança na revisão final de branch inteira, corrigido**: quando o comprador informa
um CPF que já pertence a conta existente, o sistema reaproveitava a conta mas ecoava o nome REAL
armazenado nela de volta pro comprador (WhatsApp + "Minhas Inscrições") — virava oráculo pra
descobrir nome real associado a um CPF. Corrigido (Task 10): novo campo
`Registration.proxyAthleteDisplayName` sempre guarda o nome que o COMPRADOR digitou, nunca o nome
da conta reaproveitada; as 2 superfícies voltadas pro comprador usam esse campo agora. Um 2º
achado (convite de acesso disparado antes do pagamento confirmar) foi aceito como está, decisão do
usuário — risco baixo, comportamento deliberado.

Suite final 1144/1144, `tsc --noEmit` limpo, `npm run build` OK. HEAD `eee748e`, ainda não
commitado no VPS/deployado — aguardando autorização do usuário.

## Deploy do lote acumulado (2026-07-22) — DEPLOYADO

`git push origin main` (`325af4e..212857e`) → `git pull` na VPS → `docker build` → `docker
compose up -d --no-deps app`. Sem mudança de schema Prisma neste lote inteiro (confirmado via
`git diff --stat` em `prisma/schema.prisma` antes do push). Smoke test via
`https://circuitodascorridas.com.br`: `/`, `/eventos` 200; `/admin/anuncios`,
`/anunciante/anuncios` 307 (redirect de login, esperado sem sessão). `docker logs corridas-app`
limpo. Inclui: bug urgente do cupom vencido (abaixo), backlog técnico da sessão anterior (helper
de logout + helper de auth do anunciante), e os 2 fixes urgentes desta seção seguinte (AdSense +
anúncio privado).

## 2 fixes urgentes: tag do Google AdSense + fonte "Privada" travada no admin (2026-07-22) — DEPLOYADO

Usuário reportou 2 problemas depois de tentar configurar o Google AdSense de verdade:

1. **Google mandou a tag de verificação e ela não era detectada.** Causa raiz: o campo pra colar
   o `ca-pub-XXXXXXXXXXXXXXXX` já existia em `/admin/anuncios`
   (`components/admin/GoogleAdSenseClientIdForm.tsx`), mas o script (`app/(public)/layout.tsx`)
   carregava com `strategy="afterInteractive"` (só depois do JS rodar no navegador) e só quando
   já havia uma posição Google ativa (`hasActiveGoogleAdSlot()`) — o crawler de verificação do
   Google lê o HTML puro, sem executar JavaScript, então nunca via a tag. Corrigido: script movido
   pro layout raiz (`app/layout.tsx`), `strategy="beforeInteractive"` (garante presença no HTML
   inicial), carregando em toda página do site (não só as públicas — exigência literal do
   Google: "insira este código em cada página do seu site"), sem depender de nenhuma posição já
   estar ativa. **Confirmado em produção que o campo `google_adsense_client_id` ainda está vazio**
   — usuário precisa colar `ca-pub-6911820306119064` em Admin → Anúncios pra tag aparecer (a
   correção está no ar, só falta essa configuração).
2. **Não conseguia cadastrar anúncio privado.** Causa raiz: a opção "Privada" no dropdown de fonte
   de cada posição (`components/admin/AdSlotEditForm.tsx`) estava com `disabled` e rótulo
   "(em breve)" — resíduo de antes do marketplace de anunciantes (sub-projeto 4) ser construído,
   nunca reativado depois que a feature ficou pronta e foi deployada. O backend
   (`PATCH /api/admin/ads/slots/[id]`) já aceitava `source: "PRIVATE"` normalmente o tempo todo —
   só a opção do formulário estava travada. Corrigido: opção habilitada.
   **Achado relacionado, não corrigido agora (fora do escopo pedido, registrado pra depois)**:
   `lib/ads/private-ads.ts::listAvailableSlotsForAdvertiser` não filtra por `source`/`enabled` —
   depois que o admin configurar uma posição como "Privada", vale conferir se não sobra alguma
   posição Google aparecendo por engano como disponível pro anunciante.

Suíte 1121/1121, `tsc --noEmit` limpo, build OK. Sem teste automatizado nestes 2 arquivos
(layout raiz e componente admin, sem cobertura de teste — convenção já estabelecida do projeto).

## Bug urgente: cupom vencido falhava silenciosamente (2026-07-22) — corrigido, DEPLOYADO

Usuário reportou em produção: cupom não aplicava e nenhuma mensagem de erro aparecia. Ele mesmo
diagnosticou a causa (cupom vencido) antes de eu terminar a investigação — confirmei contra o
banco de produção: cupom real `BEMVINDO10` com `active=true` mas `expiresAt` no passado.

**Causa raiz**: tanto `app/api/events/[id]/coupons/preview/route.ts` (usada pelo campo de cupom
no checkout, debounce de 350ms) quanto `lib/checkout.ts::createCheckout` (validação real no
momento de criar o pedido) filtravam `active: true` + validade **dentro do WHERE da query** — um
cupom vencido simplesmente "não existia" pro código, caindo no mesmo caminho de "Cupom inválido"
genérico que um código digitado errado. No preview isso nem chegava a aparecer como erro visível
(sintoma relatado pelo usuário).

**Correção (TDD)**: as duas rotas agora buscam o cupom só pelo código (evento específico → cupom
global, mesma prioridade de antes) e checam cada condição separadamente, com mensagem específica:
inexistente/inativo → "Cupom inválido" (comportamento inalterado); vencido → **"Cupom vencido"**
(novo, 410 no preview); esgotado → "Cupom esgotado" (comportamento inalterado). Testes novos em
`tests/unit/checkout-coupon.test.ts` (2 novos: vencido + inativo) e novo arquivo
`tests/event-coupons-preview-route.test.ts` (8 testes, rota nunca tinha teste dedicado antes).
Suíte final 1121/1121, `tsc --noEmit` limpo. Commit `504e790`.

**Deploy adiado**: usuário pediu inicialmente deploy só desta correção, depois mudou pra "corrija
e retome o desenvolvimento atual, deixe o deploy para o final" — vai bater junto com o resto do
trabalho desta sessão (backlog técnico já revisado, ver seção abaixo, mais o que vier depois).

## Backlog técnico: helper de logout + helper de auth do anunciante (2026-07-22) — DEPLOYADO

2 dos 3 itens do backlog Minor levantado na revisão final da sessão anterior (o 3º, reaprovação
de anúncio, ficou fora por decisão do usuário). Spec
`docs/superpowers/specs/2026-07-21-backlog-tecnico-nudge-advertiser-design.md`, plano
`docs/superpowers/plans/2026-07-21-backlog-tecnico-nudge-advertiser.md`, via
subagent-driven-development. 2 tasks, ambas revisadas individualmente e em revisão final de
branch inteira, commits `aa156d2..7a4aa27`:

1. **`signOutAndClearNudge()`** (`components/dashboard/ProfileCompletionNudge.tsx`): consolida a
   limpeza da flag do modal de completar cadastro (antes duplicada, corrigida em 3 dos 6 pontos
   de logout na sessão anterior) — agora os 6 pontos (`DashboardNav`, `Header` ×2,
   `AdminNav`/`OrganizerNav`/`AdvertiserNav`) chamam só essa função.
2. **`checkAdvertiserApiPermission()`** (`lib/auth/rbac.ts`): mesmo formato `PermissionCheck` já
   usado no resto do projeto, extraído do boilerplate de auth duplicado entre as 2 rotas de
   anunciante (cancelar anúncio + editar perfil). Preserva 100% do comportamento — nunca decide
   404 sozinho por perfil ausente (a rota de cancelar continua 404, a de perfil continua tratando
   ausência como estado válido).

Suíte final (antes do fix de cupom acima) 1111/1111, `tsc --noEmit` limpo. Revisão final de
branch inteira (opus): **pronto pra merge**, zero Critical/Important, confirmou zero overlap de
arquivo entre as 2 tasks. 1 Minor sem ação (PUT de perfil ganhou 1 query a mais, descartada,
efeito colateral inofensivo da consolidação).

## Deploy dos 4 ajustes pequenos + fix WhatsApp/mensagens (2026-07-21) — DEPLOYADO

`git push origin main` (`148b9cb..a80863d`, 14 commits) → `git pull` na VPS → `docker build` →
`CHECK` constraint aplicado manualmente via `psql` (`payment_order_xor_adpurchase_check`,
confirmado via `pg_get_constraintdef`) **antes** do restart do container → `docker compose up -d
--no-deps app`. Sem mudança de schema Prisma nesta leva (só a constraint SQL pura). Smoke test
via `https://circuitodascorridas.com.br`: `/`, `/eventos`, `/auth/cadastro` 200; `/admin/mensagens`,
`/organizador/mensagens`, `/anunciante/anuncios`, `/anunciante/perfil` 307 (redirect de login,
esperado sem sessão — as 2 últimas eram link morto antes desta leva, agora resolvem de verdade).
`docker logs corridas-app` limpo, sem erros.

## 4 ajustes pequenos via subagent-driven-development (2026-07-21) — implementado e deployado

Continuação da sessão: depois dos 2 bugs de WhatsApp/mensagens (seção abaixo), usuário pediu pra
seguir com 2 itens do backlog levantado ("o que falta desenvolver"): sistema de rating (adiado,
brainstorm dedicado no futuro) + modal opcional de completar cadastro, e o backlog "cosmético"
(2 dos 4 itens não eram cosméticos — eram páginas do anunciante com link morto no menu). Spec
`docs/superpowers/specs/2026-07-21-ajustes-pequenos-perfil-anunciante-design.md`, plano
`docs/superpowers/plans/2026-07-21-ajustes-pequenos-perfil-anunciante.md`. 6 tasks + 1 fix
pós-revisão-final, todas implementadas e revisadas individualmente (spec ✅ + qualidade ✅ em
cada uma), commits `ab99f7d..4a26f7a` direto na main:

1. **Modal opcional "complete seu cadastro"** (Tasks 1-2): sugere ao atleta preencher
   `gender`/`preferredShirtSize`/`city`+`state` (hoje só editáveis em `/dashboard/perfil`, nunca
   pedidos em nenhum outro lugar). Aparece uma vez por sessão de login (`sessionStorage`, limpo
   em TODOS os pontos de logout alcançáveis por atleta — achado real na 1ª revisão: só limpava
   no logout de dentro do `/dashboard`, não no header público usado fora dele). Nunca bloqueia
   navegação (diferente do gate obrigatório de `/completar-cadastro`).
2. **`/anunciante/anuncios` (Meus Anúncios)** (Tasks 3-4): o link "Meus Anúncios" no menu do
   anunciante apontava pra uma rota sem página — só existia o formulário de cadastro
   (`/anunciante/anuncios/novo`), nunca a listagem. Agora lista os anúncios do anunciante logado
   com status/motivo de rejeição, e permite cancelar um anúncio ativo (`POST
   /api/anunciante/ads/[id]/cancel`, novo status `CANCELLED`, libera a vaga automaticamente).
3. **`/anunciante/perfil` (Meus Dados)** (Task 5): mesma situação — link morto no menu. Clonado
   do padrão de `/organizador/perfil`, editando `AdvertiserProfile` (razão social, e-mail e
   telefone de contato, os 3 campos obrigatórios desde o cadastro do anunciante).
4. **`CHECK` constraint em `Payment`** (Task 6): ver seção abaixo, já registrada.

**2 achados reais corrigidos durante a implementação/revisão** (nenhum fazia parte de nenhuma
task antes de ser descoberto):
- Revisão da Task 2: flag de "modal já visto" só era limpa no botão de sair de dentro do
  `/dashboard` — o header público (usado quando o atleta navega fora do dashboard, ex.:
  `/eventos`) tinha 2 outros botões de sair que não limpavam a flag. Corrigido nos 2.
- **Revisão final de branch inteira (achado cross-task, nenhum revisor de task individual podia
  ver)**: as 2 rotas novas de anunciante (cancelar anúncio e editar perfil) divergiam em
  autenticação — a de cancelar checava `role===ADVERTISER`, a de perfil só checava sessão. A
  Task 5 tinha racionalizado isso como "protegido pelo layout da página", o que está errado:
  rotas de API não são descendentes do layout de página React. Corrigido: mesmo guard 401→403
  aplicado às 2 rotas de perfil.

Suíte final: **1107/1107 testes**, `tsc --noEmit` limpo. Revisão final de branch inteira (opus):
**pronto pra merge**. Backlog Minor sem ação (não bloqueiam nada): flag do modal ainda não é
limpa nos logouts de Admin/Organizer/AdvertiserNav (inofensivo hoje — o modal só renderiza pra
ATHLETE, que nunca alcança essas navs); boilerplate de auth duplicado entre as 2 rotas de
anunciante (candidato a helper `requireAdvertiser()` compartilhado); 2 pares de mapas de
status/estilo duplicados entre páginas do mesmo domínio.

**Verificação manual no navegador não feita** (mesmo motivo de sempre nesta sessão: banco de dev
local inacessível).

**Ainda pendente, fora de escopo desta leva**: sistema de rating de atletas (schema/UI/pontuação
retroativa) — brainstorm dedicado combinado pra depois do deploy, ver memória
`rating_system_pending`.

## Bugs WhatsApp/mensagens reportados pelo usuário (2026-07-21) — investigado, corrigido, testes OK

## CHECK constraint pendente de aplicação manual (Task 6, 2026-07-21)

O arquivo `prisma/migrations/20260721010000_payment_order_xor_adpurchase_check/migration.sql` garante no banco de dados que `Payment.orderId` e `adPurchaseId` são mutuamente exclusivos — cada pagamento deve estar vinculado a exatamente um dos dois (inscricao ou compra de plano de anúncio), nunca os dois, nunca nenhum. Até agora essa invariante era garantida só "por construção" no código (`lib/checkout.ts` e `lib/checkout-ads.ts`), sem garantia no banco. Como o deploy deste projeto usa `prisma db push --skip-generate` (que não executa arquivos `migration.sql`), este `ALTER TABLE` precisa ser aplicado manualmente via `psql` no próximo deploy — mesmo padrão já usado para os seeds de `AdPlan`/`AdSlot` do sub-projeto de marketplace. O comando para executar a migração é: `docker exec -e DBURL="$URL" -i corridas-db sh -c 'psql "$DBURL" -f -' < prisma/migrations/20260721010000_payment_order_xor_adpurchase_check/migration.sql`. Confirmado em 2026-07-21 que as 147 linhas de produção não violam essa regra (0 violações), então é seguro aplicar sem quebrar dados existentes.

## Bugs WhatsApp/mensagens reportados pelo usuário (2026-07-21) — investigado, corrigido, testes OK

**Investigação (systematic-debugging)**: acesso direto à VPS via plink (logs do container +
query no Postgres de produção) confirmou que não havia nenhuma falha de envio (`message_logs`
sem nenhuma linha `FAILED` de WhatsApp) — a causa real dos 2 problemas era outra:

1. **WhatsApp "não chegou" na inscrição da atleta `rosaria.silva.15.11@gmail.com`**: causa raiz —
   `AthleteProfile.phone` nunca é coletado em NENHUM ponto do fluxo de cadastro/inscrição (nem
   signup, nem `completar-cadastro`, nem checkout — este só pede telefone do *contato de
   emergência*, campo diferente). Confirmado no banco: `users.phone` e `athlete_profiles.phone`
   vazios pra essa atleta, apesar do e-mail de confirmação ter sido enviado normalmente
   (`notifyOrderConfirmed` só pula o WhatsApp quando `!phone`, silenciosamente, sem log de erro).
2. **Organizador não via mensagens dos atletas dos eventos dele em `/organizador/mensagens`**:
   não era bug — era o spec original (`docs/superpowers/specs/2026-07-17-caixa-entrada-alertas-design.md`,
   linha 202) que colocava isso explicitamente fora de escopo na 1ª versão. Usuário confirmou que
   quer mudar esse escopo agora.

**Decisões do usuário (perguntadas via AskUserQuestion antes de implementar)**:
- Telefone: tornar obrigatório tanto no cadastro (signup) quanto no gate pós-login
  (`completar-cadastro`) — os dois, não só um.
- Mensagens do organizador: vínculo correto por evento (`relatedEntityType`/`relatedEntityId`,
  campos que já existiam no schema mas ficavam sempre `null`), não a heurística rápida por
  destinatário. Sem backfill — mensagens já enviadas antes desta mudança não aparecerão
  retroativamente pro organizador (só as endereçadas a ele mesmo, como já era).

**Implementado (TDD, suíte completa 1089/1089, `tsc --noEmit` limpo, `npm run build` OK)**:
- `lib/message-logs.ts`: `recordMessageLog` grava `relatedEntityType`/`relatedEntityId` (antes
  existiam no schema mas nunca eram passados por lugar nenhum). `listMessageLogs` ganha filtro
  `eventIds?: string[]` — quando presente junto com `recipientUserId`, amplia pra
  `OR: [{recipientUserId}, {relatedEntityType:"Event", relatedEntityId:{in:eventIds}}]`; cuidado
  extra pra não deixar o `OR` da busca por texto (`q`) sobrescrever o `OR` do escopo quando os
  dois coexistem (usa `AND` explícito nesse caso — testado). Nova função
  `resolveOrganizerEventIds(organizerUserId)`.
- `lib/email.ts` (`sendMail`) e `lib/whatsapp.ts` (`sendWhatsAppMessage`): ganham parâmetro
  opcional `relatedEntityType`/`relatedEntityId`, repassado pro `recordMessageLog` só quando
  informado (não quebra nenhuma chamada existente dos ~15 call sites). `sendRegistrationConfirmationEmail`
  ganha `eventId?` opcional.
- `lib/notifications.ts` (`notifyOrderConfirmed`): passa `relatedEntityType:"Event"` +
  `relatedEntityId:order.event.id` tanto no e-mail quanto no WhatsApp de confirmação de
  inscrição — é o único ponto de mensagem transacional ligada a evento nesta 1ª leva (resend de
  confirmação e manual-confirm já passam por aqui, ganham de graça).
- `app/organizador/mensagens/page.tsx`: passa `eventIds` (via `resolveOrganizerEventIds`) pro
  `listMessageLogs`.
- `lib/auth/profile-completion.ts`: `MissingAthleteField` ganha `"phone"`, checado igual
  birthDate/cpf. Efeito automático: `app/dashboard/layout.tsx` e `app/(public)/inscricao/[slug]/page.tsx`
  (já usavam essa função) passam a bloquear/redirecionar pra `/completar-cadastro` qualquer
  atleta (novo ou já existente) sem telefone no perfil.
- `app/completar-cadastro/CompletarCadastroForm.tsx`: novo campo telefone quando `missing` inclui
  `"phone"` (mesmo padrão visual de birthDate/cpf, validação de mínimo de dígitos no cliente).
- `components/auth/RegisterForm.tsx` + `app/api/auth/register/route.ts`: telefone agora
  obrigatório no cadastro de ATLETA (mesmo padrão de validação de birthDate/cpf via
  `superRefine`), salvo em `AthleteProfile.phone` na criação. Organizador continua sem exigir.

**Não afeta**: atletas já cadastrados com telefone preenchido (nada muda pra eles); organizador
continua vendo normalmente as mensagens endereçadas a ele mesmo (resumo diário, alertas) mesmo
sem nenhum evento cadastrado ainda (`eventIds` vazio cai no mesmo comportamento de antes).

**Pendente**: usuário ainda não autorizou push/deploy pra essas mudanças. Perguntar antes de
fazer qualquer um dos dois (ele tem alternado entre autorizar e não autorizar a cada pedido).

**Também descoberto nesta sessão (fora de escopo, adiado a pedido do usuário)**: nem o sistema de
rating por atletas nem um modal opcional de "complete seu cadastro" (dispensável, campos não
obrigatórios, botão de fechar e seguir navegando) existem no código — confirmado por busca no
repo inteiro (schema, rotas, componentes). Usuário confirmou que quer os dois como tarefa nova,
com brainstorm dedicado, depois que estes 2 bugs forem resolvidos/deployados. Ver memória
`rating_system_pending` (não iniciar sem pedido explícito — pontuação retroativa pros atletas já
cadastrados é um requisito conhecido de antemão).

## Sessão anterior (2026-07-20, já deployada)

## Correções pontuais pós-deploy (2026-07-20) — DEPLOYADO

Pedidos avulsos do usuário depois do deploy único de 2026-07-21 anterior (arquivo ficou com datas
fora de ordem porque esses pedidos chegaram numa sessão datada 2026-07-20). Testes passando
(1076 testes) e `tsc --noEmit` limpo. Commitado em 6 commits (`f9809ca..17a7162`), push feito, e
**deploy executado na VPS** via `/opt/corridas/deploy.sh` (git pull → docker build → restart só do
`corridas-app`, sem `prisma db push` — nenhuma mudança de schema nesta leva). Smoke test depois do
restart: `/` 200, `/eventos` 200, `/admin/mensagens` 307 (redirect de login, esperado sem sessão),
`docker logs corridas-app` sem erros.

1. **Status do WhatsApp não atualizava sozinho** (`components/admin/WhatsAppConnectionPanel.tsx`):
   só consultava status uma vez ao gerar o QR; agora faz polling a cada 3s enquanto o QR estiver
   visível e o status não for "open", parando sozinho quando conecta (e limpa o QR da tela).
2. **Normalização de telefone pro WhatsApp** (`lib/whatsapp.ts`, nova função
   `normalizePhoneForWhatsApp`): aceita número com ou sem "+55"/formatação e sempre normaliza pro
   formato que a Evolution API espera (só dígitos, DDI 55 sempre presente, nunca duplicado).
   Aplicada dentro de `sendWhatsAppMessage`/`sendWhatsAppDocument`, então todos os ~9 call sites
   ganharam o fix de graça. Removido o helper `toWhatsAppDestination` duplicado/inconsistente de
   `lib/alerts/daily-summary.ts` (só prefixava "55" em 2 dos 4 pontos daquele arquivo).
3. **Filtro de datas na lista de inscritos** (`/admin/eventos/[id]/inscritos` e
   `/organizador/eventos/[id]/inscritos`): novos campos `dateFrom`/`dateTo` em
   `buildRegistrationWhere` (`lib/organizer/registrations.ts`), reaproveitando o `parseDateInput`
   já corrigido pro fuso de Brasília (mesma função usada nos relatórios).
4. **"Reenviar confirmação" também manda WhatsApp** (`lib/notifications.ts`,
   `notifyOrderConfirmed`): antes só mandava e-mail; agora também manda WhatsApp quando existe
   conexão ativa (`getConnectionState === "open"`) e a inscrição tem telefone. Os dois canais são
   independentes (falha de um não impede o outro) — isso vale pra TODA confirmação de pagamento
   (checkout, webhook, reconciliação), não só pro botão de reenvio manual. Botão renomeado de
   "Reenviar/Enviar e-mail de confirmação" pra simplesmente "Reenviar confirmação" nas 2 páginas
   de inscritos.
5. **Compressão de imagem no upload** (`app/api/upload/route.ts`): artes de evento grandes
   (>1MB) atrasavam o carregamento da página E impediam o preview do link no WhatsApp (que busca
   a URL crua direto, sem passar pelo otimizador do Next). Agora toda imagem (jpeg/png/webp, gif
   fica intocado pra preservar animação) é redimensionada (máx. 1920px no maior lado, nunca
   aumenta) e reencodada (qualidade 85) antes de subir pro Supabase Storage — mesmo formato
   original, fallback silencioso pro arquivo original se a compressão falhar. **Não afeta banners
   já enviados antes desta mudança** (só uploads novos).

6. **Coluna "Canal" na lista de mensagens** (`components/messages/MessageLogList.tsx`): a tabela
   já recebia `channel` (EMAIL/WHATSAPP) mas nunca mostrava — badge 📧/💬 adicionado.
7. **Mensagens unificadas numa lista só** (`app/admin/mensagens/page.tsx`,
   `app/organizador/mensagens/page.tsx`): usuário viu que existiam abas separadas E-mail/WhatsApp
   e pediu pra virar 1 lista cronológica só, com filtro de canal opcional. Removidas as abas,
   `listMessageLogs` (`lib/message-logs.ts`) ganhou `channel` opcional — sem filtro, mistura os
   dois canais ordenados por `createdAt desc`.

**Investigação de lentidão de navegação — concluída e correções aplicadas**: usuário relatou
cliques em link/botão que às vezes não navegam ou demoram. Explore subagent (leitura estática, 51
tool calls) achou causa principal: **nenhuma rota tem `loading.tsx`** e os dashboards/páginas
admin são forçadamente dinâmicas (`force-dynamic` ou via `auth()`) — sem Suspense boundary, um
clique fica sem nenhum feedback visual até o Server Component terminar TODAS as queries; quando o
Postgres (pool via pgbouncer/Supabase) tem qualquer contenção, o clique "parece morto" por
segundos (sintoma intermitente relatado). Aplicado:
- `components/ui/PageLoading.tsx` (spinner) + `loading.tsx` em `app/admin`, `app/organizador`,
  `app/dashboard`, `app/anunciante`.
- Paralelizadas 3 queries sequenciais desnecessárias (`Promise.all`): `app/admin/usuarios/page.tsx`
  (userSettings+total), `app/admin/eventos/page.tsx` (userSettings+organizers+total),
  `app/admin/relatorio/page.tsx` (byMethod+byMonth).
- `components/ads/AdSlotRenderer.tsx`: `<img>` cru → `next/image` (slot PRIVATE).

**Não aplicado, fica de recomendação pro usuário** (infra/mais invasivo, fora do escopo de uma
correção de código): checar `connection_limit` da `DATABASE_URL` de produção vs. plano do
Supabase (hipótese média-alta de fila de conexões no pooler); `PageViewLogger`
(`components/audit/PageViewLogger.tsx`) grava um `AuditLog` a CADA navegação client-side, disputando
o pool de conexões — considerar `sendBeacon`/debounce; `recharts` (gráficos dos 2 dashboards)
sem `next/dynamic({ssr:false})`, aumenta o bundle JS dessas páginas.

## DEPLOY ÚNICO FEITO (2026-07-21) — os 4 sub-projetos + correções de segurança/receita/último acesso estão no ar

Deploy executado na VPS (`circuitodascorridas.com.br`, 144.91.92.70), commit `14d84dd` →
`72fe095`, sem incidentes:
1. `git pull origin main` em `/opt/corridas/src` — fast-forward, 175 arquivos.
2. `WHATSAPP_WEBHOOK_SECRET` gerado e adicionado em `/opt/corridas/src/.env.prod.local`.
   `GOOGLE_ADS_OAUTH_CLIENT_ID`/`SECRET` **não adicionados** — dependem do usuário criar o
   projeto no Google Cloud primeiro (pendência já conhecida, sem isso a integração fica inerte).
3. `docker build -t corridas-app:latest .` — build limpo (confirmado antes também com `npm run
   build` local, `@react-pdf/renderer`/`sharp` corretamente empacotados no standalone).
4. `docker compose run --rm app sh -c "npx prisma db push --skip-generate"` — aplicou de uma vez
   `MessageLog`, `AdSlot`/`AdMetricsSnapshot`, todo o marketplace de anunciantes (`AdvertiserProfile`,
   `AdPlan`, `AdPurchase`, `PrivateAd`, `Payment.orderId` opcional/`adPurchaseId`) e
   `User.lastLoginAt`. Confirmado via `\dt` que todas as tabelas existem.
5. Seed manual aplicado: 5 `ad_slots` (todas `enabled=false`) + 3 `ad_plans` (Básico/Intermediário/
   Premium) — confirmado via `SELECT count(*)`.
6. `docker compose up -d --no-deps app` — só o container da app recriado, `corridas-db` intocado
   (rodando desde antes, sem recriação).
7. Smoke test: `/` 200, `/eventos` 200, `/admin/mensagens`/`/organizador/mensagens`/
   `/admin/anuncios`/`/anunciante` todos 307 (redirect de login, esperado sem sessão) — `docker
   logs corridas-app` sem nenhum erro depois dos testes.

**Pendências reais que sobraram (não bloqueiam nada, ação do usuário quando quiser):**
- Configurar o segredo do webhook do gateway de pagamento ativo em Admin → Configurações
  (Mercado Pago: "Webhook Secret"; Pagar.me: "Senha do Webhook") — sem isso os webhooks de
  pagamento são rejeitados (falha fechada, proposital) e a confirmação de pagamento só acontece
  via reconciliação automática (com atraso, não quebra nada).
- Google AdSense OAuth: criar projeto no Google Cloud + ativar AdSense Management API antes de
  configurar `GOOGLE_ADS_OAUTH_CLIENT_ID`/`SECRET`.
- WhatsApp: o `WHATSAPP_WEBHOOK_SECRET` novo só funciona depois que a instância do Evolution API
  registrar o webhook de novo (a rota de status já faz isso automaticamente/best-effort quando a
  conexão for verificada em Admin → WhatsApp).

## Limpeza: remoção de todas as referências à Vercel (2026-07-21)

Usuário reafirmou (pela 2ª vez) que este projeto roda **só** na VPS própria, nunca em Vercel.
Achados reais no repositório que causaram confusão real numa investigação de deploy:
`vercel.json` (tracked), pasta `.vercel/` com projeto de fato vinculado
(`race-registration-platform-cphz`), comentários em `.env`/`.env.example` mencionando "produção
(Vercel)", e um `.env.prod.local` **local** (não confundir com o da VPS) criado pelo Vercel CLI
contendo um token OIDC ativo. Tudo removido/corrigido, commit `72fe095`. Memória permanente salva
(`never_mention_vercel`) pra nunca mais propor/assumir Vercel neste projeto.

## Reconciliação de receita + bug de fuso horário nos filtros (2026-07-20) — DEPLOYADO

Usuário reportou: valor de receita mostrado no dashboard/tela de evento não batia com o saldo
real no Mercado Pago, e o filtro de data "10/7 a 20/7" trazia inscrição do dia 9. Análise
completa + correção, 8 commits (`e722826..5cad33b`), push feito.

**Causas raiz encontradas:**
1. `parseDateInput` (`lib/admin/audit.ts`) interpretava a data digitada como meia-noite UTC em
   vez de meia-noite em Brasília (UTC-3) — filtro "de 10/7" começava às 21h do dia 9. Função
   compartilhada por vários arquivos, mas **também havia 2 cópias duplicadas com o mesmo bug**
   em `lib/admin/users.ts` e `lib/admin/events.ts` (achado só na revisão independente) —
   deletadas, agora importam a versão corrigida.
2. Não existia definição única de "receita" no sistema — cada página calculava diferente
   (bruto vs líquido de taxa da plataforma vs líquido de taxa de serviço), e **nenhuma delas**
   descontava a comissão real do gateway (`Payment.gatewayFeeAmount`) — só a página
   `/admin/relatorio` mostrava essa comissão, mas como card solto, não subtraído de nada.

**Correção:** `lib/revenue-breakdown.ts` (`computeRevenueBreakdown`, TDD) centraliza a cascata
bruto → −taxa plataforma → −taxa serviço → =receita do evento → −comissão gateway → =margem
real da plataforma (esse último é o número que deve bater com o Mercado Pago). Componente
`RevenueBreakdownCard` (variant admin/organizer) aplicado em `/admin/relatorio`,
`/organizador/relatorio` e nas 2 páginas de evento. Dashboards migrados de `createdAt` pra
`Payment.paidAt` no filtro de período. Tabela de eventos do organizador corrigida (usava
`totalAmount` em vez de `subtotalAmount`, e ignorava o filtro de data).

**Achado importante da revisão independente (opus)**: `eventRevenue` originalmente era
derivado por subtração (`grossRevenue - taxas`), o que infla o valor se um Order acabar com
mais de 1 Payment PAID (anomalia real, é pra isso que existe o cron de reconciliação) —
corrigido pra vir direto de `Order.subtotalAmount` como input independente, não derivado.
Também achou um `to.setHours(23,59,59,999)` residual nas 2 páginas de relatório que, combinado
com a correção de fuso, causava um vazamento AINDA PIOR (~21h a mais) em servidor UTC —
removido.

Suíte final 1049/1049, `tsc --noEmit` limpo.

## Auditoria de segurança do fluxo de pagamento com cartão (2026-07-20) — DEPLOYADO em 2026-07-21

Usuário pediu análise do formulário de cartão (autocomplete/cache) + regras de negócio/segurança
de pagamento. Achados e correções, todas commitadas na main (`9090d22`, `f8f28e2`, `23f9ff0`,
`a0d01e5`, `a60c283`) e já no ar desde o deploy único de 2026-07-21:

1. **Crítica**: `GET /api/payments/mp-return` marcava pedido como PAID/registration CONFIRMED
   direto de query string (`status=approved`) sem autenticação nem verificação nenhuma —
   qualquer usuário conseguia confirmar a própria inscrição de graça com uma única URL. Corrigido:
   exige sessão, checa posse do pedido, sempre reconsulta o status real via API do Mercado Pago
   antes de gravar qualquer coisa (`lib/payment/check-mp-status.ts`, extraído e compartilhado com
   `/api/orders/[id]/status`, que já fazia isso certo).
2. **Crítica**: `verifyWebhookSignature` (Mercado Pago e Pagar.me) fazia `return true` (aceitava
   qualquer coisa) quando o segredo do webhook não estava configurado — falha aberta. Corrigido
   pra `return false` (falha fechada) nos dois. **Usuário confirmou que NUNCA configurou
   `mp_webhook_secret`/`pagarme_webhook_password`** — ver seção "Configurar webhook secret" logo
   abaixo, é a próxima ação real pendente (não é deploy, é config).
3. Reforço: Pagar.me agora reconfirma o status real via `checkPaymentStatus` antes de aplicar
   (mesma defesa que o Mercado Pago já tinha via `fetchMPPaymentStatus`), já que a autenticação do
   Pagar.me é senha compartilhada (Basic auth), não assinatura por mensagem.
4. `autoComplete="off"` em todos os campos de cartão (`PagarMeCardForm.tsx`,
   `MPCardForm.tsx`, `CheckoutForm.tsx`) — antes tinha `cc-number`/`cc-exp`/`cc-csc`/`cc-name`
   explícitos, convidando o navegador a oferecer salvar/autopreencher os dados do cartão.
5. Rate limiting (`lib/rate-limit.ts`, já existia, nunca era chamado) ligado em
   `POST /api/checkout` — 5 tentativas/minuto por usuário, mitiga card testing.

Suíte final 1038/1038, `tsc --noEmit` limpo. Achados menores registrados mas não corrigidos
(decisão de escopo, não pedidos pelo usuário): `rawPayload` do webhook armazenado sem expurgo
(baixo risco — gateways não mandam PAN/CVV completo em webhook).

### Configurar webhook secret — pendência real (não é deploy)

Depois que o deploy acontecer, o admin precisa ir em **Admin → Configurações → Pagamentos** e
preencher o segredo do webhook do gateway ativo (Mercado Pago: "Webhook Secret"; Pagar.me:
"Senha do Webhook"). Sem isso, com a correção #2 acima, o site vai **rejeitar todos os
webhooks de pagamento** (falha fechada) — os pagamentos legítimos ainda são confirmados pela
reconciliação automática (`/api/cron/reconciliation`, já configurada no crontab), só que com
atraso, não instantaneamente. Isso não bloqueia nada, mas deixar o segredo configurado é
importante pra confirmação instantânea voltar a funcionar.

## PRÓXIMA TAREFA: revisar achados da investigação de lentidão de navegação e decidir push/deploy

Ver seção "Correções pontuais pós-deploy (2026-07-20)" no topo deste arquivo — 5 correções
implementadas e testadas (WhatsApp status/normalização, filtro de data em inscritos, WhatsApp na
confirmação, compressão de imagem), aguardando: (1) o relatório do Explore subagent sobre a causa
da lentidão de navegação relatada pelo usuário, (2) autorização do usuário pra `git push`
(nada foi commitado ainda) e depois deploy — não assumir aprovação automática, ele tem alternado
entre autorizar e não autorizar push/deploy a cada pedido nesta sessão.

Os **4 sub-projetos anteriores + correções de segurança/receita/último acesso continuam 100%
implementados, revisados, commitados e DEPLOYADOS** (ver seção "DEPLOY ÚNICO FEITO" abaixo). Só
restam as pendências de configuração externa já listadas lá (webhook secret do gateway de
pagamento, credenciais do Google AdSense) — nenhuma delas bloqueia o sistema.

**Sub-projeto 4 (marketplace de anunciantes privados) — CONCLUÍDO nesta sessão** via
`superpowers:subagent-driven-development`, direto na main — spec
`docs/superpowers/specs/2026-07-18-marketplace-anunciantes-design.md` (commit `ab5fe60`), plano
`docs/superpowers/plans/2026-07-18-marketplace-anunciantes.md` (commit `f4de0e8`). 20 tasks,
todas implementadas e revisadas individualmente (spec ✅ + qualidade ✅ em cada uma) — resumo por
área:
- Schema: `ADVERTISER` role, `AdvertiserProfile → AdPurchase → PrivateAd`, `Payment.orderId` viu
  opcional + novo `Payment.adPurchaseId` (cadeia paralela, `Order`/`checkout.ts`/`Registration`
  nunca tocados). Seed de 3 `AdPlan` (Básico/Intermediário/Premium) via `migration.sql`.
- Cadastro de anunciante (`/auth/cadastro-anunciante`) atrás do toggle `ads_marketplace_enabled`
  (`PlatformSetting`, padrão `"false"`, liga em `/admin/configuracoes`).
- Checkout do plano (`/api/checkout-ads`) reaproveita o gateway de pagamento genérico existente
  sem nenhuma mudança nele.
- Webhook de pagamento ganha branch aditivo pra `AdPurchase` (`confirmAdPurchasePayment`),
  espelhando o padrão já existente de `applyGatewayStatus` (guard de status obsoleto/terminal +
  transação + e-mail só depois do commit).
- Painel do anunciante (`/anunciante`), cadastro de anúncio com validação de dimensão real via
  `sharp` (nunca confia em metadata do cliente) e upload só depois de toda validação passar (sem
  arquivo órfão em rejeição).
- Renderização pública (`AdSlotRenderer` ganha branch `PRIVATE`), rastreio de impressão/clique,
  moderação admin (aprovar/rejeitar com `ConfirmModal`, nunca `prompt()` nativo), cron de
  expiração.
- Relatório em PDF (`@react-pdf/renderer`, nova dependência) enviável por e-mail (anexo) ou
  WhatsApp (documento).

**3 bugs reais encontrados e corrigidos durante a implementação/revisão** (nenhum fazia parte do
código já existente antes desta sessão — todos introduzidos ou expostos pelas mudanças desta
feature):
1. IDOR na rota de cadastro de anúncio (`POST /api/anunciante/ads`) — não checava se o
   `adPurchaseId` enviado pertencia ao anunciante autenticado; qualquer anunciante podia consumir
   vaga paga de outro. Corrigido com checagem de posse (mesmo 400 genérico da rota, sem oráculo
   de enumeração).
2. **Achado só na revisão final de branch inteira, cross-task** — rota de aprovação
   (`approve/route.ts`) não checava exclusividade de posição: dois anunciantes podiam ter anúncio
   `APPROVED` na mesma posição ao mesmo tempo (um deles pagando sem receber veiculação real).
   Corrigido com checagem transacional (404 se não existe, 409 se a posição já tem outro
   aprovado).
3. **Também só na revisão final** — o cron genérico de expiração de pagamentos
   (`expirePendingPayments`, já existia antes desta feature) não filtrava `orderId not null`,
   então pegava pagamento PIX de plano de anúncio vencido e entrava num loop de erro permanente
   (rollback a cada execução, pagamento nunca expira de verdade). Corrigido com filtro no `where`.

Também corrigido durante a implementação (regressão cross-cutting, não um bug de feature): a
Task 1 tornar `Payment.orderId` opcional quebrou `tsc` em 13 arquivos pré-existentes do sistema
de pagamentos que assumiam `payment.order` sempre não-nulo — corrigido com guards explícitos
(nunca non-null assertion), decisão do usuário.

Suíte final: **1018/1018 testes**, `tsc --noEmit` limpo. Revisão final de branch inteira (opus,
26 commits, diff completo desde antes da Task 1): **pronto pra merge, com ajustes** — os 2
achados (Critical + Important acima) foram corrigidos e re-revisados (Approved). Achados Minor
não corrigidos (backlog, sem ação necessária agora): `Payment.orderId`/`adPurchaseId` mutuamente
exclusivos só "por construção" (sem `CHECK` no banco); rota de aprovação não re-checa
status/prazo ao reaprovar um anúncio já expirado/rejeitado (mesmo padrão já aceito nas rotas
irmãs); nav do anunciante linka `/anunciante/anuncios` e `/anunciante/perfil`, nenhuma das duas
construída por nenhuma task (dead link conhecido desde a revisão da Task 7).

**Verificação manual no navegador não feita** (mesmo motivo dos 3 sub-projetos anteriores: banco
de dev local inacessível na sessão inteira).

## Checklist de deploy (histórico — EXECUTADO em 2026-07-21, ver seção "DEPLOY ÚNICO FEITO" no topo)

Migrações (banco via `prisma db push` — **não roda `migration.sql`**, seeds abaixo precisam de
INSERT manual):
- `MessageLog` (sub-projeto 2, caixa de entrada de mensagens).
- `AdSlot` + `AdMetricsSnapshot` (sub-projeto 3, anúncios + Google AdSense) — seed manual de 5
  linhas `AdSlot` (todas `enabled=false` por padrão).
- `AdvertiserProfile`/`AdPlan`/`AdPurchase`/`PrivateAd` + `Payment.orderId` opcional/`adPurchaseId`
  (sub-projeto 4, marketplace) — seed manual de 3 linhas `AdPlan` (ver INSERT em
  `prisma/migrations/20260718010000_add_advertiser_marketplace/migration.sql`).

Env vars novas:
- `WHATSAPP_WEBHOOK_SECRET` (sub-projeto 2).
- `GOOGLE_ADS_OAUTH_CLIENT_ID`/`SECRET` (sub-projeto 3 — só funciona depois de criar o projeto no
  Google Cloud e ativar a AdSense Management API; sem isso a infra fica pronta mas inerte, sem
  quebrar nada).

Build:
- Nova dependência `@react-pdf/renderer@^4.5.1` (sub-projeto 4) — confirmar que entra no build da
  imagem Docker (`npm install` roda automático no build, mas confirmar o `package-lock.json`
  commitado bate).

Depois do deploy, smoke test sugerido (mesmo padrão dos deploys anteriores desta sessão): home
200, `/eventos` 200, `/admin/mensagens` e `/organizador/mensagens` 200, `/admin/anuncios` 200,
`/anunciante` redireciona pra login sem sessão, `docker logs corridas-app` sem erro nos primeiros
minutos.

## Contexto necessário para retomar (deploy)
- Processo de deploy: ver memória `[[deploy_vps_process]]` — git pull + `/opt/corridas/deploy.sh`
  na VPS, plink/pscp (PuTTY), `db push` manual se houver mudança de schema.
- Ledger completo task-a-task do sub-projeto 4 (git-ignored): `.superpowers/sdd/progress.md`.

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
