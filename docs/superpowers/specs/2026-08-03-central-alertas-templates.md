# Central de alertas — templates editáveis com variáveis (Etapa 2 do pacote de 10 etapas) — Design

## Contexto e estado atual

Pedido original: mega-prompt de 10 etapas do usuário (2026-08-02) cobrindo central de alertas,
home pública, fluxo de anunciante, redes sociais, entrega de kits e rating de atletas. Ordem de
execução confirmada pelo usuário: **Etapas 2-5 (central de alertas) → 6-8 (home/anunciante/social)
→ 9-10 (kits/rating, bloqueadas até concluir e validar as anteriores)**. Esta spec cobre a Etapa 2
— a infraestrutura de templates editáveis com variáveis, que é pré-requisito de tudo o mais nas
Etapas 3-5. Auditoria completa do estado atual (arquitetura, schema, matriz de alertas existentes)
está em `IMPLEMENTATION_PLAN.md` §2 — não repetida aqui, só referenciada.

**Resumo do problema real**: hoje existem 8 pontos de disparo de mensagem (`lib/notifications.ts`
+ 7 arquivos em `lib/alerts/*.ts`), todos com texto **hardcoded** em string literal no código.
Nenhum é editável pelo admin, nenhum tem variável nomeada, nenhum tem versionamento, nenhum
distingue configuração global de configuração por evento. Trocar um texto hoje exige deploy de
código.

## Decisões fechadas com o usuário (brainstorm de 2026-08-02/03)

1. **Granularidade**: um `MessageTemplate` por combinação `alertKey` × `channel` × `recipientRole`
   (não um registro só por alerta com abas). Ex.: confirmação de inscrição vira 4 registros
   possíveis (comprador/e-mail, comprador/WhatsApp, atleta/e-mail, atleta/WhatsApp).
2. **Rollout incremental**: a migração cria a infraestrutura e semeia os 8 alertas com o texto de
   fábrica atual (nada muda no comportamento no dia 1). Depois, um alerta por vez passa a ler do
   banco, na ordem: `LOW_STOCK` → `ABANDONED_CART` → `ADVERTISER_REQUEST_PENDING` →
   `CANCELLATION_REQUESTED` → conciliação → `DAILY_SUMMARY` → `PAYMENT_ERROR` → confirmação de
   inscrição (os dois últimos tocam pagamento, migrados por último).
3. **Versionamento**: histórico completo com rollback (`MessageTemplateVersion`), não só
   "última alteração".
4. **Fallback de segurança**: se o template do banco estiver ausente, inativo ou com variável
   inválida no momento do envio, o sistema usa o texto de fábrica (constante no código) e loga um
   aviso — nunca bloqueia o envio, nunca manda mensagem vazia/quebrada.
5. **Envio de teste**: sempre vai só pro e-mail/WhatsApp cadastrado na conta do admin logado —
   nunca aceita destinatário arbitrário.
6. **Armazenamento**: model relacional próprio (`MessageTemplate` + `MessageTemplateVersion`), com
   FK real pra `Event` no caso de escopo por evento — não um blob JSON dentro de `PlatformSetting`.

## Fora de escopo desta spec (fica para as Etapas 3-5, specs futuras)

- Escopo por evento em si (criar/editar um override por evento) — Etapa 3. Esta spec já desenha o
  schema (`scope`/`eventId`) e a função de resolução de precedência, mas a **UI** para criar um
  override por evento fica pra Etapa 3.
- Resumos diários configuráveis por evento — Etapa 3.
- Novos tipos de alerta (pagamento pendente, evento próximo, etc.) — Etapa 4.
- Retry/reprocessamento de falha de envio — Etapa 5 (hoje `MessageLog` já registra status/erro; a
  ampliação de retry fica pra depois).

## Modelo de dados

