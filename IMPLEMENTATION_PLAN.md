# IMPLEMENTATION_PLAN.md

**Última atualização:** 2026-08-02 23:39 (horário local do usuário, America/Sao_Paulo)
**Origem:** mega-prompt de 10 etapas do usuário (colado integralmente na conversa em 2026-08-02),
pedindo simultaneamente: central de alertas com templates editáveis + variáveis, alertas
globais/por-evento, novos alertas, auditoria de envio, redesenho da home, novo fluxo público de
anunciante, botões de redes sociais, tela de entrega de kits (nova feature) e sistema de rating de
atletas (nova feature).

**Convenção de status:** PENDENTE · EM ANDAMENTO · BLOQUEADO · CONCLUÍDO

---

## 0. Leitura obrigatória antes de continuar esta sessão

Este arquivo é a fonte de verdade. Se a sessão cair, releia esta seção + a seção "Próxima ação"
no final antes de qualquer outra coisa. Não repita a auditoria da Etapa 1 — ela já está feita e
documentada abaixo, com referências a arquivos reais do repositório.

**Contexto crítico que já existia antes deste pedido** (não descoberto agora, registrado em
`PROGRESSO.md` e na memória do agente):
- O sistema de rating de atletas **foi explicitamente adiado várias vezes** por pedido direto do
  usuário ("não iniciar nada sozinho, nem brainstorm, até eu retomar o assunto"). Este mega-prompt
  pede a Etapa 10 (rating), mas é um prompt genérico/template — não contém as decisões de produto
  que só o usuário pode tomar (critérios, peso, quem avalia). Ver §Decisões pendentes.
- A tela de entrega de kits nunca foi discutida em nenhuma sessão anterior — não existe spec, não
  existe schema, não existe nenhuma menção no código.
- O módulo de alertas (`lib/alerts/*`, `lib/notifications.ts`) já passou por uma auditoria completa
  em 2026-07-28 (`.superpowers/audits/alerts-module-audit-2026-07-28.md`) e por 3 rodadas de
  correção nesta mesma sessão (commits até `3f05e67`) + 4 itens de backlog resolvidos agora há
  pouco (commits ainda não feitos, ver `git status`). **Não redescobrir esses achados — reusar.**

---

## 1. Escopo do pedido (as 10 etapas, resumidas)

| # | Etapa | Tamanho estimado | Depende de |
|---|---|---|---|
| 1 | Auditoria completa do sistema | 1 sessão | — |
| 2 | Central de alertas: templates editáveis, variáveis `{{var}}`, preview, envio de teste, versionamento | **Grande** — requer schema novo | Etapa 1 |
| 3 | Alertas globais × por-evento com precedência, resumos diários por evento | **Grande** | Etapa 2 |
| 4 | Novos alertas recomendados (desativados por padrão) | Médio | Etapa 2 |
| 5 | Logs/auditoria de envio, retry, tratamento de falha | Médio | Etapa 2 |
| 6 | Home pública lista eventos (busca/filtro/paginação/SEO) | Médio | — (independente) |
| 7 | Fluxo público de anunciante com auth adiado pro checkout | Médio-Grande (segurança) | — (independente) |
| 8 | Botões de redes sociais administráveis | Pequeno | — (independente) |
| 9 | Tela de entrega de kits (feature nova, com spec própria) | **Grande** | Etapas 1-8 concluídas (pedido explícito do usuário no prompt) |
| 10 | Rating de atletas (feature nova, com spec própria) | **Grande** | Etapas 1-9 concluídas (idem) |

