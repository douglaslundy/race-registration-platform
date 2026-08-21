# Design: Campanhas de WhatsApp — Fase A (modelo de dados + CRUD básico)

## Contexto

Sub-projeto 3 de 3 do `taskwhatsapp.md` ("Campanhas de WhatsApp em massa") — o maior e mais
complexo dos três, decomposto (via `superpowers:brainstorming`) em 6 fases menores, cada uma com
seu próprio spec/plano/execução:

- **Fase A** (este documento): modelo de dados + CRUD básico (criar/listar/ver/editar/cancelar/
  duplicar campanhas em estado `DRAFT`, sem disparo real).
- Fase B: população de destinatários (consulta de inscritos do evento, filtro por
  `receivePromotionalMessages`, preparação em background).
- Fase C: composição de mensagem (reaproveitar alerta existente ou escrever nova, catálogo de
  variáveis, preview, envio de teste).
- Fase D: disparo real (agendamento que sobrevive a restart, worker via cron, rate limiting,
  retries, circuit breaker).
- Fase E: status de entrega + métricas (estender o webhook/`MessageLog` já existentes).
- Fase F: controles operacionais (pausar/retomar/cancelar com segurança de concorrência, auditoria
  completa).

Nenhum código de campanha existe hoje (confirmado por busca). A versão da Evolution API em
produção é a **2.3.7** (informada pelo usuário) — relevante só a partir da Fase D/E.

## Descobertas da auditoria

- **Modelo de acesso**: campanhas são uma ferramenta do **organizador, por evento** (mesmo padrão
  de `EventSocialLink`/redes sociais, `EventSponsor`/patrocínio, entrega de kits) — não uma
  ferramenta centralizada só do admin. O admin tem supervisão/gestão total sobre qualquer
  campanha de qualquer organizador (mesmo padrão de `abandoned-carts/notify`, que tem rota própria
  pro organizador e outra pro admin).
- **Template exato a seguir**: `app/api/events/[id]/social-links/route.ts`. Padrão:
  `checkApiPermission("<recurso>.<ação>")` → `resolveActingScope(session)` →
  `scope.actingAsAdmin ? db.event.findUnique(...) : db.event.findFirst({ organizerId:
  scope.organizerId })`. **Achado da revisão final da feature de patrocinadores (2026-08-18)**: a
  API de patrocinadores esqueceu o branch `actingAsAdmin` nas rotas de mutação (só o GET tinha) —
  admin levava 404 tentando gerenciar. Esta feature deve ter esse branch em **todas** as rotas
  desde o início, não só GET.
- **`resolveActingScope`** (`lib/auth/rbac.ts`) já resolve `{ actingAsAdmin, organizerId }` pra
  `ADMIN`/`ORGANIZER`/`ASSISTANT` — pra `ORGANIZER`, `organizerId` é o `OrganizerProfile.id` (não
  o `User.id`). Assistente cujo criador é admin herda `actingAsAdmin: true`; assistente cujo
  criador é organizador herda o `organizerId` do criador.
- **Controle de acesso por organizador (pedido explícito do usuário, fora do padrão dos módulos
  anteriores)**: diferente de redes sociais/patrocínio (disponíveis pra todo organizador
  automaticamente), campanhas de WhatsApp precisam ser **habilitadas individualmente pelo admin,
  por organizador** — não há precedente direto no código (`OrganizerProfile.verified` existe mas
  está morto/não usado em lugar nenhum da aplicação, só em seed/backup).
- **Tela de edição de usuário do admin** (`app/admin/usuarios/[id]/editar/page.tsx` +
  `UserForm.tsx` + `PATCH /api/admin/users/[id]`) já tem o padrão de campos condicionais por role
  (usado hoje pra CPF/nascimento de atleta, ver spec de CPF obrigatório de 2026-07-06) — mas
  **nunca tocou em `OrganizerProfile`** até hoje. Este é o primeiro campo de `OrganizerProfile`
  editável pelo admin.