```prisma
model MessageTemplate {
  id              String   @id @default(cuid())
  alertKey        String   // "ORDER_CONFIRMED" | "LOW_STOCK" | "ABANDONED_CART" | "PAYMENT_ERROR" |
                            // "PAYMENT_ERROR_ORDER_CANCELLED" | "RECONCILIATION_MISMATCH" |
                            // "CANCELLATION_REQUESTED" | "DAILY_SUMMARY" | "ADVERTISER_REQUEST_PENDING"
  channel         String   // "EMAIL" | "WHATSAPP"
  recipientRole   String   // "BUYER" | "ATHLETE" | "ORGANIZER" | "ADMIN"
  scope           String   @default("GLOBAL") // "GLOBAL" | "EVENT"
  eventId         String?
  active          Boolean  @default(true)
  subject         String?  // null quando channel = WHATSAPP
  body            String
  updatedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  event     Event?  @relation(fields: [eventId], references: [id], onDelete: Cascade)
  updatedBy User?   @relation(fields: [updatedByUserId], references: [id], onDelete: SetNull)
  versions  MessageTemplateVersion[]

  @@unique([alertKey, channel, recipientRole, scope, eventId])
  @@index([eventId])
  @@map("message_templates")
}

model MessageTemplateVersion {
  id              String   @id @default(cuid())
  templateId      String
  subject         String?
  body            String
  active          Boolean
  changedByUserId String?
  createdAt       DateTime @default(now())

  template MessageTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@index([templateId])
  @@map("message_template_versions")
}
```