**Avaliação honesta de escopo:** as etapas 2-3 sozinhas (motor de templates com variáveis seguras,
versionamento, preview, precedência global×evento, admin UI completa) equivalem ao maior projeto já
executado nesta sessão de trabalho — maior que o marketplace de anunciantes inteiro. Etapas 9 e 10
são cada uma uma feature nova do zero em produção real (pagamentos, dados de atletas). Não é
razoável — nem seguro, numa plataforma em produção com pagamento real — implementar as 10 etapas
"de uma vez" sem checkpoints. O próprio prompt já prevê isso (`FLUXO OBRIGATÓRIO DE EXECUÇÃO`,
"Sugestão de separação" em 10 commits, e trava explícita nas Etapas 9/10: "somente inicie após
concluir e validar todas as anteriores"). Este plano segue essa estrutura.

---

## 2. Etapa 1 — Auditoria do sistema — **CONCLUÍDA (2026-08-02)**

### 2.1 Arquitetura

- **Framework:** Next.js 16 (App Router, Server Components + Route Handlers), React 19.
- **Linguagem:** TypeScript.
- **ORM/banco:** Prisma 5 + PostgreSQL (self-hosted via Supabase em VPS própria — **nunca Vercel**,
  ver memória `never_mention_vercel`).
- **Autenticação:** NextAuth v5 (`next-auth@5.0.0-beta.25`) + `@auth/prisma-adapter`. Roles em
  `User.role`: `ATHLETE`, `ORGANIZER`, `ADMIN`, `ADVERTISER` (confirmar enum exato em
  `prisma/schema.prisma` antes de mexer — não redigitar de memória).
  Helpers de permissão em `lib/auth/rbac.ts` (`requireAdmin`, `checkAdvertiserApiPermission`, etc.).
- **Pagamento:** Mercado Pago + Pagar.me, abstração em `lib/payment/`.
- **E-mail:** `nodemailer` via `lib/email.ts`. **WhatsApp:** Evolution API via `lib/whatsapp.ts` +
  `lib/whatsapp/evolution-client.ts`.
- **Jobs/cron:** **sem fila** (sem BullMQ/Redis/etc.) — rotas `app/api/cron/*` protegidas por header
  `x-cron-secret`, disparadas por `crontab` na VPS (fora do repo, documentado em
  `docs/superpowers/...` e na memória `cron_jobs_vps`). Existentes hoje:
  `abandoned-carts`, `reconciliation`, `expire-payments`, `daily-summary`, `ad-metrics-sync`,
  `expire-private-ads`.
- **Testes:** Vitest (200 arquivos / 1301 casos nesta sessão) + Playwright instalado
  (`@playwright/test`) mas **sem evidência de suíte E2E ativa no repo** — confirmar antes de
  prometer "testes E2E" na Etapa de testes.
- **Storage de arquivo:** Supabase Storage (`@aws-sdk/client-s3` como client S3-compatível).

### 2.2 Modelos de dados (schema real, `prisma/schema.prisma`)

31 models: `User`, `Session`, `Account`, `VerificationToken`, `AthleteProfile`, `OrganizerProfile`,
`Event`, `EventRoute`, `EventCategory`, `TicketBatch`, `Registration`, `Order`, `Payment`, `Refund`,
`Coupon`, `TransferPayout`, `ResultImport`, `RaceResult`, `AuditLog`, `FileAsset`,
`PlatformSetting`, `AlertLog`, `MessageLog`, `AdSlot`, `AdMetricsSnapshot`, `AdvertiserProfile`,
`AdPlan`, `AdPurchase`, `PrivateAd`, `AssistantPermission`, `DailySummaryRecipient`.

Pontos relevantes para as etapas seguintes:

- **`AthleteProfile`** tem: `cpf`, `birthDate`, `phone`, `gender`, `city`, `state`,
  `emergencyName`, `emergencyPhone`, `medicalNotes`, `preferredShirtSize`, `teamName`. **Não tem**
  campo de "categoria" (categoria é da inscrição/evento, não do atleta) nem histórico de
  performance. Isso afeta diretamente o mapeamento de variáveis da Etapa 2 e os "indicadores
  objetivos" da Etapa 10.
- **`PlatformSetting`** é uma tabela chave-valor genérica (`key`/`value` string) já usada para
  dezenas de configurações (`ads_marketplace_enabled`, `seo_default_title`, toggles de alerta,
  etc.). É o padrão natural para os links de redes sociais (Etapa 8) — **não precisa de migração
  de schema**, só de novas chaves + uma tela.
- **Não existe nenhum model de template de mensagem** (`MessageTemplate` ou equivalente). Todo
  texto de e-mail/WhatsApp hoje é string literal hardcoded em `lib/email.ts`, `lib/whatsapp.ts`,
  `lib/notifications.ts` e cada arquivo de `lib/alerts/*.ts`. A Etapa 2 (templates editáveis) exige
  **schema novo** — ver §4.
- **`AlertLog`** é só uma tabela de dedupe (`alertType`+`entityType`+`entityId`+`channel`+`sentAt`,
  unique composto) — não guarda o conteúdo enviado, não tem versão de template, não tem
  destinatário. **`MessageLog`** é o log de envio real (canal, assunto, destinatário, status,
  `providerMessageId`, `errorMessage`, timestamps de envio/entrega/leitura) — já cobre boa parte do
  requisito de auditoria da Etapa 5, mas não referencia qual *versão* de template gerou a mensagem
  (porque hoje não existe versão — é string fixa no código).
- **Nenhum model de "kit" nem de "avaliação/rating"** — confirma que Etapas 9 e 10 são 100% novas.

### 2.3 Perfis e permissões

4 papéis (`ATHLETE`, `ORGANIZER`, `ADMIN`, `ADVERTISER`). Controle de acesso é feito em duas
camadas — **sempre no backend**, nunca só na UI (padrão já estabelecido, ver `lib/auth/rbac.ts`):
página (`requireAdmin()` etc. em Server Components) e rota de API (checks `session.user.role`).
Organizadores só enxergam/gerenciam eventos onde são o `Event.organizerId` (ou têm
`AssistantPermission` delegada) — este escopo tem que ser preservado em qualquer tela nova.

### 2.4 Alertas/notificações — matriz completa

Já auditado em detalhe em 2026-07-28 (arquivo completo:
`.superpowers/audits/alerts-module-audit-2026-07-28.md` — 288 linhas, inclui tabela evento
disparador × destinatário × canal × dedupe × wiring × teste para os 7 alertas operacionais, mais a
camada transacional `notifyOrderConfirmed`). Resumo (matriz pedida pela Etapa 1):

| Alerta | Disparador | Destinatário | Canal | Template hoje | Serviço | Escopo | Dedupe |
|---|---|---|---|---|---|---|---|
| Confirmação de inscrição (`notifyOrderConfirmed`) | Checkout PAID / webhook / poller / conciliação | Comprador + atleta (se procuração) | E-mail + WhatsApp | string hardcoded `lib/notifications.ts` | `lib/notifications.ts` | Transacional, sempre ativo, sem toggle | Por canal/destinatário (`AlertLog`, corrigido nesta sessão) |
| `LOW_STOCK` (vagas se esgotando) | Pós-checkout | Organizador do evento | E-mail + WhatsApp | hardcoded `lib/alerts/low-stock.ts` | idem | Global (toggle + limiar em `/admin/alertas`) | `TicketBatch:batchId`, permanente |
| `ABANDONED_CART` | Cron + reenvio manual | Comprador | E-mail + WhatsApp | hardcoded `lib/alerts/abandoned-cart.ts` | idem | Global | `Order:orderId` |
| `PAYMENT_ERROR` (a+b) | Webhook/poller/expiração + reenvio manual | Comprador | E-mail + WhatsApp | hardcoded `lib/alerts/payment-error.ts` | idem | Global | `Payment:id` / `Order:id` |
| Conciliação (sem `alertType` próprio) | Cron + manual | Todos os `ADMIN` | E-mail + WhatsApp | hardcoded `lib/alerts/reconciliation.ts` | idem | Global | Por divergência específica (corrigido nesta sessão) |
| `CANCELLATION_REQUESTED` | Solicitação de cancelamento | Admins + organizador do evento | E-mail + WhatsApp | hardcoded `lib/alerts/cancellation-requested.ts` | idem | Global | Por solicitação (corrigido nesta sessão) |
| `DAILY_SUMMARY` | Cron diário | Admins/organizadores ativos + `DailySummaryRecipient` | E-mail + WhatsApp | hardcoded `lib/alerts/daily-summary.ts` | idem | **Por usuário** (padrão isolado, fora de `/admin/alertas`) | Por dia+usuário |
| `ADVERTISER_REQUEST_PENDING` | Webhook (pagamento de plano) | Todos os `ADMIN` | E-mail + WhatsApp | hardcoded `lib/alerts/advertiser-request-pending.ts` | idem | Global (card já existe em `/admin/alertas`, adicionado 2026-07-28) | Por destinatário |

**Nenhum alerta hoje tem**: template editável, variáveis nomeadas, versionamento, preview, envio de
teste, ou escopo por-evento. Todos são strings fixas + toggle on/off (e alguns nem toggle têm, ex.
confirmação de inscrição). Isso confirma que a Etapa 2 é, na prática, uma reescrita da camada de
templates de **todos os 8 fluxos acima**, não uma tela nova isolada.

### 2.5 Home pública, fluxo de anunciante, admin, componentes reutilizáveis

- **Home (`app/(public)/page.tsx`)**: hoje é só um hero estático (título + 2 botões). **Não lista
  nenhum evento.** A listagem pública real já existe em `/eventos`
  (`app/(public)/eventos/page.tsx`), que já tem paginação/filtro/`EventCard` com validação de lote
  (`getBatchStatus`, corrigido em sessão anterior — ver `PROGRESSO.md`). A Etapa 6 deve **reusar**
  essa lógica na home, não duplicar.
- **Fluxo de anunciante (`app/(public)/anuncie/page.tsx`)**: **já é público** (sem exigir login) e
  já reaproveita o padrão de `SubscribeButton`/PIX. Porém tem uma lacuna real: a página sempre
  submete `plans[0].id` (`RequestAdvertiserForm adPlanId={plans[0].id}`) — **não existe seleção de
  plano pelo visitante**, mesmo havendo cards visuais para vários planos. Isso é o gap concreto que
  a Etapa 7 precisa fechar (permitir escolher entre os planos exibidos), mais o fluxo de "login
  adiado até o checkout" quando o usuário logado tem outro papel.
- **Admin (`app/admin/*`)**: já tem `configuracoes`, `alertas` (5 cards hoje), `seo`, `anuncios`,
  navegação em `components/admin/AdminNav.tsx` (confirmar nome exato ao implementar). Padrão
  consistente: página Server Component com `requireAdmin()` + componentes client para formulários.
- **Componentes reutilizáveis relevantes**: `components/ui/ConfirmModal.tsx` e
  `components/ui/ErrorModal.tsx` (regra fixa do `CLAUDE.md` — nunca usar `alert()`/`confirm()`),
  `components/events/EventCard.tsx`, `components/admin/AlertConfigCard.tsx`.
- **Redes sociais**: nenhuma chave em `PlatformSetting`, nenhum componente, nenhum campo de admin
  hoje. 100% a construir (Etapa 8), mas o padrão de armazenamento (chave-valor) já existe.

### 2.6 Cobertura de testes

200 arquivos / 1301 casos em `tests/` (Vitest). Padrão observado: rotas de API e `lib/` têm teste
quase sempre; componentes React client (`"use client"`) **não têm teste dedicado** — convenção já
estabelecida e repetida nesta sessão ("componente React, convenção do projeto"). Isso será mantido
nas novas telas, salvo lógica de negócio extraída para função pura testável.

---

## 3. Decisões técnicas já tomadas

1. **Persistência do plano**: este arquivo (`IMPLEMENTATION_PLAN.md`) é a fonte de verdade, como
   pedido. Ele convive com `PROGRESSO.md` (regra permanente do `CLAUDE.md` desta sessão) — decisão:
   `IMPLEMENTATION_PLAN.md` guarda o detalhe tático desta iniciativa específica (as 10 etapas);
   `PROGRESSO.md` recebe um resumo de alto nível ao final de cada etapa concluída, como já é hábito
   no projeto. Não duplicar o conteúdo integralmente nos dois.
2. **Templates de mensagem precisam de schema novo.** Proposta: model `MessageTemplate` com
   `key` (identifica o alerta, ex. `ORDER_CONFIRMED_BUYER_EMAIL`), `channel`, `scope`
   (`GLOBAL` ou `EVENT`), `eventId?`, `subject?`, `body`, `active`, `updatedByUserId`,
   `updatedAt`, e um model auxiliar `MessageTemplateVersion` (ou campo `previousBody` simples) para
   histórico — **detalhar o desenho exato antes de migrar**, não migrar ainda.
3. **Motor de variáveis**: substituição de string (`{{var}}` → valor), **sem `eval`/Function
   dinâmica** (exigência explícita do usuário, e alinhado com a prática de segurança já usada no
   projeto — ex. `lib/validate-url.ts` para SSRF). Escapamento por canal: HTML-escape para e-mail
   quando o corpo for HTML; texto puro para WhatsApp (sem escape de tags, mas sanitizar quebras de
   controle). Variável desconhecida → erro de validação **antes de salvar** (na tela de edição), não
   em runtime de envio. Variável sem valor no momento do disparo → renderiza vazio de forma segura
   (nunca `"undefined"` literal), com log de aviso.
4. **Reaproveitar `PlatformSetting`** para redes sociais e para os toggles globais de alerta que já
   existem — não criar uma segunda tabela de configuração paralela.
5. **Reaproveitar `/eventos` (query + `EventCard` + `getBatchStatus`) na home** em vez de recriar a
   lógica de listagem.

---

## 4. Decisões do usuário — RESOLVIDAS (2026-08-02 23:45)

1. **Ordem de execução**: confirmada a ordem do próprio prompt — Etapas 2-5 (central de alertas)
   primeiro, depois 6-8 (home/anunciante/social), só depois 9-10 (kits/rating).
2. **Etapas 9 (kits) e 10 (rating)**: usuário confirmou que continuam adiadas — só retomar depois
   de concluir e validar as demais etapas (o que já é exatamente a trava que o próprio prompt
   define para essas duas). Nenhuma spec, brainstorm ou código dessas duas etapas até lá.
3. **Escopo do model `MessageTemplate`**: ainda a fechar via `superpowers:brainstorming` antes da
   migração — próxima ação real desta sessão.

---

## 5. Plano de execução por etapa

Cada etapa vira sua própria seção de tarefas quando eu começar a implementá-la (não escrever
subtarefas detalhadas de tudo agora — o próprio prompt pede plano técnico objetivo, e subtarefas de
uma etapa 9 pendem do que sair da etapa 2). Abaixo, só o essencial de cada uma e o status atual.

### Etapa 2 — Central de alertas (templates + variáveis) — **CONCLUÍDA** (parcial: 2 de 8 alertas migrados)

**Status:** Infraestrutura de templates 100% pronta (schema, variáveis, render engine, admin UI, APIs);
rollout incremental em andamento — apenas `LOW_STOCK` e `ABANDONED_CART` migrados para ler do banco,
conforme decisão de deploy conservador registrada na spec (commit `e62de96`).

**17 commits produzidos (Tasks 1-11):**
1. `d691a6a` — feat: adiciona `MessageTemplate` e `MessageTemplateVersion` ao schema
2. `1740a2a` — feat: catálogo de variáveis de template com origem real no schema
3. `76f19f8` — feat: motor de substituição de variáveis `{{var}}` sem eval
4. `61a5276` — fix: expandir `stripControlChars` pra incluir DEL e C1 (`\x7F-\x9F`)
5. `edfed4d` — feat: registry de alertas com textos de fábrica copiados da produção
6. `5a11f74` — fix: alertas registry e variables corrigem textos verbatim + 9 variáveis
7. `7cdcb03` — feat: resolução de template com precedência evento > global > fábrica
8. `f7d60e4` — fix: nested try/catch no fallback de factory (garantir nunca lança)
9. `e8e7596` — feat: semeadura idempotente dos 8 alertas com texto de fábrica
10. `31277de` — feat: rotas admin pra listar, ver e salvar templates de mensagem
11. `abde07d` — feat: rotas admin de preview, envio de teste e reversão de template
12. `ca932a1` — feat: tela admin de templates de mensagem (lista + editor + histórico)
13. `cb4bbdd` — fix: `handlePreview` error feedback + `handleRevert` confirmation modal
14. `e149894` — feat: `LOW_STOCK` passa a ler template do banco (1º alerta migrado)
15. `1913186` — fix: não fazer HTML-escape em subject lines (text puro SMTP, não HTML)
16. `d0a6067` — feat: `ABANDONED_CART` passa a ler template do banco (2º alerta migrado)
17. `1ce2157` — fix: tests/alert-abandoned-cart.test.ts — remover mocks, usar registry defaults

**Verificação (2026-08-03):**
- Vitest: 207 arquivos, 1349 testes — 100% passou
- TypeScript (tsc --noEmit): limpo
- npm run build: limpo

**Revisão final de branch inteira (2026-08-03):** "Ready to merge: With fixes" — 0 Critical, 3
Important (achados cross-task que nenhuma revisão de task isolada conseguiria ver), 10 Minor
(registrados, não bloqueantes). Corrigidos numa única rodada (commits `adbba9a`/`5d45672`/`08d21cb`,
re-revisão confirmou os 3 endereçados sem regressão):
1. WhatsApp de `ABANDONED_CART` não preenchia `link_finalizar_pagamento` (variável declarada mas
   renderizava vazia numa mensagem real).
2. `SAMPLE_VALUES` de preview/test-send era mantido à mão e ficou desatualizado (faltavam 9
   variáveis) — agora derivado do catálogo (`ALL_VARIABLES`), com teste garantindo que toda
   variável nova sempre tem exemplo.
3. Checkbox "Ativo" no editor confundia com os toggles de liga/desliga do alerta (que são coisa
   separada) — relabeled pra deixar claro que controla "usar texto personalizado vs. padrão do
   sistema", não se o alerta é enviado.

**DEPLOY CONCLUÍDO (2026-08-03):** `git push origin main` (`3f05e67..08d21cb`, 22 commits) → VPS:
`git pull` → `docker build` → `prisma db push --skip-generate` (aditivo, sem `--accept-data-loss`
necessário) → `docker compose up -d --no-deps app` → **seed rodado contra produção**
(`seedMessageTemplatesFromRegistry()`, executado via `ts-node` com `tsconfig-paths` registrado
manualmente dentro do container — a imagem de produção não tem `tsconfig.json` nem roda
`prisma/seed.ts` inteiro de propósito, pra não recriar as contas de teste admin/organizador que
esse script também cria). Resultado: **25 linhas criadas, 0 puladas** (11 alertas × combinações de
canal/destinatário), confirmado via `psql` direto (`SELECT count(*) FROM message_templates` = 25).
Smoke test: `/`, `/eventos` 200, container sem erros nos logs.

**Rollout 100% concluído (2026-08-03) — os 8 alertas migrados.** Plano
`docs/superpowers/plans/2026-08-03-migrar-alertas-restantes.md` (Tasks 13-19), via
`superpowers:subagent-driven-development`, commits `a4d252e..b75b59b`:
- Task 13 `a4d252e` — `ADVERTISER_REQUEST_PENDING`.
- Task 14 `59de47d`+`eee20b9` — `CANCELLATION_REQUESTED`; achou e corrigiu um bug real
  pré-existente no registry (WhatsApp dizia "Justificativa:" sem call-to-action, produção real
  dizia "Motivo:" com CTA — divergência da Task 4 original, não pega por nenhuma revisão até
  aqui).
- Task 15 `f8153a3` — `RECONCILIATION_MISMATCH` (e-mail parcial: assunto+introdução editáveis,
  tabela de divergências continua no código; WhatsApp migrado por completo).
- Task 16 `def69ed` — `DAILY_SUMMARY` (e-mail parcial igual acima; WhatsApp migrado por completo,
  registry estendido com 5 variáveis novas pra cobrir os textos ricos de admin/organizador).
- Task 17 `ccd550a` — `PAYMENT_ERROR` + `PAYMENT_ERROR_ORDER_CANCELLED`.
- Task 18 `cfb08ad`+`8c827fd` — `ORDER_CONFIRMED` + variantes de procuração (maior risco da leva,
  arquivo com histórico de bugs de mensagem duplicada — revisão extra com modelo mais capaz
  confirmou dedupe/claim intocado; achou e corrigiu um gap real: `ORDER_CONFIRMED_PROXY_ATHLETE`
  declarava `nome_atleta`/`nome_comprador` sem os call sites preencherem — inofensivo com o texto
  de fábrica, mas renderizaria em branco se um admin customizasse).

**Revisão final de branch inteira (2026-08-03):** "Ready to merge: With fixes" — 1 Critical + 2
Important, todos corrigidos numa rodada só (commits `4cbf04f`/`b75b59b`, re-revisão confirmou tudo
endereçado sem regressão, suíte final 207 arquivos / 1383 testes):
- **Critical** (o mais sério de toda a Etapa 2): os 25 templates já semeados em produção na leva
  anterior contêm o texto da FASE 1. Como `resolve.ts` dá prioridade ao banco sobre o registry, e
  `seedMessageTemplatesFromRegistry()` pula linhas existentes, as 2 mudanças de texto desta leva
  (fix do `CANCELLATION_REQUESTED`, WhatsApp real de `DAILY_SUMMARY`) **nunca chegariam em
  produção** sem uma sincronização manual — regredindo silenciosamente o resumo diário por WhatsApp
  pra um placeholder sem métricas. Corrigido: `refreshUnmodifiedTemplatesFromRegistry()`
  (`lib/templates/seed.ts`) — só re-sincroniza linhas com **zero** `MessageTemplateVersion` (nunca
  editadas por um admin desde a criação; qualquer edição real sempre grava uma versão antes de
  sobrescrever, então zero-versão prova "nunca customizado"), nunca sobrescreve customização real.
  Script standalone novo `prisma/refresh-templates.ts` (`npm run db:refresh-templates`) — não usa
  `prisma/seed.ts` inteiro de propósito (cria conta admin de demonstração, não deve rodar em prod).
- **Important** (×2): mais 4 variáveis declaradas no registry sem preenchimento no call site —
  mesma classe do achado de `ORDER_CONFIRMED_PROXY_ATHLETE` na Task 18 — em `PAYMENT_ERROR`/
  WhatsApp, `RECONCILIATION_MISMATCH`/WhatsApp, `ADVERTISER_REQUEST_PENDING`/WhatsApp e
  `DAILY_SUMMARY`/WhatsApp (2 papéis); e `DAILY_SUMMARY` vazando 6 variáveis só-de-WhatsApp pra
  legenda do editor de e-mail (`sendDailySummaryEmail` ganhou parâmetro `metrics` opcional,
  preenchido pelos 4 call sites, compartilhando a mesma extração de métricas que o WhatsApp já usa).

Suíte final 207 arquivos / 1383 testes, `tsc --noEmit` limpo. **Ainda não deployado** — a leva
anterior (2 alertas) já está em produção; esta leva (6 alertas + fixes) está só local, aguardando
autorização pra push/deploy (mesmo padrão de sempre — esta vez não perguntado ainda porque o
usuário interrompeu o meio da leva com dois pedidos novos, ver abaixo).

**⚠️ Passo de deploy obrigatório e não automático desta vez**: além do `git pull`/build/restart de
sempre (sem migração de schema nesta leva), rodar UMA VEZ contra produção:
`npx ts-node --compiler-options {"module":"CommonJS"} prisma/refresh-templates.ts` (mesmo
procedimento manual de `tsconfig-paths` já usado pro seed original, ver seção anterior). Sem isso,
o fix de `CANCELLATION_REQUESTED` e o WhatsApp novo de `DAILY_SUMMARY` continuam mudos em produção
mesmo depois do deploy — é a causa raiz do achado Critical acima.

**Pedido novo do usuário no meio da execução (2026-08-03), decisões de sequenciamento fechadas:**
1. **Templates completamente editáveis** — usuário não aceita a simplificação "tabela continua no
   código" usada em `RECONCILIATION_MISMATCH`/`DAILY_SUMMARY`. Direção já validada com o usuário:
   dar ao admin um **template de linha** editável (ex.: `{{label}}: {{value}}`) que o código aplica
   em loop — resolve o pedido sem violar a regra de segurança "sem eval, sem loop/condicional no
   motor" (o loop continua no código, só o formato de cada linha vira editável).
2. **Alerta diário por evento** — cadastrar um contato (e-mail/telefone) pra receber resumo diário
   de só um evento específico. Confirmado que é exatamente a Etapa 3 (`Global × por-evento`)
   chegando mais cedo.
3. **Sequenciamento combinado**: usuário escolheu terminar a migração mecânica primeiro (Tasks
   13-19, já concluída) e fazer os dois pedidos acima **juntos**, num brainstorm só (já que os dois
   mexem na mesma área de resumo diário/tabelas) — próxima ação real desta sessão.

### Etapa 3 — Global × por-evento + resumo diário por evento — PENDENTE (Etapa 2 100% completa;
próximo brainstorm já teria que cobrir isso + o template de linha editável, por pedido do usuário)

