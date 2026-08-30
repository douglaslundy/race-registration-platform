# Design: Snapshot / override de dados da inscrição

Data: 2026-08-30
Sub-projeto C de um pedido maior (ver `docs/superpowers/specs/2026-08-28-twilio-whatsapp-provider-design.md` §Contexto).
Sub-projetos A (Twilio) e B (múltiplas contas Mercado Pago) já mergeados em `main`.

## Contexto

Hoje uma `Registration` não guarda nome / e-mail / CPF do participante — só aponta pra conta do
atleta (`athleteUserId → User` / `AthleteProfile`). Todo consumidor (lista de inscritos, export,
crachá, certificado, comprovante, e-mail) lê `registration.athlete.name` etc.

Problema: um organizador que precisa corrigir um erro de digitação em **uma** inscrição de **um**
evento não tem como — a única rota existente
(`app/api/organizer/registrations/[id]/athlete/route.ts`) recebe `registrationId` na URL mas faz
`tx.user.update` + `tx.athleteProfile.upsert`, ou seja, **edita a conta global do atleta**,
afetando todas as inscrições dele em todos os eventos. É o anti-padrão que este sub-projeto resolve.

O modelo já tem precedente pra "dado por inscrição, separado da conta": `Registration.shirtSize`,
`teamName`, `emergencyContactName/Phone`, `medicalNotes`, `proxyAthleteDisplayName`. E congelamento
de dado é padrão consolidado no projeto (`Order.subtotalAmount`/`platformFeeAmount`,
`Payment.paymentAccountId`, `Payment.provider`, `Order.serviceFeeOriginalAmount`).

**Objetivo:** cada inscrição passa a ter um **snapshot próprio e congelado** dos dados de
identidade do participante (nome, e-mail, telefone, nascimento, gênero, CPF), preenchido no
checkout e editável só por uma rota auditada. A conta do atleta e as outras inscrições dele ficam
intactas.

## Decisões travadas com o usuário

- **Campos no snapshot:** os 6 de identidade — nome, e-mail, telefone, nascimento, gênero, CPF.
- **Modelo:** snapshot **sempre preenchido e congelado** (não `null`-com-fallback). Todo checkout
  copia os dados do atleta pra inscrição naquele momento. Consumidores lêem **só** de `participant*`,
  nunca mais de `registration.athlete.*`. Migração preenche as inscrições existentes.
- **Colunas na tabela `registrations`** — não uma tabela nova (segue o padrão de `emergencyContact*`).
- **CPF:** `participantCpf` sem `@unique`, valida dígito verificador, **não toca** `AthleteProfile.cpf @unique`
  nem a dedup de atletas.
- **`athleteUserId` continua** — é como se sabe de quem é a conta (login, dashboard do atleta, dedup).
  O snapshot é aditivo.
- **Edição pelo organizador/admin:** rota `PATCH /api/{organizer,admin}/registrations/[id]` nova,
  edita só os `participant*` da inscrição, nunca `User`/`AthleteProfile`. RBAC anti-IDOR. Auditoria
  before/after.
- **Auto-edição do atleta:** só se o evento tiver `registrationEditDeadline` configurado e não
  vencido. Campos permitidos ao atleta: nome, telefone, nascimento, gênero (+ os que já são por
  inscrição: `shirtSize`, `teamName`, `emergencyContact*`). **E-mail e CPF não** — só organizador/admin.
- **Regra geral pros consumidores:** dado *da inscrição* → `participant*`. Dado *da conta* (topo do
  painel "Olá {nome}", e-mail de criação de conta, login, opt-out de campanha) → segue na conta.

## Global Constraints

- **Centavos em `Int`** — não se aplica aqui, mas mantém a convenção do projeto.
- **`participant*` são a ÚNICA fonte de nome/e-mail/CPF/telefone/nascimento/gênero de uma
  inscrição** depois deste sub-projeto. Nenhum consumidor de inscrição lê `registration.athlete.name`
  (ou o equivalente via `include`) — se sobrar algum, é bug. A revisão adversarial (grep) confirma isso.
- **`participantName` e `participantEmail` são NOT NULL.** Todo `User` tem `name` e `email`, então o
  backfill e o checkout sempre têm de onde tirar. `participantPhone/BirthDate/Gender/Cpf` são
  nullable (seguem o que o `AthleteProfile` tinha).
- **A rota de edição NUNCA escreve em `User` nem `AthleteProfile`.** Corrigir uma inscrição e
  corrigir o cadastro do atleta são ações separadas.