- **Enums do Postgres são caros de alterar depois** (`ALTER TYPE ... ADD VALUE` tem restrições de
  transação). Definir o enum de status completo desde a Fase A evita uma migration de enum a cada
  fase futura.

## Decisões confirmadas com o usuário

1. Campanhas são **por evento, geridas pelo organizador**, com **supervisão/gestão total do
   admin** — mesmo padrão dos demais módulos por evento deste projeto.
2. Acesso à feature é **controlado individualmente pelo admin, por organizador** — um toggle
   simples (`campaignsEnabled`), não um fluxo de solicitação/aprovação.

## Arquitetura

### 1. Schema (`prisma/schema.prisma`)

```prisma
enum CampaignStatus {
  DRAFT
  SCHEDULED
  PREPARING
  RUNNING
  PAUSED
  COMPLETED
  CANCELLED
  FAILED
}

model Campaign {
  id              String         @id @default(cuid())
  eventId         String
  name            String
  description     String?
  status          CampaignStatus @default(DRAFT)
  messageBody     String         @db.Text
  scheduledAt     DateTime?
  createdByUserId String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  event         Event @relation(fields: [eventId], references: [id])
  createdByUser User  @relation(fields: [createdByUserId], references: [id])

  @@index([eventId, status])
  @@map("campaigns")
}
```

Só `Campaign` nesta fase — `CampaignRecipient` (e o índice/constraint de idempotência que ele vai
precisar) nasce na Fase B, quando a lógica que o usa também nasce. Evita uma tabela vazia sem
nenhum código que a leia/escreva por várias fases.

`messageBody` é texto puro nesta fase — sem catálogo de variáveis, sem renderer, sem opção de
reaproveitar um alerta existente. Isso é toda a Fase C. O objetivo da Fase A é só o esqueleto
CRUD + state machine funcionando de ponta a ponta.

`OrganizerProfile` ganha um campo novo:

```prisma
model OrganizerProfile {
  ...
  campaignsEnabled Boolean @default(false)
  ...
}
```

`false` por padrão — nenhum organizador tem acesso até o admin habilitar explicitamente.

### 2. Controle de acesso por organizador

Novo helper, `lib/campaigns/access.ts`:

```ts
export async function hasCampaignsAccess(scope: AssistantScope): Promise<boolean>
// true se scope.actingAsAdmin; caso contrário, lê OrganizerProfile.campaignsEnabled via
// scope.organizerId.
```

Chamado logo após `resolveActingScope` em toda rota de campanha (lista/criar/ver/editar/cancelar/
duplicar) — se `false`, retorna 403. O menu "Campanhas" na página do evento do organizador só
aparece quando habilitado, mas o bloqueio real é sempre no servidor (nunca só esconder o menu).

### 3. Habilitação pelo admin

`app/admin/usuarios/[id]/editar/page.tsx` + `UserForm.tsx`: novo checkbox "Habilitar campanhas de
WhatsApp", visível só quando o role selecionado é `ORGANIZER` (mesmo padrão condicional já usado
pra CPF/nascimento de atleta).

`PATCH /api/admin/users/[id]`: schema Zod ganha `campaignsEnabled` opcional; quando presente, faz
upsert em `OrganizerProfile` (mesmo padrão que a rota já teria que ter pra CPF, adaptado — hoje
essa rota não toca em `OrganizerProfile` nenhum, então este é código novo, não uma extensão de
upsert existente). `AuditLog` (`USER_UPDATED`) inclui a mudança no metadata quando alterada.

### 4. API de campanhas

Espelhando `app/api/events/[id]/social-links/*` exatamente, com o branch `actingAsAdmin` presente
em **toda** rota de mutação (lição da revisão de patrocinadores):