### Etapa 4 — Novos alertas (desativados por padrão) — PENDENTE (depende da 2)

### Etapa 5 — Logs/auditoria de envio — PARCIAL hoje via `MessageLog`/`AlertLog`; falta versão de
template e retry — PENDENTE

### Etapa 6 — Home lista eventos — PENDENTE (independente, pode começar em paralelo)

### Etapa 7 — Fluxo público de anunciante com auth adiada — PENDENTE (independente)

### Etapa 8 — Redes sociais administráveis — PENDENTE (independente, menor risco/esforço)

### Etapa 9 — Entrega de kits — BLOQUEADO (aguarda etapas 1-8 + validação do rascunho de spec)

### Etapa 10 — Rating de atletas — BLOQUEADO (aguarda etapas 1-9 + validação do rascunho de spec)

---

## 6. Riscos identificados

- **Reescrever templates de fluxos de pagamento ao vivo** (confirmação de inscrição, erro de
  pagamento) é a mudança de maior risco deste pacote — sistema em produção com dinheiro real. Migrar
  com fallback: se o template do banco estiver ausente/inválido, cair no texto padrão atual
  (hardcoded) em vez de falhar o envio.
- **Volume de trabalho**: 10 etapas, várias de porte grande, numa única iniciativa. Risco de start
  fragmentado sem checkpoint gerar retrabalho maior que o normal desta sessão (que sempre revisou
  cada plano/spec antes de codar). Mitigação: seguir brainstorm→spec→plano→implementação por etapa,
  como em todo o histórico do projeto, em vez de codar direto a partir do prompt genérico.
