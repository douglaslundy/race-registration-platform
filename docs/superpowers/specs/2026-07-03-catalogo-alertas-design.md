# Design: catálogo de alertas (vagas esgotando, carrinho abandonado, erro de pagamento)

Sub-projeto 6b de um conjunto maior de pedidos (o pedido original "sistema de alertas via e-mail e WhatsApp" foi dividido em dois: o sub-projeto 6a construiu a infraestrutura Evolution API/WhatsApp — `sendWhatsAppMessage()`; este consome ela).

## ⚠️ Risco e mitigação

- Este sub-projeto toca 3 rotinas existentes em produção: `lib/checkout.ts` (onde `TicketBatch.soldCount` já é incrementado), `app/api/webhooks/payment/route.ts` e `app/api/orders/[id]/status/route.ts` (os dois pontos onde um `Payment` já transiciona para `CANCELLED`/`EXPIRED`).
- Em todos os três casos, a mudança é **estritamente aditiva**: uma única chamada `void notificarAlerta(...)` inserida no fim da lógica já existente, depois que a resposta/transação já foi decidida. A função chamada nunca lança exceção (mesmo padrão *fire-and-forget* de `notifyOrderConfirmed` em `lib/notifications.ts` — try/catch interno, falha silenciosa) e nunca altera o valor retornado pela rota.
- Cada alerta checa seu próprio `PlatformSetting` de "ativado" internamente, antes de fazer qualquer trabalho. Com os 3 alertas desligados por padrão (decisão confirmada com o usuário), o comportamento observável dessas 3 rotinas fica **idêntico ao atual** até o admin ativar algo em `/admin/alertas`.
- Nenhuma rotina existente tem sua lógica de negócio, validações ou fluxo de erro alterados — só um efeito colateral novo, no final.

## Contexto (o que já existe)

- `lib/whatsapp.ts` → `sendWhatsAppMessage(phone: string, text: string): Promise<void>` (sub-projeto 6a): lança erro se o WhatsApp não estiver configurado/conectado; quem chama decide se quer capturar isso.
- `lib/email.ts` → `sendMail({to, subject, html})` genérico + `layout()` para o HTML padrão; padrão de templates dedicados (`sendRegistrationConfirmationEmail`, etc.).
- `lib/notifications.ts` → padrão de função fire-and-forget (`notifyOrderConfirmed`): try/catch interno, checa se o canal está pronto (`isSmtpReady`), busca os dados necessários, chama o template, nunca lança.
- `PlatformSetting` (chave-valor) + `getSetting`/`upsertSetting` (`lib/settings.ts`) + `POST /api/admin/settings` genérico (já grava `AuditLog`, já faz `revalidatePath`) — nenhuma rota nova é necessária para salvar a configuração dos alertas.
- `TicketBatch.capacity`/`soldCount` (Int, sempre definidos — sem conceito de "ilimitado" neste nível; `Event.maxParticipants` é o campo nullable de ilimitado, mas não é usado aqui).
- `Order.status` (`PENDING` → `PAID`/`CANCELLED`/`REFUNDED`), `Order.createdAt`.
- `AthleteProfile.phone` e `OrganizerProfile.phone` já existem no schema — usados como destino do WhatsApp.
- Nenhum mecanismo de cron/agendamento existe hoje no sistema.
- `lib/checkout.ts`: dentro de uma `db.$transaction`, cria `Order` + `Registration` e faz `tx.ticketBatch.update({ soldCount: { increment: 1 } })`, depois retorna `{ orderId, registrationId, ... }` para `app/api/checkout/route.ts`, que já chama `void notifyOrderConfirmed(...)` em outro fluxo (pagamento confirmado) como referência de padrão.
- `app/api/webhooks/payment/route.ts`: dentro de uma `db.$transaction`, decide `newPaymentStatus`/`newOrderStatus`; hoje só reage a `newPaymentStatus === "PAID"` chamando `notifyOrderConfirmed`. Não reage a `CANCELLED`/`EXPIRED`.
- `app/api/orders/[id]/status/route.ts`: rota de polling chamada pelo front-end enquanto o pedido está pendente; faz uma consulta ao vivo no Mercado Pago e, se detectar `CANCELLED`, atualiza `Payment`/`Order` — hoje sem nenhuma notificação nesse caminho.

