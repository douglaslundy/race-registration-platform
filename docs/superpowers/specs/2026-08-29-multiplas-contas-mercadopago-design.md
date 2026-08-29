# Design: Múltiplas contas Mercado Pago (geridas pelo admin)

Data: 2026-08-29
Sub-projeto B de um pedido maior (ver `docs/superpowers/specs/2026-08-28-twilio-whatsapp-provider-design.md` §Contexto).
Sub-projeto A (Twilio) já mergeado; sub-projeto C (snapshot de inscrição) fica pra spec própria.

## Contexto

Hoje o sistema tem **uma** configuração de gateway global, em `platform_settings`:
`payment_provider` (`sandbox` | `mercadopago` | `pagarme`), e pro Mercado Pago
`mp_access_token` / `mp_webhook_secret` / `mp_public_key` (com fallback pra env).

- `lib/payment/index.ts` → `getPaymentProvider()` lê `payment_provider` e instancia
  `MercadoPagoProvider` / `PagarMeProvider` / `SandboxPaymentProvider`.
- `lib/payment/mercadopago.ts` → `MercadoPagoProvider` lê o token via `getMercadoPagoAccessToken()`
  a cada chamada (`getClient()`), verifica webhook via `getMercadoPagoWebhookSecret()`.
- `app/api/checkout/route.ts` → resolve o provider, cria o `Payment` com `provider: providerKey`.
- `app/api/webhooks/payment/route.ts` → **um** endpoint; detecta MP vs Pagar.me pelo shape do
  payload, valida assinatura, re-consulta status na API, chama `applyGatewayStatus`.
- `lib/payment/refund-service.ts` → estorno; monta o provider da setting global.
- `app/api/checkout/card-config/route.ts` → entrega a `mp_public_key` pro frontend do cartão.
- `Payment.provider` já é `String` (guarda `"mercadopago"` etc.) — precedente pra congelar dado
  de roteamento no pagamento.

**Objetivo:** o admin da plataforma passa a cadastrar **N contas Mercado Pago** (label +
credenciais), define **uma como padrão global**, e pode **sobrescrever a conta por evento**. Cada
pagamento **congela** a conta que o processou, pra webhook e estorno sempre usarem a conta certa —
inclusive depois que a conta for arquivada.

**Decisões travadas com o usuário:**
- Contas **só do admin** — sem OAuth de organizador, sem split de pagamento.
- Modelo **B**: conta padrão global + override opcional por evento. Evento sem override herda a padrão.
- Webhook **B**: **um endpoint por conta** (`/api/webhooks/payment/mp/[accountId]`), com shim de
  compatibilidade no endpoint atual.
- **2FA (opção B)**: TODA operação de conta MP pede código (criar, editar credencial, arquivar,
  trocar padrão global, trocar override de evento). Mais `/api/admin/backup/import`.
- Pagar.me e sandbox: **inalterados** (seguem na config global; sem multi-conta).

## Global Constraints

- **Credenciais nunca voltam pro frontend.** GET de conta devolve só `label`, `isDefault`,
  `archivedAt` e flags booleanas "configurado". Campos de credencial nos forms nunca vêm
  pré-preenchidos e só são enviados quando não-vazios. Nada de `accessToken`/`webhookSecret` em
  `AuditLog` em claro (mascarar pra `"***"`).
- **Nunca `alert()` / `confirm()` / `window.prompt()`** — usar `components/ui/ConfirmModal.tsx` /
  `components/ui/ErrorModal.tsx` (ver `CLAUDE.md`).
- **Verificação de webhook fail-closed:** sem `webhookSecret` da conta → nenhum webhook aceito
  (nunca pular a verificação).
- **Sem regressão pro Pagar.me / sandbox:** `payment_provider != "mercadopago"` → comportamento
  idêntico ao de hoje, zero código novo no caminho.
