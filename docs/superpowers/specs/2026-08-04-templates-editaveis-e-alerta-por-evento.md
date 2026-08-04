# Templates 100% editáveis + alertas por evento (Etapa 3 adiantada) — Design

## Contexto e estado atual

A Etapa 2 (central de alertas com templates editáveis) terminou 100% — os 8 alertas leem do banco
via `getEffectiveTemplate`/`renderTemplate`, com fallback seguro pro texto de fábrica. Durante a
execução da última leva (migração dos 6 alertas restantes), o usuário pediu 3 coisas que ficaram
de fora do escopo original, todas resolvidas neste brainstorm:

1. Dois alertas (`RECONCILIATION_MISMATCH`, `DAILY_SUMMARY`) tinham uma parte "não editável"
   (tabela/lista gerada em código) — usuário quer tudo editável.
2. Quer poder cadastrar um contato (e-mail/telefone) pra receber o resumo diário de **um evento
   específico**, não o agregado de todos os eventos de um organizador/admin.
3. Quer poder personalizar o **texto** de qualquer alerta pra um evento específico, direto na tela
   de admin — o schema já suporta isso desde a Etapa 2 (`MessageTemplate.scope`/`eventId`), só
   faltou a UI.

Referência técnica: `IMPLEMENTATION_PLAN.md` §Etapa 2 (estado completo do sistema de templates) e
`docs/superpowers/specs/2026-08-03-central-alertas-templates.md` (spec original, motor de
variáveis, precedência).

## Decisões fechadas com o usuário (brainstorm 2026-08-04)

1. **`DAILY_SUMMARY` fica 100% editável sem motor novo** — como as métricas são um conjunto fixo e
   conhecido (não uma lista de tamanho variável), a solução é expor cada métrica como variável
   nomeada (mesmo padrão que o WhatsApp desse alerta já usa) e parar de colar a tabela
   automaticamente depois do texto do admin. Sem loop, sem condicional.
2. **`RECONCILIATION_MISMATCH` ganha um mecanismo de "linha repetida"** — só este alerta precisa,
   por ter uma lista de tamanho variável (N divergências). Solução: `rowTemplate` editável por
   canal, aplicado pelo código a cada divergência (loop continua no código, só o formato de cada
   linha vira editável).
3. **Separar "Taxas retidas pela plataforma" em duas métricas** — hoje `getAdminDailySummary` soma
   `Order.platformFeeAmount` + `Order.paymentFeeAmount` num número só. Vira duas variáveis
   distintas: `{{taxa_plataforma}}` e `{{taxa_servico}}`.
4. **Alerta diário por evento**: `DailySummaryRecipient` ganha `eventId` opcional (reaproveita a
   tabela existente). Cadastro na tela de edição do evento (organizador ou admin do evento — mesma
   permissão de hoje pra editar evento). Métricas: mesma lógica de agregação já existente, filtrada
   pro evento.
5. **Personalização de qualquer alerta por evento, direto em `/admin/alertas`** — só admin (mantém
   o padrão de permissão já existente pras rotas de template). Fica dentro da tela de templates
   já existente, não na tela de edição de evento (que é onde fica o item 4, um cadastro de contato,
   coisa diferente).

## Fora de escopo desta spec

- Organizador conseguir personalizar o texto dos próprios eventos (decisão fechada: só admin por
  enquanto — pode virar uma spec futura se pedido).
- Qualquer outro alerta ganhar um mecanismo de linha repetida (só `RECONCILIATION_MISMATCH` precisa
  hoje — se um alerta futuro precisar, reusa o mesmo `rowTemplate`).
- Envio manual/"disparar agora" de um alerta pra um evento (etapa de auditoria/UX separada, não foi
  o que o usuário pediu aqui).

## 1. `DAILY_SUMMARY` 100% editável

### 1.1 `lib/alerts/daily-summary-metrics.ts`

`AdminDailySummary.platformFeesRetained` (soma) vira dois campos:

```ts
export interface AdminDailySummary {
  newUsersCount: number;
  newOrganizersCount: number;
  eventsCreatedCount: number;
  paidRegistrationsCount: number;
  grossRevenue: number;
  platformFeeAmount: number;   // era platformFeesRetained (somado)
  serviceFeeAmount: number;    // novo — antes só existia somado
  payoutsGeneratedCount: number;
  payoutsGeneratedAmount: number;
  cancelledOrRefundedCount: number;
}
```

