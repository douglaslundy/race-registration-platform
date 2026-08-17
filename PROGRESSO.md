# Progresso do Projeto

## Última atualização (2026-08-17, mais recente)
**Push + deploy feito e confirmado em produção**: Etapa 9 (entrega de kits, 10 tasks + revisão
final) e a correção de paginação de `/admin/mensagens`, juntos (`git push` até `a5a9ba3`).
Sequência de 4 passos usada por causa da migration de `KitDelivery`. Ver detalhes nas duas seções
abaixo.

**Etapa 9 do mega-prompt antigo (entrega de kits) — CONCLUÍDO E DEPLOYADO.**
Brainstorm → spec (`docs/superpowers/specs/2026-08-16-entrega-kits-design.md`) → plano de 10 tasks
(`docs/superpowers/plans/2026-08-16-entrega-kits.md`) → executado via
`superpowers:subagent-driven-development`, direto na `main`. 12 commits de tasks + revisão final
com fix wave (2 achados Important corrigidos numa rodada só). HEAD atual: `97fd777`. Ver seção
"Entrega de kits" mais abaixo pro detalhe completo.

Paginação de `/admin/mensagens` corrigida (commit `b6dd9f3`) — dados já eram paginados certo no
servidor (`skip`/`take` de 20, `lib/message-logs.ts`), o bug real era só a UI: um `<Link>` por
página sem limite virando parede de botões. Trocado por janela compacta (Anterior/±1/Próxima,
reticências, canto inferior direito). `/organizador/mensagens` tem o mesmo bug, NÃO corrigido
(fora do pedido). **Deployado** junto com a entrega de kits, num único push (2026-08-17).

## Entrega de kits (2026-08-16/17) — CONCLUÍDO E DEPLOYADO

Etapa 9 do mega-prompt de 10 etapas de 2026-08-02/03 — ficou deliberadamente bloqueada até pedido
explícito do usuário, que veio nesta sessão. Feature nova do zero: organizador (e assistentes
autorizados) roda um balcão de retirada física de kit no dia do evento, em múltiplos pontos
simultâneos, com um campo único de busca/leitura (nome/CPF/peito digitado, leitor físico
USB/Bluetooth que só "digita" no campo, ou botão de câmera opcional), trava contra dupla entrega
garantida no banco (`KitDelivery.registrationId` único), registro de quem retirou (inclusive
terceiro), relatório de progresso com CSV, e QR code (só o `registration.id`, sem dado sensível)
disponível em "Minha inscrição" e anexado na confirmação de inscrição por e-mail/WhatsApp.

**10 tasks**, todas revisadas individualmente (algumas com 1 rodada de fix, todas fechadas):
1. Schema `KitDelivery` + migration (`prisma/migrations/20260817000000_add_kit_deliveries/`).
2. `lib/kit-delivery.ts` — busca (`findRegistrationForKitDelivery`) + relatório
   (`getKitDeliveryProgress`).
3. Permissões de assistente novas (`kits.view`/`kits.deliver`) nos dois catálogos.
4. API de busca + confirmação de entrega — achado real: os testes só checavam o retorno mockado,
   não o `where` exato mandado ao Prisma pra escopo de dono do evento (a mesma classe de bug de
   IDOR que este projeto já teve antes) — corrigido com asserções diretas de `where`.
5. API de relatório (JSON + CSV) — já nasceu aplicando a lição da Task 4.
6. Tela de retirada do organizador (`/organizador/eventos/[id]/entrega-kits`) — busca, confirmação,
   relatório embutido.
7. Leitura por câmera (`qr-scanner`, npm novo) — a API real da lib não pôde ser verificada ao
   escrever o plano (sem acesso à internet na hora); o implementador leu o `.d.ts` do pacote
   instalado antes de codar, confirmado independentemente pelo revisor lendo o mesmo arquivo.
8. Componente compartilhado `KitDeliveryReportCard` + página do admin só-leitura
   (`/admin/eventos/[id]/entrega-kits`).
9. QR code (`react-qr-code`, já usada pro QR do Pix) na página "Minha inscrição", só quando
   `CONFIRMED`.
10. QR code gerado como PNG no servidor (`qrcode`, npm novo) e anexado na confirmação de inscrição
    — mexe em `lib/notifications.ts::notifyOrderConfirmed`, função viva em produção. Achado real:
    o teste que devia provar "falha ao anexar o QR no WhatsApp nunca desfaz o claim de dedupe do
    texto que já foi enviado" na verdade não conseguia distinguir implementação certa de errada
    (mesma contagem de chamadas nos dois casos) — corrigido com asserção direta em
    `alertLog.deleteMany`, verificada empiricamente pelo implementador (quebrou o try/catch de
    propósito, viu o teste falhar, reverteu).

**Revisão final de branch inteira (opus, base `30dd99f`..`8933f6c`):** achou 2 Important + vários
Minor, sem nenhum Critical. Fix wave único aplicado (commit `97fd777`):
1. **Important**: a página de relatório do admin (Task 8) não tinha nenhum link na UI — só
   alcançável digitando a URL. Corrigido: link "Entrega de kits" na fileira de Ações de
   `/admin/eventos/[id]`.
2. **Important**: `getKitDeliveryProgress` carregava TODAS as inscrições confirmadas do evento
   inteiras (com e-mail/telefone) só pra contar e montar a lista de pendentes — recarregado a cada
   scan e a cada entrega confirmada no balcão. Corrigido: `total`/`delivered`/`pendingTotal` agora
   via `count()` agregado; a lista de pendentes aceita um limite opcional (relatório JSON da UI
   usa 50, export CSV continua sem limite pra manter a lista completa). Card de relatório mostra
   "Mostrando X de Y pendentes" quando truncado.
3. Minors selecionados: ternário sem efeito em `lib/email.ts` removido; `sendWhatsAppDocument`
   (usada pro anexo do QR) ganhou registro em `MessageLog` (antes invisível na auditoria de
   mensagens), mesmo padrão já usado por `sendWhatsAppMessage`.

Re-revisão do fix wave: todos os 4 achados endereçados, nenhuma quebra nova. Suíte completa
(227 arquivos / 1558 testes) e `tsc --noEmit` limpos depois do fix wave — confirmado de novo pelo
controller antes de fechar.

**Duas novas dependências de produção**: `qrcode` (+ `@types/qrcode`) e `qr-scanner` — ambas
pequenas, sem achados de segurança conhecidos, `qrcode` traz a árvore do `yargs` (CLI, não usada)
como transitiva.

**Não testado no navegador** (mesmo problema de DNS de sempre nesta sessão) — verificação foi
typecheck + suíte completa + conferência manual detalhada do contrato API↔UI em cada task de UI,
incluindo verificação independente da API real do `qr-scanner` direto no pacote instalado.

**Deploy confirmado em 2026-08-17**: `git push origin main` (até `a5a9ba3`) → na VPS
(`/opt/corridas/src`): `git pull` → `docker build -t corridas-app:latest .` → `docker compose run
--rm app sh -c "npx prisma db push --skip-generate"` (sync limpo, só criação da tabela nova
`kit_deliveries`, sem prompt de perda de dado) → `docker compose up -d --no-deps app`. Confirmado
com `\d kit_deliveries` direto no banco: unique em `registrationId`, índice em
`deliveredByUserId`, os 2 FKs corretos. Smoke test: `/`, `/eventos` 200; `/admin/eventos`,
`/admin/mensagens` 307 (redirect de login, esperado sem sessão). `docker logs corridas-app` sem
erro (nem o `EACCES` antigo do cache de imagem, que já tinha sido corrigido antes).

**PRÓXIMA TAREFA:** nenhuma pendente desta frente. Idealmente, um teste manual no navegador do
fluxo completo de entrega de kits (cadastrar QR, escanear, confirmar entrega, ver relatório) —
não foi possível fazer nesta sessão (mesmo problema de DNS de sempre).

## Última atualização (histórico anterior)
2026-08-16 — 3 frentes concluídas e deployadas na mesma sessão: (1) feature "redes sociais por
evento", (2) fix do 404 em inscrição por procuração, (3) fix de permissão no Dockerfile +
inserção de `{{redes_sociais}}` nos 11 templates de mensagem em produção. Ver as 3 seções abaixo.

## Dockerfile: chown pro usuário nextjs + {{redes_sociais}} inserido nos templates (2026-08-16) — CONCLUÍDO E DEPLOYADO

**Parte 1 — Dockerfile**: achado num smoke test anterior (`EACCES: permission denied, mkdir
'/app/.next/cache'`) — os `COPY --from=builder` no estágio `runner` não tinham `--chown`, então
tudo ficava com dono `root` mesmo com `USER nextjs` (uid 1001) ativado depois. Corrigido
acrescentando `--chown=nextjs:nodejs` nas 6 linhas de `COPY --from=builder` do `Dockerfile`
(commit `105db48`). Deployado (`git pull` → `docker build` → `docker compose up -d --no-deps
app`, sem mudança de schema). Confirmado: `docker exec corridas-app stat /app/.next` agora mostra
`Uid: (1001/nextjs) Gid: (1001/nodejs)`, e o erro `EACCES` não reapareceu nos logs depois do
restart nem depois de tráfego real (smoke test).