- **Migração sem downtime:** o endpoint `/api/webhooks/payment` atual continua funcionando durante e
  depois da migração (shim → conta padrão). Só o `git pull`+build normal, **sem `db push` manual
  além do schema** (uma migração Prisma nova; em produção aplicada via `prisma db push` como as
  outras — o `_prisma_migrations` de prod está congelado desde 2026-07-08, então **nunca**
  `prisma migrate deploy**).
- **2FA:** reusar `lib/security/sensitive-action-verification.ts` — só estender o union
  `SensitiveActionType` e o `ACTION_LABEL`. Não reescrever o mecanismo.
- **Centavos em `Int`** em todo valor monetário (convenção do projeto).

---

## 1. Modelo de dados

### 1.1 `PaymentAccount` (novo model)

```prisma
model PaymentAccount {
  id            String    @id @default(cuid())
  label         String                          // "Mercado Pago Principal", "Conta Circuito Sul"
  provider      String    @default("mercadopago") // aberto pra futuro; só "mercadopago" hoje
  accessToken   String    @db.Text
  webhookSecret String    @db.Text
  publicKey     String?   @db.Text              // checkout transparente de cartão
  isDefault     Boolean   @default(false)
  archivedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  events   Event[]
  payments Payment[]

  @@map("payment_accounts")
}
```

- **Exatamente uma conta `isDefault = true`** entre as não-arquivadas. Garantido em código
  (transação no `make-default`), não por constraint de banco — Postgres não tem "único parcial só
  quando true" nativo em Prisma; usar `@@index` comum e um teste que verifica a invariante.
  (Alternativa considerada: índice parcial via SQL cru na migração `CREATE UNIQUE INDEX ... WHERE
  "isDefault" AND "archivedAt" IS NULL`. Fica como reforço opcional — a corretude vem da transação.)
- `provider` existe só pra não travar o schema; toda a lógica deste sub-projeto assume
  `"mercadopago"`.

### 1.2 `Event` — campo novo

```prisma
  paymentAccountId String?
  paymentAccount   PaymentAccount? @relation(fields: [paymentAccountId], references: [id])
```

`null` = usa a conta padrão global. Não-nulo = override.

### 1.3 `Payment` — campo novo

```prisma
  paymentAccountId String?
  paymentAccount   PaymentAccount? @relation(fields: [paymentAccountId], references: [id])

  @@index([paymentAccountId])
```

**Congelado na criação.** `null` só pra: pagamentos antigos de Pagar.me/sandbox, e pagamentos MP
criados antes da migração que por algum motivo não puderam ser backfillados (não deve acontecer).

### 1.4 Migração de dados (Prisma migration + step de dados)

Na migração:
1. `CREATE TABLE payment_accounts ...`, `ALTER TABLE events ADD COLUMN "paymentAccountId" ...`,
   `ALTER TABLE payments ADD COLUMN "paymentAccountId" ...` (+ FKs, índices).
2. **Step de dados** (script `prisma/migrations/<ts>_.../data-backfill.ts` rodado à parte, OU
   incluído como SQL na migração se der — preferir script TS pra ler as settings):
   - Se existir `platform_settings.mp_access_token` (valor não-vazio):
     - `INSERT INTO payment_accounts (label, accessToken, webhookSecret, publicKey, isDefault)`
       `VALUES ('Mercado Pago Principal', <mp_access_token>, <mp_webhook_secret ?? ''>, <mp_public_key>, true)`.
     - `UPDATE payments SET "paymentAccountId" = <novaConta.id> WHERE provider = 'mercadopago'`.
   - Se **não** existir `mp_access_token`: não cria conta nenhuma (instalação nova — admin cria a
     primeira pela UI).
   - `events.paymentAccountId` fica `null` em todos (herdam a padrão).
3. As settings `mp_access_token` / `mp_webhook_secret` / `mp_public_key` **não são apagadas** — o
   shim do webhook legado e o fallback de refund ainda as consultam durante a transição. Um item de
   backlog (fora deste sub-projeto) remove depois.

### 1.5 `lib/payment/account-resolver.ts` (novo)

```ts
export interface ResolvedPaymentAccount {
  id: string;
  accessToken: string;
  webhookSecret: string;
  publicKey: string | null;
  label: string;
  archived: boolean;
}

/** Conta efetiva de um evento: override do evento, senão a padrão global. */
export async function resolveEventPaymentAccount(eventId: string): Promise<ResolvedPaymentAccount>;

/** A conta padrão global (isDefault=true, não-arquivada). Lança se não houver. */
export async function getDefaultPaymentAccount(): Promise<ResolvedPaymentAccount>;

/** Conta pelo id, mesmo arquivada (pra webhook e refund históricos). Lança se não existir. */
export async function getPaymentAccountById(id: string): Promise<ResolvedPaymentAccount>;
```

Erro quando não há conta padrão: `class NoPaymentAccountError extends Error`. O checkout traduz
pra 503 "Gateway de pagamento não configurado".

---

## 2. Camada de pagamento

### 2.1 `getPaymentProvider` amarrado à conta

`lib/payment/index.ts`:

```ts
// assinatura nova — account opcional; sem account, comportamento de hoje (setting global) —
// usado por Pagar.me/sandbox e como fallback.
export async function getPaymentProvider(account?: ResolvedPaymentAccount): Promise<PaymentProvider>;
```

- `payment_provider === "mercadopago"` **e** `account` informado → `new MercadoPagoProvider(account)`.
- `payment_provider === "mercadopago"` **sem** `account` → `new MercadoPagoProvider()` (lê setting
  global — só pro shim legado e fallback de refund de pagamento sem conta).
- `pagarme` / `sandbox` → inalterado.

`lib/payment/mercadopago.ts`:

```ts
export class MercadoPagoProvider implements PaymentProvider {
  constructor(private account?: ResolvedPaymentAccount) {}

  private async token(): Promise<string> {
    if (this.account) return this.account.accessToken;
    const t = await getMercadoPagoAccessToken(); // fallback setting global
    if (!t) throw new Error("MP_ACCESS_TOKEN não configurado");
    return t;
  }
  private async webhookSecret(): Promise<string | null> {
    return this.account ? this.account.webhookSecret : getMercadoPagoWebhookSecret();
  }
  // getClient(), verifyWebhookSignature(), refundPayment(), checkPaymentStatus(), createPayment(),
  // cancelPayment() passam a usar this.token() / this.webhookSecret().
}
```

Nenhuma mudança nas assinaturas de `PaymentProvider` (interface em `lib/payment/types.ts`).

### 2.2 Checkout (`app/api/checkout/route.ts`)

Depois do `createCheckout` (que já tem o `eventId`):

```ts
const providerKey = await getPaymentProviderSetting();
let account: ResolvedPaymentAccount | undefined;
if (providerKey === "mercadopago") {
  try {
    account = await resolveEventPaymentAccount(checkoutData.eventId);
  } catch (e) {
    return NextResponse.json({ error: "Gateway de pagamento não configurado..." }, { status: 503 });
  }
}
const provider = await getPaymentProvider(account);
// ... provider.createPayment(...) ...
const payment = await db.payment.create({ data: {
  ...,
  provider: providerKey,
  paymentAccountId: account?.id ?? null,
}});
```

`app/api/checkout-ads/route.ts` (compra de anúncio): `account = await getDefaultPaymentAccount()`
quando `providerKey === "mercadopago"`; grava `paymentAccountId`.

`app/api/checkout/card-config/route.ts`: passa a aceitar `?eventId=` e, pra MP, devolver
`resolveEventPaymentAccount(eventId).publicKey` em vez de `mp_public_key`. Sem `eventId` (ou
provider != mercadopago) → comportamento de hoje. O componente de cartão do frontend passa o
`eventId` que já tem.

### 2.3 Webhook por conta — `app/api/webhooks/payment/mp/[accountId]/route.ts` (novo)

```
POST /api/webhooks/payment/mp/:accountId
```

1. `const account = await getPaymentAccountById(params.accountId)` — 404 se não existir.
2. `const rawBody = await req.text()`; assinatura de `x-signature` (formato MP).
3. `verifyWebhookSignature(rawBody, sig)` usando `account.webhookSecret` — **fail-closed**.
4. Payload `{ action, data: { id } }` → `providerPaymentId = data.id`.
5. `fetchMPPaymentStatus(providerPaymentId, account.accessToken)` — status real via API da conta.
6. `payment = db.payment.findFirst({ where: { providerPaymentId } })`.
   - Sem payment → `200 { ok: true }` (MP faz retry; pode ser corrida com a criação).
   - `payment.paymentAccountId && payment.paymentAccountId !== account.id` → **ignora**, log
     `[webhook] pagamento X pertence a outra conta` → `200 { ok: true }`.
7. Daí pra frente: exatamente o fluxo de hoje (`AdPurchase` branch, `applyGatewayStatus`,
   `notifyOrderConfirmed` / `notifyPaymentError`).

O handler compartilha o corpo com o legado — extrair `processPaymentWebhookEvent(payment, order,
event)` pra `lib/payment/webhook-handler.ts` e os dois endpoints chamam.

### 2.4 Shim legado — `app/api/webhooks/payment/route.ts` (modificado, mínimo)

- Pagar.me / sandbox: **inalterado**.
- MP: resolve `account = await getDefaultPaymentAccount()` (ou, se não houver conta nenhuma, o
  caminho antigo com a setting global — instalação que ainda não migrou credencial). Log
  `[webhook] endpoint legado usado pela conta <label> — migrar o painel do MP pra /mp/<id>`. Depois
  segue o mesmo `processPaymentWebhookEvent`.
- Continua detectando MP vs Pagar.me pelo shape do payload como hoje.

### 2.5 Estorno — `lib/payment/refund-service.ts`

```ts
const payment = await db.payment.findUnique({ where: { id: paymentId }, ... });
let account: ResolvedPaymentAccount | undefined;
if (payment.provider === "mercadopago" && payment.paymentAccountId) {
  account = await getPaymentAccountById(payment.paymentAccountId); // mesmo arquivada
}
const provider = await getPaymentProvider(account); // sem account → fallback setting global
await provider.refundPayment({ providerPaymentId: payment.providerPaymentId });
```

### 2.6 Conciliação — `lib/payment/check-mp-status.ts` + cron

`checkMPPaymentStatus(providerPaymentId)` ganha um 2º arg opcional `accessToken?`. Os chamadores
que têm o `Payment` em mãos resolvem a conta (`payment.paymentAccountId → getPaymentAccountById`)
e passam o token. Sem token → fallback setting global (comportamento de hoje).

---

## 3. Admin: rotas, 2FA e UI

### 3.1 2FA — extensão do mecanismo existente

`lib/security/sensitive-action-verification.ts`:

```ts
export type SensitiveActionType =
  | "PAYMENT_REFUND"
  | "REGISTRATION_CANCELLATION_REFUND"
  | "REGISTRATION_CANCEL_CONFIRMED"
  | "PAYMENT_ACCOUNT_CHANGE"   // criar/editar/arquivar conta + trocar padrão + override de evento
  | "BACKUP_IMPORT";

const ACTION_LABEL: Record<SensitiveActionType, string> = {
  ...,
  PAYMENT_ACCOUNT_CHANGE: "Confirmação de alteração de conta de pagamento",
  BACKUP_IMPORT: "Confirmação de importação de backup",
};
```

`targetId` da verificação:
- criar conta → `"new"`;
- editar/arquivar/make-default → `accountId`;
- override de evento → `eventId`;
- backup/import → `"backup"`.

Fluxo idêntico ao estorno: `POST .../request-code` (gera + envia por e-mail e, se houver telefone,
WhatsApp) → cliente digita → `POST` da ação com `{ verificationId, code }` no corpo →
`verifySensitiveActionCode(...)` antes de qualquer efeito colateral. E-mail falhou → aborta.

### 3.2 Rotas — `/api/admin/payment-accounts`

| Método/rota | 2FA | Comportamento |
|---|---|---|
| `GET /` | não | Lista as contas: `id`, `label`, `isDefault`, `archivedAt`, `hasAccessToken`, `hasWebhookSecret`, `hasPublicKey`, `webhookUrl` (montado: `<APP_URL>/api/webhooks/payment/mp/<id>`). **Sem credenciais.** |
| `POST /request-code` | — | `requestSensitiveActionCode({ actionType: "PAYMENT_ACCOUNT_CHANGE", targetId })` |
| `POST /` | sim | Cria: `{ label, accessToken, webhookSecret, publicKey?, verificationId, code }`. `label` obrigatório, `accessToken`/`webhookSecret` obrigatórios. Primeira conta criada vira `isDefault: true` automaticamente. |
| `PATCH /[id]` | sim | Edita `{ label?, accessToken?, webhookSecret?, publicKey?, verificationId, code }`. Credencial só sobrescrita quando enviada não-vazia. Não mexe em `isDefault`/`archivedAt`. |
| `POST /[id]/make-default` | sim | Transação: `updateMany({ isDefault: false })` + `update({ id, isDefault: true })`. 400 se a conta estiver arquivada. |
| `POST /[id]/archive` | sim | `archivedAt = now()`. **400 se `isDefault`** ("promova outra conta antes"). |
| `POST /[id]/unarchive` | sim | `archivedAt = null`. |

Guard: `checkAdminOnlyApiPermission("payment-accounts.manage")` (actionKey nova no catálogo do
admin) — ADMIN sempre; ASSISTANT-de-admin só com a permissão global. Todas as mutações auditam
(`PAYMENT_ACCOUNT_CREATED` / `_UPDATED` / `_DEFAULT_CHANGED` / `_ARCHIVED` / `_UNARCHIVED`), com
`accessToken`/`webhookSecret` mascarados no `metadata`.

### 3.3 Override por evento

`PATCH /api/admin/events/[id]` (rota admin de edição de evento) ganha `paymentAccountId?: string | null`
no corpo + `{ verificationId, code }` **quando esse campo está presente**. `null` = "usar padrão".
Valida que o id existe e não está arquivado (ou é `null`). Audita `EVENT_PAYMENT_ACCOUNT_CHANGED`.

Se a rota admin de evento hoje não separa bem "mudou o campo X" — adicionar o gate de 2FA só no
branch em que `paymentAccountId` veio no payload e difere do atual.

### 3.4 `/api/admin/backup/import`

Ganha `{ verificationId, code }` + `verifySensitiveActionCode({ actionType: "BACKUP_IMPORT",
targetId: "backup" })` antes de tocar no banco. `POST /api/admin/backup/import/request-code` novo.

### 3.5 UI — `app/admin/configuracoes/page.tsx`

- **Card "Contas Mercado Pago"** (novo, `components/admin/PaymentAccountsManager.tsx`):
  - Tabela: label, ⭐ se padrão, badge "Arquivada", status ("Token ✓ / Webhook ✓ / Public key —").
  - Ações: **Nova conta** · por linha: **Editar** · **Tornar padrão** · **Arquivar/Desarquivar**.
  - Modal de criar/editar: campos + **o URL do webhook daquela conta em destaque, com botão copiar**
    ("cole isto em Suas integrações → Webhooks no painel desta conta MP"). Auth token / webhook
    secret nunca pré-preenchidos.
  - Toda ação abre um **modal de código 2FA** (padrão do estorno: primeiro "enviamos um código
    pro seu e-mail", input de 6 dígitos, confirma). Reusar o componente do estorno se genérico o
    suficiente; senão um `PaymentAccountCodeModal` espelhando-o.
- **`PaymentGatewayForm.tsx`** (existente): perde os 3 campos `mp_*`. Fica com: seletor de provider
  (`mercadopago` / `pagarme` / `sandbox`) + as credenciais **Pagar.me** (inalteradas). Uma nota:
  "As credenciais do Mercado Pago agora ficam em Contas Mercado Pago (abaixo)."
- **Painel admin do evento** (`app/admin/eventos/[id]/...`): select "Conta de pagamento" com as
  contas não-arquivadas + opção "(padrão da plataforma: <label>)". Ao salvar com mudança nesse
  campo → modal de código 2FA. Mostra aviso se a conta atual do evento estiver arquivada.

---

## 4. Casos de borda e erros

- **Nenhuma conta padrão** (última arquivada por fora, ou instalação nova sem migração): checkout
  MP → 503 "Gateway de pagamento não configurado". `getDefaultPaymentAccount()` lança
  `NoPaymentAccountError`. O `archive` já bloqueia arquivar a padrão, mas o checkout revalida.
- **`accountId` inválido na URL do webhook** → 404, nada processado.
- **Webhook com assinatura válida mas `providerPaymentId` de pagamento de outra conta** → ignora
  (log), `200`.
- **`Payment` inexistente quando o webhook chega** → `200`, MP faz retry (igual hoje).
- **Editar credencial com pagamentos pendentes na conta** → permitido. Trocar por credencial de
  **outra** conta MP por engano deixa pendentes órfãos — fora de escopo prevenir (erro de operação,
  mesmo risco de hoje ao trocar `mp_access_token`).
- **`Event.paymentAccountId` → conta arquivada:** resolução ainda usa ela (pagamentos novos do
  evento vão pra conta certa); UI mostra "conta arquivada" no evento. `resolveEventPaymentAccount`
  não faz fallback automático pra padrão nesse caso — seria mudar pra onde vai o dinheiro sem o
  admin saber.
- **Primeira conta** criada é `isDefault: true` automaticamente (não dá pra ter MP sem padrão).
- **`make-default` numa conta arquivada** → 400.
- **2FA:** código errado 5x / expirado (10 min) / reuso / anti-reuso entre ações → mensagens do
  mecanismo atual. Falha no e-mail do código → aborta a ação, credencial não gravada.
- **Migração idempotente:** se `payment_accounts` já tiver a "Mercado Pago Principal", o step de
  dados não duplica (checa por `isDefault` existente antes de inserir).

## 5. Testes

- **`lib/payment/account-resolver`**: override do evento → conta; sem override → padrão; sem padrão
  → `NoPaymentAccountError`; `getPaymentAccountById` acha conta arquivada.
- **`MercadoPagoProvider(account)`**: `createPayment`/`refundPayment`/`checkPaymentStatus`/
  `verifyWebhookSignature` usam token e secret da conta, não da setting; sem `account` → fallback
  setting global (regressão Pagar.me/sandbox intacta).
- **Checkout E2E**: `Payment.paymentAccountId` = conta resolvida do evento; `checkout-ads` = padrão.
- **`card-config`**: com `eventId` → public key da conta do evento; sem → setting global.
- **Webhook por conta** (`/mp/[accountId]`): assinatura válida da conta certa → aplica; assinatura
  de outra conta → 401; `accountId` inexistente → 404; `providerPaymentId` de outra conta → ignora,
  200; `Payment` inexistente → 200.
- **Shim legado** (`/api/webhooks/payment`): MP → resolve padrão e aplica; Pagar.me → inalterado
  (testes atuais seguem verdes).
- **Refund**: usa a conta congelada (inclusive arquivada); `paymentAccountId` null → fallback
  setting global.
- **Rotas admin**: cada mutação sem `verificationId`/`code` válido → 403; GET nunca devolve
  `accessToken`/`webhookSecret`; `archive` da padrão → 400; `make-default` transacional (rebaixa a
  antiga); auditoria mascara credenciais; primeira conta vira default.
- **Override de evento**: `PATCH` com `paymentAccountId` sem 2FA → 403; com `null` → volta pra
  padrão; conta arquivada → 400.
- **backup/import**: sem código → 403.
- **Migração** (teste do step de dados): com `mp_access_token` → cria "Mercado Pago Principal"
  default + backfill de `payments.paymentAccountId`; sem token → nenhuma conta; rodar 2x → não
  duplica.
- **Invariante**: nunca duas contas `isDefault=true` não-arquivadas (teste no fluxo de
  `make-default` e de criação).

## 6. Compatibilidade e migração operacional

1. Deploy do código (branch → main → `git pull` + build + `prisma db push` do schema novo +
   step de dados). Container reinicia.
2. Nesse ponto: existe a conta "Mercado Pago Principal" (default), todos os `Payment` MP antigos
   apontam pra ela, o endpoint legado ainda funciona. **Nada quebra sem o admin fazer nada.**
3. Quando o admin quiser: em `/admin/configuracoes` → Contas Mercado Pago → copia o URL do webhook
   da conta principal (`/api/webhooks/payment/mp/<id>`) e atualiza no painel do MP. Aí o log de
   "endpoint legado" some pra essa conta.
4. Admin cadastra as outras contas, aponta o webhook de cada uma, e seta o override nos eventos que
   usam conta diferente.
5. Backlog (fora deste sub-projeto): remover as settings `mp_*` e o shim legado depois que todas as
   contas estiverem migradas.

## 7. Fora de escopo (documentado)

- OAuth / conexão de conta pelo organizador; split / marketplace do Mercado Pago.
- Múltiplas contas Pagar.me.
- Rodízio automático de conta por volume / limite.
- Remoção das settings `mp_access_token` / `mp_webhook_secret` / `mp_public_key` e do endpoint
  webhook legado (backlog pós-migração).
- Migrar o `Payment.provider` string pra enum (não relacionado).