- **Etapas 9/10 conflitam com instrução explícita anterior do usuário** de esperar por pedido
  direto — mitigado ao tratar este prompt como esse pedido, mas sem pular a validação de spec antes
  do schema.

## 7. Pendências (atualizado 2026-08-03)

**Etapa 2 (infraestrutura de templates):** concluída. Seed contra banco real adiado pra pós-deploy
(limitação técnica de conexão nesta máquina; será executado via `seedMessageTemplatesFromRegistry()`
no VPS após o próximo deployment, seguindo padrão manual já usado para ad_slots/ad_plans).

**Etapas 3-8 (próximas):** independentes ou dependem apenas da Etapa 2 concluída. Recomendar com o
usuário a ordem de priorização:
- Etapa 3 (global × por-evento + resumo diário) — **recomendado próximo** — completa a infra de
  alertas com precedência e versões por evento.
- Etapas 6-8 — podem ser paralelas — home/anunciante/social — menor risco, independentes.
- Etapas 4-5 — novos alertas e auditoria — podem vir após etapa 3.

**Etapas 9/10 (kits + rating):** permanecem **BLOQUEADAS** até 1-8 estarem **100% concluídas,
testadas e deployadas** — seguir requisito explícito do prompt original. Rascunhos de spec
(`docs/KIT_DELIVERY_SPEC.md` e `docs/ATHLETE_RATING_SPEC.md`) aguardam pedido direto do usuário.

## 8. Próxima ação (2026-08-03)

Etapa 2 (infraestrutura de templates) **concluída e verificada** (17 commits, 1349 testes passando,
build limpo). Aguardar próximo deployment + confirmação do usuário sobre priorização das Etapas 3-8
antes de iniciar a próxima frente de trabalho. Etapas 9-10 continuam BLOQUEADAS (trava registrada).
