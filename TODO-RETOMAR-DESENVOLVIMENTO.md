# TODO para retomada

## Lote de tarefas atual (8 itens) — sessão 2026-07-11/12

Pedido em uma única mensagem em 2026-07-11: 8 tarefas em ordem, cada uma como seu próprio ciclo
spec → plano → implementação (subagentes) → revisão → commit, trabalhando direto na `main` (usuário
recusou isolamento por worktree nesta sessão). Após as 6 primeiras, perguntar sobre deploy antes de
iniciar a 7ª (sistema de rating), que por sua vez exige pesquisa + prompt completo + autorização
explícita antes de qualquer código.

Histórico completo por tarefa (specs/planos/decisões de review) em
`docs/superpowers/specs/2026-07-*` e `docs/superpowers/plans/2026-07-*`; ledger detalhado (local,
não versionado) em `.superpowers/sdd/progress.md`.

- [x] **1. Carrinhos abandonados (admin/organizador)** — página de envio manual (individual/em
  massa) de alerta de carrinho abandonado, além do alerta automático que já existia via cron.
  Commits `f87b770..c583799` (10 commits). Review final encontrou e corrigiu 2 bugs cross-task
  (AlertLog não gravado em envio manual → risco de alerta duplicado; faltava paginação/ordenação na
  UI). 425/425 testes, build limpo.
- [x] **2. Filtros e resumo na página do evento** (categoria/percurso/lote/cupom/tipo de pagamento)
  — filtros novos nas duas listas de inscritos (admin/organizador); cards de Percursos/Categorias/
  Lotes ganharam contagem+receita; novo card "Tipo de pagamento"; página de evento do admin trazida
  à paridade com a do organizador (ganhou seção de cupons e card de categorias que não existiam).
  Commits `a7c0ce3..93509e7` (9 commits). Review final corrigiu 1 problema cross-task (card de tipo
  de pagamento somava valor bruto com taxas enquanto os outros cards somavam valor líquido — dois
  números rotulados "receita" que não batiam; corrigido por relabeling, não mudança de valor).
  439/439 testes, build limpo.
- [x] **3. Verificar página de resultados + import CSV** — DONE. Spec:
  `docs/superpowers/specs/2026-07-12-resultados-hardening-design.md`. Plano:
  `docs/superpowers/plans/2026-07-12-resultados-hardening.md`. Commits `06bcd61..42550b4` (4
  commits) on main, via subagent-driven-development (3 tasks + review final). Corrigidas as 3
  lacunas: (a) parser CSV trocado por `papaparse` (corrige bug real: nome de atleta com vírgula
  entre aspas, tipo "Silva, João", quebrava o parser antigo e deslocava as colunas seguintes);
  (b) `tests/event-results-route.test.ts` criado do zero (rota não tinha nenhum teste antes) —
  10 testes cobrindo POST (auth/role, arquivo ausente, CSV vazio, coluna obrigatória ausente, 404
  fora de escopo, parsing de vírgula entre aspas, sucesso completo) e PATCH (auth/role, publicação);
  (c) `<select name="categoria">` adicionado à página pública de resultados, populado pelas
  categorias realmente presentes no import publicado mais recente. Review final (opus) encontrou 1
  problema Minor que virou fix: o filtro de categoria usava `contains` (substring), o que o novo
  `<select>` de valores exatos tornou alcançável como bug real (selecionar "M30" também retornava
  "M30-39") — corrigido para `equals` (commit `42550b4`). 449/449 testes, build limpo.
  **Verificação manual no navegador NÃO foi feita** — o banco de dados (Supabase) não está acessível
  a partir deste ambiente sandboxed; pedir para o usuário verificar visualmente na próxima vez que
  abrir o app, ou verificar em produção após o próximo deploy.