- **RBAC anti-IDOR:** organizador só toca inscrição de evento do próprio `organizerId`
  (`resolveActingScope(session).organizerId` + `event.organizerId`); assistente idem, com a
  permissão `registrations.edit-athlete` escopada ao evento (`checkApiPermission(..., { eventId })`);
  admin edita qualquer uma; atleta só a própria (`athleteUserId === session.user.id`).
- **Auditoria:** toda edição grava `AuditLog` com `metadata: { before: {campos}, after: {campos} }`.
- **CPF:** validado com `isValidCpf` (`lib/cpf.ts`) e normalizado com `normalizeCpf` antes de gravar;
  CPF inválido → 400. Sem checagem de duplicidade (é snapshot).
- **Migração de schema:** uma migração Prisma nova; em produção aplicada via `prisma db push`
  (`_prisma_migrations` de prod congelado desde 2026-07-08 — **nunca `prisma migrate deploy`**). O
  backfill de dados roda como script TS à parte (`docker compose run --rm --no-deps app sh -c "npx tsx ..."`),
  **antes do restart**.
- **Sem regressão** pros fluxos que não são de identidade da inscrição: checkout (fora o preenchimento
  do snapshot), pagamento, kit (fora o nome), campanhas (fora a personalização).

---

## 1. Modelo de dados

### 1.1 `Registration` — 6 colunas novas

```prisma
  participantName      String
  participantEmail     String
  participantPhone     String?
  participantBirthDate DateTime?
  participantGender    String?
  participantCpf       String?
```

- `participantName` / `participantEmail`: NOT NULL com `@default("")`. O `@default("")` permite o
  `ADD COLUMN` numa tabela populada; o backfill preenche as linhas existentes e o checkout preenche
  as novas, então o valor nunca fica vazio na prática. **O default fica** — não há 2ª migração pra
  removê-lo (custo/risco não justifica; o invariante é garantido em código). Sem índice novo.
- `participantCpf`: **sem `@unique`**, sem índice. Guardado normalizado (só dígitos).

### 1.2 `Event` — 1 coluna nova

```prisma
  registrationEditDeadline DateTime?
```

`null` → atleta não pode auto-editar nenhuma inscrição desse evento. Uma data → atleta pode
auto-editar a própria inscrição até `registrationEditDeadline` (comparação com `new Date()` no
servidor). Organizador/admin editam sempre, ignorando esse campo.

### 1.3 Migração de dados — `prisma/backfill-registration-participants.ts`

```ts
export async function backfillRegistrationParticipants(
  prisma: Pick<PrismaClient, "registration" | "$transaction">,
): Promise<{ updated: number }>;
```

- Percorre `registration.findMany` em páginas (cursor por `id`, ~500 por vez — a tabela pode ter
  dezenas de milhares de linhas) incluindo `athlete: { select: { name, email, athleteProfile: { select: { phone, birthDate, gender, cpf } } } }`.
- Só atualiza linhas onde `participantName === ''` OU `participantEmail === ''` (idempotente — rodar
  2x não retrabalha).
- `participantName = athlete.name`, `participantEmail = athlete.email`,
  `participantPhone = athlete.athleteProfile?.phone ?? null`, idem `birthDate` / `gender`,
  `participantCpf = athlete.athleteProfile?.cpf ?? null`.
- Executável direto (`if (require.main === module)`) pra rodar no container. Retorna a contagem.

---

## 2. Preenchimento do snapshot no checkout

### 2.1 `lib/checkout.ts` — `tx.registration.create` (linha ~209)

O `createCheckout` já resolve `athleteUserId` (inscrição normal → `input.athleteUserId`; proxy →
o id do atleta criado/encontrado). Precisa, no mesmo `$transaction`, dos dados de identidade:

- **Inscrição normal:** buscar `tx.user.findUnique({ where: { id: athleteUserId }, select: { name, email, athleteProfile: { select: { phone, birthDate, gender, cpf } } } })`.
- **Inscrição por procuração (`input.proxyAthlete`):** os dados vêm do payload do proxy
  (`input.proxyAthlete.name` / `.email` / `.phone` / `.birthDate` / `.cpf`) — que já é o que o fluxo
  usa pra criar o `AthleteProfile` do atleta-proxy. Gênero: o proxy não coleta hoje → `null`.
  E-mail: o proxy pode não ter e-mail real; usar o mesmo valor (placeholder) que o fluxo já gera
  pro `User` do proxy.

Gravar no `create`:

```ts
        participantName: identity.name,
        participantEmail: identity.email,
        participantPhone: identity.phone ?? null,
        participantBirthDate: identity.birthDate ?? null,
        participantGender: identity.gender ?? null,
        participantCpf: identity.cpf ? normalizeCpf(identity.cpf) : null,
```