## Decisões (confirmadas com o usuário)

1. Catálogo fechado de 3 alertas (não um motor de regras genérico): vagas se esgotando, carrinho abandonado, erro de pagamento.
2. Cada alerta tem: liga/desliga e-mail, liga/desliga WhatsApp, e 1 parâmetro simples quando fizer sentido (limiar % para vagas esgotando, minutos para carrinho abandonado). Tudo configurado pelo admin, nada criado dinamicamente.
3. Destinatários: vagas esgotando → organizador do evento; carrinho abandonado e erro de pagamento → o próprio atleta.
4. Carrinho abandonado precisa de checagem periódica — implementado como rota protegida por segredo + crontab do sistema operacional na VPS (não um `setInterval` em processo).
5. Todos os 3 alertas vêm **desligados por padrão** (e-mail e WhatsApp).
6. Carrinho abandonado dispara **uma única vez por pedido** (sem lembretes repetidos).
7. Tela de configuração em página dedicada `/admin/alertas`.

## Arquitetura

### Schema: nova tabela `AlertLog`

```prisma
model AlertLog {
  id         String   @id @default(cuid())
  alertType  String   // "LOW_STOCK" | "ABANDONED_CART" | "PAYMENT_ERROR"
  entityType String   // "TicketBatch" | "Order" | "Payment"
  entityId   String
  channel    String   // "EMAIL" | "WHATSAPP"
  sentAt     DateTime @default(now())

  @@unique([alertType, entityId, channel])
  @@map("alert_logs")
}
```

O par único (`alertType`, `entityId`, `channel`) garante que o mesmo alerta nunca é reenviado pelo mesmo canal para a mesma entidade — tanto por checagem prévia quanto como rede de segurança (uma tentativa de `create` duplicada falha por violação de unicidade em vez de mandar duas vezes). Essa tabela é genérica o suficiente para qualquer alerta futuro reaproveitar sem precisar de migração nova.

### Configuração (`PlatformSetting`, via `getSetting`/`upsertSetting` já existentes)

Novo módulo `lib/alerts/alert-settings.ts`, mesmo padrão de `lib/whatsapp-settings.ts`:

```ts
export interface LowStockAlertSettings { emailEnabled: boolean; whatsappEnabled: boolean; thresholdPercent: number; }
export interface AbandonedCartAlertSettings { emailEnabled: boolean; whatsappEnabled: boolean; minutesThreshold: number; }
export interface PaymentErrorAlertSettings { emailEnabled: boolean; whatsappEnabled: boolean; }

export async function getLowStockAlertSettings(): Promise<LowStockAlertSettings>;
export async function getAbandonedCartAlertSettings(): Promise<AbandonedCartAlertSettings>;
export async function getPaymentErrorAlertSettings(): Promise<PaymentErrorAlertSettings>;
```

Chaves: `alert_low_stock_email_enabled`, `alert_low_stock_whatsapp_enabled`, `alert_low_stock_threshold_percent` (padrão `90`); `alert_abandoned_cart_email_enabled`, `alert_abandoned_cart_whatsapp_enabled`, `alert_abandoned_cart_minutes` (padrão `30`); `alert_payment_error_email_enabled`, `alert_payment_error_whatsapp_enabled`. Todos os `*_enabled` têm padrão `false`.

### Lógica de cada alerta

Um módulo por alerta em `lib/alerts/`, cada um seguindo o padrão fire-and-forget de `notifyOrderConfirmed` (try/catch interno, nunca lança, checa configuração e dedupe antes de fazer qualquer trabalho):

