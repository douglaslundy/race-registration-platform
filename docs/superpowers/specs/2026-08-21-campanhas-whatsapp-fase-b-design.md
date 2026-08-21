# Design: Campanhas de WhatsApp — Fase B (população de destinatários)

## Contexto

Fase B de 6 do sub-projeto "Campanhas de WhatsApp em massa" (sub-projeto 3 de 3 do
`taskwhatsapp.md`). A Fase A entregou o modelo `Campaign` (por evento, obrigatório) e o CRUD
básico. Esta fase entrega a população de destinatários — e, por pedido explícito do usuário durante
o brainstorming, expande o alicerce da Fase A para suportar também campanhas **sem evento** ("pra
toda a plataforma"), uma capacidade restrita ao admin.

Como o schema da Fase A ainda não foi implantado em produção, é seguro reabri-lo nesta fase.

## Decisões confirmadas com o usuário

1. **Status de inscrição elegível**: qualquer status (`PENDING_PAYMENT`, `CONFIRMED`, `CANCELLED`,
   `TRANSFERRED`, `WAITLISTED`, `CANCELLATION_REQUESTED`) conta como destinatário de uma campanha
   por evento — sem filtro por status.
2. **"Enviar pra toda a plataforma"**: capacidade nova, restrita ao **admin** — nenhum organizador,
   mesmo com `campaignsEnabled`, pode disparar pra base inteira de atletas, só pros inscritos do
   próprio evento.
3. **Preparação síncrona, em lotes**: roda dentro do próprio request (sem fila/estado assíncrono
   persistido) — na escala real deste projeto (corridas com centenas/poucos milhares de inscritos)
   completa em segundos. Background de verdade fica pra uma fase futura, se a escala virar problema
   real.
4. **Filtro de `receivePromotionalMessages`**: sempre aplicado, nunca opcional pelo organizador/
   admin — é o mecanismo de consentimento da Fase 1 (sub-projeto 1), não uma preferência de
   campanha.

## Ajuste ao alicerce da Fase A

### `Campaign.eventId` vira opcional

```prisma
model Campaign {
  ...
  eventId String?
  ...
  event Event? @relation(fields: [eventId], references: [id], onDelete: Cascade)
  ...
}
```

`eventId = null` significa "campanha pra toda a plataforma". Nunca acessível por organizador —
apenas pelas rotas admin-only descritas abaixo.

### Extração do preâmbulo de acesso repetido (recomendação da revisão final da Fase A)

A revisão final da Fase A já identificou que o bloco `hasCampaignsAccess` + gate `actingAsAdmin` +
lookup de evento + lookup de campanha se repete, hoje, em 6 handlers de 4 arquivos — e recomendou
extrair antes desta fase, já que o mesmo mecanismo de código-duplicado foi a causa raiz de um bug
real em outra feature deste projeto (`social-links` esqueceu o branch `actingAsAdmin` numa rota).
Esta fase adiciona uma SEGUNDA árvore de rotas (admin-only, sem evento) que precisaria da mesma
lógica — o momento certo pra extrair é agora, não depois.

Novo `lib/campaigns/service.ts`, com uma função central:

```ts
export async function resolveCampaignRouteContext(params: {
  session: Session;
  eventId: string | null;   // null para rotas admin-only de plataforma
  campaignId?: string;      // omitido nas rotas de lista/criação
}): Promise<
  | { ok: true; scope: AssistantScope; event: Event | null; campaign?: Campaign }
  | { ok: false; response: NextResponse }
>
```

Encapsula: `resolveActingScope` → `hasCampaignsAccess` (403) → lookup do evento com branch
`actingAsAdmin` quando `eventId` não é nulo (404) → lookup da campanha escopado por `eventId`
quando `campaignId` é passado (404). Pra rotas admin-only de plataforma (`eventId: null` vindo de
`/api/admin/campaigns/*`), o helper exige `scope.actingAsAdmin` diretamente (nunca chama
`hasCampaignsAccess`, que não faz sentido pra uma capacidade que só admin tem).

Os 4 arquivos de rota já existentes (`app/api/events/[id]/campaigns/*`) são refatorados pra usar
esse helper — refactor mecânico, sem mudança de comportamento (a suíde de testes já existente da
Fase A deve continuar passando sem alteração).

## `CampaignRecipient` (novo modelo)

Campos desta fase apenas — nada de campos de envio (tentativas, `provider_message_id`, timestamps
de fila/entrega/leitura), que nascem na Fase D quando o código que os usa existir (mesmo princípio
já aplicado na Fase A: não criar coluna sem uso).

```prisma
enum CampaignRecipientStatus {
  PENDING
  QUEUED
  PROCESSING
  SENT
  DELIVERED
  READ
  FAILED
  SKIPPED
  INVALID_PHONE
  WHATSAPP_NOT_FOUND
  OPTED_OUT
  CANCELLED
}

model CampaignRecipient {
  id              String                  @id @default(cuid())
  campaignId      String
  athleteUserId   String
  registrationId  String?
  normalizedPhone String
  status          CampaignRecipientStatus @default(PENDING)
  failureReason   String?
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt

  campaign     Campaign     @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  athlete      User         @relation(fields: [athleteUserId], references: [id])
  registration Registration? @relation(fields: [registrationId], references: [id])

  @@index([campaignId, status])
  @@map("campaign_recipients")
}
```

Enum completo de 12 estados definido já, mesmo só `PENDING`/`OPTED_OUT`/`INVALID_PHONE`/`SKIPPED`
alcançáveis nesta fase — mesmo raciocínio do `CampaignStatus` da Fase A (evita `ALTER TYPE`
custoso quando as Fases D/E precisarem dos demais estados).

Deduplicação por telefone **não** é uma constraint de banco (`@@unique`) — é feita em memória
durante a população (ver abaixo), porque a regra de negócio é "a primeira ocorrência vence, as
demais viram `SKIPPED` com motivo", não "rejeitar a segunda tentativa de insert" — uma constraint
de unicidade forçaria usar `skipDuplicates` do Prisma, que descarta a linha duplicada silenciosamente
em vez de gravá-la como `SKIPPED` (perdendo a contagem que o documento original exige).

## Lógica de população

Novo `lib/campaigns/recipients.ts`:

```ts
export interface PrepareRecipientsResult {
  total: number;
  pending: number;
  optedOut: number;
  invalidPhone: number;
  duplicate: number;
}

export async function prepareCampaignRecipients(
  campaignId: string,
  eventId: string | null,
): Promise<PrepareRecipientsResult>
```

Passo a passo:
1. Apaga todos os `CampaignRecipient` existentes desta campanha (idempotente — permite reexecutar
   depois de editar a campanha, sempre que ainda em `DRAFT`; a rota que chama esta função garante o
   `DRAFT`, esta função não precisa checar de novo).
2. Se `eventId` não é nulo: lê `Registration` do evento **sem filtro de status** (conforme
   decisão do usuário), em lotes de ~500 (`skip`/`take`), selecionando `id`, `athleteUserId`,
   `athlete.receivePromotionalMessages`, `athlete.athleteProfile.phone`.
3. Se `eventId` é nulo (plataforma): lê `User` com `role: "ATHLETE", active: true`, mesmo esquema
   de lotes, sem `registrationId` (sempre `null` nesses registros).
4. Pra cada registro do lote, nesta ordem:
   - `!receivePromotionalMessages` → status `OPTED_OUT`.
   - Telefone ausente ou `normalizePhoneForWhatsApp` + validação de formato falha → status
     `INVALID_PHONE`.
   - Telefone já visto nesta execução (um `Set<string>` em memória, mantido entre lotes, nunca
     reiniciado a cada lote) → status `SKIPPED`, `failureReason: "Telefone duplicado nesta
     campanha"`.
   - Caso contrário → status `PENDING`, telefone registrado no `Set`.
5. Grava cada lote via `createMany` (sem `skipDuplicates` — não há constraint de unicidade que
   force isso).
6. Retorna as contagens agregadas (`total`, `pending`, `optedOut`, `invalidPhone`, `duplicate`).

### Validação de telefone

Novo `isValidWhatsAppPhone(normalized: string): boolean` em `lib/whatsapp.ts` (ao lado de
`normalizePhoneForWhatsApp`, que já existe e é reaproveitada sem alteração): verdadeiro quando o
telefone normalizado tem exatamente 12 ou 13 dígitos e começa com `"55"` (DDI Brasil — mesma
suposição já embutida em `normalizePhoneForWhatsApp`, este projeto não opera fora do Brasil).

## API

### Evento específico (organizador + admin)

- `POST /api/events/[id]/campaigns/[campaignId]/prepare-recipients` — só quando `status ===
  "DRAFT"` (400 caso contrário). Chama `prepareCampaignRecipients(campaignId, eventId)`, retorna o
  resumo. Auditoria: `CAMPAIGN_RECIPIENTS_PREPARED`.
- `GET /api/events/[id]/campaigns/[campaignId]/recipients/summary` — `groupBy` de
  `CampaignRecipient.status` pra esta campanha, sem exigir reexecutar a população.

### Plataforma inteira (admin-only, nova árvore de rotas)

- `GET/POST /api/admin/campaigns` — lista/cria campanhas com `eventId: null`. `POST` sempre exige
  `actingAsAdmin` (nunca aceita um organizador, mesmo habilitado).
- `GET/PATCH /api/admin/campaigns/[campaignId]`
- `POST /api/admin/campaigns/[campaignId]/cancel`
- `POST /api/admin/campaigns/[campaignId]/duplicate`
- `POST /api/admin/campaigns/[campaignId]/prepare-recipients`
- `GET /api/admin/campaigns/[campaignId]/recipients/summary`

Mesma forma de resposta e mesmas regras de state machine da árvore por evento — toda a lógica
compartilhada vive em `lib/campaigns/service.ts`.

## Permissões

`prepare-recipients` e o resumo de destinatários usam a permissão `campaigns.edit` já existente
(preparar destinatários é parte de gerenciar uma campanha em rascunho, não uma ação separada) — sem
nova entrada no catálogo de assistente.

As rotas admin-only de plataforma **não** passam pelo catálogo de permissão de assistente — são
`actingAsAdmin`-only por design, um assistente de admin (que já herda `actingAsAdmin: true` via
`resolveActingScope`) tem acesso normalmente, mas nenhum assistente de organizador jamais alcança
essas rotas.

## UI

- `CampaignsManager.tsx` ganha um botão "Preparar destinatários" (visível só quando `status ===
  "DRAFT"`), que chama o endpoint de preparação e mostra o resumo (total, elegíveis, excluídos por
  opt-out, telefone inválido, duplicado) inline no card da campanha.
- Nova tela `app/admin/campanhas/page.tsx` (nível de topo, fora de qualquer evento) — mesmo
  `CampaignsManager`, mas apontando pra `/api/admin/campaigns` em vez de
  `/api/events/[id]/campaigns`. Precisa de uma pequena generalização no componente (hoje ele monta
  a URL sempre com `eventId`) pra aceitar uma base de API alternativa.
- Link "Campanhas (plataforma)" no menu do admin, sempre visível (não depende de
  `campaignsEnabled`, que é um gate só de organizador).

## Fora de escopo

- Preview/dry-run com renderização de variáveis (Fase C).
- Verificação de existência de WhatsApp (`WHATSAPP_NOT_FOUND`) — estado definido no enum, mas
  nenhum código o produz ainda (Fase D/E).
- Preparação assíncrona/em background com estado `PREPARING` persistido — decisão explícita de
  ficar síncrono nesta fase.
- Tela paginada de "ver destinatários" um a um — só o resumo agregado por status.
- Qualquer envio real.

## Testes

- `lib/whatsapp.ts::isValidWhatsAppPhone`: unitário, formatos válidos/inválidos.
- `lib/campaigns/recipients.ts::prepareCampaignRecipients`: unitário/integração —
  evento com registros de vários status (todos elegíveis), opt-out excluído, telefone ausente/
  inválido excluído, telefone duplicado entre 2 registros vira `SKIPPED` mantendo o 1º como
  `PENDING`, reexecução limpa os registros antigos, modo plataforma (`eventId: null`) usa `User`
  em vez de `Registration`.
- `lib/campaigns/service.ts::resolveCampaignRouteContext`: unitário — cobre os 4 cenários (admin/
  organizador × evento/plataforma) e os 403/404 de cada combinação.
- Rotas de evento e de plataforma: testes de integração espelhando os já existentes da Fase A,
  cobrindo o novo `prepare-recipients`/`recipients/summary` e confirmando que a refatoração do
  service não quebrou nenhum teste já existente da Fase A.
- Sem testes de UI (convenção já estabelecida).