`getAdminDailySummary` para de somar (`feeAgg._sum.platformFeeAmount ?? 0) + (feeAgg._sum.paymentFeeAmount ?? 0)`)
e retorna os dois valores separados.

### 1.2 Registry — `DAILY_SUMMARY` ganha variáveis pra cada métrica

Reaproveita as variáveis que o WhatsApp já tem (`total_inscricoes_pagas`, `receita_periodo`,
`novos_usuarios`, `eventos_criados`, `cupons_usados`, `data_resumo`, `papel_destinatario`,
`link_plataforma`) — não cria nomes paralelos pra dado equivalente. Só adiciona as que faltam:

```
variables: [
  // já existiam (Task 16)
  "data_resumo", "papel_destinatario", "total_inscricoes_pagas", "receita_periodo",
  "novos_usuarios", "eventos_criados", "cupons_usados", "link_plataforma",
  // novas — só ADMIN
  "novos_organizadores", "taxa_plataforma", "taxa_servico",
  "repasses_gerados", "valor_repasses", "cancelamentos_estornos",
  // novas — só ORGANIZER
  "cancelamentos_solicitados", "lotes_esgotados",
]
```

Cada `recipientRole` (ADMIN/ORGANIZER) só recebe, no `values` passado pro `renderTemplate`, as
variáveis que fazem sentido pro seu papel (mesmo padrão já usado no WhatsApp desde a Task 16) — as
que não se aplicam simplesmente não entram no `values` daquele papel, e renderizam vazio se
referenciadas por engano no template errado.

`factoryDefault` do EMAIL passa a montar a tabela inteira via variáveis, ex. (admin):

```html
<p>Olá,</p>
<p>Resumo de <strong>{{data_resumo}}</strong> (visão de {{papel_destinatario}}):</p>
<table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
  <tbody>
    <tr><td>Novos usuários</td><td><strong>{{novos_usuarios}}</strong></td></tr>
    <tr><td>Novos organizadores</td><td><strong>{{novos_organizadores}}</strong></td></tr>
    <tr><td>Eventos criados</td><td><strong>{{eventos_criados}}</strong></td></tr>
    <tr><td>Inscrições pagas</td><td><strong>{{total_inscricoes_pagas}}</strong></td></tr>
    <tr><td>Receita bruta</td><td><strong>{{receita_periodo}}</strong></td></tr>
    <tr><td>Taxa da plataforma</td><td><strong>{{taxa_plataforma}}</strong></td></tr>
    <tr><td>Taxa de serviço</td><td><strong>{{taxa_servico}}</strong></td></tr>
    <tr><td>Repasses gerados</td><td><strong>{{repasses_gerados}} ({{valor_repasses}})</strong></td></tr>
    <tr><td>Cancelamentos/estornos</td><td><strong>{{cancelamentos_estornos}}</strong></td></tr>
  </tbody>
</table>
```

Análogo pro organizador, com o subconjunto de métricas que ele já recebe hoje.

### 1.3 `lib/email.ts::sendDailySummaryEmail`

Para de montar `tableRows`/concatenar tabela. Body vira só `renderTemplate(template.body, values, "EMAIL")`
— o `values` inclui TODAS as métricas (as que não fazem sentido pro papel ficam de fora do objeto,
renderizando vazio se o admin as referenciar por engano, mesmo padrão já usado em todo o resto do
sistema).

### 1.4 WhatsApp do admin ganha `taxa_plataforma`/`taxa_servico`

`buildAdminWhatsAppText` — hoje não mostra taxa nenhuma — pode opcionalmente incluir (decisão de
implementação: manter o texto de fábrica do WhatsApp como está hoje, só disponibilizando as 2
variáveis novas pra quem quiser customizar; não é obrigatório mudar o texto padrão do WhatsApp).

## 2. `RECONCILIATION_MISMATCH` — motor de linha repetida

### 2.1 Schema do registry — novo campo por entrada

`AlertTemplateDefinition` ganha um campo opcional:

```ts
interface AlertTemplateDefinition {
  // ...campos existentes
  rowTemplate?: (channel: AlertChannel) => string; // só pra alertas com lista de tamanho variável
  rowVariables?: string[]; // variáveis válidas dentro do rowTemplate (subconjunto separado de `variables`)
}
```

`RECONCILIATION_MISMATCH.rowTemplate`:

