# Resumo diário (admin + organizador) — Design

## Contexto

O admin e o organizador não têm nenhum resumo periódico do que aconteceu na plataforma/nos seus
eventos — só descobrem números acessando o dashboard manualmente. O usuário pediu um alerta diário
por e-mail e WhatsApp para os dois papéis, com conteúdo relevante a cada um, e com liga/desliga por
usuário individual (não um interruptor único por papel).

## Objetivo

Um cron diário (rodando às 7h, horário de Brasília) que envia, a cada admin e a cada organizador
ativo, um resumo do dia anterior (00h-23h59, `America/Sao_Paulo`) — por e-mail (detalhado) e
WhatsApp (condensado) — respeitando a preferência individual de cada usuário para cada canal, com
o padrão atual sempre ligado.

## Decisões confirmadas com o usuário

- **Preferência por usuário individual**, não um toggle global por papel.
- **Modelo de dados:** duas colunas booleanas em `User` (`dailySummaryEmailEnabled`,
  `dailySummaryWhatsappEnabled`), ambas `@default(true)` — não uma tabela genérica de preferências,
  já que hoje só este alerta precisa de escopo por usuário (YAGNI).
- **Janela e horário:** dia anterior completo, cron às 7h `America/Sao_Paulo`.
- **Conteúdo do admin:** novos usuários cadastrados, novos organizadores, eventos criados,
  inscrições concluídas (pagas), receita bruta do dia, taxas da plataforma retidas, repasses
  gerados/pendentes, pedidos cancelados/estornados no dia.
- **Conteúdo do organizador** (escopado aos seus próprios eventos): inscrições pagas, receita
  bruta, cupons usados, cancelamentos/estornos solicitados, lotes esgotados no dia.
- **Dia sem atividade:** envia mesmo assim, com os números zerados (confirma que o cron está
  rodando; não esconde regressões).
- **Formato:** e-mail com todos os itens detalhados; WhatsApp condensado (4-5 linhas com os
  números principais + link pro dashboard).
- **UI dos toggles:** nova seção "Notificações" em `app/admin/perfil/page.tsx` e
  `app/organizador/perfil/page.tsx`, reaproveitando as rotas `PUT` de perfil já existentes (sem
  rota nova).

## Arquitetura

### 1. Schema (migração aditiva)

```prisma
model User {
  // ...campos existentes...
  dailySummaryEmailEnabled    Boolean @default(true)
  dailySummaryWhatsappEnabled Boolean @default(true)
}
```

Sem backfill necessário — o `@default(true)` já vale para as linhas existentes.

### 2. Métricas — `lib/alerts/daily-summary-metrics.ts`

```ts
export interface AdminDailySummary {
  newUsersCount: number;
  newOrganizersCount: number;
  eventsCreatedCount: number;
  paidRegistrationsCount: number;
  grossRevenue: number;
  platformFeesRetained: number;
  payoutsGeneratedCount: number;
  payoutsGeneratedAmount: number;
  cancelledOrRefundedCount: number;
}

export interface OrganizerDailySummary {
  paidRegistrationsCount: number;
  grossRevenue: number;
  couponsUsedCount: number;
  cancellationsRequestedCount: number;
  soldOutBatchesCount: number;
}

export async function getAdminDailySummary(dayStart: Date, dayEnd: Date): Promise<AdminDailySummary>
export async function getOrganizerDailySummary(organizerId: string, dayStart: Date, dayEnd: Date): Promise<OrganizerDailySummary>
```

Implementadas com `db.*.count()`/`db.*.aggregate()` diretos, reaproveitando os `where`-builders de
`lib/admin/report.ts`/`lib/organizer/report.ts` (`buildReportPaymentWhere`,
`buildReportRegistrationWhere`, `buildReportOrderFeeWhere`, `buildReportRefundWhere`,
`buildOrganizerPayoutWhere`) onde o escopo (data + `organizerId`) já corresponde. `newUsersCount`/
`newOrganizersCount`/`eventsCreatedCount` são contagens novas por `createdAt` no intervalo + filtro
de `role`/tabela, sem builder existente reaproveitável.

### 3. Envio — `lib/alerts/daily-summary.ts`