Notas de migração:
- `@@unique([alertKey, channel, recipientRole, scope, eventId])` protege sozinha os registros com
  `scope="EVENT"` (cada `eventId` é distinto). Para `scope="GLOBAL"` (`eventId=null`), o Postgres
  trata `NULL` como não-igual a `NULL` em constraints únicas, então a constraint **não** impede
  duas linhas globais duplicadas por conta própria. A rota de escrita (`PUT`) fecha essa lacuna na
  aplicação: sempre faz `upsert` por `alertKey`+`channel`+`recipientRole`+`scope="GLOBAL"` (busca
  antes de criar), nunca um `create` direto — coberto por teste dedicado ("não deixa criar dois
  templates globais para o mesmo alerta/canal/destinatário").
- Todas as colunas novas, nenhuma alteração em coluna existente — migração aditiva, sem risco de
  perda de dado, sem lock longo (tabelas novas, vazias).
- Rollback: `DROP TABLE message_template_versions; DROP TABLE message_templates;` — seguro porque
  nenhum outro dado depende dessas tabelas (o fallback de fábrica garante que o sistema continua
  funcionando mesmo sem elas, então a migração é reversível a qualquer momento antes de qualquer
  alerta ser migrado pra ler do banco).

## Arquitetura de código

### `lib/templates/registry.ts` (novo)

Catálogo estático, no código (não no banco), com uma entrada por `alertKey`:

```ts
interface AlertTemplateDefinition {
  alertKey: string;
  description: string;           // exibida na listagem admin
  channels: ("EMAIL" | "WHATSAPP")[];
  recipientRoles: ("BUYER" | "ATHLETE" | "ORGANIZER" | "ADMIN")[];
  variables: string[];           // nomes válidos pra ESTE alerta (subconjunto do catálogo geral)
  factoryDefault: (channel, recipientRole) => { subject?: string; body: string };
}
```

`factoryDefault` é literalmente o texto hardcoded que existe hoje em cada arquivo — copiado, não
reescrito, pra garantir que o comportamento de produção não muda até o rollout explícito de cada
alerta (decisão 2).

### `lib/templates/variables.ts` (novo) — catálogo de variáveis e origem real

Mapeamento completo variável → origem, cruzado contra o schema real (não o que o prompt sugeriu
sem checar). Cada variável documenta: nome, descrição, entidade de origem, campo real, e
comportamento quando ausente (sempre: string vazia, nunca erro).

| Variável | Origem real | Observação |
|---|---|---|
| `{{nome_atleta}}` | `Registration.athlete.name` (`User.name`) | — |
| `{{primeiro_nome_atleta}}` | derivado de `User.name` (primeira palavra) | calculado, não é coluna |
| `{{email_atleta}}` | `User.email` | — |
| `{{telefone_atleta}}` | `AthleteProfile.phone` | pode ser vazio |
| `{{documento_atleta}}` | `AthleteProfile.cpf` | pode ser vazio |
| `{{data_nascimento_atleta}}` | `AthleteProfile.birthDate` | formatada `dd/mm/aaaa` |
| `{{equipe_atleta}}` | `AthleteProfile.teamName` | pode ser vazio |
| `{{categoria_inscricao}}` | `Registration` → `EventCategory.name` | renomeada de `categoria_atleta` — categoria é da inscrição, não existe no perfil do atleta |
| `{{nome_organizador}}` | `Event.organizer.user.name` | — |
| `{{email_organizador}}` | `Event.organizer.user.email` | — |
| `{{telefone_organizador}}` | `OrganizerProfile.phone` | pode ser vazio |
| `{{empresa_organizador}}` | `OrganizerProfile.companyName` | pode ser vazio |
| `{{nome_evento}}` | `Event.title` | — |
| `{{descricao_evento}}` | `Event.description` | — |
| `{{data_evento}}` / `{{hora_evento}}` | `Event.startAt` | formatadas em horário de Brasília, mesma função `toDatetimeLocal`-adjacente já usada no projeto |
| `{{local_evento}}` / `{{cidade_evento}}` / `{{estado_evento}}` / `{{endereco_evento}}` | `Event.venueName` / `Event.city` / `Event.state` / `Event.addressLine` (confirmado no schema real) | `venueName`/`addressLine` podem ser vazios; `city`/`state` são obrigatórios |
| `{{link_evento}}` | derivado de `Event.slug` + `NEXT_PUBLIC_APP_URL` | calculado |
| `{{nome_modalidade}}` | `EventRoute.name` (quando a inscrição tem rota associada) | pode ser vazio |
| `{{numero_inscricao}}` | `Registration.id` | — |
| `{{status_inscricao}}` | `Registration.status`, traduzido via `lib/registration-status.ts` já existente | — |
| `{{data_inscricao}}` | `Registration.createdAt` | — |
| `{{valor_inscricao}}` | `Order.totalAmount` (ou `TicketBatch.priceAmount` conforme o alerta), formatado via `lib/format.ts::formatCurrency` já existente | — |
| `{{codigo_confirmacao}}` | `Order.id` | mesmo identificador já usado nos e-mails atuais |
| `{{data_cancelamento}}` | `Registration` cancelamento — data do evento de cancelamento (auditoria) | — |
| `{{motivo_cancelamento}}` | motivo informado no cancelamento (campo já existente no fluxo de cancelamento) | — |
| `{{status_reembolso}}` / `{{valor_reembolso}}` | `Refund.status` / `Refund.amount` | só disponível em alertas de cancelamento/reembolso |
| `{{status_pagamento}}` | `Payment.status`, traduzido | — |
| `{{valor_pagamento}}` | `Payment.amount` | — |
| `{{forma_pagamento}}` | `Payment.method` | — |
| `{{data_pagamento}}` | `Payment.paidAt` | — |
| `{{codigo_transacao}}` | `Payment.providerPaymentId` | — |
| `{{nome_plataforma}}` | `getAppName()` (já existe, usado no SEO) | — |
| `{{email_suporte}}` / `{{telefone_suporte}}` | novas chaves em `PlatformSetting` (não existem hoje — **a implementar como configuração simples de admin, sem tela dedicada nesta etapa**, reaproveitando o padrão chave-valor) | vazio até o admin preencher |
| `{{link_plataforma}}` | `NEXT_PUBLIC_APP_URL` | — |
| `{{ano_atual}}` | `new Date().getFullYear()` | calculado |

**Variáveis do prompt que NÃO viram variável funcional nesta etapa** (sem origem real e fora de
escopo criar agora): `{{categoria_atleta}}` (substituída por `{{categoria_inscricao}}`, que é o
dado real). Nenhuma outra variável da lista do prompt ficou sem origem — todas as demais mapeiam
pra campo real do schema atual.

Cada `alertKey` do registry declara **qual subconjunto** dessas variáveis está disponível (ex.:
`LOW_STOCK` não tem `{{codigo_transacao}}`, porque não existe pagamento envolvido nesse alerta).

### `lib/templates/render.ts` (novo) — motor de substituição

```ts
function renderTemplate(body: string, values: Record<string, string | undefined>): string
function validateTemplateVariables(body: string, allowedVariables: string[]): { valid: boolean; unknown: string[] }
```

`renderTemplate` troca `{{nome}}` por `values[nome] ?? ""` via regex simples (`/\{\{(\w+)\}\}/g`),
sem `eval`, sem `Function()`, sem lógica condicional. Escapamento: quando `channel === "EMAIL"`,
HTML-escape do valor antes de inserir (previne XSS caso um valor venha de entrada do usuário, ex.
`Event.title`); `WHATSAPP` não escapa HTML (não faz sentido no canal) mas remove caracteres de
controle. `validateTemplateVariables` roda **antes de salvar** (na rota `PUT` do template) —
qualquer `{{algo}}` fora da lista permitida do `alertKey` bloqueia o save com erro claro.

### `lib/templates/resolve.ts` (novo) — precedência

```ts
async function getEffectiveTemplate(
  alertKey: string, channel: string, recipientRole: string, eventId?: string
): Promise<{ subject?: string; body: string; source: "event" | "global" | "factory" }>
```

Ordem: 1) linha `scope=EVENT` + `eventId` casando e `active=true` → 2) linha `scope=GLOBAL` e
`active=true` → 3) `factoryDefault` do registry. Qualquer erro de banco (timeout, conexão) também
cai no fallback de fábrica (decisão 4) — a resolução nunca lança, sempre retorna algo enviável.