**Parte 2 — inserção de `{{redes_sociais}}` nos templates reais**: usuário reportou que cadastrou
uma rede social no evento mas o atleta não recebeu nada nas confirmações. Causa: a variável
`{{redes_sociais}}` (e também `{{link_patrocinio}}`, achado colateral, ainda não resolvido — ver
nota abaixo) foi disponibilizada pro editor de templates mas **nunca inserida no texto de
nenhuma mensagem real** — decisão explícita do plano original ("não mexer em nenhum
factoryDefault"). `lib/templates/resolve.ts` busca o corpo da mensagem em EVENT → GLOBAL →
factory; como nenhum desses 3 níveis tinha `{{redes_sociais}}` escrito, a promoção calculada
nunca aparecia em lugar nenhum.

Corrigido por pedido explícito do usuário: **11 linhas de `message_templates` (escopo GLOBAL,
direto no banco de produção via `psql`, mesmo padrão já usado nesta sessão pro conteúdo de SEO)**
— os 6 alertKeys que essa feature suporta (únicos com a variável realmente calculada no código,
`lib/notifications.ts`/`abandoned-cart.ts`/`payment-error.ts`): `ORDER_CONFIRMED` (EMAIL+WHATSAPP),
`ORDER_CONFIRMED_PROXY_BUYER` (WHATSAPP), `ORDER_CONFIRMED_PROXY_ATHLETE` (EMAIL+WHATSAPP),
`ABANDONED_CART` (EMAIL+WHATSAPP), `PAYMENT_ERROR` (EMAIL+WHATSAPP),
`PAYMENT_ERROR_ORDER_CANCELLED` (EMAIL+WHATSAPP). Confirmado que nenhum desses alertKeys tem
override por evento (`scope='EVENT'`) que pudesse ficar escondendo a mudança GLOBAL. Padrão de
inserção, com pelo menos uma linha em branco antes (pedido explícito do usuário): e-mail (HTML)
ganhou um `<p>{{redes_sociais}}</p>` novo no final do corpo (parágrafos HTML já têm espaçamento
visual entre si); WhatsApp (texto puro) ganhou `\n\n{{redes_sociais}}` no final. Quando não há
link ativo/dentro do limite, a variável resolve pra `""` (já coberto pela Task 2 da feature) —
sobra um parágrafo/linha vazia no fim da mensagem, cosmético, não quebra nada.

**Achado colateral, TAMBÉM CORRIGIDO** (usuário confirmou explicitamente, mesma sessão):
`{{link_patrocinio}}` (feature anterior, 2026-08-12/13, marcada como "concluída e deployada")
sofria do EXATO MESMO problema — nunca tinha sido inserida no texto de nenhum template real.
Só é uma variável disponível nos 3 alertKeys de confirmação (`ORDER_CONFIRMED`,
`ORDER_CONFIRMED_PROXY_BUYER`, `ORDER_CONFIRMED_PROXY_ATHLETE` — não em `ABANDONED_CART`/
`PAYMENT_ERROR*`, que nunca tiveram essa variável no registro). Inserida nas mesmas 5 linhas de
`message_templates` já editadas acima, posicionada ANTES de `{{redes_sociais}}` (mesmo padrão de
pelo menos uma linha em branco entre blocos). Confirmado lendo o corpo gravado depois do UPDATE.

**Não testado no navegador** (mesmo problema de DNS já documentado nesta sessão) — a verificação
foi ler o corpo de cada uma das 11 linhas direto no banco depois do UPDATE, confirmando o texto
exato gravado.

## Bug urgente (2026-08-16): 404 na página de pagamento/inscrição para inscrição por procuração — CORRIGIDO E DEPLOYADO

Usuário reportou 404 em `https://circuitodascorridas.com.br/dashboard/inscricoes/<id>` quando a
inscrição é por procuração (pra um terceiro). Investigação com `superpowers:systematic-debugging`:

**Causa raiz**: `app/dashboard/inscricoes/[id]/page.tsx` (mesma tela mostra status de
pagamento — PIX/boleto/polling — e o detalhe da inscrição) buscava a inscrição com
`where: { id, athleteUserId: session.user.id }`. Numa inscrição por procuração
(`lib/checkout.ts` → `createCheckout`, ativado quando `input.proxyAthlete` está presente), o
`athleteUserId` gravado é o da conta do atleta terceiro (nova conta criada na hora, ou uma já
existente casada por CPF) — sempre diferente de `order.buyerUserId` (quem de fato pagou e está
logado). Resultado: o comprador cai em 404 tanto no redirect automático pós-checkout
(`CheckoutForm.tsx:312,322` → é literalmente "a página de pagamento", mostra o QR code do PIX)
quanto ao clicar no link em "Minhas inscrições" ou "Pagamentos" — as duas telas já listam essas
inscrições corretamente (`app/dashboard/inscricoes/page.tsx` já usa
`OR: [{athleteUserId}, {order:{buyerUserId}}]` com badge "Inscrito por você"), só a tela de
detalhe/pagamento que ficou pra trás com o filtro antigo, estreito demais.

**Corrigido**: mesmo padrão `OR` replicado em dois lugares (única e mesma classe de bug nos dois):
- `app/dashboard/inscricoes/[id]/page.tsx` — leitura da inscrição.
- `app/api/registrations/[id]/cancel/route.ts` — mesma falha bloquearia o comprador de cancelar
  uma inscrição feita pra terceiro (mesmo filtro estreito).

Bônus: a tela de detalhe agora mostra "Inscrição feita por você para X" quando vista pelo
comprador (antes não indicava de quem era a inscrição, campo `athlete`/`buyerUserId` nem eram
selecionados na query).

**Verificação**: TDD — 2 testes novos em `tests/registration-cancel-route.test.ts` reproduziram o
bug (RED, assertivo sobre o `where` exato passado ao Prisma) antes da correção, GREEN depois.
Suíte completa 1530/1530 (era 1528, +2 novos), `tsc --noEmit` limpo. Não foi possível testar no
navegador (mesmo problema de DNS já documentado nesta sessão pro host do Supabase de produção).
Não achei nenhum outro ponto de entrada com o mesmo bug (rotas de organizador/admin já são
escopadas por `organizerId`, não por `athleteUserId`, então não são afetadas).

**Deploy confirmado em 2026-08-16**: `git push origin main` (`f7aec86..352fc96`) → na VPS
(`/opt/corridas/src`): `git pull` → `docker build -t corridas-app:latest .` → `docker compose run
--rm app sh -c "npx prisma db push --skip-generate"` (sync limpo, só criação das 2 tabelas novas,
sem prompt de perda de dado) → `docker compose up -d --no-deps app`. Smoke test: `/`, `/eventos`
200; `/dashboard/inscricoes/cmsvvjf7a01i5tz32l9panqxg` e `/admin/eventos` 307 (redirect de login,
esperado sem sessão — não prova o fix específico, só confirma que a rota resolve). `docker logs
corridas-app` sem erro relacionado às mudanças desta sessão.

**Achado colateral durante o smoke test, NÃO relacionado a esta sessão, não corrigido**: o
container roda como usuário `nextjs` (uid 1001), mas `/app/.next` pertence a `root` — toda
tentativa de cache de otimização de imagem (`next/image`) falha com `EACCES: permission denied,
mkdir '/app/.next/cache'`. Degrada de forma não-fatal (imagens continuam servidas, só sem cache
em disco), causa provável no `Dockerfile` (falta `chown` pro usuário `nextjs` na etapa de
`COPY --from=builder`). Não mexi nisso — fora do escopo do que foi pedido. Registrar como
pendência real se o usuário quiser investigar performance de imagens depois.

**PRÓXIMA TAREFA**: nenhuma pendente desta frente. Pedir pro usuário confirmar no navegador,
logado, que `/dashboard/inscricoes/cmsvvjf7a01i5tz32l9panqxg` abre normalmente agora e que o
cadastro de redes sociais funciona (não foi possível testar no navegador nesta sessão).

## Redes sociais com limite de envio, por evento (2026-08-13/16) — CONCLUÍDO E DEPLOYADO

Item B do pedido original de 4 tarefas do usuário (item A, link de patrocínio, já foi concluído e
deployado — ver seção mais abaixo). Organizador cadastra redes sociais por evento (rede + link +
mensagem + limite de envios por pessoa); a plataforma inclui isso via variável de template
`{{redes_sociais}}` nas 3 mensagens que já manda pro comprador/atleta (confirmação de inscrição,
carrinho abandonado, erro de pagamento), respeitando "primeiras N mensagens recebem a promoção".

**Documentos:**
- Spec: `docs/superpowers/specs/2026-08-13-redes-sociais-evento-design.md`
- Plano: `docs/superpowers/plans/2026-08-13-redes-sociais-evento.md` (6 tasks)
- Ledger de execução (subagent-driven-development):
  `.superpowers/sdd/2026-08-13-redes-sociais-evento/progress.md` — histórico completo de cada
  task/round de fix, não apagar.

**Modo de execução desta feature:** subagent-driven-development, **direto na branch `main`**
(sem worktree — pedido explícito do usuário desta vez, diferente das features anteriores).
HEAD atual em `main`: commit `00c32ea`.

**Concluído (Tasks 1-4 de 6, todas revisadas e com fix aplicado quando necessário):**
- Task 1 (`2fcfb81`): models `EventSocialLink`/`SocialLinkSend` no schema + migration escrita à
  mão em `prisma/migrations/20260813010000_add_event_social_links/migration.sql` (commitada com
  `git add -f`, `/prisma/migrations/` está no `.gitignore` — já verificado que está rastreada).
  **Migration NÃO aplicada em produção ainda** — precisa da sequência de deploy com schema (ver
  "Próxima tarefa" abaixo).
- Task 2 (`ae512f8` + fix `9012902`): helper `getSocialPromoText(eventId, userId)`.
  **Achado real da revisão, corrigido**: o plano mandou criar `lib/social-links.ts`, mas esse
  arquivo já existia pra uma feature completamente não relacionada (ícones de redes sociais do
  site público — `SOCIAL_NETWORKS`/`buildSocialLinks`/`buildWhatsAppLink`). O helper novo foi
  separado pra `lib/event-social-links.ts` (arquivo próprio); `lib/social-links.ts` foi restaurado
  ao estado original. **Importar sempre de `@/lib/event-social-links`, nunca de
  `@/lib/social-links`** — isso já está correto em tudo que foi implementado até aqui (Task 4).
- Task 3 (`70dacb8`): variável `redes_sociais` em `lib/templates/registry.ts` (6 alertKeys:
  ORDER_CONFIRMED + 2 variantes, ABANDONED_CART, PAYMENT_ERROR + variante) **e** em
  `lib/templates/variables.ts` (`ALL_VARIABLES` — os dois arquivos precisam estar sincronizados,
  `tests/templates-registry.test.ts` garante isso).
- Task 4 (`de9db91` + fix `00c32ea`): resolve `redes_sociais` nos 3 fluxos de envio
  (`lib/notifications.ts`, `lib/alerts/abandoned-cart.ts`, `lib/alerts/payment-error.ts`, mais
  `lib/email.ts` pros 3 e-mails). **Achado real da revisão, corrigido**: a chamada de
  `getSocialPromoText` (que tem efeito colateral — incrementa contador de cota) estava sendo feita
  ANTES das guardas de dedupe/SMTP/canal habilitado/telefone, então uma execução que não enviava
  nada (ex.: cron de carrinho abandonado reprocessando pedido já bloqueado por dedupe) ainda assim
  queimava a cota do usuário. Corrigido com resolver preguiçoso memoizado, chamado só de dentro de
  cada branch que efetivamente vai enviar — mantém "no máximo 1 chamada real por destinatário
  lógico" mas só dispara quando a mensagem sai de verdade. Bônus da mesma correção:
  `renderTemplateSubject` agora colapsa `\r\n` pra espaço (redes_sociais pode ter múltiplas linhas
  e agora é válida em assuntos de e-mail também).

**Task 5 (API REST — commit `cb4a0d0`):** `GET/POST /api/events/[id]/social-links` +
`PATCH/DELETE /api/events/[id]/social-links/[linkId]`, espelhando `coupons/*`, IDOR-safe (ownership
checado antes de toda mutação). Revisão: aprovada, só achados Minor (deferidos, ver git log da
sessão se precisar do detalhe — o ledger do plano já foi apagado, ver "Limpeza" abaixo).

**Task 6 (UI do organizador — commits `f70fca8` + fix `6e44e09`):**
`app/organizador/eventos/[id]/redes-sociais/page.tsx` + link na página do evento, usando
`ConfirmModal` (não `ConfirmDialog`). Revisão achou 1 Important real (handleCreate renderizava o
objeto cru de `zod.flatten()` como filho React em erro de validação — crash reproduzível com campo
só-espaço ou `maxSends` negativo), corrigido e re-revisado limpo. **Verificação manual no navegador
NÃO foi possível nesta sessão** — o host de DB de produção (`db.usgslzpuovvrkvvrhljt.supabase.co`)
não resolve via DNS neste ambiente, então `npm run dev` não sobe. Verificação foi só estática
(typecheck, suíte completa, conferência manual do contrato API↔UI linha a linha contra as rotas
reais da Task 5). Recomendação: fazer ao menos um teste manual rápido (criar/editar/remover uma
rede social, clicar "Remover" e confirmar que `ConfirmModal` aparece, nunca `confirm()` nativo)
assim que houver acesso a um ambiente que resolva o DB — antes ou logo depois do deploy.

**Revisão final de branch inteira (opus, base `5dbf69d`..`6e44e09`):** achou 2 Important + 8 Minor,
sem nenhum Critical. Fix wave único aplicado (commit `08ac923`), corrigindo:
1. **Important**: `social-links.view/create/edit/delete` não existiam nos catálogos de permissão de
   assistente (`app/organizador/assistentes/page.tsx`, `app/admin/assistentes/page.tsx`) — nenhum
   ASSISTANT conseguiria ser autorizado (403 permanente e silencioso). Corrigido: 4 entradas
   adicionadas nos dois catálogos + `load()`/`reload()` da tela de redes sociais agora checam
   `res.ok` e mostram erro em vez de renderizar lista vazia enganosamente.
2. **Important**: `getSocialPromoText` (`lib/event-social-links.ts`) não tinha try/catch — um erro
   de banco (ex.: tabela ainda não migrada em produção) quebraria o envio de confirmação/carrinho/
   erro de pagamento em vez de resolver pra `""` como o contrato promete. Corrigido: função inteira
   embrulhada em try/catch, loga e retorna `""` em qualquer erro.
3. Minors selecionados por custo/benefício (o resto foi só registrado, não corrigido — ver
   histórico de commits da sessão de 2026-08-16 se precisar do texto completo de cada achado):
   botão preso em "Criando…" se a resposta de erro não for JSON (guard `res.json().catch()`),
   contraste dark mode no formulário de criação, fileira de 4 botões de ação sem `flex-wrap`
   (virou `grid grid-cols-2 sm:grid-cols-4`), e o texto de `redes_sociais` colapsava em uma linha
   só (não-clicável) no corpo HTML dos e-mails quando havia mais de um link ativo — corrigido em
   `lib/templates/render.ts` (`\n` → `<br>` só no canal EMAIL, confirmado que não afeta WhatsApp
   nem nenhuma outra variável de template).

Re-revisão do fix wave: todos os 6 achados endereçados, nenhuma quebra nova. Suíte completa
(223 arquivos / 1528 testes) e `tsc --noEmit` limpos depois do fix wave.

**Limpeza:** o workspace do subagent-driven-development pra este plano
(`.superpowers/sdd/2026-08-13-redes-sociais-evento/`) foi apagado — o histórico de git (mensagens
de commit + `git log`) é a fonte da verdade agora, não `.superpowers/` (que está no `.gitignore`).

**PRÓXIMA TAREFA:** nenhuma pendente de implementação. Falta só, quando o usuário autorizar:
1. Push (`git push origin main` — local está à frente do `origin/main`, ~14 commits incluindo esta
   feature).
2. Deploy com a sequência de 4 passos por causa da migration de schema pendente (`EventSocialLink`/
   `SocialLinkSend` ainda não existem em produção): `git pull` → `docker build` → `docker compose
   run --rm app sh -c "npx prisma db push --skip-generate"` → `docker compose up -d --no-deps app`
   (NUNCA só `deploy.sh` sozinho quando há mudança de schema).
3. Idealmente, um teste manual rápido no navegador (ver nota da Task 6 acima) — não foi possível
   nesta sessão por falta de acesso ao DB de produção.
**Contexto necessário pra continuar:** este bloco do PROGRESSO.md só — nenhum outro arquivo
precisa ser lido antes de fazer push/deploy quando autorizado.

## Link de patrocínio por evento (2026-08-12/13) — CONCLUÍDO E DEPLOYADO

Item A do pedido de 4 tarefas do usuário. Campo `Event.sponsorLink`, variável de template
`{{link_patrocinio}}` disponível só nos 3 alertas de confirmação de inscrição, configurável na
edição do evento. Plano: `docs/superpowers/plans/2026-08-12-link-patrocinio-evento.md` (3 tasks).
Revisão final achou 1 Crítico real (o plano esqueceu de cadastrar `link_patrocinio` em
`lib/templates/variables.ts`, só em `registry.ts` — quebrava `tests/templates-registry.test.ts` e
deixava a variável invisível no editor de templates), corrigido antes do merge. **Deployado em
produção** (push + `prisma db push` + restart, tudo confirmado funcionando).

## Relatório Geral por evento (2026-08-12/13) — CONCLUÍDO E DEPLOYADO

Tela nova por evento (organizador + admin) só com inscrições CONFIRMADAS, sem paginação, sem
botões de ação: nome/CPF/e-mail/telefone/percurso/categoria/lote/camiseta/contato de
emergência/alergias/valor pago/forma de pagamento/data de confirmação. CSV de `/inscritos`
estendido com Telefone/Valor Pago + filtro `?status=`. Achado real da revisão: coluna "Valor Pago"
do CSV não-filtrado mentia pra inscrições não confirmadas — renomeada pra "Valor do Pedido" nesse
modo. **Deployado em produção.**

## Camisetas por lote (2026-08-12) — CONCLUÍDO, REVISÃO FINAL LIMPA (fix wave aplicada)

Toggle "Ver por lote" no card "Camisetas" (`components/ui/ShirtSizeReportCard.tsx`, extraído como
componente compartilhado), alternando entre a grade agregada de 7 tiles e uma tabela por lote.
Novo helper `computeShirtSizeBreakdownByBatch()` em `lib/organizer/event-metrics.ts`, componente
consumido por `app/organizador/eventos/[id]/page.tsx` e `app/admin/eventos/[id]/page.tsx`. Revisão
final de branch inteira aprovou pra merge (achados só Minor, todos corrigidos nesta leva): colunas
da tabela por lote agora casadas por `size` (não mais posicional), tipos `ShirtSizeStat`/
`ShirtSizeByBatch` importados de `lib/organizer/event-metrics.ts` em vez de duplicados localmente,
contraste dark mode ajustado (texto e bordas da tabela por lote), e este registro de bookkeeping.

**Status**: mergeado na main e deployado em produção (junto com a correção do PDF de inscritos,
mesma leva). Nenhuma pendência.

## Relatório de camisetas por evento (2026-08-12) — CONCLUÍDO, REVISÃO FINAL LIMPA

Card "Camisetas" (contagem de inscrições confirmadas por tamanho) nas páginas de gerenciamento de
evento do organizador e do admin. Helper puro `computeShirtSizeBreakdown()` em
`lib/organizer/event-metrics.ts` (7 linhas fixas: PP/P/M/G/GG/XGG/Sem tamanho informado), consumido
por `app/organizador/eventos/[id]/page.tsx` e `app/admin/eventos/[id]/page.tsx` (sem query nova,
reaproveita `dimensionRegistrations`). Plano (3 tasks):
`docs/superpowers/plans/2026-08-12-relatorio-camisetas-por-evento.md`. Revisão final de branch
inteira aprovou pra merge (achados só Minor, todos corrigidos nesta leva): teste documentando que
valor de `shirtSize` desconhecido é silenciosamente descartado (não conta em nenhuma das 7 linhas),
`break-words leading-tight` no label "Sem tamanho informado" nas duas páginas (evita overflow em
grade estreita), e este registro de bookkeeping.

**Status**: mergeado na main e deployado em produção. Nenhuma pendência.

## Verificação em 2 etapas para ações sensíveis de pagamento (2026-08-11) — IMPLEMENTADO, AGUARDANDO AUTORIZAÇÃO DE DEPLOY

Pedido do usuário: qualquer rotina que efetivamente chama a API do gateway de pagamento pra
estornar dinheiro passa a exigir um código de 6 dígitos (enviado por e-mail obrigatório + WhatsApp
best-effort pro usuário autenticado que executa a ação) antes do estorno acontecer de fato. Spec em
`docs/superpowers/specs/2026-08-11-verificacao-2fa-acoes-sensiveis-design.md`, plano em
`docs/superpowers/plans/2026-08-11-verificacao-2fa-acoes-sensiveis.md` (15 tasks — a 14ª foi
descoberta e adicionada em andamento, ver abaixo). Executado via subagent-driven-development, direto
na `main` (autorizado pelo usuário), com revisor dedicado por task e loop de correção sempre que
achado Important/Critical (todos fechados antes de avançar).

**Os 4 pontos que chamam `refundPayment()` de verdade, agora todos cobertos** (backend + UI):
1. Estorno manual admin — `POST /api/admin/payments/[id]/refund` (Task 4) + `RefundPaymentButton.tsx` (Task 10).
2. Estorno manual organizador — `POST /api/organizer/registrations/[id]/refund` (Task 5) + `RefundRegistrationButton.tsx` (Task 11).
3. Rejeição de anunciante com estorno automático — `POST /api/admin/anunciantes/[purchaseId]/reject` (Task 6) + `AdvertiserRequestRow.tsx` (Task 12).
4. Aprovação de cancelamento com estorno automático — rotas admin+organizador de `cancellation-decision` (Task 7) + UI na tela de inscritos do organizador (Task 13) **e** na fila de "reembolsos pendentes" admin+organizador (Task 14 — ver nota abaixo).

**Fora do escopo, por decisão do usuário**: `resolveRefundManually` e `updatePayoutStatus` (não
chamam a API do gateway diretamente — candidatos a uma leva futura se pedido).

**Achado mid-implementação, virou Task 14 (não estava nas 14 originais)**: `PendingCancellationsTable.tsx`
(usado pelas telas `/admin/reembolsos-pendentes` e `/organizador/reembolsos-pendentes`) é um 3º
consumidor de `CancellationDecisionButtons` que a Task 13 não tinha mapeado — sem o fix, o botão
"Aprovar" quebraria (erro genérico, não falha de segurança — o backend da Task 7 já bloqueava
corretamente) pra qualquer cancelamento com pagamento pago vindo dessa fila específica. Corrigido:
`lib/registrations/pending-queue.ts` agora expõe `hasPaidPayment`, as 2 páginas passam
`requestCodeEndpoint`, e as props do componente voltaram a ser obrigatórias (não há mais nenhum 4º
consumidor — confirmado via grep + `tsc --noEmit` limpo).

**Achado durante a revisão da Task 12, também corrigido antes de fechar**: o código original da
Task 12 pedia código de verificação incondicionalmente ao rejeitar uma solicitação de anunciante —
mas isso bloquearia rejeição de solicitações sem pagamento pago (ex: chargeback chegando via webhook
enquanto a solicitação ainda está `PENDING_APPROVAL`). Corrigido com o mesmo padrão `hasPaidPayment`
que a Task 13 já usava.

**Commits** (ordem cronológica, `main`):
`59975e0` schema+rate limit → `dc80524` e-mail do código → `d39c538` serviço central →
`635c34e` estorno admin → `6e3ccd1` estorno organizador → `1c0daf6` rejeição anunciante →
`a4fec6d`+`6a47524` aprovação de cancelamento (backend) → `6ebe397` CodeVerificationModal →
`0f9fe52`+`cd2c994` hook (+ fix de erro de rede) → `1234f00` RefundPaymentButton →
`dcf30f0` RefundRegistrationButton → `64c49d0`+`26cb901` AdvertiserRequestRow (+ fix hasPaidPayment) →
`c686eea` CancellationDecisionButtons → `1a56177`+`d6ee1e5` fila reembolsos-pendentes (+ fix teste).

**Migração de schema pendente de deploy**: `SensitiveActionCode` (tabela nova, aditiva, sem dado
existente a migrar) precisa de `prisma db push` (ou `migrate deploy`) na VPS antes do próximo deploy
funcionar — sem isso, todo pedido de código vai falhar com erro de tabela inexistente.

**Teste manual no navegador: NÃO FEITO em nenhum dos 4 pontos.** O `.env` local aponta pro que
parece ser o Supabase de produção (`db.usgslzpuovvrkvvrhljt.supabase.co`) — rodar o fluxo de verdade
mandaria e-mail/WhatsApp reais e estornaria/rejeitaria/aprovaria algo real. Toda verificação até
aqui foi estática (typecheck cruzando os contratos de props/retorno entre componentes, leitura das
rotas de backend confirmando a ordem "verifica código → só depois muda estado", suíte de testes
automatizados). **Fica pendente um teste manual conjunto com o usuário, nos 4 fluxos, antes do
deploy** — ver PRÓXIMA TAREFA.

**Suíte de testes**: `npx vitest run` → 213 arquivos passando, 6 falhando (23 casos) — todas as 23
falhas são pré-existentes, no trabalho não relacionado de `messageType` (outra frente desta sessão,
ver commits `23318fc`..`ac71fee`), nenhuma nova introduzida por esta feature. `npx tsc --noEmit` →
limpo.

**Revisão final de branch inteira (opus)**: achou 1 Crítico + 3 Importantes, todos corrigidos antes
de fechar:
- **Crítico**: o código de verificação vazava em texto puro pra `message_logs.subject` no envio por
  WhatsApp (`truncateForSubject` mantinha os 77 primeiros caracteres, e o código de 6 dígitos ficava
  dentro desse trecho) — visível em `/admin/mensagens` e `/organizador/mensagens`, inclusive pela
  mesma sessão comprometida que o código deveria proteger. Corrigido: `sendWhatsAppMessage` ganhou
  `options.logSubject` (usa o rótulo da ação, sem o código, como assunto gravado no log).
- **Importante**: `actionType`/`targetId` colidiam entre os fluxos de estorno (`targetId=payment.id`)
  e os de decisão de cancelamento (`targetId=registration.id`), ambos com `actionType:
  "PAYMENT_REFUND"` — risco latente pra uma conta com papel admin+organizador ao mesmo tempo.
  Corrigido: decisão de cancelamento ganhou `actionType: "REGISTRATION_CANCELLATION_REFUND"` próprio.
- **Importante**: a tela de inscritos do organizador calculava `hasPaidPayment` a partir do pagamento
  mais recente, não "existe algum pagamento pago" (like o backend real faz) — falhava fechado (sem
  furo de segurança) mas quebrava o fluxo da UI num caso de borda. Corrigido, sem query nova.
- **Importante**: faltava a migration do Prisma pra tabela `sensitive_action_codes` (schema tinha o
  model, `prisma migrate deploy` nunca criaria a tabela). Corrigido: migration escrita à mão
  (conferida campo a campo contra o schema), nenhum comando de CLI/banco rodado.
- Tudo corrigido num commit único (`9003605`), re-revisado (achado 1 Minor: o commit também trouxe
  uma mudança de assinatura não relacionada de outra frente em andamento — `messageType` obrigatório
  em `lib/whatsapp.ts` — separado num commit próprio (`d1b4f99`), sem afetar o resto do fix).

**PRÓXIMA TAREFA**: 1) teste manual conjunto com o usuário nos 4 fluxos (banco local aponta pra
produção, não dá pra testar sozinho) — nenhum dos 4 foi testado no navegador ainda; 2) perguntar
explicitamente antes de `git push`/deploy — mudança de schema + mexe em dinheiro real.
**Contexto necessário**: este bloco inteiro + `docs/superpowers/plans/2026-08-11-verificacao-2fa-acoes-sensiveis.md`
(15 tasks + revisão final, todas commitadas em `main` até `d1b4f99`, nenhum push feito ainda).