```ts
export async function sendAdminDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }>
export async function sendOrganizerDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }>
```

Cada função segue o formato de loop já usado em `notifyReconciliationMismatches`
(`lib/alerts/reconciliation.ts:8-51`): busca os destinatários (`db.user.findMany({ where: { role:
"ADMIN", active: true } })` / organizadores ativos com pelo menos um evento), itera com
`try/catch` por destinatário (uma falha não aborta o lote), e loga erro no `console.error` sem
lançar. Diferença chave em relação ao padrão existente: o gate de "canal ligado" não vem de um
`PlatformSetting` global — vem das duas colunas do próprio destinatário
(`admin.dailySummaryEmailEnabled`/`dailySummaryWhatsappEnabled`).

Dedupe via `claimAlert("DAILY_SUMMARY", "DailySummary", \`${dateKey}:${user.id}\`, channel)` (
`dateKey` = `YYYY-MM-DD` do `dayStart`) — garante que um re-run do cron no mesmo dia não reenvia
pro mesmo destinatário no mesmo canal. Email só é tentado se `isSmtpReady(cfg)` (mesmo gate já
usado em `notifyReconciliationMismatches`); WhatsApp só se o usuário tiver `phone` preenchido.

### 4. Templates

- `lib/email.ts`: nova `sendDailySummaryEmail(to: string, role: "ADMIN" | "ORGANIZER", date: Date, metrics: AdminDailySummary | OrganizerDailySummary): Promise<void>`, usando o helper `layout()` já existente — uma tabela HTML com todos os itens listados acima.
- WhatsApp: texto condensado montado inline em `daily-summary.ts`, ex. para admin:
  ```
  Resumo de {data}: {N} novas inscrições pagas, R$ {receita} em receita bruta,
  {N} novos usuários, {N} eventos criados. Veja mais em /admin.
  ```
  (versão do organizador troca os números pelos dele, sem "novos usuários"/"eventos criados").

### 5. Cron — `app/api/cron/daily-summary/route.ts`

Mesmo formato de `app/api/cron/reconciliation/route.ts`: `POST`, autenticação via header
`x-cron-secret` comparado a `process.env.CRON_SECRET`, `401` em caso de mismatch. Calcula o
intervalo "ontem" em `America/Sao_Paulo` a partir do horário atual do servidor, chama as duas
funções de envio, retorna `{ adminsSent, adminsFailed, organizersSent, organizersFailed }`.

Fora do código: uma nova linha de crontab na VPS chamando essa rota às 7h horário de Brasília
(documentado em `TODO-RETOMAR-DESENVOLVIMENTO.md`/memória, seguindo o mesmo padrão das 3 rotas de
cron já existentes — nenhuma delas tem crontab-as-code no repo).

### 6. UI — toggles em "Meus Dados"

`app/admin/perfil/page.tsx` e `app/organizador/perfil/page.tsx` ganham uma seção "Notificações"
com dois checkboxes ("Receber resumo diário por e-mail" / "por WhatsApp"), adicionados ao corpo já
existente de `PUT /api/admin/profile` / `PUT /api/organizer/profile` (e ao Zod schema de cada
rota) — sem rota nova.

## Testes

- Testes unitários de `getAdminDailySummary`/`getOrganizerDailySummary` com fixtures conhecidas →
  números esperados.
- Testes unitários de `sendAdminDailySummaries`/`sendOrganizerDailySummaries` mockando `db`,
  `sendMail`, `sendWhatsAppMessage` e o módulo de dedupe: toggle desligado pula o canal; alerta já
  reivindicado (dedupe) pula o reenvio; falha em um destinatário não aborta o lote.
- Teste de rota do cron: 401 sem/segredo errado; sucesso chama as duas funções de envio com as
  datas corretas de início/fim de "ontem".
- Teste de rota para cada `PUT` de perfil (admin/organizador): as duas novas colunas persistem.

## Fora de escopo

- Botão de "enviar teste agora" (não pedido; pode ser adicionado depois se necessário).
- Qualquer preferência por tipo de métrica dentro do resumo (é tudo-ou-nada por canal, não por
  item do conteúdo).
- Alertas para outros papéis (`ATHLETE`, `SUPPORT`, `PARTNER`) — fora do pedido original.
