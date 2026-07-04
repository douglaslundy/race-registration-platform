# Reenvio manual de notificação de pagamento não identificado

## Contexto

Terceiro e último sub-projeto de uma leva de pedidos do usuário. Hoje, quando um pagamento
expira/é cancelado, `notifyPaymentError(paymentId)` (`lib/alerts/payment-error.ts`) dispara
automaticamente um e-mail e/ou WhatsApp avisando o atleta — mas não existe nenhuma forma manual de
reenviar esse aviso depois, e a redação atual é genérica ("não foi concluído... tente novamente"),
sem deixar claro que a inscrição foi cancelada por falta de identificação do pagamento, nem sugerir
uma nova inscrição.

## Descoberta importante

`notifyPaymentError` usa deduplicação (`claimAlert`/`AlertLog`, `lib/alerts/dedupe.ts`) para nunca
mandar o mesmo alerta duas vezes por pagamento+canal — essencial para o disparo automático (evita
duplicar em caso de webhook reentregue), mas isso bloquearia um reenvio manual: se o alerta
automático já tiver disparado, chamar a mesma função de novo não reenviaria nada. A função ganha uma
opção `bypassDedupe` para contornar isso especificamente no caminho manual, sem alterar o
comportamento do disparo automático (que continua chamando sem essa opção).

## 1. Templates atualizados (usados nos dois casos — automático e manual)

`lib/email.ts` (`sendPaymentErrorEmail`) e a mensagem de WhatsApp em `lib/alerts/payment-error.ts`
passam a deixar explícito que a inscrição foi cancelada por pagamento não identificado, e sugerir
uma nova inscrição imediata. Mesmo texto para os dois disparos (automático e manual) — só muda
*quando* e *por quem* é acionado.

## 2. `notifyPaymentError` ganha `bypassDedupe`

```ts
export async function notifyPaymentError(
  paymentId: string,
  options?: { bypassDedupe?: boolean },
): Promise<void>
```

Quando `bypassDedupe: true`, pula a chamada a `claimAlert` (trata como se sempre tivesse "ganho a
disputa") e não desfaz nada em `unclaimAlert` no catch (não há claim pra desfazer). Os 3 chamadores
existentes (`app/api/webhooks/payment/route.ts`, `app/api/orders/[id]/status/route.ts`,
`lib/payment/expire-payments.ts`) continuam chamando sem o segundo argumento — comportamento
inalterado.

## 3. Duas rotas novas (organizador e admin)

Espelhando o padrão já usado pelo estorno (`app/api/organizer/registrations/[id]/refund/route.ts` e
o equivalente de admin): `app/api/organizer/registrations/[id]/resend-payment-notification/route.ts`
e `app/api/admin/registrations/[id]/resend-payment-notification/route.ts`. Cada uma:

- Autentica (organizador só vê inscrições dos próprios eventos; admin vê qualquer uma).
- Busca a inscrição e o pagamento mais recente do pedido com status `EXPIRED` ou `CANCELLED`
  (ordenado por `createdAt desc`, já que esses pagamentos não têm `paidAt`).
- Se não achar um pagamento nesse estado, retorna erro 400 ("Nenhum pagamento expirado/cancelado
  encontrado para esta inscrição").
- Chama `notifyPaymentError(payment.id, { bypassDedupe: true })`.
- Grava um `AuditLog` (`action: "PAYMENT_ERROR_NOTIFICATION_RESENT"`, `entityType: "Payment"`,
  `userId` de quem disparou) — seguindo o padrão de toda ação administrativa já existente no
  projeto.

Adicionar essa ação à tela de inscritos do admin (hoje somente leitura, por decisão do sub-projeto
2) é uma exceção deliberada e restrita: reenviar uma notificação não mexe em dinheiro nem no estado
da inscrição, ao contrário de estornar/cancelar/confirmar (que continuam de fora do admin).

## 4. Botão compartilhado

Novo `components/registrations/ResendPaymentNotificationButton.tsx` (mesmo padrão visual/estrutural
de `ManualConfirmButton`: botão simples, estado de carregamento, `router.refresh()` no sucesso,
`alert()` no erro — consistente com os outros botões de ação já existentes; a limpeza de `alert()`
em todo o sistema é uma tarefa futura separada, ainda não iniciada). Recebe um `endpoint` (padrão já
usado por `ReconciliationPanel`), assim o mesmo componente serve as duas rotas.

Aparece nas duas telas de inscritos (organizador e admin), dentro do `renderActions` de cada uma,
só quando o pagamento mais recente daquela inscrição está `EXPIRED` ou `CANCELLED` — mesma condição
usada pelas rotas para decidir se há o que reenviar. Isso significa que a tela do admin ganha seu
primeiro uso de `renderActions` (hoje não passa nenhum).

## Fora de escopo

- Qualquer outro botão de ação (estornar, aprovar/rejeitar cancelamento, confirmar manualmente) na
  tela de inscritos do admin — continuam de fora, essa exceção é só para o reenvio de notificação.
- Varredura geral do sistema por `alert()` — tarefa futura separada, ainda não pedida para começar.
- Configuração de um texto customizado por disparo — sempre usa o template fixo (atualizado).