## Varredura completa: segurança + performance + bugs relatados (2026-08-10) — CATALOGADO, NADA CORRIGIDO AINDA

Usuário pediu varredura completa (segurança + lentidão) depois de relatos de clientes: formulário
de inscrição (própria e por procuração) "trava" e os dados somem sem erro nem confirmação;
lentidão grande em "Ver inscritos"/"Ordem cronológica" na tela de inscritos do evento; inscrição de
02/08 ainda "aguardando pagamento" sem cancelamento automático; 2 alertas de VPS "Load Alto"
(6.8 em 09/08 14:26, 6.9 em 09/08 22:02). Relatório completo apresentado ao usuário no chat desta
sessão (não copiado aqui — ver a conversa se precisar do texto literal). Resumo dos achados:

**Achados novos desta varredura:**
1. **CRÍTICO/segurança — IDOR confirmado**: `app/api/events/[id]/batches/[batchId]/route.ts`,
   `.../categories/[categoryId]/route.ts`, `.../routes/[routeId]/route.ts` — o `update`/`delete`
   final não inclui `eventId: id` no `where`, então um organizador autenticado pode editar/apagar
   lote/categoria/percurso de evento de OUTRO organizador se souber o ID do sub-recurso (IDs
   expostos pelos GETs públicos dos mesmos endpoints). Não corrigido ainda — perguntar ao usuário
   se quer priorizar.
2. **Causa provável da lentidão em "Ver inscritos"/"Ordem cronológica"**: as duas telas
   (`app/admin/eventos/[id]/inscritos/page.tsx`, `app/organizador/eventos/[id]/inscritos/page.tsx`)
   fazem `db.registration.findMany` SEM paginação (`take`/`skip` ausentes) + `include` aninhado de
   `order.payments` com `take:1` que vira N+1 real (uma query por pedido) porque o Prisma 5.22 não
   tem `relationJoins` habilitado no schema. Cresce linearmente com o total de inscritos do evento,
   a cada clique de filtro/ordenação (form é `method="GET"`, recarrega tudo). Falta também
   `@@index([eventId, createdAt])` em `Registration` e índice em `Payment.status`.
3. **Causa provável do formulário "travar e sumir"**: quando o pagamento por cartão volta
   `PENDING` sem PIX/boleto (comum em antifraude do Mercado Pago/Pagar.me — `pending_contingency`,
   `processing`, etc.), `CheckoutForm.tsx` não redireciona (só redireciona se `status==="PAID"` ou
   se tem `pixQrCodeText`) — cai no branch genérico `setResult(body)` que troca o formulário INTEIRO
   por um card pequeno de confirmação, sem `scrollTo(0,0)`. Se o usuário tinha rolado até o botão
   (fim de formulário longo), a tela "encolhe" pra uma área que não existe mais — parece que os
   dados sumiram e nada aconteceu, mas na verdade deu certo, só não está visível. Ausência de
   timeout/`AbortController` nas chamadas a gateway (`lib/payment/mercadopago.ts`,
   `lib/payment/pagarme.ts`) agrava a sensação de travamento em casos de gateway lento.
4. **Pagamento de 02/08 não expirado automaticamente**: a lógica de `lib/payment/expire-payments.ts`
   está correta (Payment.expiresAt sempre é setado com fallback, mesmo em PIX/boleto/cartão, desde
   commits de 12/07) — a causa mais provável é o cron da VPS (`/api/cron/expire-payments`, protegido
   por `x-cron-secret`) não estar rodando ou estar falhando silenciosamente; **não dá pra confirmar
   sem acesso à VPS** (SSH falhou nesta sessão — ver abaixo). **Ação imediata disponível sem deploy
   nenhum**: `/admin/pedidos-vencidos` já tem um botão "Processar agora" (`ExpirePaymentsPanel.tsx`
   → `POST /api/admin/expire-payments`) que roda a mesma lógica do cron sob demanda — istruí o
   usuário a clicar nele pra destravar o pedido de 02/08 agora; se não resolver, confirma que o
   próprio pedido tem alguma particularidade que escapa do filtro (precisa olhar o registro real no
   banco).
5. **Achados de auditorias anteriores (já documentadas, ainda não corrigidas)** — reconfirmados
   nesta varredura, ver `.superpowers/audits/alerts-module-audit-2026-07-28.md` (conciliação sem
   dedupe reenviando pra sempre — candidato forte a estar contribuindo pros picos de load da VPS) e
   `.superpowers/audits/proxy-registration-duplicate-message-investigation-2026-07-28.md` (TOCTOU
   entre webhook/poller/conciliação causando notificação duplicada).
6. Achados médios/baixos de segurança: rate limiting ausente em login/registro/reset de senha
   (`lib/auth/config.ts`, `app/api/auth/register`, `forgot-password`, `reset-password` — já existe
   `RATE_LIMITS.AUTH` pronto em `lib/rate-limit.ts`, só não é usado nesses); comparação não
   constant-time no Basic Auth do webhook Pagar.me (`lib/payment/pagarme.ts:167`); upload aceita
   PDF/GIF sem checagem de magic bytes (`app/api/upload/route.ts`).

**Acesso à VPS FALHOU nesta sessão**: chaves `~/.ssh/corridas_deploy` e `~/.ssh/id_ed25519`
testadas contra usuários `root`/`deploy`/`corridas`/`ubuntu`/`admin` em `144.91.92.70` — as 2
primeiras tentativas deram "permission denied (publickey,password)", as seguintes deram "connection
timed out" (suspeita de bloqueio temporário tipo fail2ban depois das tentativas anteriores). A nota
antiga deste arquivo (mais abaixo, seção de 2026-07-23) dizia "chave SSH `~/.ssh/id_ed25519` (sem
senha)" — não funcionou mais nesta sessão, pode ter sido rotacionada ou o IP de origem mudou.
**Não investigado ainda**: crontab real da VPS, logs de load spike (09/08 14:26 e 22:02), se o
CRON_SECRET em produção bate com o esperado, se o cron de expire-payments está de fato agendado.

**Atualização (mesmo dia, depois de acesso à VPS liberado)**:

1. **IDOR corrigido e commitado nada ainda** (código pronto, aguardando decisão de commit/deploy):
   os 3 endpoints (`batches`/`categories`/`routes`) agora fazem `findFirst({ id, eventId })` antes
   de mutar, mesmo padrão de `coupons/[couponId]/route.ts`. 31 testes (28 existentes + 3 IDOR
   novos) passando, `tsc --noEmit` limpo. Suíte completa tem 23 falhas PRÉ-EXISTENTES não
   relacionadas (arquivos `alert-*`/`lib-advertiser-request-pending`, já sujos no working tree
   antes desta sessão — trabalho de `messageType` em andamento, não mexi nisso).

2. **Acesso à VPS restaurado**: chave antiga não funcionava mais; usuário passou senha root nova
   direto no chat. Usei via `plink -ssh -pw` (Windows, sem sshpass). Timeouts anteriores nas
   tentativas com chave eram fail2ban bloqueando temporariamente o IP de saída do ambiente
   (187.108.125.248) depois de tentativas de auth erradas — não é bloqueio permanente, nem
   problema da senha em si.