Um helper local `resolveParticipantIdentity(tx, input, athleteUserId)` isola isso.

### 2.2 Sem mudança no `app/api/checkout/route.ts`

O snapshot é interno ao `createCheckout`. O corpo do request e a resposta não mudam.

---

## 3. Rotas de edição

### 3.1 `PATCH /api/organizer/registrations/[id]/route.ts` (nova)

- `checkApiPermission("registrations.edit-athlete", { eventId })` — resolve o `eventId` da inscrição
  primeiro (`db.registration.findUnique({ where: { id }, select: { eventId, event: { select: { organizerId } } } })`).
- `resolveActingScope(session)` → se `!actingAsAdmin`, exigir `registration.event.organizerId === scope.organizerId`
  (senão 404 — não vaza existência).
- Corpo (zod): `{ name?, email?, phone?, birthDate?, gender?, cpf? }` — qualquer subconjunto; pelo
  menos 1 campo.
- `email` → `z.string().email()`. `cpf` → normaliza + `isValidCpf` → 400 se inválido; grava
  normalizado. `birthDate` → `z.string()` que parseia pra `Date` válida (400 se `NaN`).
- Transação: lê os `participant*` atuais (para o `before`), `db.registration.update`, `db.auditLog.create`
  `action: "REGISTRATION_PARTICIPANT_UPDATED"`, `entityType: "Registration"`, `entityId: id`,
  `metadata: { before, after }` (só os campos que mudaram).
- Resposta: `{ ok: true }`.

### 3.2 `PATCH /api/admin/registrations/[id]/route.ts` (nova)

Igual à 3.1 mas `checkAdminOnlyApiPermission("registrations.edit-athlete-any")` (actionKey nova no
catálogo admin) e sem a checagem de `organizerId` (admin edita qualquer inscrição). Mesmo corpo,
mesma auditoria.

### 3.3 `PATCH /api/athlete/registrations/[id]/route.ts` (nova)

- `auth()` → `session.user`; `db.registration.findUnique({ where: { id }, select: { athleteUserId, event: { select: { registrationEditDeadline } } } })`.
- `registration.athleteUserId !== session.user.id` → 404.
- `!event.registrationEditDeadline || event.registrationEditDeadline < new Date()` → 403
  `{ error: "O prazo para editar esta inscrição já encerrou." }` (ou "não está disponível" quando
  `null`).
- Corpo (zod): `{ name?, phone?, birthDate?, gender?, shirtSize?, teamName?, emergencyContactName?, emergencyContactPhone? }`.
  **`email` e `cpf` não são declarados no schema zod e não são lidos do corpo** — mesmo que o
  cliente mande, essa rota nunca grava `participantEmail`/`participantCpf`.
- Grava em `Registration` (os `participant*` + os campos que já são por-inscrição). Auditoria
  `action: "REGISTRATION_PARTICIPANT_UPDATED"`, `metadata: { before, after, by: "athlete" }`.
- Resposta: `{ ok: true }`.

### 3.4 A rota `/athlete` atual

`app/api/organizer/registrations/[id]/athlete/route.ts` **deixa de ser sobre a inscrição** —
passa a ser "editar o cadastro do atleta" de verdade. Duas opções (decidir no plano):
- **(a)** manter a rota, renomear conceitualmente, e o painel do organizador ganha 2 botões:
  "Corrigir esta inscrição" (→ 3.1) e "Editar cadastro do atleta" (→ esta, que segue dando
  `user.update` + `athleteProfile.upsert`).
- **(b)** remover a rota `/athlete` e o botão correspondente; edição de cadastro do atleta pelo
  organizador sai de escopo (o organizador nem sempre deveria poder editar a conta de um atleta
  que não é dele). O painel fica só com "Corrigir esta inscrição".

Recomendação: **(a)** — a capacidade existe hoje e removê-la é uma regressão de função; só fica
mais clara a separação.

### 3.5 Componentes de UI

- `components/organizer/EditAthleteButton.tsx` (ou equivalente que hoje chama `/athlete`) — vira
  `EditRegistrationParticipantButton` apontando pra 3.1; se a opção (a) da §3.4 valer, um segundo
  botão/modal pro cadastro do atleta.
- `app/dashboard/inscricoes/[id]/page.tsx` — se `event.registrationEditDeadline` no futuro, mostra
  um botão "Editar meus dados desta inscrição" → modal → 3.3. Senão, não mostra.