- `GET /api/events/[id]/campaigns` — lista campanhas do evento.
- `POST /api/events/[id]/campaigns` — cria em `DRAFT` (`name`, `description?`, `messageBody`).
- `GET /api/events/[id]/campaigns/[campaignId]` — detalhe.
- `PATCH /api/events/[id]/campaigns/[campaignId]` — edita `name`/`description`/`messageBody`,
  **só permitido quando `status === "DRAFT"`** (400 caso contrário — evita editar uma campanha já
  agendada/rodando, mesmo que essas transições só existam a partir da Fase D).
- `POST /api/events/[id]/campaigns/[campaignId]/cancel` — `DRAFT → CANCELLED`, terminal. Rejeita
  (400) se a campanha já não estiver em `DRAFT` (nesta fase, só `DRAFT` existe além de
  `CANCELLED`, então na prática só bloqueia cancelar duas vezes).
- `POST /api/events/[id]/campaigns/[campaignId]/duplicate` — clona `name`/`description`/
  `messageBody` de qualquer campanha (inclusive `CANCELLED`) numa `DRAFT` nova.

Todas checam `hasCampaignsAccess` antes de prosseguir.

### 5. UI

`app/organizador/eventos/[id]/campanhas/page.tsx` (lista, com botão "Nova campanha" e ação
"Duplicar" por linha) + `.../campanhas/nova/page.tsx` (criar) + `.../campanhas/[campaignId]/
page.tsx` (ver/editar quando `DRAFT`, só leitura + botão "Cancelar" quando não). Link "Campanhas"
na página do evento do organizador, condicionado a `campaignsEnabled` (buscado no carregamento da
página do evento).

Espelho em `app/admin/eventos/[id]/campanhas/*` — mesmas 3 telas, reaproveitando os mesmos
componentes de UI quando fizer sentido (a diferença real está só na API que já resolve
`actingAsAdmin` automaticamente).

### 6. Permissões de assistente

`campaigns.view` / `campaigns.create` / `campaigns.edit` / `campaigns.cancel` (sem `.delete` — não
há exclusão definitiva) adicionadas aos dois catálogos (`app/organizador/assistentes/page.tsx`,
`app/admin/assistentes/page.tsx`) **desde esta fase**, não deixado pra depois (mesma lição da
revisão de patrocinadores).

Nota: a permissão de assistente controla o QUE um assistente pode fazer dentro de um organizador
já habilitado — não sobrepõe o gate de `campaignsEnabled` do organizador. Um assistente de um
organizador sem `campaignsEnabled` não tem acesso, mesmo com todas as permissões de campanha
concedidas.

### 7. Auditoria

`AuditLog`: `CAMPAIGN_CREATED`, `CAMPAIGN_UPDATED`, `CAMPAIGN_CANCELLED`, `CAMPAIGN_DUPLICATED` —
mesmo padrão de string livre já usado (`USER_REGISTERED`, `CART_ABANDONED`, etc.).

## Fora de escopo (fases futuras)

- Seleção/contagem de destinatários reais — Fase B.
- Catálogo de variáveis, reaproveitar alerta como cópia, preview, envio de teste — Fase C.
- Agendamento funcional, worker, rate limiting, retries, circuit breaker — Fase D.
- Status de entrega, métricas — Fase E.
- Pausar/retomar, concorrência entre workers — Fase F.
- Qualquer transição de estado além de `DRAFT ⇄ CANCELLED` e duplicar.

## Testes

- `lib/campaigns/access.ts`: unitário, `hasCampaignsAccess` retornando `true` pra admin, `true`/
  `false` pra organizador conforme `campaignsEnabled`.
- `PATCH /api/admin/users/[id]`: aceita `campaignsEnabled` quando `role=ORGANIZER`, grava em
  `OrganizerProfile` via upsert, grava auditoria.
- API de campanhas: criar/listar/editar (só em `DRAFT`)/cancelar/duplicar — sucesso, e IDOR-safe
  (organizador não acessa evento de outro); admin acessa qualquer evento; bloqueado quando
  `campaignsEnabled=false`; assistente sem permissão bloqueado mesmo com organizador habilitado.
- Sem testes de UI (convenção já estabelecida no projeto).