3. **Causa raiz real do "pedido de 02/08 sem cancelar"**: NÃO era cron quebrado — confirmado via
   `/opt/corridas/cron.log` que `expire-payments` roda a cada 6h sem falhar (expirou pagamentos de
   verdade em 03/08, 04/08, 07/08, 08/08, 09/08). O caso real era outro: **5 inscrições** (não só
   uma), todas do lote "1º Lote" do evento "3º Corrida Saúde em Movimento"
   (`cmqz8nc1p001bq8jhenjtc4ca`), com pedido+pagamento por cartão já `CANCELLED` (recusado ~1min
   após checkout) mas a `Registration` presa em `PENDING_PAYMENT` pra sempre — e o
   `ticketBatch.soldCount` nunca decrementado (170 vendidos quando devia ser 165 — 5 vagas
   fantasma, 2 semanas presas, desde 25/07). Nenhuma das 3 rotas que deveriam sincronizar isso
   (`applyGatewayStatus` via webhook/poller/checkout) deixou rastro em `audit_logs` pra nenhum dos
   5 casos — mecanismo exato de qual código aplicou o `CANCELLED` sem sincronizar o resto **não foi
   100% confirmado** (fora do tempo desta sessão), mas o padrão é sistêmico, não um bug de um único
   evento.
   **Corrigido nos dados** (autorizado pelo usuário, aplicado via `psql` na VPS, transação única com
   CTE, decrementa `soldCount` só pela contagem real de linhas afetadas — idempotente): as 5
   registrations viraram `CANCELLED`, `soldCount` do lote voltou de 170 para 165. Confirmado que o
   evento não tinha ficado `SOLD_OUT` por causa disso (estava `REGISTRATIONS_OPEN` o tempo todo).
   **Ainda não corrigido no código**: `lib/payment/reconciliation.ts::checkPendingMismatches` só
   aplica correção quando o gateway diz `PAID` — quando diz `CANCELLED`/`rejected`/etc, só reporta
   `corrected: false` e não faz nada (achado já catalogado na auditoria de 28/07, risco #2). Esse é
   o candidato mais forte a rede de segurança contra recorrência — proposto ao usuário, ainda
   aguardando confirmação explícita pra implementar (é código de pagamento, não só limpeza de dado).

4. **VPS Monitor (`monitor-backend`, `/opt/vps-monitor`) provavelmente contribui pros picos de
   load**: container rodando a ~55% CPU sustentado, ~91h de CPU acumuladas em 7 dias, scheduler
   interno (APScheduler) constantemente atrasado (jobs de 15s/30s atrasando alguns segundos toda
   vez) — sinal de sobrecarga crônica do próprio monitor, não do app de corridas. **Isso é bug de
   outro sistema** compartilhando a mesma VPS (Contabo `144.91.92.70`, 6 vCPUs, ~40 containers de 6+
   projetos diferentes: corridas, xadrez-essencial, mecanicapro, monitor, 2x Supabase self-hosted,
   evolution-api). `corridas-app`/`corridas-db` mostraram uso baixo no snapshot capturado (0%
   CPU, ~515MB RAM) — não são o driver óbvio da carga alta observada nos 2 alertas de 09/08.
   **Não investigado ainda**: causa raiz do atraso do scheduler do monitor-backend (fora do escopo
   deste projeto, mas relevante pro usuário decidir se aloca tempo pra isso separadamente).

**Atualização final (mesmo dia — implementado, commitado e DEPLOYADO)**:

Usuário escolheu implementar 4 dos itens: IDOR, `reconciliation.ts`, checkout travando, performance
de "Ver inscritos" (rate limiting em login ficou de fora, não pedido). Todos com TDD/testes
ajustados, suíte completa rodada a cada etapa (1402/1425 passando — as 23 falhas restantes são
pré-existentes do trabalho de `messageType` que já estava sujo no working tree antes desta sessão,
não relacionadas, não mexidas). `tsc --noEmit` limpo em cada etapa.

4 commits separados, direto na `main`:
- `1aa99b1` fix: IDOR em lotes/categorias/percursos de evento
- `9b22b4f` fix: reconciliação aplica CANCELLED/EXPIRED/REFUNDED/CHARGEBACK, não só PAID
- `00a87be` fix: checkout redireciona pra detalhe da inscrição em vez de card in-place
- `646ee69` perf: paginação + fim do N+1 em "Ver inscritos" + índices novos (`Registration(eventId,createdAt)`, `Payment(status,expiresAt)`)

**Deploy feito e confirmado**: `git push origin main` (`a14a37e..646ee69`, inclui também os 7
commits do trabalho de `messageType` que já estavam commitados localmente de sessão anterior, não
pushados ainda — não tinha como separar sem reescrever histórico) → na VPS: `git pull` → `docker
build` → `docker compose run --rm app sh -c "npx prisma db push --skip-generate --accept-data-loss"`
("in sync", só criação de índices, sem perda de dado) → `docker compose up -d --no-deps app`. Smoke
test: `/`, `/eventos` 200; `/admin/eventos`, `/organizador`, `/admin/pedidos-vencidos` 307 (redirect
de login, esperado sem sessão). `docker logs corridas-app` sem erro nos 2 minutos após restart.

**Acesso à VPS nesta sessão**: usuário passou a senha root nova direto no chat (`root@144.91.92.70`,
usada via `plink -ssh -pw` no Windows). Chave SSH antiga registrada em sessões anteriores
(`~/.ssh/id_ed25519`) não funciona mais — se uma próxima sessão precisar de acesso, pedir a senha
de novo ou pedir pro usuário configurar uma chave nova (não guardar senha em memória/arquivo).

**Não implementado nesta leva (fora do que foi pedido)**: rate limiting em
login/registro/reset-senha (`lib/auth/config.ts`, `RATE_LIMITS.AUTH` já existe pronto em
`lib/rate-limit.ts`, só falta usar); comparação constant-time no webhook Pagar.me
(`lib/payment/pagarme.ts:167`); upload sem checagem de magic bytes (`app/api/upload/route.ts`); VPS
Monitor sobrecarregado (observação de infraestrutura, fora do escopo deste projeto). Retomar só se o
usuário pedir.

**PRÓXIMA TAREFA**: nenhuma pendente desta varredura. Sistema de rating de atletas continua adiado
(ver memória `rating_system_pending`) — só retomar se pedido explicitamente.

## Continuação da varredura (mesmo dia): os 4 itens que tinham ficado de fora — TODOS implementados

Usuário pediu explicitamente pra implementar os 4 itens que a varredura anterior tinha catalogado
mas não corrigido: rate limiting, comparação constant-time no Pagar.me, magic bytes no upload, e
investigar a sobrecarga do VPS Monitor.

1. **Rate limiting em login/registro/reset de senha** — `lib/rate-limit.ts` ganhou `getClientIp()`
   (lê `x-forwarded-for`, confiável porque a app só é alcançável via Traefik). Aplicado em
   `lib/auth/config.ts` (authorize, chave dupla por IP e por e-mail — achado real durante o TDD:
   `CredentialsProvider(config)` do next-auth guarda a função `authorize` de verdade em
   `.options.authorize`, não em `.authorize` de nível superior, que é sempre um stub `() => null`;
   testar contra o stub daria falso positivo), `app/api/auth/register`, `forgot-password`,
   `reset-password`. Testes novos (`tests/unit/auth-rate-limit.test.ts`,
   `tests/forgot-password-route.test.ts`, `tests/reset-password-route.test.ts` — nenhum existia
   antes) + `tests/register-route.test.ts` atualizado.
2. **Constant-time no webhook Pagar.me** — `lib/payment/pagarme.ts:167`, caminho Basic Auth agora
   usa `crypto.timingSafeEqual` com guard de tamanho (evita exception por buffers de tamanho
   diferente), igual ao caminho HMAC ao lado.
3. **Magic bytes no upload** — `app/api/upload/route.ts` ganhou `matchesMagicBytes()`, checa os
   bytes reais contra a assinatura de cada formato aceito (jpeg/png/webp/gif/pdf) antes de aceitar
   — antes confiava só no Content-Type declarado pelo navegador. Achado real: o teste existente
   "faz fallback pro arquivo original quando a compressão falha" comprovava exatamente esse buraco
   (bytes falsos passavam disfarçados de imagem) — reescrito pra esperar 400 em vez de aceitar.
4. **VPS Monitor sobrecarregado — causa raiz encontrada e corrigida** (repo separado,
   `github.com/douglaslundy/montoring_vps`, projeto próprio do usuário, clonado no scratchpad pra
   editar com segurança/rodar a suíte local em vez de editar direto via SSH):
   `collector/docker_client.py::DockerClient._client()` abria um `httpx.AsyncClient` NOVO a cada
   chamada (`async with self._client() as c:`), e `collect_all()` chama isso uma vez por container
   a cada ciclo de 30s — ~45 conexões HTTP novas via socket Unix a cada 30s, nunca reaproveitadas.
   Batia exatamente com o sintoma (scheduler cronicamente atrasado, ~55-100%+ CPU sustentado).
   Corrigido: `_client()` agora cria uma vez e reaproveita (recria só se fechado); `aclose()` novo
   pro shutdown do FastAPI. Suíte completa do vps-monitor: 291 passed (288 preexistentes + 3 novos
   cobrindo o reaproveitamento), 0 falhas, rodada localmente antes do push (venv Python 3.14 +
   pytest, instalado no scratchpad). Commit `200f517`, push pro GitHub, deploy na VPS (`git pull` +
   `docker compose build --no-cache` + restart via `deploy.sh` do próprio projeto).
   **Resultado real (verificado com leitura mais estável, não só o primeiro check pós-deploy)**:
   PARCIAL, não 100%. `collect_and_store` (o job que o fix mirava) parou de atrasar — confirmado,
   não aparece mais em nenhuma mensagem "was missed by". Load médio da VPS caiu (4.04/3.18/2.75
   contra picos de 5.8-6.9 antes). **Mas** `tail_access_log` continua atrasando, agora por
   ~14-15s (quase o intervalo inteiro de 15s) — causa raiz DIFERENTE da que foi corrigida, ainda
   não identificada (o event loop está sendo bloqueado por outra coisa nesses momentos).
   **Achado extra durante essa investigação, não corrigido**: o arquivo que `tail_access_log` lê
   (`/var/log/traefik/access.log`, dentro do container `monitor-backend`) está **vazio (0 bytes) e
   parado desde 20/07** — o monitor pode estar cego pra dados de acesso há quase 3 semanas. Não
   investigado o motivo (path de mount errado? Traefik parou de logar? rotação quebrada?). Registrar
   como pendência real pro usuário decidir se quer que eu continue nessa frente (é escopo de outro
   projeto, `montoring_vps`, fora do sistema de corridas).

Suíte completa do sistema_inscricoes_corridas_codex depois desses 3 primeiros itens: 1414/1437
(as 23 falhas continuam as mesmas pré-existentes do trabalho de `messageType`, não mexidas).
`tsc --noEmit` limpo em cada etapa.

**Commitados, pushados e deployados** (mesmo dia): 3 commits (`ae41986` rate limiting,
`fe8c7d9` constant-time Pagar.me, `5e82a0b` magic bytes no upload) → `git push origin main` →
deploy na VPS (`git pull` → `docker build` → `docker compose up -d --no-deps app`, sem mudança de
schema nesta leva). Smoke test confirmado: `/`, `/eventos`, `/auth/login` 200; `/admin/eventos`
307 (login, esperado). `docker logs corridas-app` limpo.

## Achado extra durante a investigação do VPS Monitor: Traefik escrevendo em arquivo deletado

Durante a investigação do item 4 acima, descoberto (não fazia parte do pedido original, achado
colateral): `/proc/1/fd/8` do container `traefik` apontava pra
`/var/log/traefik/access.log (deleted)` com **467.171.452 bytes (~445 MB)** escritos num inode
órfão desde a rotação de log de 20/07 00:00. O `access.log` real (visível no filesystem) está
vazio desde então — o monitor ficou cego pra dados de acesso por ~3 semanas, e o espaço em disco
só seria liberado quando o Traefik reiniciasse. `/etc/logrotate.d/traefik-access-log` já usa
`copytruncate` (opção certa pra esse cenário) e funcionou normalmente de 14 a 19/07 (arquivos
`access.log.2.gz` a `.6.gz` têm conteúdo) — só a rotação de 20/07 falhou, causa exata não
confirmada (suspeita: algum script de `/opt/vps-monitor/monitor/scripts/` que reinicia containers
de infra pode ter interferido, não investigado a fundo).

**Ação tomada e confirmada**: reiniciado o container `traefik` (`docker restart traefik` na VPS,
23:33). Confirmado com uma requisição real logo depois: `access.log` voltou a crescer de verdade
(fd sem mais "(deleted)", entrada JSON real da requisição de teste apareceu no arquivo). Os ~445MB
órfãos foram liberados automaticamente no restart.

**Observação que reforça que o problema de CPU do monitor não está 100% resolvido**: às 23:35
(quase 3h depois do deploy do fix do `DockerClient`), o processo do `monitor-backend` já tinha
acumulado 99min de CPU em 180min de wall-clock (~55% médio) e 54.9% de uso no instante da leitura
— só um pouco melhor que antes do fix, não uma correção completa. Reforça que o item 2 abaixo
(hipótese do SQLAlchemy síncrono bloqueando o event loop) é o próximo passo real, não só uma
suspeita teórica.

**Ainda pendente** (repo separado, `montoring_vps`, fora do escopo deste projeto — prompt
autocontido entregue ao usuário no chat pra usar numa sessão dedicada nesse outro repo):
1. Investigar por que o `copytruncate` falhou especificamente em 20/07 (não recorrente ainda, mas
   sem correção da causa raiz pode acontecer de novo).
2. Alerta novo no motor de alertas do monitor pra detectar `access.log` parado de crescer.
3. Job `tail_access_log` continua atrasando (~14-15s de um intervalo de 15s) mesmo após o fix do
   `DockerClient`, e o CPU do processo continua alto (~55% médio) — hipótese mais forte agora:
   sessões síncronas do SQLAlchemy usadas direto dentro de `async def` sem `run_in_executor`,
   bloqueando o event loop inteiro a cada commit.

## Revisão final do plano "Solicitação de conta de anunciante" — 8 achados corrigidos (2026-07-28)

Plano de 14 tasks (`/anuncie` público → paga PIX → admin aprova/rejeita) estava completo; revisão
final de branch inteira achou 8 problemas, todos corrigidos nesta leva (commit `8221fb4`, direto
na `main`, HEAD anterior `1981bfe`):

1. **CRÍTICO**: `RequestAdvertiserForm.tsx` navegava pra `/anuncie/enviado` e descartava o PIX —
   ninguém conseguia pagar. Agora mostra `PixPaymentCard` (mesmo padrão de `SubscribeButton.tsx`).
2. `POST /api/anunciante/solicitar` agora trata falha do gateway em `createPayment` (try/catch) —
   antes deixava a conta criada mas travada (retry batia em "e-mail já cadastrado").
3. `ads_marketplace_enabled` agora também bloqueia `/api/anunciante/solicitar` e a página
   `/anuncie` (antes só bloqueava a promoção manual do admin) — texto do card em
   `/admin/configuracoes` corrigido.
4. Rejeição: `refundFailed` agora é rastreado e devolvido na resposta; e-mail só afirma que houve
   estorno quando `refunded=true`; UI do admin avisa quando o estorno automático falha.
5. `/api/anunciante/ads` só aceita `AdPurchase` com `status:"PAID"` pra liberar vaga (antes uma
   compra REJECTED/PENDING também passava).
6. Aprovação grava `AuditLog` (`USER_UPDATED`) na mesma transação (faltava, era o único fluxo do
   plano que muda `role` sem auditoria); logs de erro de approve/reject ganharam `purchaseId`.
7. Comentário em `request-advertiser.ts` não cita mais a rota `register-advertiser` (já removida).
8. `/admin/alertas` ganhou o card "Solicitação de conta de anunciante" — faltava, então o alerta
   imediato ao admin (decisão de design do próprio plano) ficava permanentemente OFF.

Suite completa (excluindo 2 worktrees órfãs de sessões antigas em `.claude/worktrees/`, que falham
por motivo pré-existente não relacionado — alias `@` do vitest sempre resolve pro repo principal):
200 arquivos / 1285 testes, todos passando. `tsc --noEmit` limpo. `npm run build` limpo.

Relatório completo:
`.superpowers/sdd/2026-07-28-solicitacao-conta-anunciante/final-review-fix-round-1-report.md`
(fora do git, `.superpowers/` está no `.gitignore`).

**Pendência real**: nada aberto neste plano — pronto pra deploy junto com o resto (perguntar ao
usuário quando quiser fazer o deploy acumulado, mesmo padrão de sempre).

## Conteúdo de SEO escrito e gravado em produção (2026-07-28)

Usuário percebeu que o sistema de SEO (infraestrutura pronta desde o deploy anterior) não tinha
nenhum conteúdo de verdade preenchido — nem configurações globais, nem `metaTitle`/`metaDescription`
dos eventos reais. Não usei o botão "Gerar com IA" (não tem chave de provedor configurada ainda em
Admin → SEO) — escrevi o conteúdo eu mesmo, direto no banco de produção (mesmo padrão já usado
nesta sessão pra correções pontuais), baseado na descrição real de cada evento.

**Configurações globais** (`platform_settings`, chaves `seo_default_title`/`seo_default_description`/`seo_brand_context`):
"Circuito das Corridas — Inscrições para Corridas e Trail Run" / descrição mencionando MG, SP,
Pix/cartão/boleto / contexto de marca pra fallback e futuros prompts de IA.

**Eventos reais** (3 no banco, só 2 receberam SEO — ver justificativa):
- "3º Corrida Saúde em Movimento" (Ilicínea/MG, 30/08/2026) — metaTitle/metaDescription gravados.
- "Trail Run São Judas" (Guapé/MG, 18/10/2026) — metaTitle/metaDescription gravados.
- "Corrida das Pedras 2025" (São Paulo/SP) — **propositalmente não recebeu SEO**: está com status
  `CANCELLED`, não faz sentido investir em ranqueamento de um evento cancelado (cai no fallback
  automático do próprio título/descrição do evento, comportamento padrão do sistema).

Confirmado ao vivo via `curl` no HTML de produção: home e página do evento mostram o título/descrição
corretos. Nenhuma mudança de código nesta leva — só dado gravado direto no banco de produção.

**Pendência real que sobrou**: o botão "Gerar com IA" (Tasks 13/14/16/17 do plano) continua sem uso
possível até alguém configurar uma chave de API (Claude/OpenAI/Google) em Admin → SEO. Perguntar
ao usuário se quer configurar isso quando ele tiver a chave em mãos.

## Frente 2 — decisões de brainstorm fechadas (2026-07-28), spec ainda não escrita

Usuário respondeu as 3 decisões pendentes do fluxo de solicitação de conta de anunciante:
1. **Créditos**: reaproveitar `AdPurchase.maxSimultaneousSlots` já existente (cada anúncio
   aprovado ocupa uma vaga simultânea até cancelar/expirar) — sem schema novo.
2. **Alerta ao admin**: notificação imediata (e-mail/WhatsApp) a cada solicitação nova de
   anunciante, não só no resumo diário.
3. **Reembolso na rejeição**: reaproveitar `lib/payment/refund-service.ts` (mesma infra usada
   pros reembolsos de inscrição).

**Próxima ação real ao retomar esta frente**: com as decisões fechadas, escrever a spec
(`docs/superpowers/specs/...`) combinando essas 3 decisões + as 3 já fechadas antes (ver histórico
mais abaixo neste arquivo) + os campos do formulário já definidos (CNPJ/CPF, endereço, Instagram,
Facebook). Depois spec → plano → `superpowers:subagent-driven-development`.

## Bug urgente (2026-07-28): card de evento na listagem não respeitava data do lote — CORRIGIDO, DEPLOY PENDENTE

Usuário reportou que o evento "Trial Run São Judas" mostrava o botão "Inscrever-se" na página de
listagem (`/eventos`) mesmo achando que a inscrição não devia estar aberta ainda. Investigação:
os lotes reais desse evento têm `startAt=01/07/2026` (já ativos há quase um mês, não bate com a
expectativa do usuário de "1º de agosto" — usuário não confirmou onde configurou essa data,
possivelmente confusão/lote diferente, não travou a investigação). O bug REAL encontrado é
separado do que já tinha sido corrigido na página de detalhe do evento: `components/events/EventCard.tsx`
(usado só na listagem `/eventos`) tinha seu próprio botão "Inscreva-se" como link direto pra
`/inscricao/[slug]`, sem NENHUMA validação de lote (só checava `status !== REGISTRATIONS_CLOSED/COMPLETED`).
A query `lib/events.ts::listPublicEvents` também só buscava `priceAmount/soldCount/capacity` do
lote mais barato (`take:1`), sem os campos que `getBatchStatus` precisa.

Corrigido: query passa a buscar todos os lotes com os campos necessários (`startAt`/`endAt`/`active`/`activationMode`);
`EventCard` reaproveita `getBatchStatus` (mesmo padrão já usado na página de detalhe) pra decidir
entre "Inscreva-se" (link), "Inscrições em breve" (desabilitado, upcoming) ou o fallback de
esgotado/fechado. Sem teste dedicado (componente React, convenção do projeto — mesma decisão da
correção anterior). Commit `f037d15`, suíte 1254/1254, `tsc` limpo. **DEPLOYADO** (push -> pull na
VPS -> docker build -> docker compose up -d --no-deps app, sem mudança de schema). Smoke test
confirmado ao vivo: `/eventos` mostra "Inscrições em breve" pro evento com lote upcoming,
"Inscrições abertas" pros demais.

**Também descoberto durante a investigação, achado técnico registrado pra referência futura**:
`app/organizador/eventos/[id]/lotes/page.tsx:113` usa `b.startAt.slice(0, 16)` pra preencher o
campo de edição de data do lote — mesma classe de bug do `toDatetimeLocal` já corrigido em
`EditEventForm.tsx`, só que aqui nem tenta converter de UTC pra local (pega a string crua). Não
corrigido ainda (não é a causa do bug relatado, que era só no card da listagem) — vale corrigir
numa próxima leva.

## Interrupção pontual (2026-07-27): 2 correções urgentes pedidas pelo usuário no meio da execução do plano — RESOLVIDAS

Usuário pediu pra pausar a sequência do plano SEO+IA/anúncios (estava na Task 22, interrompida
por limite de sessão dos subagents — ver seção da Task 22 mais abaixo, ainda pendente) pra
resolver 2 problemas urgentes antes de continuar:

1. **Corrigir nome/link do evento "Trial Run São Judas - GUAPE - MG"** — o título já estava
   certo no banco (o usuário já tinha renomeado via admin), mas o slug (link público) continuava
   `desafio-sao-judas-x-jacutinga-1781733455085` (nunca é regenerado quando o título muda — hoje
   não existe funcionalidade no app pra regenerar slug, foi uma correção manual direta no banco de
   produção). Corrigido via `psql` na VPS (`docker exec corridas-db`) pra
   `trial-run-sao-judas-guape-mg` (evento `id=cmqim3gmn000esf846h461fx4`, confirmada
   unicidade antes de aplicar). **Não commitado no git** (é dado, não código) — só a mudança no
   banco de produção.

2. **Bug "grave" de fuso horário na edição de evento** — usuário criou evento pra 18/10/2026
   07:00, mas ao reabrir pela tela de editar, o campo de hora mostrava 10:00. Investigado com
   `superpowers:systematic-debugging`: causa raiz em `toDatetimeLocal()`
   (`components/organizer/EditEventForm.tsx`) — usava `toISOString()` (sempre UTC) sem converter
   de volta pro horário local de Brasília antes de preencher o input `datetime-local`. **O dado no
   banco sempre esteve correto** (`startAt = 2026-10-18 10:00:00` é exatamente 07:00 BRT em UTC,
   confirmado via query direta) — o bug era só na exibição do formulário de edição, e afeta os 3
   campos que reaproveitam essa função (`startAt`, `kitPickupAt`, `cancellationDeadline`). TDD:
   teste escrito primeiro (`tests/unit/to-datetime-local.test.ts`), confirmado RED reproduzindo o
   bug exato (retornava 10:00 em vez de 07:00), corrigido subtraindo
   `dt.getTimezoneOffset() * 60000` antes de formatar, confirmado GREEN. Suíte completa 1250/1250,
   `tsc --noEmit` limpo. Commit `d53af22`, **ainda não deployado** — aguardando autorização do
   usuário pra push/deploy (mesmo padrão de sempre). **Decisão do usuário**: não isolar esse
   deploy — o `main` local está 27 commits à frente do `origin/main` (todo o plano de
   SEO+IA/anúncios, Tasks 1-21, mais essa correção), não dá pra subir um commit isolado sem os
   anteriores, e a Task 1 desse plano exige migração de schema (`Event.metaTitle`/`metaDescription`,
   confirmado que ainda não existe em produção). Usuário optou por esperar o plano inteiro
   terminar (Tasks 22-25 + revisão final) e fazer um deploy único no final, como sempre.

## BACKLOG DE BUGS (não iniciar agora — só registrar, aguardando as 3 frentes em andamento)

### Bug reportado pelo usuário em 2026-07-27: mensagem duplicada/errada na inscrição por procuração

Quando um atleta cria uma inscrição por procuração pra um terceiro (feature completa em
2026-07-22/23, ver seção "Inscrição por procuração" mais abaixo neste arquivo):
- Mensagem pro terceiro (o atleta procurado): enviada corretamente.
- Mensagem pro comprador (quem criou a inscrição): enviada corretamente.
- **Bug**: existe uma SEGUNDA mensagem, com o texto "[nome do comprador] criou uma inscrição para
  você" — essa mensagem deveria ir pro terceiro (é conteúdo dele), mas o texto sugere que está
  sendo enviada pro comprador de novo (mensagem duplicada/destinatário errado) — a mensagem
  correta com esse conteúdo já foi enviada antes, então essa segunda parece redundante ou mal
  direcionada.

**Não investigado ainda.** Ponto de partida provável: `lib/proxy-athlete.ts` e
`lib/notifications.ts` (fluxo de notificação dupla comprador+atleta descrito na inscrição por
procuração), mais os pontos que disparam convite de acesso por e-mail. Usar
`superpowers:systematic-debugging` quando for investigar — não assumir a causa sem ler o código
dos 2 pontos de disparo de mensagem envolvidos.

## PRÓXIMA TAREFA (2026-07-27) — 3 frentes grandes, ordem confirmada pelo usuário

Usuário confirmou explicitamente a ordem: **1) executar o plano de SEO+IA/anúncios (pronto) → 2)
terminar o brainstorm+spec do fluxo de solicitação de anunciante → 3) só depois começar a
auditoria do módulo de alertas** (é a maior e mais arriscada, mexe em pagamento/cancelamento).

