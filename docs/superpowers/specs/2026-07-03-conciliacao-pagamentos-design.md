# Design: confirmação manual, código de transação e conciliação de pagamentos

Sub-projeto 8 de um conjunto maior de pedidos.

## ⚠️ Risco e mitigação

- **Confirmação manual pode ser usada indevidamente** (organizador marcando como pago algo que não foi). Mitigação: exige justificativa obrigatória, grava `AuditLog` completo (quem, quando, motivo), e só é permitida em inscrições `PENDING_PAYMENT` do próprio evento do organizador — mesma fronteira de segurança já usada no estorno e na decisão de cancelamento.
- **Conciliação nunca corrige o banco automaticamente** — só sinaliza. Isso evita que uma falha temporária de rede ou uma resposta inconsistente do gateway apague/altere um estado real por engano. A correção, se necessária, continua sendo manual (via os fluxos já existentes: reenviar webhook, ou a confirmação manual acima).
- **Interface `PaymentProvider` ganha um método novo** (`checkPaymentStatus`) — implementado nos 3 provedores já existentes (`SandboxPaymentProvider`, `MercadoPagoProvider`, `PagarMeProvider`), sem alterar nenhum método já existente. Nenhum consumidor atual desses provedores é afetado.
- **Novo campo `User.phone`** — nullable, sem valor padrão, não afeta nenhum usuário existente nem nenhuma consulta atual.

## Contexto (o que já existe)

- `Payment.providerPaymentId` já é gravado no checkout, mas não é exibido em nenhuma tela do organizador.
- `app/organizador/eventos/[id]/inscritos/page.tsx`: tabela já tem colunas de pagamento/valor/data/status e a coluna "Ações" com `RefundRegistrationButton`/`CancellationDecisionButtons` (padrão de botão com confirmação em duas etapas).
- `app/api/organizer/registrations/[id]/refund/route.ts` e `.../cancellation-decision/route.ts`: padrão de segurança já estabelecido (`db.registration.findFirst({ where: { id, event: { organizer: { userId } } } })`).
- `lib/payment/types.ts`: interface `PaymentProvider` com `createPayment`/`refundPayment`/`verifyWebhookSignature`/`parseWebhookPayload` — **sem** nenhum método de consulta de status.
- `app/api/orders/[id]/status/route.ts` já tem uma versão ad-hoc de consulta de status ao Mercado Pago (`checkMPPaymentStatus`), só usada ali, não reutilizável.
- `lib/payment/pagarme.ts` já tem um mapeamento de status de cobrança do Pagar.me para os status internos (usado hoje só na leitura de webhook).
- Catálogo de alertas (sub-projeto 6b): `lib/alerts/` (padrão de módulo por alerta + configuração via `PlatformSetting` + `AlertConfigCard` reutilizável em `/admin/alertas`), rota de cron protegida por segredo (padrão de `/api/cron/abandoned-carts`).
- `AthleteProfile.phone`/`OrganizerProfile.phone` já existem; `User` (a tabela base, usada por todos os papéis) não tem campo de telefone.
- Páginas de perfil próprias já existem para atleta (`/dashboard/perfil`) e organizador (`/organizador/perfil`), mas não para admin.

## Decisões (confirmadas com o usuário)

1. Confirmação manual exige justificativa obrigatória (texto livre).
2. Conciliação roda automaticamente via cron **e** pode ser disparada manualmente: pelo admin (todos os eventos) e pelo organizador (só os eventos dele).
3. Divergência encontrada nunca corrige o banco sozinha — só sinaliza e envia alerta (e-mail + WhatsApp) para o admin.
4. Alerta de e-mail vai para todo usuário com papel `ADMIN` (usa `User.email`, já existente); alerta de WhatsApp usa um novo campo `User.phone` (compartilhado entre todos os papéis) — como hoje não existe tela de perfil para admin, esta sub-projeto cria uma mínima (`/admin/perfil`) só para isso.

## Arquitetura

### Schema

```prisma
// User
phone String?
```

Sem outra mudança de schema — a conciliação não grava nada novo no banco (é read-only sobre `Payment`), e a confirmação manual usa os campos já existentes de `Payment`/`Order`/`Registration`.

### Código de transação na tabela de inscritos

`app/organizador/eventos/[id]/inscritos/page.tsx`: a consulta já inclui `order.payments` — passa a selecionar também `providerPaymentId`, exibido como uma nova coluna "Código transação" (texto monoespaçado, truncado, com fallback "—" quando nulo).

### Confirmação manual

Nova rota `POST /api/organizer/registrations/[id]/manual-confirm`, corpo `{ reason: string }` (mínimo alguns caracteres). Mesma fronteira de segurança do estorno (escopado ao evento do organizador). Só permitida quando `registration.status === "PENDING_PAYMENT"`. Numa transação: `Payment → PAID` (`paidAt = now()`), `Order → PAID`, `Registration → CONFIRMED`; grava `AuditLog` (`REGISTRATION_MANUALLY_CONFIRMED`, `metadata: { reason }`); dispara `notifyOrderConfirmed` (já existente) fire-and-forget.

Novo componente `ManualConfirmButton` na coluna "Ações", visível quando `status === "PENDING_PAYMENT"` — confirmação em duas etapas com campo de justificativa obrigatório (mesmo padrão do `CancelRegistrationButton` quando exige justificativa).

### Conciliação com o gateway