- `app/admin/eventos/[id]/...` — botão equivalente à 3.2 na linha da inscrição.
- Painel de edição do evento (organizador e admin) — campo "Prazo para o atleta editar a inscrição"
  (date input) que grava `Event.registrationEditDeadline`. Vai na rota de edição de evento que já
  existe (`PATCH /api/events/[id]` pro organizador; a equivalente admin).

---

## 4. A troca nos consumidores

Regra única: **onde lê nome/e-mail/CPF/telefone/nascimento/gênero de uma inscrição, lê de `participant*`.**

### 4.1 Listas, tabelas e páginas

- `components/registrations/RegistrationsTable.tsx`, `GeneralReportTable.tsx`,
  `PendingCancellationsTable.tsx`, `components/payment/PendingRefundsTable.tsx`
- `app/organizador/eventos/[id]/inscritos/page.tsx` + `relatorio-geral/page.tsx`,
  `app/admin/eventos/[id]/inscritos/page.tsx` + `relatorio-geral/page.tsx`
- `lib/organizer/registrations.ts`, `lib/registrations/pending-queue.ts`
- `app/api/events/[id]/registrations/route.ts`

Cada um: adicionar os `participant*` ao `select` da `Registration` (onde hoje tem
`athlete: { select: { name, email } }`), trocar as leituras, e — quando possível — remover o
`include`/`select` de `athlete.name`/`.email` se ninguém mais usar.

### 4.2 Exports

- `lib/registrations/export.ts`, `lib/reports/general-report.ts`,
  `app/api/events/[id]/kit-deliveries/report-export/route.ts`, o export de inscritos.
- Colunas "Nome", "E-mail", "CPF" = `participant*`.

### 4.3 Kit

- `lib/kit-delivery.ts`, `app/api/registrations/[id]/qrcode/route.ts`,
  `app/organizador/eventos/[id]/entrega-kits/EntregaKitsClient.tsx`
- Nome no crachá / QR / busca por nome = `participantName`. A busca por CPF na entrega de kit
  (se existir) = `participantCpf`.

### 4.4 Painel do atleta

- `app/dashboard/inscricoes/page.tsx` (lista) e `[id]/page.tsx` (detalhe) — mostram os dados
  **daquela inscrição** (`participant*`), não da conta.

### 4.5 Resultados públicos

- `app/(public)/eventos/[slug]/resultados/page.tsx` — nome no resultado = `participantName`.
  (Os resultados são casados por `bibNumber` / CPF; a exibição usa o snapshot.)

### 4.6 Notificações e alertas (caso de julgamento — regra: inscrição usa o snapshot)

- `lib/notifications.ts` (`notifyOrderConfirmed`) — o e-mail de confirmação de inscrição vai pro
  `participantEmail`; nome no corpo = `participantName`. **Nuance:** um `Order` pode ter várias
  `Registration` (compra pra várias pessoas). Hoje manda 1 e-mail pro comprador. Manter isso:
  o e-mail vai pro e-mail do **comprador** (`order.buyer.email`), mas o conteúdo (lista de
  inscritos) usa `participant*` de cada inscrição. Não multiplicar e-mails.
- `lib/alerts/payment-error.ts`, `lib/alerts/abandoned-cart.ts`, `lib/alerts/cancellation-requested.ts`,
  `lib/alerts/registration-cancelled-by-staff.ts` — nome/e-mail do participante nesses alertas
  (que vão pro organizador) = `participant*`.
- `lib/templates/variables.ts` — as variáveis de template que representam o participante de uma
  inscrição (`{{nome_atleta}}` etc.) = `participant*`.

### 4.7 Campanhas de WhatsApp (caso de julgamento)

- `lib/campaigns/recipients.ts`, `lib/campaigns/resolve-recipient-variables.ts`,
  `app/api/cron/send-campaign-messages/route.ts`
- Personalização (`{{nome}}`) = `participantName`.
- Telefone do destinatário = `participantPhone`. **Se `participantPhone` for `null`, o destinatário
  é pulado** — não cai no telefone da conta do atleta (consentimento e opt-out são por número; usar
  o número da conta poderia mandar mensagem pra quem não se inscreveu).
- Opt-out continua sendo checado por número (inalterado).

### 4.8 Backup

- `app/api/admin/backup/route.ts` (export) já faz `findMany` puro da `Registration` — os
  `participant*` entram automaticamente. `Event` idem (`registrationEditDeadline`).
- `app/api/admin/backup/import/route.ts` — `toRegistrationRow` ganha os 6 `participant*`;
  `toEventRow` ganha `registrationEditDeadline`. (Consistente com o que o sub-projeto B fez pra
  `paymentAccountId`.)