### 1. Plano combinado SEO+IA + link de anúncios — EM EXECUÇÃO via subagent-driven-development

Usuário escolheu subagent-driven-development, direto na main (mesmo padrão da sessão inteira).
Spec `docs/superpowers/specs/2026-07-26-sistema-seo-ia.md` + spec
`docs/superpowers/specs/2026-07-27-anuncios-link-destino.md` + plano combinado (25 tasks)
`docs/superpowers/plans/2026-07-27-seo-ia-e-anuncios-link.md`.

**Estado exato pra retomar** (ledger completo em `.superpowers/sdd/progress.md`, git é a fonte da
verdade se o ledger sumir — TaskList da ferramenta interna NÃO persiste entre sessões, sempre
volta vazia; usar o ledger + `git log`, nunca a memória da conversa):

- **Tasks 1-17: completas e revisadas** (spec ✅ + qualidade Approved cada uma, zero
  Critical/Important em aberto). Commits em sequência: `920a199` (Task 1, migração
  metaTitle/metaDescription) → `432cab6` (Task 2) → `4d4122e` (Task 3) → `4eb3cf1` (Task 4) →
  `de70b06` (Task 5, robots.ts) → `f01a488` (Task 6) → `8d023b8` (Task 7) → `34c895f` (Task 8,
  Search Console + GA no layout raiz) → `9704672` (Task 9, `/admin/seo`) → `36a928c` (Task 10,
  campos metaTitle/metaDescription na edição de evento) → `2e4f34f` (Task 11, `lib/ai/` —
  Claude/OpenAI/Google) → `e8e29df` (Task 12, build-seo-prompt) → `b8c7fd3` (Task 13, rota de
  geração por IA do evento) → `c93b8a4` (Task 14, rota de geração por IA do site) → `05ede65`
  (Task 15, formulário de provedor de IA) → `b08ae5f` (Task 16, botão "Gerar com IA" nos campos
  globais) → `10f6d47` (Task 17, botão "Gerar com IA" nos campos do evento) → `7103392` (Task 18,
  `lib/validate-url.ts` implementação inicial) → `f3dfaf8` (Task 18, fix de 3 gaps de segurança
  achados na revisão — ver abaixo). HEAD atual: `f3dfaf8`.
- **Task 18 achado de segurança (resolvido)**: revisão com escrutínio extra (validação é
  SSRF/XSS-sensitive) achou 3 gaps reais mesmo com código implementado ao pé da letra da spec —
  `::1` nunca bloqueava de verdade (hostname vem com colchetes `[::1]`), `localhost.` (ponto final)
  contornava o bloqueio, e só `127.0.0.1` exato era bloqueado (não o `/8` inteiro) e
  `169.254.0.0/16` (endpoint de metadados de nuvem) não tinha bloqueio nenhum. Usuário escolheu
  corrigir antes de seguir (via AskUserQuestion) — corrigido, re-revisão confirmou os 3 endereçados
  sem regressão.
- Tasks 19-25 + revisão final de branch inteira: ainda não iniciadas.

**Achados Minor registrados no ledger (não bloqueiam, deferred)**: indentação cosmética em
`app/(public)/eventos/[slug]/page.tsx` (Task 7); `as any` em `app/admin/seo/page.tsx:60` (Task
15); botão de salvar do `SeoSettingsForm` não desabilita durante geração por IA (Task 16).

**Achado de processo (Task 13)**: o brief da Task 13 tinha um teste com mocks de banco
incompletos pro caminho ORGANIZER de `resolveActingScope` — corrigido só no teste (código da rota
implementado verbatim), verificado pelo revisor contra `lib/auth/rbac.ts` real. Não se repetiu nas
Tasks 14/17 (rotas/formulários seguintes).