**Novo método na interface `PaymentProvider`:**
```ts
checkPaymentStatus(providerPaymentId: string): Promise<"PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK">
```
- `SandboxPaymentProvider`: sempre retorna `"PENDING"` (não há estado externo real para consultar em ambiente de teste — isso nunca gera divergência, já que só pagamentos já `PENDING` no banco são checados).
- `MercadoPagoProvider`: `GET /v1/payments/{id}`, reaproveitando o mesmo mapeamento de status já usado no webhook (`approved→PAID`, `refunded→REFUNDED`, `charged_back→CHARGEBACK`, `cancelled`/`rejected→CANCELLED`, `expired→EXPIRED`, qualquer outro → `PENDING`).
- `PagarMeProvider`: `GET /core/v5/charges/{id}`, reaproveitando o mapeamento de status já usado no webhook (`paid`/`overpaid→PAID`, `refunded→REFUNDED`, `chargedback→CHARGEBACK`, `failed`/`canceled→CANCELLED`, qualquer outro → `PENDING`).

**Nova rotina** `lib/payment/reconciliation.ts`:
```ts
export interface PaymentMismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
}

export async function reconcilePayments(options?: { organizerUserId?: string }): Promise<{ checked: number; mismatches: PaymentMismatch[] }>;
```
Consulta `Payment`s com `status = "PENDING"`, `providerPaymentId` não nulo, e `createdAt` mais antigo que o limiar configurável `alert_reconciliation_minutes_threshold` (definido na seção de alerta abaixo; padrão 15 minutos — evita falso positivo em pagamentos recém-criados ainda em processamento no gateway). Quando `organizerUserId` é informado, filtra só pagamentos de pedidos de eventos daquele organizador. Para cada um, chama `checkPaymentStatus` do provedor configurado; se o status retornado for diferente do status local, adiciona à lista de divergências. **Nunca escreve no banco.**

**Alerta de divergências** (`lib/alerts/reconciliation.ts`, fora do sistema de deduplicação por entidade do catálogo de alertas — este é um resumo por execução, não um alerta por entidade, então re-alerta a cada execução enquanto a divergência não for resolvida manualmente, o que é o comportamento desejado): se `reconcilePayments()` encontrar 1+ divergências e o alerta estiver ligado, monta um e-mail/WhatsApp com a lista (pedido, evento, status local vs. status do gateway) e envia para cada usuário com papel `ADMIN` (e-mail via `User.email`; WhatsApp via `User.phone`, pulando quem não tiver telefone cadastrado). Configuração via `PlatformSetting` (mesmo padrão dos outros 3 alertas: `alert_reconciliation_email_enabled`, `alert_reconciliation_whatsapp_enabled`, `alert_reconciliation_minutes_threshold`), com um 4º card em `/admin/alertas` reaproveitando o componente `AlertConfigCard` já existente.

**Rotas de disparo:**
- `POST /api/cron/reconciliation` — protegida por `x-cron-secret`/`CRON_SECRET` (mesmo padrão do carrinho abandonado). Roda `reconcilePayments()` sem filtro de organizador (plataforma toda) e dispara o alerta se houver divergências.
- `POST /api/admin/reconciliation` — admin autenticado, roda `reconcilePayments()` sem filtro, **retorna a lista de divergências na resposta** (o admin já vê o resultado na hora, então esse disparo manual não aciona o alerta de e-mail/WhatsApp — seria redundante).
- `POST /api/organizer/reconciliation` — organizador autenticado, roda `reconcilePayments({ organizerUserId: session.user.id })`, retorna a lista de divergências dos eventos dele na resposta, **e também aciona o alerta para o admin** se houver divergências (o admin precisa saber, mesmo que o organizador tenha disparado).

**UI:**
- Nova página `/admin/conciliacao` (padrão de página dedicada, como `/admin/whatsapp`/`/admin/backup`): botão "Verificar agora" + tabela de resultado (pedido, evento, valor, status local, status do gateway) após rodar.
- Nova página `/organizador/conciliacao`: mesmo padrão, escopado aos eventos do organizador.
- Novo card em `/admin/alertas` para o 4º alerta (divergência de conciliação).
- Link novo em `AdminNav.tsx` e no menu do organizador para as respectivas páginas.
- Nova página mínima `/admin/perfil` (só campo de telefone, mesmo padrão visual de `/organizador/perfil`) + rota `GET`/`PUT /api/admin/profile`.

## Fora de escopo

- Qualquer correção automática de divergência.
- Qualquer alteração no fluxo de webhook existente.
- Histórico persistido de execuções de conciliação (cada execução é um resumo efêmero, não gravado em tabela própria — as divergências reais continuam visíveis nos dados de `Payment`/`Order` até serem corrigidas).
- Conciliação de reembolsos/estornos (`Refund`) — só `Payment` com status `PENDING`.
- Outros campos de perfil do admin além do telefone.

## Testes

- Testes unitários para `checkPaymentStatus` de cada provedor (mockando `fetch`), cobrindo os mapeamentos de status.
- Testes unitários para `reconcilePayments` (mockando `db` e o provedor), cobrindo: limiar de minutos, filtro por organizador, detecção de divergência, ausência de escrita no banco em qualquer cenário.
- Testes unitários para o módulo de alerta de conciliação (settings desligadas, e-mail para múltiplos admins, pular WhatsApp sem telefone).
- Testes de rota para `manual-confirm` (fronteira de segurança, exige `reason`, só em `PENDING_PAYMENT`, transação correta) e para as 3 rotas de disparo de conciliação (autenticação/autorização, filtro por organizador, alerta disparado só nos casos certos).
- Sem testes de UI (convenção já estabelecida).
- Verificação manual: confirmação manual de ponta a ponta; exibição do código de transação; conciliação encontrando uma divergência real (via dado manipulado diretamente no banco de teste) e confirmando que o alerta chega sem nenhuma escrita no banco.