- **`lib/alerts/low-stock.ts`** → `checkLowStockAlert(ticketBatchId: string): Promise<void>`. Busca o lote + evento + organizador; se `soldCount / capacity * 100 >= thresholdPercent` (e `capacity > 0`), envia e-mail e/ou WhatsApp para o organizador (usando `AlertLog` para nunca repetir por lote+canal), com dados do evento/lote/percentual atual.
- **`lib/alerts/abandoned-cart.ts`** → `checkAbandonedCarts(): Promise<{ checked: number; notified: number }>`. Busca `Order` com `status = "PENDING"` e `createdAt <= now - minutesThreshold`, ainda sem entrada em `AlertLog` para (`ABANDONED_CART`, order.id, canal); envia e-mail/WhatsApp para o comprador com um link para retomar o pagamento; marca em `AlertLog`. Retorna contagem para o log da rota de cron.
- **`lib/alerts/payment-error.ts`** → `notifyPaymentError(paymentId: string): Promise<void>`. Busca o pagamento + pedido + comprador; envia e-mail/WhatsApp avisando que o pagamento falhou/expirou, com link para tentar novamente. Usa `AlertLog` (`PAYMENT_ERROR`, paymentId, canal) para não duplicar em reprocessamentos de webhook.

Templates de e-mail novos em `lib/email.ts` (`sendLowStockEmail`, `sendAbandonedCartEmail`, `sendPaymentErrorEmail`), seguindo o `layout()` já existente. Mensagens de WhatsApp são strings simples passadas para `sendWhatsAppMessage()`.

### Pontos de disparo (rotinas existentes, edição aditiva)

- `app/api/checkout/route.ts`: depois que `lib/checkout.ts` retorna com sucesso, `void checkLowStockAlert(result.ticketBatchId)`.
- `app/api/webhooks/payment/route.ts`: depois da transação, quando `newPaymentStatus === "CANCELLED" || newPaymentStatus === "EXPIRED"`, `void notifyPaymentError(payment.id)`.
- `app/api/orders/[id]/status/route.ts`: depois da transação que marca o pagamento como `CANCELLED`, `void notifyPaymentError(payment.id)`.

### Rota de cron

`POST /api/cron/abandoned-carts` — sem sessão de usuário; autenticado por um header `x-cron-secret` comparado a `process.env.CRON_SECRET` (401 se não bater ou a variável não estiver definida). Chama `checkAbandonedCarts()` e retorna `{ checked, notified }`. O admin configura uma linha de crontab na VPS (ex.: a cada 10 minutos) chamando essa rota com `curl` e o header — isso fica documentado no relatório de verificação manual, não é código.

### UI — `/admin/alertas`

Página dedicada (padrão de `/admin/whatsapp`/`/admin/backup`), 3 cards (um por alerta), cada um com: checkbox e-mail, checkbox WhatsApp, campo numérico do parâmetro (limiar % ou minutos). Salva via `POST /api/admin/settings` existente (uma chamada por campo alterado, mesmo padrão de `SmtpSettingsForm`). Link novo em `AdminNav.tsx`.

## Fora de escopo

- Qualquer alerta além destes 3.
- Motor de regras genérico para o admin criar alertas novos pela tela.
- Lembretes repetidos para o mesmo carrinho abandonado.
- Re-disparo do alerta de vagas esgotando se a capacidade do lote for aumentada depois do primeiro disparo (limitação conhecida da v1 — o dedupe é permanente por lote).
- Qualquer UI de histórico "quais alertas já foram enviados" (fica implícito na tabela `AlertLog`, sem tela dedicada nesta versão).

## Testes

- Testes unitários para `checkLowStockAlert`, `checkAbandonedCarts`, `notifyPaymentError` (mockando `db`, `sendMail`/`sendWhatsAppMessage`, e as configurações), cobrindo: alerta desligado (não faz nada), abaixo do limiar (não dispara), acima do limiar (dispara e grava `AlertLog`), já alertado (não duplica), canal sem destinatário válido (telefone nulo) não quebra o outro canal.
- Testes unitários para `lib/alerts/alert-settings.ts` (getters com valores padrão).
- Teste de rota para `POST /api/cron/abandoned-carts` (401 sem segredo correto, 200 com segredo correto chamando `checkAbandonedCarts`).
- Sem testes de UI (convenção já estabelecida).
- Verificação manual: confirmar que, com os 3 alertas desligados, o checkout/webhook/status continuam funcionando exatamente como antes; depois, ligar cada alerta um de cada vez e forçar o cenário (lote quase cheio, pedido pendente antigo, pagamento cancelado) para confirmar o disparo e o não-reenvio na segunda execução.