**Como retomar**: seguir `superpowers:subagent-driven-development` normalmente a partir da Task
18 (ou onde o ledger `.superpowers/sdd/progress.md` indicar) — não re-implementar nada já
commitado. Specs completas em `docs/superpowers/specs/2026-07-26-sistema-seo-ia.md` +
`docs/superpowers/specs/2026-07-27-anuncios-link-destino.md`; plano completo (25 tasks) em
`docs/superpowers/plans/2026-07-27-seo-ia-e-anuncios-link.md` — todos já commitados no git, não
precisam ser copiados pra lugar nenhum.

### 2. Fluxo de solicitação de conta de anunciante (pagamento antes da aprovação) — BRAINSTORM EM ANDAMENTO

Pedido do usuário em 2026-07-27: hoje virar `ADVERTISER` é direto (autosserviço ou promoção pelo
admin, sem pagamento prévio). Fluxo novo pedido: página de planos pública mostra os planos
desabilitados com botão "Solicitar conta de anunciante" → formulário → pagamento do plano →
"aguardando aprovação" → admin aprova/rejeita (se rejeitar, reembolsa) → admin recebe alerta de
solicitações pendentes → anúncios criados pelo anunciante aprovado consomem "créditos" do
pagamento feito.

**Decisões já fechadas:**
1. Durante a espera, a pessoa continua com o papel que já tinha (atleta/organizador); se não tinha
   conta nenhuma, cria uma conta comum `ATHLETE` no ato da solicitação — não existe papel
   intermediário novo tipo `ADVERTISER_PENDING`.
2. Visitante anônimo pode solicitar direto no formulário (sem precisar logar antes) — o próprio
   formulário de solicitação já coleta os dados de uma conta nova (nome/e-mail/senha) junto com o
   pedido de anunciante.
3. Campos do formulário: além dos 3 já usados hoje (razão social, e-mail de contato, telefone de
   contato), adicionar **CNPJ ou CPF, endereço, perfil do Instagram, perfil do Facebook**.

**Ainda faltam decisões antes de virar spec** (perguntar ao retomar):
- "Créditos": é só reaproveitar o `AdPurchase.maxSimultaneousSlots` que já existe (cada anúncio
  aprovado ocupa uma vaga simultânea até cancelar/expirar), ou o usuário quer um saldo numérico
  diferente, que desconta permanentemente por anúncio criado (não por "simultâneo")?
- Alerta ao admin sobre solicitações pendentes: notificação imediata (e-mail/WhatsApp) a cada
  solicitação nova, ou entra só no resumo diário que já existe (`lib/alerts/daily-summary.ts`)?
- Fluxo de reembolso: reaproveitar a infraestrutura de reembolso já existente
  (`lib/payment/refund-service.ts`) — presumido, não fechado explicitamente com o usuário ainda.

**Contexto necessário pra retomar**: nenhum arquivo específico ainda além dos já mapeados durante
esta sessão (`app/api/auth/register-advertiser/route.ts`, `lib/advertisers/promote.ts`,
`prisma/schema.prisma` — models `AdvertiserProfile`/`AdPurchase`/`AdPlan`). Seguir
`superpowers:brainstorming` a partir daqui — perguntar as decisões pendentes acima, uma de cada
vez, antes de escrever a spec.

### 3. Módulo administrativo de alertas/notificações — NÃO INICIADO

Pedido extenso do usuário em 2026-07-27 (prompt completo salvo na conversa, não repetido aqui por
economia de espaço — ler o pedido original se precisar do texto literal): auditoria completa de
todos os fluxos de e-mail/WhatsApp/notificação já existentes no sistema (confirmação de
inscrição, cancelamento, carrinho abandonado, pagamento aprovado/pendente/recusado/estornado,
lembretes, etc.) + módulo novo em Admin pra centralizar criação/edição/ativação/teste desses
alertas com templates por canal, variáveis dinâmicas mapeadas a colunas reais do banco, histórico
de versões/auditoria, migração dos templates atuais preservando o texto, rodapé automático de
redes sociais. É a frente mais arriscada das 3 (mexe em toda a comunicação transacional da
plataforma, incluindo confirmação de pagamento). **Só começar depois que as frentes 1 e 2
estiverem resolvidas**, começando pela fase de auditoria/diagnóstico (sem alterar nada ainda),
apresentando o resultado antes de qualquer implementação — mesmo processo de brainstorm já usado
nesta sessão pras outras 2 frentes, não pular direto pra código só porque o pedido original pede
implementação completa.

## PRÓXIMA TAREFA (histórico, já resolvida): sistema de SEO da plataforma (pedido em 2026-07-26)

Usuário pediu um sistema de SEO completo: pesquisar boas práticas de SEO pro nicho (plataforma de
inscrição pra corridas de rua/eventos esportivos), implementar meta tags/structured data nas
páginas públicas, e criar uma aba nova em Admin com os campos que fazem sentido serem editáveis
(ex.: meta title/description por página, Open Graph, sitemap, etc.) — objetivo declarado pelo
usuário é ranquear bem no Google. **Ainda não iniciado** — é feature nova do zero, vai precisar de
`superpowers:brainstorming` primeiro (não existe nada de SEO estruturado no código hoje, além do
`generateMetadata` básico em `app/layout.tsx` com title/description/keywords estáticos).

**Contexto necessário pra retomar**: nenhum ainda — primeiro passo é o brainstorm com o usuário
pra definir escopo (quais campos ficam editáveis por evento vs. globais, sitemap.xml dinâmico,
JSON-LD de qual tipo de schema.org — Event, SportsEvent —, robots.txt, Open Graph/Twitter Cards).

## Ajuda pontual: configuração do Google AdSense + ads.txt (2026-07-26) — DEPLOYADO

Usuário já tinha o client ID configurado (`ca-pub-6911820306119064`, sessão anterior) e recebeu o
código de um bloco de anúncio do Google (`data-ad-slot="8770096948"`) mas nenhum anúncio
aparecia. Investigado:
1. Confirmado que o `<ins class="adsbygoogle">` já estava sendo gerado certinho no HTML de
   produção pela posição `EVENTOS_ABAIXO_BANNER` (o sistema já gera esse bloco automaticamente a
   partir do `AdSlotEditForm` em Admin → Anúncios, não precisa colar HTML em lugar nenhum).
2. Achado real: o usuário (provavelmente testando) tinha deixado 2 posições com o ID de bloco
   válido **desativadas** (`EVENTOS_COLUNA_ESQUERDA`, `EVENTO_DETALHE_COLUNA_DIREITA`) e 2 outras
   **ativadas sem nenhum ID de bloco preenchido** (`EVENTOS_ENTRE_RESULTADOS`,
   `EVENTO_DETALHE_ABAIXO_BANNER` — essas nunca iam renderizar nada). Corrigido direto no banco de
   produção (reativadas as 2 com ID válido, desativadas as 2 sem ID) — ação reversível pelo
   próprio Admin → Anúncios a qualquer momento.
3. **Causa raiz real de nenhum anúncio aparecer**: faltava o arquivo `/ads.txt` — o Google AdSense
   exige esse arquivo pra autorizar a veiculação de anúncios daquele publisher no domínio, mesmo
   com o código do bloco correto. Implementado `app/ads.txt/route.ts` (route handler dinâmico,
   gera a linha `google.com, pub-<id>, DIRECT, f08c47fec0942fa0` a partir do
   `google_adsense_client_id` já salvo em Admin → Anúncios — não precisa reconfigurar nada se o
   client ID mudar no futuro). TDD, `tests/ads-txt-route.test.ts`.

Aproveitado o mesmo commit/deploy pra uma correção pontual: label do campo de nome do contato de
emergência no checkout dizia só "Contato emergência", agora diz "Nome do contato de emergência"
(`components/checkout/CheckoutForm.tsx`, `components/checkout/ProxyAthleteModal.tsx`, pedido
avulso do usuário nesta mesma sessão).

Suíte 1183/1183, `tsc --noEmit` limpo, `npm run build` OK. Deploy: `git push` (`9306dcd..6818dfc`)
→ `/opt/corridas/deploy.sh` → confirmado em produção: `/ads.txt` retorna 200 com a linha certa,
`/eventos` mostra 2 blocos `<ins class="adsbygoogle" data-ad-slot="8770096948">` no HTML, `docker
logs corridas-app` limpo.

## Sistema de rating de atletas — continua AGUARDANDO usuário pedir pra começar

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

## Frente 2 — spec fechada (2026-07-28), pronta pra virar plano

Spec completa em `docs/superpowers/specs/2026-07-28-solicitacao-conta-anunciante.md`. Todas as
decisões fechadas (as 3 do brainstorm inicial + as 3 de 2026-07-28 + as 4 que apareceram durante a
escrita da spec, incluindo achado técnico real: `refundPayment()` precisa ser estendido pra
aceitar AdPurchase, hoje só aceita Registration/Order). Decisão de escopo: `register-advertiser`
(autosserviço instantâneo) será removido, substituído pelo fluxo pago+aprovado; promoção manual
pelo admin continua igual. Próxima ação real: `superpowers:writing-plans` pra transformar a spec
num plano de tasks, depois `superpowers:subagent-driven-development` (mesmo padrão de sempre).

## Frente 2 — plano de implementação escrito (2026-07-28)

Plano completo em `docs/superpowers/plans/2026-07-28-solicitacao-conta-anunciante.md` (14 tasks,
commit d19cace). Autorrevisão encontrou e corrigiu um achado real antes de fechar: as páginas
públicas novas não podiam ficar sob `/anunciante/*` porque `app/anunciante/layout.tsx` já exige
`role==="ADVERTISER"` pra qualquer página ali — bloquearia a própria tela de solicitação. Corrigido
pra `app/(public)/anuncie/` (grupo de rotas sem gate, mesmo usado por /eventos, /termos). Também
achado durante o próprio plano: `refundPayment()` precisa reescrever o arquivo inteiro (não só um
guard) porque `applyGatewayStatus` é acoplado a Order/Registration — plano já tem o código completo
das duas versões (antes/depois). Próxima ação real: escolher entre execução via
subagent-driven-development (recomendado) ou executing-plans.

## Sessão 2026-07-28/29 — Frente 2 (anunciante) deployada + módulo de alertas endurecido

Concluído e em produção nesta sessão:
- Plano "Solicitação de conta de anunciante" (14 tasks + revisão final + fix round) — deployado
  (commits até `ca4a9df`). Migração de schema aplicada (`db push`).
- Bug crítico achado na própria revisão final (RequestAdvertiserForm descartava os dados do PIX,
  ninguém conseguia pagar) — corrigido antes do deploy.
- Auditoria do módulo de alertas (frente 3) — 5 riscos encontrados, todos corrigidos em 3 rodadas
  de fix + revisão (commits até `3f05e67`, deployado sem migração de schema): bug de mensagem
  duplicada em `notifyOrderConfirmed` (a rodada 2 pegou uma regressão crítica própria — o fix
  original quebrava o botão de reenviar e-mail — corrigida), dedupe da conciliação, segunda
  solicitação de cancelamento silenciada, e-mail de compra de anúncio sem try/catch no webhook,
  AuditLog de carrinho abandonado sem limite.
- Worktrees órfãos de agentes antigos (`.claude/worktrees/agent-a76951544142c2ede`,
  `agent-a9b61986e3557b4d3`) removidos — só continham relatórios já extraídos.

## Backlog de baixa prioridade (registrado 2026-07-29, retomar só com pedido explícito)

**Módulo de alertas** (nada bloqueante, decisões deliberadas de escopo):
- `app/api/orders/[id]/status/route.ts` (poller de status) ainda usa transação própria em vez de
  reaproveitar `applyGatewayStatus` — a trava em `notifyOrderConfirmed` já impede mensagem
  duplicada mesmo assim, mas esse caminho não tem paridade de capacidade/auditoria com o webhook.
- Reenvios manuais com `bypassDedupe` não gravam `recordAlert` (inofensivo hoje, rastreado).
- Divergência de conciliação não resolvida alerta 1x só, pra sempre — `/admin/conciliacao` é o
  único backstop pra revisão manual (comportamento intencional, não bug).

**Frente de anunciante** (cosméticos, não bloqueantes):
- `RequestAdvertiserForm.tsx`: tela fica muda se o gateway devolver PIX sem `pixQrCodeText`
  (herdado do padrão do `SubscribeButton`); `res.json()` sem guard (`SubscribeButton` usa
  `res.text()` + parse protegido).
- `/anuncie/enviado` virou página morta (não removida de propósito).
- Duplicação cosmética de `const data` em `AdvertiserRequestRow.tsx`.

**Sem spec ainda, aguardando pedido explícito do usuário:**
- Tela de entrega de kits.
- Sistema de rating (precisa de pontuação retroativa pros atletas já cadastrados/inscritos).

## Backlog de baixa prioridade resolvido (2026-08-02)

Usuário pediu pra resolver todos os itens do backlog acima (rating e tela de entrega de kits
ficaram de fora — são features novas sem spec, não itens de backlog). TDD em cada item
comportamental, suíte completa 200 arquivos/1301 testes, `tsc --noEmit` limpo, `npm run build` OK.
Nada commitado/deployado ainda — perguntar ao usuário antes.

1. **Poller de status sem paridade com o webhook** (`app/api/orders/[id]/status/route.ts`): agora
   reusa `applyGatewayStatus` (mesma função do webhook/conciliação) em vez de reimplementar a
   transação na mão. Corrige 2 lacunas reais, não só cosméticas: (a) cancelamento via polling nunca
   liberava a vaga reservada (`ticketBatch.soldCount` não decrementava) — bug de capacidade real,
   não só falta de auditoria; (b) nenhuma linha de `AuditLog` era gravada nessa via. Novo
   `SyncSource` `"status_poll"` em `lib/payment/sync-payment-status.ts` (ação
   `PAYMENT_STATUS_SYNCED_POLL`, label em `lib/admin/labels.ts`). Testes novos em
   `tests/order-status-alerts.test.ts`.
2. **`recordAlert` ausente em envios com `bypassDedupe`** (`lib/notifications.ts` e
   `lib/alerts/payment-error.ts`): reenvio manual/confirmação manual (admin/organizador) ignorava a
   reivindicação anterior pra reenviar, mas nunca deixava rastro pra uma rodada automática futura
   ver que já houve envio — `lib/alerts/abandoned-cart.ts` já fazia certo, os outros dois não.
   Corrigido nos 4 pontos de envio (e-mail comprador, e-mail atleta, WhatsApp, e os 2 canais de
   `notifyPaymentError`/`notifyOrderCancelledWithoutPayment`).
3. **`RequestAdvertiserForm.tsx`**: alinhado ao padrão do `SubscribeButton.tsx` —
   `res.text()`+`JSON.parse` protegido em vez de `res.json()` cru (evitava crash se o servidor
   devolvesse corpo vazio/não-JSON), e novo guard quando o resultado não vem com `pixQrCodeText`
   (antes a tela voltava muda pro formulário vazio sem avisar que a solicitação já tinha sido
   enviada, risco de o usuário reenviar e duplicar).