```ts
rowTemplate: (channel) =>
  channel === "EMAIL"
    ? `<tr><td>{{evento}}</td><td>{{pedido}}</td><td>{{status_local}}</td><td>{{status_gateway}}</td><td>{{situacao}}</td></tr>`
    : `{{evento}} — Pedido {{pedido}}: {{situacao}}`,
rowVariables: ["evento", "pedido", "status_local", "status_gateway", "situacao"],
```

### 2.2 `lib/email.ts::sendReconciliationMismatchEmail` / WhatsApp em `lib/alerts/reconciliation.ts`

Em vez de montar `<tr>` na mão pra cada mismatch, resolve o `rowTemplate` (mesmo mecanismo de
`getEffectiveTemplate`, mas buscando o campo `rowTemplate` do template salvo — schema do
`MessageTemplate` ganha coluna opcional `rowTemplate: String?`) e aplica `renderTemplate` pra cada
divergência, juntando o resultado (`<tbody>` no e-mail, `\n` no WhatsApp).

### 2.3 Migração de schema

```prisma
model MessageTemplate {
  // ...campos existentes
  rowTemplate String? @db.Text // só usado por alertas com lista de tamanho variável (hoje: RECONCILIATION_MISMATCH)
}
```

Aditiva, sem risco. `MessageTemplateVersion` também ganha `rowTemplate String?` pra manter o
histórico consistente.

### 2.4 Admin UI

`MessageTemplateEditor` ganha um segundo campo "Template de cada linha" (textarea), visível só
quando `alertKey` tem `rowTemplate` definido no registry — com sua própria legenda de variáveis
(`rowVariables`, separada da legenda principal).

## 3. Alerta diário por evento

### 3.1 Schema

```prisma
model DailySummaryRecipient {
  id        String                     @id @default(cuid())
  userId    String
  name      String
  type      DailySummaryRecipientType
  value     String
  eventId   String?                    // novo — quando presente, o resumo é só deste evento
  createdAt DateTime                   @default(now())

  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  event Event? @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([eventId])
  @@map("daily_summary_recipients")
}
```

`userId` continua obrigatório — pra um cadastro feito na tela de evento, aponta pro `userId` do
organizador do evento (mesmo quando é o admin que cadastra), preservando "esse contato pertence ao
dono do evento" como já é hoje pros contatos extras normais.

### 3.2 Nova agregação — `lib/alerts/daily-summary-metrics.ts`

```ts
export interface EventDailySummary {
  paidRegistrationsCount: number;
  grossRevenue: number;
  couponsUsedCount: number;
  cancellationsRequestedCount: number;
  vagasRestantes: number;
}

export async function getEventDailySummary(eventId: string, dayStart: Date, dayEnd: Date): Promise<EventDailySummary>
```

Reaproveita as mesmas queries de `getOrganizerDailySummary`, trocando o filtro `event: {organizerId}`
por `eventId` direto — mesmo shape de métricas do organizador (já é a granularidade certa), mais
`vagasRestantes` (soma de `capacity - soldCount` dos lotes ativos do evento, dado novo que só faz
sentido no contexto de 1 evento só).

### 3.3 Novo alertKey `DAILY_SUMMARY_EVENT`

```ts
DAILY_SUMMARY_EVENT: {
  alertKey: "DAILY_SUMMARY_EVENT",
  description: "Resumo diário de um evento específico — enviado só pros contatos cadastrados na tela de edição do evento.",
  channels: ["EMAIL", "WHATSAPP"],
  recipientRoles: ["ADMIN"], // papel genérico — quem recebe é sempre um contato avulso, não um usuário com role real
  variables: ["data_resumo", "nome_evento", "inscricoes_pagas", "receita_evento", "cupons_usados", "cancelamentos_solicitados", "vagas_restantes"],
  factoryDefault: (channel) => ...,
},
```

### 3.4 Job/cron

Novo passo em `app/api/cron/daily-summary/route.ts` (mesmo cron, sem cron novo): depois de
`sendAdminDailySummaries`/`sendOrganizerDailySummaries`, chama `sendEventDailySummaries(dayStart, dayEnd)`
— busca `DailySummaryRecipient.findMany({where: {eventId: {not: null}}})`, agrupa por `eventId`,
calcula `getEventDailySummary` uma vez por evento (não uma vez por contato), envia. Mesmo padrão de
dedupe (`claimAlert`/`unclaimAlert`) já usado nos outros dois.

### 3.5 UI — tela de edição de evento