### 4.9 Fica na conta (NÃO muda)

- Topo do painel do atleta ("Olá, {user.name}"), `app/dashboard/layout.tsx`.
- E-mail de criação de conta / boas-vindas, convite de assistente, reset de senha.
- Login, `session.user.name`.
- Opt-out de campanha (por número).
- `app/admin/usuarios/[id]/editar` + `UserForm.tsx` — edita a conta, não inscrição.
- `app/api/athlete/profile/route.ts` — o atleta edita o **cadastro** dele (não uma inscrição).

---

## 5. Casos de borda

- **Atleta muda a conta depois de se inscrever** → inscrições existentes não mudam; só as próximas
  pegam o valor novo.
- **`participantCpf` ≠ `AthleteProfile.cpf`** → permitido. Resultado/certificado usam o da inscrição;
  dedup e `@unique` do perfil intocados.
- **Proxy sem e-mail real** → `participantEmail` recebe o mesmo placeholder que o fluxo de proxy já
  gera pro `User`.
- **Edição do atleta após o prazo** → 403; organizador/admin seguem.
- **`registrationEditDeadline` não configurado** → auto-edição do atleta 403 sempre.
- **Backfill de inscrição de atleta sem `AthleteProfile`** → `participantPhone/BirthDate/Gender/Cpf`
  ficam `null`; `participantName/Email` sempre do `User`.
- **`registrationEditDeadline` no passado no checkout** → não bloqueia o checkout (só edição posterior).
- **Certificado / resultado já gerado** → snapshot, sem reprocessamento.
- **Migração numa tabela grande** → backfill paginado (cursor), idempotente (só linhas com
  `participantName === ''`); pode rodar em partes.
- **`Order` com várias `Registration`** → o e-mail de confirmação continua sendo 1, pro comprador,
  com o conteúdo por inscrição usando `participant*`.

## 6. Testes

- **Regressão de isolamento (obrigatório):** 3 inscrições do mesmo atleta em 3 eventos → editar só
  a 2ª (nome + CPF) via `PATCH /api/organizer/registrations/[id]` → asserir que a 1ª, a 3ª, o `User`
  e o `AthleteProfile` **não mudaram** e a 2ª mudou.
- **Checkout preenche os 6 `participant*`** — inscrição normal (do `User`/`AthleteProfile`) e proxy
  (do payload).
- **`PATCH` organizador:** edita só a inscrição (nenhum `user.update`/`athleteProfile.update`);
  IDOR (organizador de outro evento → 404); CPF inválido → 400; e-mail inválido → 400; auditoria
  `REGISTRATION_PARTICIPANT_UPDATED` com `before`/`after` só dos campos mudados.
- **`PATCH` admin:** edita qualquer inscrição; actionKey nova.
- **`PATCH` atleta:** só o dono (outro atleta → 404); respeita `registrationEditDeadline`
  (futuro → OK, passado → 403, `null` → 403); `email`/`cpf` no corpo são ignorados (não gravados).
- **Consumidores:** um teste por categoria — `lib/registrations/export.ts` exporta `participant*`;
  `lib/kit-delivery.ts` usa `participantName`; a lista de inscritos renderiza `participantName`;
  o resultado público usa `participantName`; `notifyOrderConfirmed` usa `participantEmail` no
  conteúdo.
- **Campanha:** `participantPhone` `null` → destinatário pulado; `{{nome}}` = `participantName`.
- **Backfill:** idempotente (2 execuções → 2ª não retrabalha); atleta sem `AthleteProfile`
  (`participantPhone` etc. `null`).
- **Backup:** round-trip de `participant*` + `registrationEditDeadline`.
- **Revisão adversarial (grep):** `grep -rn "\.athlete\.name\|\.athlete\.email\|athlete: { select" lib/ app/ components/`
  — nenhum resultado em contexto de exibir/exportar dados de uma inscrição (só onde é legítimo:
  dedup, dashboard do atleta pelo `session`, edição de cadastro do atleta).

## 7. Fora de escopo (documentado)

- Editar dados de inscrição em lote.
- Histórico de versões do snapshot (só o último `before`/`after` fica no `AuditLog`).
- Reconciliar snapshot ↔ conta automaticamente (ex.: "os dados da conta mudaram, quer atualizar as
  inscrições?").
- Coletar gênero no fluxo de proxy.
- Remover o `default ''` de `participantName`/`participantEmail` numa 2ª migração (aceitável manter).
- O organizador editar a conta de um atleta que não é dele (mantido como está, se a opção (a) da
  §3.4 valer — é comportamento de hoje).