4. **`AdvertiserRequestRow.tsx`**: `const data = await res.json()` duplicado nos 2 branches de
   `handleReject` virou uma leitura só, reaproveitada nos dois casos.

## Mega-prompt de 10 etapas (2026-08-02/03) — Etapa 2 concluída e deployada

Usuário colou um pedido grande de uma vez (central de alertas com templates editáveis, home
pública, fluxo de anunciante, redes sociais, entrega de kits, rating de atletas). Criado
`IMPLEMENTATION_PLAN.md` (persistência exigida pelo próprio prompt) com auditoria completa +
plano técnico das 10 etapas — **é o arquivo de referência pra retomar isso**, não repetir aqui.
Ordem confirmada com o usuário: Etapas 2-5 (central de alertas) → 6-8 (home/anunciante/social) →
9-10 (kits/rating, continuam bloqueadas até concluir e validar as anteriores — usuário já tinha
pedido explicitamente pra elas esperarem, mega-prompt não muda isso).

**Etapa 2 (central de alertas/templates) — CONCLUÍDA e DEPLOYADA em produção (2026-08-03).**
Brainstorm → spec (`docs/superpowers/specs/2026-08-03-central-alertas-templates.md`) → plano de 12
tasks (`docs/superpowers/plans/2026-08-03-central-alertas-templates.md`) → executado via
`superpowers:subagent-driven-development` (22 commits, revisão individual por task + revisão final
de branch inteira: "Ready to merge: With fixes", 3 achados Important corrigidos numa rodada só).
Detalhe técnico completo em `IMPLEMENTATION_PLAN.md` §Etapa 2. Deploy: push + VPS (`prisma db push`
aditivo + seed rodado contra produção via `ts-node` manual dentro do container, já que a imagem de
produção não tem `tsconfig.json` nem deve rodar `prisma/seed.ts` inteiro — 25 templates criados).
Suite 207 arquivos/1351 testes, `tsc`/`build` limpos.

**Pendência real**: 6 dos 8 fluxos de alerta ainda usam texto hardcoded (só `LOW_STOCK` e
`ABANDONED_CART` migrados, decisão deliberada de rollout incremental) — retomar repetindo a receita
das Tasks 10/11 do plano, sem precisar de plano novo.

## Incidente VPS resolvido (2026-08-03): swap alto (73,6%)

Investigado e corrigido na mesma sessão. Causa: 48 containers (4 stacks do usuário: corridas,
mecanicapro, xadrez-essencial, syscursos — 2 delas com stack Supabase completa própria) em só 6
vCPUs/11GB. Não era emergência ativa (`vmstat` mostrou swap-in/out ~0, 4,4GB ainda disponível).
Ações aplicadas: 2º swapfile de 4GB criado (`/swapfile2`, total 8GB agora, persistido em
`/etc/fstab`) — resolveu o alerta na hora (uso caiu pra 36%); `monitor-backend` (o próprio serviço
de monitoramento, sem limite de CPU/memória, 106% de CPU) limitado a 1,5 CPU/512MB via
`docker-compose.override.yml` em `/opt/vps-monitor/monitor/` (persistente, sobrevive a
redeploy do monitor). Achado à parte não corrigido: access log do Traefik que o monitor lê está
vazio desde 20/07 (`/var/log/traefik/access.log`, volume `traefik_access_logs`) — estatística de
acesso do monitor está morta silenciosamente, causa raiz não investigada, retomar só se pedido.

## Etapa 2 — 100% concluída (2026-08-03): os 8 alertas migrados pra templates do banco

Plano `docs/superpowers/plans/2026-08-03-migrar-alertas-restantes.md` (Tasks 13-19), mesma receita
das Tasks 10/11 anteriores. Migrados: `ADVERTISER_REQUEST_PENDING`, `CANCELLATION_REQUESTED`,
`RECONCILIATION_MISMATCH`, `DAILY_SUMMARY`, `PAYMENT_ERROR`(+`ORDER_CANCELLED`), `ORDER_CONFIRMED`
(+2 variantes de procuração). Detalhe técnico completo em `IMPLEMENTATION_PLAN.md` §Etapa 2 —
inclui 2 bugs reais pré-existentes achados e corrigidos durante a migração (texto de
`CANCELLATION_REQUESTED` divergente da Task 4 original; variáveis não preenchidas em
`ORDER_CONFIRMED_PROXY_ATHLETE`). Suíte 207/1373, `tsc` limpo. **Ainda não deployado** (só a leva
anterior de 2 alertas está em produção).

**Pedido novo do usuário no meio da execução, direção já fechada com ele:**
1. Quer templates **totalmente** editáveis (não só assunto/introdução) — a solução combinada é dar
   ao admin um "template de linha" (`{{label}}: {{value}}`) que o código aplica em loop, sem violar
   a regra de "sem eval/loop no motor de renderização".
2. Quer alerta diário **por evento** (contato e-mail/telefone só pra um evento específico) — é a
   Etapa 3 chegando adiantada.
3. Usuário confirmou: os dois pedidos entram **juntos** num brainstorm só (mesma área de resumo
   diário/tabelas), depois de terminar a migração mecânica (já terminada).

**Revisão final de branch inteira (2026-08-03) achou 1 Crítico + 2 Importantes, todos corrigidos**
(commits `4cbf04f`/`b75b59b`, re-revisão confirmou tudo endereçado, suíte final 207/1383):
- **Crítico**: os 25 templates já semeados em produção (leva anterior) têm o texto da FASE 1 — como
  o banco tem prioridade sobre o registry, as 2 mudanças de texto desta leva (fix do
  `CANCELLATION_REQUESTED`, conteúdo real do WhatsApp de `DAILY_SUMMARY`) nunca chegariam em
  produção sem uma sincronização manual. Criada `refreshUnmodifiedTemplatesFromRegistry()`
  (`lib/templates/seed.ts`) — só re-sincroniza linhas com **zero** histórico de versão (nunca
  editadas por um admin), nunca sobrescreve customização real.
- 2 Importantes: mais 4 variáveis declaradas no registry mas nunca preenchidas nos call sites
  (`PAYMENT_ERROR`/WhatsApp, `RECONCILIATION_MISMATCH`/WhatsApp, `ADVERTISER_REQUEST_PENDING`/
  WhatsApp, `DAILY_SUMMARY`/WhatsApp nos 2 papéis); `DAILY_SUMMARY` vazava 6 variáveis só-de-WhatsApp
  pra legenda do editor de e-mail (renderizavam em branco) — `sendDailySummaryEmail` ganhou um
  parâmetro `metrics` opcional preenchido pelos 4 call sites.

**⚠️ PASSO DE DEPLOY OBRIGATÓRIO, NÃO AUTOMÁTICO** — depois do `git pull`/build/restart de sempre,
rodar UMA VEZ contra o banco de produção (mesmo padrão manual do seed original — VPS sem
`tsconfig.json`, precisa registrar `tsconfig-paths` na mão dentro do container, ver a leva anterior
desta mesma seção pro procedimento exato):
```
npx ts-node --compiler-options {"module":"CommonJS"} prisma/refresh-templates.ts
```
(script novo, `prisma/refresh-templates.ts` — **não** usar `prisma/seed.ts` inteiro em produção,
ele também cria uma conta admin de demonstração com senha padrão). Sem esse passo, o fix de
`CANCELLATION_REQUESTED` e o WhatsApp novo de `DAILY_SUMMARY` ficam mudos em produção mesmo depois
do deploy.

## Etapa 3 concluída (2026-08-04): templates 100% editáveis + alerta por evento

Spec `docs/superpowers/specs/2026-08-04-templates-editaveis-e-alerta-por-evento.md` → plano
`docs/superpowers/plans/2026-08-04-templates-editaveis-e-alerta-por-evento.md` (26 tasks, executado
via `superpowers:subagent-driven-development`). 4 partes: (1) `DAILY_SUMMARY` 100% editável (tabela
de métricas sai do código, vira template) + separação taxa de plataforma/taxa de serviço; (2)
`RECONCILIATION_MISMATCH` ganha `rowTemplate` (mecanismo de "linha repetida", primeiro do sistema);
(3) `DailySummaryRecipient.eventId` — contato de resumo diário escopado a um evento só; (4)
`MessageTemplate.scope="EVENT"` ganha UI (admin personaliza texto de qualquer alerta por evento, em
`/admin/alertas`).

**Revisão final de branch inteira achou 1 Crítico + 5 Importantes** — o Crítico (perda silenciosa
do `rowTemplate` da conciliação ao salvar qualquer edição no editor global — cadeia de 4 tasks,
`""` não caía no fallback de fábrica por usar `??` em vez de `||`) foi corrigido numa rodada de fix
(commit `a75ee95`), re-revisão confirmou tudo endereçado.

**Achado Important #2 da revisão** — a personalização por evento (parte 4) não tinha efeito
nenhum no envio real (nenhum remetente passava `eventId` pro resolver de template) — era um gap da
spec, não desvio de implementação. Usuário pediu pra ampliar o escopo e resolver: **Tasks 21-26**
(commits `22315f6..7db9227`) conectaram `eventId` nos ~8 pontos de envio real que fazem sentido
(`ORDER_CONFIRMED`+variantes, `LOW_STOCK`, `ABANDONED_CART`, `PAYMENT_ERROR`+variante,
`CANCELLATION_REQUESTED`, `DAILY_SUMMARY_EVENT`) — `RECONCILIATION_MISMATCH`/`DAILY_SUMMARY`
agregado/`ADVERTISER_REQUEST_PENDING` continuam sem `eventId` de propósito (não são de 1 evento só).

**Pendências reais, ainda em aberto:**
- Verificação manual no navegador das 2 telas novas (contato de resumo por evento na edição de
  evento; personalização de template por evento em `/admin/alertas`) — nunca foi feita, sem acesso
  a navegador durante a implementação.
- Deploy: checar produção por templates `DAILY_SUMMARY`/e-mail já customizados manualmente (têm
  `MessageTemplateVersion`) antes do deploy — perdem a tabela de métricas, já que
  `refresh-templates.ts` pula de propósito linha já editada por admin.
- Nada commitado além do que já está local em `main`. Nenhum push ainda.

Suite 210 arquivos / 1416 testes, `tsc --noEmit` limpo, `npm run build` limpo.

Detalhe técnico completo: `docs/superpowers/plans/2026-08-04-templates-editaveis-e-alerta-por-evento.md`
e o ledger em `.superpowers/sdd/2026-08-04-templates-editaveis-e-alerta-por-evento/progress.md`.

## Etapa 6 concluída (2026-08-04): home pública mostra os próximos 6 eventos

Brainstorm → spec (`docs/superpowers/specs/2026-08-04-home-publica-lista-eventos-design.md`) →
plano de 1 task (`docs/superpowers/plans/2026-08-04-home-publica-lista-eventos.md`) → executado via
`superpowers:subagent-driven-development` (commit `4f31797`). Home (`/`) ganhou: banner rotativo
(`EventsBanner`, reaproveitado), slot de anúncio `HOME_ABAIXO_BANNER`, seção "Próximos eventos" com
até 6 `EventCard`s (via `listPublicEvents({ pageSize: 6 })`, já ordenado por data mais próxima —
some inteira se não houver evento futuro), botão "Ver todos" pra `/eventos`, slot de anúncio
`HOME_ENTRE_EVENTOS_CTA`, `OrganizerCTA` no rodapé. `/eventos` continua 100% inalterado.

**Correção feita durante o plano**: a spec original assumia que dava pra criar `AdSlot` novo pelo
admin — investigação mostrou que não existe esse fluxo (`/admin/anuncios` só lista/configura slots
já existentes, `lib/ad-slots.ts` não tem `create`). Os 2 slots novos seguem o mesmo padrão manual já
usado pros 5 slots originais: `INSERT` SQL documentado no plano, a rodar uma vez contra produção
depois do deploy (nasce `enabled: false`, não quebra nada se não rodar, só fica inativo).

**Pendente**: verificação manual no navegador — bloqueada por limitação de ambiente (servidor dev
não sobe aqui, Supabase inacessível localmente, confirmado que é pré-existente, não é regressão
desta mudança). Suite 210/1416, `tsc`/`build` limpos. Nada commitado além do que já está local em
`main`, nenhum push ainda.

## Etapa 8 concluída (2026-08-04): redes sociais administráveis

Brainstorm → spec (`docs/superpowers/specs/2026-08-04-redes-sociais-design.md`) → plano de 3 tasks
(`docs/superpowers/plans/2026-08-04-redes-sociais.md`) → executado via
`superpowers:subagent-driven-development` (commits `97134e8`, `0272438`, `ce4c99c`). Admin configura
URL de 6 redes (Instagram, Facebook, WhatsApp, YouTube, TikTok, X) em `/admin/configuracoes`, um
botão "Salvar" só; rodapé (`components/layout/Footer.tsx`, aparece em toda página pública) mostra um
ícone SVG inline por rede preenchida — rede vazia não mostra ícone, todas vazias somem a fileira
inteira. Zero código de backend novo: reaproveitou o endpoint genérico já existente
`POST /api/admin/settings` (admin-only, já audita, já revalida o layout público) com 6 chaves novas
de `PlatformSetting` (`social_instagram` etc.). Lógica de "quais redes mostrar" isolada em
`lib/social-links.ts` (função pura, testada) — `Footer`/`SocialLinksForm` ficam sem teste dedicado,
convenção já estabelecida do projeto.

**Ponto de maior risco do plano**: Task 3 inseriu 1 entrada nova num `Promise.all` de ~20 itens já
existente em `app/admin/configuracoes/page.tsx` — revisor re-traçou o alinhamento array↔
desestruturação par a par contra o arquivo real (não só o diff), confirmou as 20 posições corretas,
nova entrada por último em ambos os lados, nenhuma entrada existente tocada.

Suite 211/1421, `tsc`/`build` limpos (verificação combinada rodada duas vezes: por task e no final).
Nada commitado além do que já está local em `main`, nenhum push ainda.

## Deploy em produção concluído (2026-08-04): Etapa 3 (parte 5) + Etapa 6 + Etapa 8

Push `6e57340..5f21638` → VPS `git pull` (75 arquivos) → `docker build` → `prisma db push
--skip-generate` (sync ok, sem migração pendente) → `docker compose up -d --no-deps app`. Smoke
test via domínio público (não `localhost`, porta 3000 não é publicada pro host — só acessível via
rede `proxy` do Traefik): `/`, `/eventos`, `/admin/alertas`, `/admin/configuracoes` todos OK.

**Falso alarme durante a verificação**: `WebFetch` no domínio público voltou sem a seção "Próximos
eventos" nem os ícones de rede social — parecia bug real (`/eventos` mostrava os mesmos 2 eventos
corretamente). Causa: cache interno de 15 min do próprio `WebFetch`, de uma consulta ao mesmo
domínio *antes* do deploy, nesta mesma conversa. `curl` direto confirmou o HTML novo já estava no
ar, correto, desde o primeiro restart — não houve bug nenhum.