### Pontos de disparo (migração incremental, decisão 2)

Cada um dos 8 arquivos (`lib/alerts/low-stock.ts`, `abandoned-cart.ts`,
`advertiser-request-pending.ts`, `cancellation-requested.ts`, `reconciliation.ts`,
`daily-summary.ts`, `payment-error.ts`, `notifications.ts`) troca a string concatenada na mão por:
`const { subject, body } = await getEffectiveTemplate(...); const text = renderTemplate(body, {...valores reais que a função já calcula hoje...})`. Nenhuma mudança na lógica de dedupe/claim/envio
existente — só a origem do texto muda.

## Admin UI

Amplia `/admin/alertas` (não cria tela nova) com uma segunda seção "Templates de mensagem", abaixo
dos cards de toggle já existentes:
- Tabela: `alertKey` (nome amigável do registry) × canal × destinatário, com status
  ativo/inativo, escopo (badge "Global"), última alteração + responsável.
- Clique abre um editor (modal, reaproveitando `ConfirmModal`-like shell ou página dedicada
  `/admin/alertas/templates/[id]`, decisão de implementação a bater no plano) com: campo assunto
  (só se EMAIL), corpo (textarea), legenda de variáveis pesquisável agrupada por categoria (Atleta/
  Organizador/Evento/Inscrição/Cancelamento/Pagamento/Plataforma, igual às categorias do prompt),
  preview ao vivo com dados de exemplo fictícios, botão "Enviar teste" (POST separado, sempre usa
  o e-mail/telefone da sessão do admin), botão "Ver histórico" (lista de `MessageTemplateVersion`
  com botão reverter por versão).
- `active` (ativo/inativo) editável na própria listagem, sem abrir o editor — ação rápida.

## Endpoints novos