- [x] **4. Investigar e corrigir bug de expiração de pagamentos pendentes** — DONE. Spec:
  `docs/superpowers/specs/2026-07-12-payment-expiration-fix-design.md`. Plano:
  `docs/superpowers/plans/2026-07-12-payment-expiration-fix.md`. Commits `c39a97b..f4b0030` (3
  commits, subagent-driven-development) + `ab081e3` (script de backfill). Causa raiz encontrada via
  systematic-debugging: **não era o crontab** — pagamentos de cartão de crédito nunca recebiam
  `expiresAt` (só PIX/boleto recebiam), então ficavam invisíveis pra sempre à query de
  `expirePendingPayments()`, usada tanto pelo cron quanto pelos botões manuais do admin/organizador.
  Cartão recusado também era gravado como `PENDING` em vez de estado terminal. Corrigido: Mercado
  Pago e Pagar.me agora mapeiam `rejected`/`failed`/`canceled` → cancelamento imediato (dentro da
  própria requisição de checkout, via `applyGatewayStatus` já existente) e status "em análise" →
  `PENDING` com fallback de `expiresAt` (48h Mercado Pago, 1h Pagar.me, baseado na documentação
  oficial de cada gateway). 458/458 testes, build limpo, review final sem achados críticos.
  **Pendências que exigem ação manual do usuário (não são código):**
  - Rodar `npm run db:backfill-stuck-card-payments -- --dry-run` (depois sem `--dry-run`) no
    próximo deploy pra corrigir os pedidos que **já** estão presos em PENDING na produção — o fix
    só vale daqui pra frente, não corrige retroativamente sozinho.
  - Confirmar que o crontab da VPS ainda chama `/api/cron/expire-payments` a cada 6h (não foi
    possível verificar deste ambiente sandboxed, sem acesso SSH).