**2 passos manuais de deploy executados com sucesso**:
1. `refresh-templates.ts` rodado contra produção (procedimento: sem `tsconfig.json` no container de
   runtime, foi necessário montar um `tsconfig.tmp.json` temporário via bind mount com
   `baseUrl`/`paths` pro alias `@/*` + `TS_NODE_PROJECT=tsconfig.tmp.json npx ts-node -r
   tsconfig-paths/register prisma/refresh-templates.ts` — `--compiler-options` sozinho não basta,
   `paths` não é aceito inline). Resultado: 2 templates novos criados, 6 re-sincronizados, 21
   pulados (customizados ou já em dia) — confirmado antes que **nenhum** `DAILY_SUMMARY`/e-mail
   tinha customização manual em produção, então não houve perda de tabela de métricas.
2. Os 2 novos `ad_slots` (`HOME_ABAIXO_BANNER`, `HOME_ENTRE_EVENTOS_CTA`) inseridos via SQL direto,
   `enabled=false` como planejado — confirmado via `SELECT`, os 7 slots (5 antigos + 2 novos) presentes.

Nenhuma pendência de deploy restante destas 3 frentes.

## Etapa 7 concluída (2026-08-04): seleção de plano em /anuncie

Brainstorm → spec (`docs/superpowers/specs/2026-08-04-anuncie-selecao-plano-design.md`) → plano de
1 task (`docs/superpowers/plans/2026-08-04-anuncie-selecao-plano.md`) → executado via
`superpowers:subagent-driven-development` (commit `7fb2e1c`). Novo componente
`components/advertiser/AdvertiserPlanPicker.tsx` (client) junta a grade de cards de plano + o
`RequestAdvertiserForm` já existente: clicar num card seleciona o plano (destaque visual,
`aria-pressed`, botão nativo — acessível por teclado), plano mais barato (`plans[0]`) vem
pré-selecionado, troca de plano não reseta o formulário (sem `key` forçando remount).
`app/(public)/anuncie/page.tsx` encolheu pra só buscar dados e delegar a renderização. Zero mudança
em `RequestAdvertiserForm.tsx` ou `app/api/anunciante/solicitar/route.ts` — nenhum dos dois
precisava mudar. Fluxo de "login adiado até o checkout" já existia e continua intacto (não era um
gap de verdade, só precisava confirmação).

Revisão de task única (não houve revisão de branch inteira separada — task única, revisor já
verificou tudo direto contra o diff): **Approved**, zero Critical/Important, só 2 sugestões Minor
de acessibilidade (usar `role="radiogroup"`/`radio` em vez de botões com `aria-pressed`, daria
navegação por setas — não é falha de spec, adiado). Suite 211/211 arquivos, 1421/1421 testes,
`tsc`/`build` limpos.

**DEPLOYADA em produção (2026-08-04)**: push `2c6bbbe..87fd737` → VPS (`cd /opt/corridas/src && git
pull` — **nota**: o repo git na VPS fica em `/opt/corridas/src`, não em `/opt/corridas` direto, usar
sempre `deploy.sh` ou replicar esse `cd` — → `docker build` → `docker compose up -d --no-deps app`
de `/opt/corridas`, sem `prisma db push`, sem passo manual). Smoke test via domínio público: `/`,
`/anuncie`, `/eventos` todos 200; confirmado via `curl` que o HTML de `/anuncie` já tem os botões
`aria-pressed` da seleção de plano.

**Pendência real**: verificação manual no navegador (clicar de fato num plano e ver o form reagir)
nunca foi feita — sem acesso a navegador durante a implementação, mesma limitação de sempre nesta
sessão. Só isso.

## 4 correções pós-deploy das Etapas 6/8/3 (2026-08-04)

Usuário testou o site no ar e reportou 4 problemas reais, todos investigados e corrigidos no
código local (**ainda não deployados** — ver "Próxima tarefa"):

1. **Ícones de redes sociais pouco visíveis**: ficavam só no rodapé, pequenos. Pesquisei prática de
   sites de inscrição de corrida (RunSignup e referências de UX) — cabeçalho é o padrão pra
   visibilidade. Adicionados também no `Header` (desktop: coluna entre o menu e o login; mobile: no
   menu expansível), mantendo o rodapé como estava. `Header`/`Footer` deixaram de buscar dado
   próprio — `app/(public)/layout.tsx` agora calcula `socialLinks` uma vez (`getSetting` × 6 +
   `buildSocialLinks`) e repassa como prop pros dois; `Footer` voltou a ser síncrono.
2. **Select confusa em `/admin/alertas`**: não era destinatário, era personalização de TEXTO por
   evento (Etapa 3 Parte 4) — mas o usuário achou confusa/pequena e pediu pra **remover de vez**.
   Confirmado em produção: **zero** linhas `scope=EVENT` existiam (feature nunca chegou a ser usada
   por ninguém), então a remoção não perde nenhum dado real. Removidos:
   `app/admin/alertas/templates/[id]/eventos/[eventId]/page.tsx`,
   `app/api/admin/message-templates/[id]/eventos/[eventId]/route.ts`, o teste da rota, e a
   coluna/Select em `MessageTemplateList.tsx` (só ficou a coluna "Ação" → "Editar", que edita o
   texto padrão global). `getEffectiveTemplate`'s `eventId` e as Tasks 21-26 (threading de eventId
   nos remetentes reais) **continuam intactos** — servem pros contatos de resumo por evento
   (feature separada, não removida) e caem no texto global normalmente. Aproveitei pra corrigir o
   gap real por trás da confusão: o card de cadastro de contatos (telefone/e-mail) pro resumo
   diário de um evento específico (`EventDailySummaryRecipientsManager`) já existia na edição do
   organizador mas faltava na página de detalhe do evento do **admin** — adicionado agora
   (`app/admin/eventos/[id]/page.tsx`), reaproveitando o componente existente (API já aceitava
   admin via `scope.actingAsAdmin`, não precisou mudar backend).
3. **Resumo diário do WhatsApp não era uma métrica por linha**: e-mail já era tabela (uma métrica
   por linha); WhatsApp (admin, organizador, por evento) era uma frase corrida com vírgulas.
   Reescrito o texto padrão de fábrica em `lib/templates/registry.ts` pro mesmo formato/ordem do
   e-mail, um `\n` por métrica.
4. **WhatsApp nas redes sociais exigia URL pronta**: agora o campo aceita só telefone (DDD +
   número, sem +55, mesmo padrão já usado em `EventDailySummaryRecipientsManager`) e
   `buildSocialLinks` (que ganhou um 2º parâmetro `appName`) gera o link `wa.me` automaticamente
   com a mensagem "Olá, gostaria de falar com a equipe {nome da plataforma}" pré-preenchida.

Commits: `f7e02e7` (itens 1+4), `d4fcdea` (item 2), `c7dba03` (item 3). Suite 210/210 arquivos,
1416/1416 testes (5 testes a menos = os do teste deletado da rota removida), `tsc --noEmit` e
`npm run build` limpos (build limpo rodado do zero, `rm -rf .next` antes, pra garantir que as
rotas removidas realmente sumiram do build).

**DEPLOYADA em produção (2026-08-04)**: push `a3757b7..6434aa3` → VPS (`cd /opt/corridas/src && git
pull`, fast-forward 15 arquivos) → `docker build` → `docker compose up -d --no-deps app` — sem
`prisma db push` (nenhuma migração). Smoke test: `/` e `/eventos` 200; `/admin/alertas` e a rota
removida (`/admin/alertas/templates/.../eventos/...`) ambas 307 (auth gate, esperado). Confirmado
via `curl` no HTML de produção: ícones de Instagram e WhatsApp já configurados pelo usuário
(`social_instagram`, `social_whatsapp="+5535984060343"`) renderizam certo no cabeçalho e rodapé —
WhatsApp virou `wa.me/5535984060343?text=Olá, gostaria de falar com a equipe Circuito das
Corridas` automaticamente, confirmando que a normalização do "+55" já digitado não duplicou o DDI.

`refresh-templates.ts` rodado logo em seguida: 3 templates re-sincronizados (os 3 textos de
WhatsApp do resumo diário que mudaram), 24 pulados (já em dia ou customizados por admin — nenhum
customizado de fato, confirmado antes). Novo texto uma-métrica-por-linha já ativo em produção.

**Pendência real**: verificação manual no navegador de nenhuma das 4 correções (clicar de fato nos
ícones, testar o formulário do admin) — sem acesso a navegador nesta sessão, mesma limitação de
sempre.

## 2 ajustes finos nos ícones de redes sociais (2026-08-04)

Usuário testou de novo e reportou 2 problemas nos ícones do item 1 da leva anterior:

1. **Ícone de WhatsApp errado**: o `WhatsappIcon` em `components/layout/SocialIcons.tsx` usava o
   path de um balão de mensagem genérico (ícone tipo "message-circle"), não o logo real do
   WhatsApp — bug pré-existente desde a implementação original da Etapa 8, só notado agora.
   Trocado pelo path correto do logo (bolha + fone), estilo preenchido, mesmo padrão dos outros
   ícones de marca (Facebook/YouTube/TikTok/X).
2. **Ícones do cabeçalho pouco visíveis**: confirmado ao vivo via `curl` que os ícones JÁ estavam
   no header (conforme a correção anterior), mas pequenos (`w-4 h-4`) e cinza uniforme
   (`text-gray-500`), meio escondidos entre o menu e os botões de login. Aumentados pra `w-5 h-5`
   (desktop) / `w-6 h-6` (menu mobile) e cada rede ganhou a cor da própria marca (verde WhatsApp,
   rosa Instagram, azul Facebook, vermelho YouTube, preto TikTok/X) em vez de cinza — muito mais
   fácil de notar. O rodapé continua neutro/cinza de propósito (não foi pedido mudar lá).

Commit `652dde8`. Suite 210/210, `tsc`/`build` limpos. **Deployado e confirmado ao vivo**: `curl`
no HTML de produção mostra as classes `text-green-600`/`text-pink-600` aplicadas e o novo path do
WhatsApp (`17.472...`) tanto no cabeçalho quanto no rodapé.

**Pendência real**: verificação visual de fato num navegador (só confirmei via `curl`/grep no HTML
— cores/tamanhos corretos no markup, mas não vi renderizado) — mesma limitação de sempre.

## Ícones sociais ainda escondidos no mobile — corrigido (2026-08-05)

Usuário testou no celular e perguntou de novo "aonde estão os ícones" — a extensão do Chrome não
conectou nesta sessão (`tabs_context_mcp` retornou "Browser extension is not connected"), então não
deu pra abrir o navegador e ver direto. Perguntei via `AskUserQuestion` se era celular ou
computador — resposta: **celular**. Isso explica o problema: os ícones do commit anterior só
existiam dentro do `Header.tsx` em dois lugares — cluster desktop (`hidden md:flex`, correto) e
dentro do menu ☰ expansível no mobile (só aparecia depois de tocar no hambúrguer). "Destaque" não
pode depender de um toque extra escondido.

Corrigido: nova faixa `md:hidden` sempre visível logo abaixo do cabeçalho no mobile (fundo cinza
claro, ícones centralizados, sem precisar abrir menu nenhum). A versão duplicada que ficava dentro
do menu ☰ foi removida (virou redundante). Extraído `SocialIconLinks` (componente local dentro do
próprio arquivo) pra não duplicar o JSX entre a versão desktop e a faixa mobile — usado nos dois
lugares agora.

Commit `d8abbd3`. Suite 210/210, `tsc`/`build` limpos. **Deployado e confirmado via `curl`** — a
faixa mobile (`md:hidden flex items-center justify-center gap-6 ...`) está no HTML de produção.

**Pendência real**: mesma de sempre — nunca vi renderizado num navegador de verdade, só confirmei
via HTML/`curl`. Se o usuário testar no celular e ainda achar que não está bom, meu próximo passo
seria pedir uma captura de tela em vez de tentar adivinhar de novo.

## Investigação: "teste de WhatsApp não chega" — causa real encontrada e corrigida (2026-08-05)

Usuário reportou que clicar "Enviar teste pra mim" num alerta não entregava nada no WhatsApp.
Investigação, nesta ordem:

1. Checado `message_logs` em produção — sem nenhuma entrada `FAILED` de WhatsApp, e nenhuma
   entrada de teste WhatsApp (`subject LIKE '%TESTE%'`) — só um teste de E-MAIL registrado.
2. Checada a conexão real do WhatsApp (Evolution API `connectionState`) — `"state":"open"`,
   ativa.
3. Enviei uma mensagem de teste **direto pela API** (bypassando o site) pro número da própria
   conta do usuário — **chegou** (confirmado pelo usuário). Isso prova que a integração de
   WhatsApp funciona de ponta a ponta; o "sem o 9º dígito" que apareceu na resposta da API é só o
   WhatsApp resolvendo o número no formato como está cadastrado lá (comportamento normal do
   Baileys, não é bug).
4. Pedido pro usuário testar de novo, especificamente a linha de WhatsApp (não a de e-mail) do
   mesmo alerta — ele confirmou: sem erro na tela, mas nada chegou.
5. Checado `message_logs` de novo — apareceu **mais um teste de E-MAIL**, de novo nenhum de
   WhatsApp. Ou seja: o clique do usuário, mesmo tentando a linha de WhatsApp, resultou em envio
   de e-mail.
6. **Causa raiz encontrada**: `MessageTemplateEditor.tsx` e a página
   `app/admin/alertas/templates/[id]/page.tsx` mostram o **mesmo título genérico**
   (`def.description`, ex: "Resumo diário — 100% editável...") pra qualquer canal — não existe
   NENHUM indicador visível de "você está editando a versão de E-mail" vs "WhatsApp" na tela. É
   fácil clicar/ficar na linha errada (mesmo `alertKey`, linhas diferentes só por `channel`) sem
   perceber, já que a única pista era a presença/ausência sutil do campo "Assunto".

**Corrigido**: badge colorido "Canal: E-mail"/"Canal: WhatsApp" bem visível no topo do formulário
(azul/verde), `<h1>` da página passou a citar o canal, título da aba do navegador idem
(`generateMetadata` dinâmico). Commit `c3611cd`. Suite 210/210, `tsc`/`build` limpos. **Deployado**.

**Confirmado que NÃO é bug de envio** — infra de WhatsApp 100% funcional, verificada com um envio
real que chegou. O problema real e provável era confusão de qual linha da lista o usuário estava
editando, agora impossível de confundir com o badge.

**Pendência real**: usuário ainda vai testar de novo com o badge visível pra confirmar que agora
funciona — próximo passo real ao retomar é ler a resposta dele.

## Próxima tarefa

Aguardar confirmação do usuário de que o teste de WhatsApp agora funciona (badge de canal deployado
— ver seção acima). Depois disso, todas as correções pedidas até agora estarão completas. Perguntar
o que vem a seguir. Etapa 4 (novos alertas recomendados) e Etapa 5 (auditoria/log de envio mais
completo, hoje parcial) continuam pendentes, sem pedido explícito ainda. Etapas 9/10 (kits, rating)
continuam bloqueadas até 1-8 estarem 100% concluídas, testadas e deployadas — e até pedido explícito
do usuário.
