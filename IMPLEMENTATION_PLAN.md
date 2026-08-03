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

### Etapa 2 — Central de alertas (templates + variáveis) — EM ANDAMENTO
Spec aprovada pelo usuário e commitada: `docs/superpowers/specs/2026-08-03-central-alertas-templates.md`
(commit `e62de96`). Decisões fechadas via brainstorm: granularidade por alerta×canal×destinatário,
rollout incremental (LOW_STOCK → ABANDONED_CART → ADVERTISER_REQUEST_PENDING →
CANCELLATION_REQUESTED → conciliação → DAILY_SUMMARY → PAYMENT_ERROR → confirmação de inscrição),
versionamento completo com rollback, fallback silencioso pro texto de fábrica, envio de teste só
pro próprio admin, model relacional (`MessageTemplate`+`MessageTemplateVersion`, não JSON).
Arquivos-alvo previstos: `prisma/schema.prisma` (2 models novos), `lib/templates/` (novo: registry,
variables, render, resolve), `app/admin/alertas/` (tela ampliada) + rotas novas
`app/api/admin/message-templates/*`, todos os 8 pontos de disparo listados em §2.4 (migrados um por
vez). **Próximo passo real**: usuário revisar a spec escrita; depois `superpowers:writing-plans`
pra quebrar em tasks.

### Etapa 3 — Global × por-evento + resumo diário por evento — PENDENTE (depende da 2)

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

## 7. Pendências
- Confirmar com o usuário a ordem/prioridade real (§4.1) antes de abrir a Etapa 2.
- Desenhar e validar o schema de `MessageTemplate` antes de gerar migração.
- Rascunhar `docs/KIT_DELIVERY_SPEC.md` e `docs/ATHLETE_RATING_SPEC.md` **antes** de qualquer código
  das Etapas 9/10, e validar com o usuário.

## 8. Próxima ação
Ordem confirmada pelo usuário (§4). Abrir a Etapa 2 com `superpowers:brainstorming` para fechar o
desenho do `MessageTemplate` (schema, granularidade por alerta×canal, versionamento, fallback
seguro) antes de qualquer migração. Etapas 9-10 permanecem BLOQUEADAS até 1-8 estarem concluídas e
validadas — não iniciar spec nem brainstorm delas antes disso.