- [x] **5. Verificar sistema de repasse ao organizador** — DONE. Investigação revelou que o sistema
  era só leitura: `/admin/repasses` tinha filtro/ordenação/export CSV completos, mas **nenhuma rota
  em lugar nenhum do app criava ou atualizava um repasse** — a única forma de um `TransferPayout`
  entrar no banco era restaurando um backup completo. Usuário pediu o fluxo completo. Spec:
  `docs/superpowers/specs/2026-07-12-repasse-organizador-design.md`. Plano:
  `docs/superpowers/plans/2026-07-12-repasse-organizador.md`. Commits `b90e638..c6ee288` (6
  commits, subagent-driven-development, 5 tarefas + review final). Construído: `Order.payoutId`
  (evita contar o mesmo pedido em dois repasses); geração automática do repasse a partir dos
  pedidos pagos do evento (bruto = total cobrado do comprador, taxa = taxa da plataforma + taxa de
  serviço, líquido = bruto − taxa); máquina de estado `PENDENTE → PROCESSANDO/CONCLUÍDO/FALHOU`
  (falhar libera os pedidos de volta pro pool, evitando o mesmo padrão de "dinheiro preso pra
  sempre" corrigido na tarefa 4); aviso visual quando um pedido é estornado depois do repasse já
  concluído; compatibilidade com backup import/export. Review de uma das tarefas encontrou e
  corrigiu uma race condition real (duas gerações de repasse simultâneas podiam contar o mesmo
  pedido duas vezes); review final encontrou e corrigiu 1 gap de auditoria (log de geração não
  registrava qual admin gerou o repasse). 482/482 testes, build limpo.
  **Pendências que exigem ação manual do usuário:** aplicar a migração (`Order.payoutId`) via
  `prisma db push` no próximo deploy; verificação visual no navegador não foi feita (sem acesso ao
  banco neste ambiente sandboxed).
- [x] **6. Dashboards admin e organizador com gráficos de linha** — DONE. Ao contrário do que a
  memória indicava, `app/admin/page.tsx` e `app/organizador/page.tsx` **já existiam** (cards de KPI
  + tabelas) — a lacuna real era nenhum gráfico de linha em lugar nenhum, e nenhuma lib de gráficos
  instalada. Spec: `docs/superpowers/specs/2026-07-12-dashboards-graficos-design.md`. Plano:
  `docs/superpowers/plans/2026-07-12-dashboards-graficos.md`. Commits `2289df1..ac94262` (7
  commits, 4 tarefas). Construído: `components/ui/LineChart.tsx` (SVG próprio, sem dependência
  nova — usuário escolheu essa opção em vez de uma lib como Recharts); `lib/dashboard-metrics.ts`
  (novos cadastros, inscrições, cupons usados, todos com um ponto por dia); filtro de/até/evento
  (padrão 30 dias) nas duas páginas; admin ganha os 3 gráficos, organizador ganha 2 (sem novos
  cadastros — dado da plataforma inteira, não do organizador). Dois bugs reais de fuso horário
  pegos em revisão e corrigidos: (1) o loop de bucketing misturava UTC (extração da chave do dia)
  com hora local (incremento do loop) — sob DST isso duplicaria/pularia um dia; (2) o intervalo
  padrão de 30 dias também usava hora local, o que no deploy real (America/Sao_Paulo, UTC-3)
  fazia inscrições feitas à noite (21h-23h59 local) desaparecerem do gráfico até o dia seguinte —
  confirmado com simulação real pelo revisor final. 489/489 testes, build limpo.
  **Verificação manual no navegador não foi feita** — sem acesso ao banco neste ambiente.
- [ ] **7. Perguntar sobre deploy** antes de iniciar a tarefa 8 — é um gate de decisão, não uma
  tarefa de código.
- [ ] **8. Sistema de rating (atletas + organizadores)** — **NÃO INICIAR sem pedido explícito do
  usuário** (instrução dada em 2026-07-13, mesmo que esta lista chegue nesse ponto). Quando
  iniciar: exige pesquisar um modelo de pontuação real (tipo Elo ou similar) antes de propor valores
  de pontos, escrever o prompt de implementação completo, e só então pedir autorização explícita do
  usuário antes de escrever qualquer código. Escopo também inclui (adicionado no meio da conversa,
  antes da tarefa 1 começar): pontuação por cadastro completo com barra de % de completude na frente
  de cada usuário nas listas; rating do atleta sempre visível na área do atleta; upload de foto de
  perfil (avatar) em "meus dados"; modal pós-login incentivando completar cadastro por pontos (só
  pra quem já preencheu os dados obrigatórios, substituindo o modal atual que força esse
  preenchimento). **Adicionado em 2026-07-13:** a implementação precisa incluir uma passagem
  retroativa de pontos pros atletas que já se cadastraram/já têm inscrições, usando os mesmos
  valores de pontuação definidos no desenho final (ver memória `rating_system_pending`).

### Deploy 2026-07-13 (1ª leva — commits `b90e638..838d9ee`)
- [x] Push de 54 commits locais pra `origin/main`.
- [x] Deploy na VPS via `git pull` → `docker build` → `prisma db push` (aplicou a migração
  `Order.payoutId`) → `docker compose up -d --no-deps app`. Site verificado no ar (`/`, `/eventos`,
  `/auth/login` respondendo 200).
- [x] `prisma/backfill-stuck-card-payments.ts` rodado contra produção — 0 pagamentos presos
  encontrados, nada precisava de correção.
- [ ] Verificar se o crontab da VPS ainda chama `/api/cron/expire-payments` a cada 6h — não
  verificado nesta passagem.

### Pedidos órfãos sem pagamento (2026-07-13, achado ao investigar inscrições presas)
- [x] Consulta em produção encontrou 12 inscrições `PENDING_PAYMENT` há mais de 3 dias, todas com
  `Order` sem nenhum `Payment` associado (checkout abandonado antes de escolher forma de
  pagamento) — o mecanismo de expiração da tarefa 4 só olha a tabela `Payment`, não pega esses.
  Spec: `docs/superpowers/specs/2026-07-13-expirar-pedidos-orfaos-design.md`. Plano:
  `docs/superpowers/plans/2026-07-13-expirar-pedidos-orfaos.md`. Commits `c93d811..fe7b930` (2
  commits). Construído: `expireAbandonedOrders`/`cancelAbandonedOrder` em
  `lib/payment/expire-payments.ts` (mesmo padrão de `expirePendingPayments`, filtro
  `payments: { none: {} }`), somado no cron e nos dois botões manuais existentes — nenhuma mudança
  de UI necessária. 497/497 testes, review final: pronto pra merge.

### Validação de e-mail + melhorias de dashboard (2026-07-13, pedido em lote)
- [x] Validação de domínio de e-mail no cadastro via consulta DNS/MX real (timeout 4s, deixa
  passar se travar) — pegava e-mails como "usuario@gmail.coml" que só passavam por validação de
  formato. Renomeado "Painel Administrativo"/"Admin" → "Dashboard" (h1 + nav), igualando ao
  organizador. Gráficos trocados do SVG próprio pra Recharts (biblioteca real, `^3.9.2`, compatível
  com React 19) — mesma assinatura de props, nenhuma chamada precisou mudar. Layout dos dois
  dashboards: filtros de data/evento inline e justificados (só quebram linha por
  responsividade), gráficos um por linha (era grid de 2-3 colunas). Spec:
  `docs/superpowers/specs/2026-07-13-validacao-email-e-dashboards-design.md`. Plano:
  `docs/superpowers/plans/2026-07-13-validacao-email-e-dashboards.md`. Commits `bdd4f67..6074acf`
  (4 commits). 504/504 testes, review final: pronto pra merge. **Não verificado visualmente** —
  recomendação do review final: conferir os dois dashboards em modo claro e escuro.

### Deploy 2026-07-13 (2ª leva — commits `c93d811..6074acf`, sem migração de banco)
- [x] Push + `git pull` → `docker build` (instalou `recharts`) → `docker compose up -d --no-deps
  app` (sem `prisma db push`, nenhuma mudança de schema nesta leva). Site verificado no ar (`/`,
  `/eventos` respondendo 200; `/admin` responde 307, esperado sem sessão logada).

> Pra retomar: uma mensagem "continue" é suficiente — este arquivo e a memória do projeto têm o
> estado completo. As 6 primeiras tarefas e o deploy estão concluídos. **Não iniciar a tarefa 8
> (rating) sem o usuário pedir explicitamente.**

## Lote anterior (12 itens) — concluído

### Fase 1 — Correções rápidas (sem migração)
- [x] **T1** Lote grátis (valor 0): `priceAmount` agora `.nonnegative()` na rota POST e PATCH; front exibe erro no submit.
- [x] **T2** Dark mode "Lote esgotado": adicionadas variantes `dark:` no badge (`lotes/page.tsx`) e no status do detalhe admin.
- [x] **T4** Páginas centralizadas (`mx-auto`) + `REGISTRATIONS_OPEN` traduzido (corrigido em `SetPlatformFeeForm` e via `EVENT_STATUS_LABEL` completo).
- [x] **T6** Status do admin (lista + detalhe) usando `EVENT_STATUS_LABEL` em português.
- [x] **T8** Modalidade em português via `MODALITY_LABEL` na página pública e no detalhe admin.
- [x] **T11** `lib/checkout.ts` exige percurso/categoria quando o evento os possui (validação no servidor + UX no front). Testes adicionados.

### Fase 2 — Cupons (migração)
- [x] **T9** Página `/admin/cupons` com rastreamento: desconto concedido por código (pedidos pagos), criador, e em quais eventos foi aplicado (detalhe por evento para cupons globais).
- [x] **T10** Admin cria cupom global (`eventId` nulo) ou por evento. API `/api/admin/coupons` + checkout/preview reconhecem cupom global.
- ✅ **Migração** `20260620000000_coupons_global_and_creator` APLICADA na produção em 2026-06-20 via `prisma db push` no deploy (banco self-hosted `corridas-db`).

### Deploy (2026-06-20)
- [x] Push para `origin/main` (`1ba3f4b`) e deploy na VPS `144.91.92.70` concluído. Site `https://circuitodascorridas.com.br` no ar com o novo código (HTTP 200 home/eventos/login). DB sincronizado via `prisma db push`.

### Correções e infra (2026-06-21)
- [x] **Fix upload:** revertido `FileUploadInput` para POST `/api/upload` (Supabase direto). Removidos `lib/upload-client.ts`, `app/api/upload/presign/route.ts` e testes — código S3/presign introduzido sem pedido que quebrou o upload em produção. (commit `da2561c`)
- [x] **Fix 404 pós-deploy:** removido container `src-app-1` que conflitava com `corridas-app` no Traefik (labels duplicadas). Causa: `docker-compose.yml` do repo sendo extraído para `/opt/corridas/src/` em cada deploy.
- [x] **Remove docker-compose.yml do repo:** arquivo legado removido da raiz do projeto e do GitHub. (commit `d90e1f0`)
- [x] **Deploy via git pull:** `/opt/corridas/src` inicializado como repo git com SSH deploy key no GitHub. Script `/opt/corridas/deploy.sh` criado. Arquivos órfãos de deploys anteriores removidos da VPS. Deploy testado com sucesso.

### Fase 3 — E-mail / SMTP
- [x] **T3** `lib/email.ts` + `lib/smtp-settings.ts` + `lib/notifications.ts`; card SMTP em `/admin/configuracoes` com botão de teste; confirmação enviada no checkout, webhook e polling de status.
- [x] **T5** `forgot-password`/`reset-password` reescritos (bug do token literal "reset" corrigido) usando o SMTP configurado.

### Fase 4 — Relatórios
- [x] **T7** Card "Eventos do organizador" em `/admin/usuarios/[id]`: total/concluídos/em andamento/cancelados.

### Cancelamento de inscrição pelo atleta (2026-07-08/09)
- [x] **Motivo obrigatório no cancelamento:** API `POST /api/registrations/[id]/cancel` rejeita sem justificativa (400); motivo salvo em `cancellationReason` + `auditLog`. Front usa `CancellationReasonModal`. Verificado em produção em 2026-07-10.
- [x] **Alerta a admins e organizador:** `lib/alerts/cancellation-requested.ts` (commit `5f14785`) notifica todos os admins + organizador do evento por e-mail e WhatsApp, com dedupe e respeito às configurações de canal. Canais confirmados habilitados pelo usuário. Verificado em produção em 2026-07-10 (imagem `corridas-app` buildada em 09/07 23:16 com o último commit `a106f8c`).

### Fase 5 — Análise
- [ ] **T12** Login Google: relatório de viabilidade entregue (ver resumo da sessão). Viável e de baixo esforço (NextAuth v5 + PrismaAdapter + modelos Account/Session já prontos). Requisitos: projeto Google Cloud, OAuth Client ID, tela de consentimento, redirect URI `…/api/auth/callback/google`, envs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Deixado para depois.

> ⚙️ **Preferência:** SEMPRE perguntar se o usuário quer implementar antes de codar tarefas/etapas — não implementar sem confirmação explícita.

### Pendências pós-deploy
- [ ] Configurar SMTP em **Admin → Configurações → E-mail (SMTP)** e validar com o botão "Enviar teste" (sem isso, T3/T5 não enviam e-mail).
- [ ] Trocar a senha root da VPS (foi compartilhada no chat). Opcional: autorizar chave SSH para deploys sem senha.

## Regras mantidas
- Não reintroduzir seed de eventos automáticos sem aprovação explícita.
- Não armazenar cartão nem dados sensíveis.
- Não apagar evento com inscrições/pedidos vinculados.

## Histórico (já corrigido)
- Upload de banner migrado para `presign` no front.
- Botão de exclusão de evento na UI do organizador; `DELETE /api/events/[id]` só remove sem dependências.
- Remoção do seed automático do evento exemplo.