- `GET /api/admin/message-templates` — lista (com filtro por `alertKey`/`channel`/`scope`).
- `GET /api/admin/message-templates/[id]` — detalhe + histórico de versões.
- `PUT /api/admin/message-templates/[id]` — salva (valida variáveis, grava versão anterior,
  atualiza `updatedByUserId`).
- `POST /api/admin/message-templates/[id]/preview` — renderiza com dados de exemplo, não envia nada.
- `POST /api/admin/message-templates/[id]/test-send` — envia pro e-mail/telefone do admin logado.
- `POST /api/admin/message-templates/[id]/revert/[versionId]` — restaura uma versão antiga (grava
  a versão atual como nova entrada de histórico antes de sobrescrever).

Todas exigem `requireAdmin()` — nenhuma pertence ao escopo de organizador nesta etapa (override por
evento pelo organizador, se fizer sentido, é decisão da Etapa 3).

## Segurança e permissões

- Todas as rotas acima checam `requireAdmin()` no backend (nunca só na UI).
- `test-send` nunca aceita um destinatário no corpo da requisição — o e-mail/telefone vêm sempre da
  sessão autenticada, fechando o risco de abuso pra spam de terceiros.
- Validação de variável desconhecida acontece no backend (rota `PUT`), não só no client — um
  request direto à API não consegue salvar um template com variável inválida.
- Nenhuma execução dinâmica de código em nenhum ponto do motor de renderização.

## Testes

- `lib/templates/render.test.ts`: substituição simples, variável ausente vira string vazia, HTML
  escape no canal EMAIL, sem escape no WHATSAPP, `validateTemplateVariables` rejeita variável
  desconhecida e aceita lista vazia/corpo sem variáveis.
- `lib/templates/resolve.test.ts`: precedência evento > global > fábrica; fallback quando linha
  está `active=false`; fallback quando a query lança erro.
- Rotas admin: permissão (não-admin recebe 403/404 conforme padrão do projeto), `PUT` rejeita
  variável inválida e grava `MessageTemplateVersion`, `test-send` sempre usa o destinatário da
  sessão (nunca aceita um do body), `revert` restaura conteúdo correto e registra novo histórico.
- Cada alerta migrado (na ordem da decisão 2) ganha um teste confirmando que agora usa
  `getEffectiveTemplate`/`renderTemplate` e que, sem nenhum template no banco (banco limpo), o
  texto enviado é idêntico ao texto hardcoded anterior (garante zero regressão comportamental).

## Riscos

- Maior risco: migrar `notifications.ts` (confirmação de inscrição) e `payment-error.ts` — tocam
  fluxo de pagamento ao vivo. Mitigado pela ordem de rollout (migrados por último, depois de
  validar o padrão nos 6 alertas anteriores) e pelo fallback de fábrica silencioso.
- Volume de trabalho: 8 arquivos de disparo + 6 rotas admin + 1 tela ampliada + 2 tabelas novas.
  Maior peça de infraestrutura desta sessão até agora — plano de implementação (próximo passo) deve
  quebrar isso em tasks pequenas e testáveis independentemente, seguindo
  `superpowers:subagent-driven-development` como o resto do projeto já faz para trabalho deste
  porte.

## Critérios de aceite desta etapa

- Migração aplicada, tabelas criadas, nenhuma regressão nos 200 arquivos de teste existentes.
- Os 8 alertas semeados no banco com o texto de fábrica atual, idêntico ao que está em produção.
- Pelo menos os 2 primeiros alertas da ordem de rollout (`LOW_STOCK`, `ABANDONED_CART`) migrados
  de fato para ler do banco, com teste de zero-regressão.
- Tela admin funcional: listar, editar, validar variável inválida, preview, enviar teste, ver
  histórico, reverter — para os alertas já migrados.
- `tsc --noEmit`, suíte completa e `npm run build` limpos.
- Escopo por evento (Etapa 3) e os alertas restantes da ordem de rollout ficam para a spec/plano
  seguinte — não é critério de aceite desta etapa terminar os 8 de uma vez (decisão 2).