Nova seção "Resumo diário deste evento" (organizador ou admin do evento — mesma permissão de editar
o evento hoje): lista de contatos cadastrados (nome, tipo, valor) + formulário de adicionar/remover,
mesmo componente visual já usado em Admin/Organizador → Perfil pros contatos extras de hoje,
adaptado pra passar `eventId` fixo em vez de `userId` da sessão.

## 4. Personalização de qualquer alerta por evento (admin, em `/admin/alertas`)

### 4.1 UI

Em `MessageTemplateList`, cada linha ganha um link "Personalizar para um evento" (além do
"Editar" que já existe, que continua editando o GLOBAL). Abre um seletor de evento (busca por
nome/slug, reaproveita o padrão de busca já usado em outras telas admin) e, ao escolher, navega pra
`/admin/alertas/templates/[id]/eventos/[eventId]` (rota nova) — mesmo `MessageTemplateEditor`,
mas operando sobre uma linha `scope=EVENT`+`eventId` em vez de `GLOBAL`.

### 4.2 Backend

- `GET /api/admin/message-templates/[id]/eventos/[eventId]` — busca a linha `EVENT` se existir; se
  não existir, retorna o conteúdo EFETIVO atual (resultado de `getEffectiveTemplate` com esse
  `eventId`) como ponto de partida, com um flag `isOverride: false` pra UI saber que ainda não foi
  criada uma linha própria.
- `PUT` no mesmo path — faz upsert da linha `scope=EVENT`+`eventId` (cria se não existir, com a
  mesma validação de variáveis e versionamento já usados na rota global).
- `DELETE` (nova capacidade) — remove a personalização, volta a usar o texto global. Precisa
  decidir: apagar a linha de vez, ou só marcar `active=false`? **Decisão: apagar de vez** — uma
  personalização por evento desativada não faz sentido guardar (diferente do global, que sempre
  existe como registro único); se o admin quiser recriar depois, edita nascendo do texto global de
  novo. Sem perda real: `MessageTemplateVersion` já não é herdado entre scopes diferentes hoje.

Todas as rotas continuam `checkAdminOnlyApiPermission` (decisão fechada: só admin).

## Migração de schema (consolidada desta spec)

1. `MessageTemplate.rowTemplate String? @db.Text` (aditiva).
2. `MessageTemplateVersion.rowTemplate String? @db.Text` (aditiva).
3. `DailySummaryRecipient.eventId String?` + relação `event Event? @relation(...)` (aditiva).

Sem `--accept-data-loss` necessário (só colunas novas opcionais). Seed: `DAILY_SUMMARY_EVENT` entra
no `ALERT_REGISTRY` e é pego automaticamente por `seedMessageTemplatesFromRegistry()` — nenhuma
linha nova precisa ser criada manualmente além do já documentado passo de `refresh-templates.ts`
(que não se aplica aqui, já que é um alertKey novo, não uma mudança de texto existente).

## Riscos

- `rowTemplate` é a primeira vez que o sistema tem 2 campos de template pro mesmo registro — vale
  cuidado extra na revisão pra garantir que `validateTemplateVariables` roda separadamente pro
  `body` (usa `variables`) e pro `rowTemplate` (usa `rowVariables`), sem misturar as duas listas.
- `getEventDailySummary` reaproveita a mesma classe de query do organizador — mesma cautela de
  performance já validada lá (nada novo, mesmo padrão).
- Personalização por evento no admin é a primeira tela que expõe o conceito de `scope=EVENT` pra um
  humano — vale um teste manual real (navegador) antes de considerar pronta, não só testes
  automatizados, já que é uma interação nova (buscar evento, ver "isOverride: false", criar,
  editar, apagar).

## Critérios de aceite

- `DAILY_SUMMARY` (e-mail e WhatsApp, admin e organizador) 100% editável — nenhuma parte do texto
  fica hardcoded fora do template, incluindo a tabela de métricas.
- `RECONCILIATION_MISMATCH` com `rowTemplate` funcional nos 2 canais, aplicado corretamente pra N
  divergências (0, 1, e várias).
- Contato de resumo diário por evento cadastrável na tela de edição de evento, recebendo métricas
  corretas e só daquele evento.
- Admin consegue criar, editar e remover uma personalização de qualquer alerta pra um evento
  específico, em `/admin/alertas`, e o resto do sistema (fallback pro global, depois pra fábrica)
  continua funcionando exatamente como documentado na spec original da Etapa 2.
- Suite completa + `tsc --noEmit` + `npm run build` limpos, mesma exigência de sempre.
