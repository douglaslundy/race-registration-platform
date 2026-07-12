# Corrigir pedidos de cartão presos em PENDING (bug de expiração de pagamentos)

## Contexto

Quarto de seis sub-projetos pedidos pelo usuário nesta sessão (carrinhos abandonados ✅ → filtros/
resumo no evento ✅ → resultados/import CSV ✅ → **este** → repasses → dashboards). O pedido original
era investigar por que pedidos ficam presos em `PENDING` por dias sem expirar, apesar de
`/api/cron/expire-payments` existir e (segundo memória de sessões anteriores) estar configurado no
crontab da VPS a cada 6h.

Investigação (systematic-debugging) encontrou a causa raiz — **não é um problema de crontab, é um
bug de código** que afeta apenas pagamentos por **cartão de crédito**:

- `expirePendingPayments()` (`lib/payment/expire-payments.ts:47-57`) só considera pagamentos com
  `expiresAt` preenchido e no passado: `where: { status: "PENDING", expiresAt: { not: null, lt: new
  Date() }, ... }`.
- PIX e boleto sempre recebem `expiresAt` (ambos os provedores preenchem, com fallback quando o
  gateway não retorna `date_of_expiration`/`expires_at`).
- **Cartão de crédito nunca recebe `expiresAt`** — nem `MercadoPagoProvider.createPayment`
  (`lib/payment/mercadopago.ts:189-193`) nem `PagarMeProvider.createPayment`
  (`lib/payment/pagarme.ts:136-139`) retornam esse campo pro branch de cartão. `checkout/route.ts:150`
  grava `expiresAt: null` pra todo pagamento de cartão.
- Resultado: todo `Payment` de cartão fica **estruturalmente invisível** pra query de expiração —
  pra sempre, não importa a idade. Isso vale também pros botões manuais do admin e do organizador
  (`/api/admin/expire-payments`, `/api/organizer/expire-payments`) — os três chamadores usam a
  mesma função `expirePendingPayments()`, mesmo filtro.
- Segundo problema, relacionado: quando o gateway rejeita o cartão (`status: "rejected"` na MP,
  `"failed"`/`"canceled"` na Pagar.me), o código grava isso localmente como `PENDING`
  (`mercadopago.ts:191`: `status: resCC.status === "approved" ? "PAID" : "PENDING"`), não como uma
  falha terminal. A reconciliação diária (`lib/payment/reconciliation.ts:73-98`) até detecta esse
  descompasso, mas só corrige automaticamente quando o gateway agora diz `PAID` — pra
  `CANCELLED`/`REJECTED` ela só registra o descompasso (`corrected: false`), sem nunca corrigir o
  registro local.

Combinando os dois: **qualquer checkout de cartão que não seja aprovado na hora (cartão recusado,
em análise antifraude, etc.) vira um `Order`/`Payment`/`Registration` preso em `PENDING` pra
sempre**, com a vaga do lote (`TicketBatch.soldCount`) nunca liberada. Nenhum job automático — nem
o cron, nem a reconciliação — resolve isso, e nenhum botão manual consegue ver essas linhas.

**Decisões confirmadas com o usuário:**
- Cartão **recusado** (`rejected`/`failed`/`canceled`): cancelar **imediatamente**, dentro da
  própria requisição de checkout — não esperar nenhum job de expiração.
- Cartão **em processamento/análise** (`in_process`, `pending`, `processing`, etc.): continuar como
  `PENDING`, mas agora com `expiresAt` preenchido, como rede de segurança pro cron/expire-payments
  liberar a vaga automaticamente se o gateway nunca resolver.
- Janela de fallback **por gateway**, baseada na documentação oficial de cada um (mesmo padrão já
  usado pro fallback de 24h do PIX, documentado em [[cron_jobs_vps]]):
  - **Mercado Pago: 48h.** Os `status_detail` `pending_contingency` e `pending_review_manual`
    (cartão em contingência/revisão manual) têm resultado informado "em até 2 dias úteis", segundo
    a [documentação oficial](https://www.mercadopago.com.ar/developers/en/docs/checkout-api-orders/payment-management/status/transaction-status).
  - **Pagar.me: 1h.** O recurso ["Cancelamento Garantido"](https://docs.pagar.me/docs/cancelamento-garantido)
    já promete que cobranças de cartão com falha no fluxo normal (status `processing`) são
    resolvidas "no momento do pedido, em tempo real" — não há uma janela de dias documentada, então
    1h é só uma rede de segurança generosa.

## 1. `lib/payment/types.ts` — novo status `CANCELLED` no resultado de criação

`CreatePaymentResult.status` hoje é `"PENDING" | "PAID" | "EXPIRED"`. Adiciona `"CANCELLED"`:

```ts
export interface CreatePaymentResult {
  providerPaymentId: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
  // ... resto inalterado
}
```

`CANCELLED` sinaliza "o gateway já recusou este pagamento na criação — nem chega a existir como
pendente". Distinto de `EXPIRED`, que é o que `cancelExpiredPayment` grava quando um PIX/boleto
pendente estoura o prazo depois de já ter existido como `PENDING`.

## 2. `lib/payment/mercadopago.ts` — mapear status de cartão na criação

Branch de cartão hoje (linhas 189-193):

```ts
return {
  providerPaymentId: String(resCC.id),
  status: resCC.status === "approved" ? "PAID" : "PENDING",
  gatewayFeeAmount: resCC.status === "approved" ? extractGatewayFeeAmount(resCC) : undefined,
};
```

Novo mapeamento (mesmo padrão de `checkPaymentStatus`, que já trata `rejected` como estado
terminal — linha 250):

```ts
const CARD_CREATE_FALLBACK_EXPIRY_MS = 48 * 3600 * 1000; // 48h — ver design doc

if (resCC.status === "approved") {
  return {
    providerPaymentId: String(resCC.id),
    status: "PAID",
    gatewayFeeAmount: extractGatewayFeeAmount(resCC),
  };
}
if (resCC.status === "rejected") {
  return { providerPaymentId: String(resCC.id), status: "CANCELLED" };
}
return {
  providerPaymentId: String(resCC.id),
  status: "PENDING",
  expiresAt: new Date(Date.now() + CARD_CREATE_FALLBACK_EXPIRY_MS),
};
```

Qualquer outro status retornado pela MP na criação (`in_process`, `pending`, `authorized`, etc.)
cai no ramo `PENDING` com fallback de 48h.

## 3. `lib/payment/pagarme.ts` — mesmo princípio, fallback de 1h

Branch de cartão hoje (linhas 135-139):

```ts
const chargeStatus = String(data.status ?? "");
return {
  providerPaymentId: String(data.id),
  status: chargeStatus === "paid" ? "PAID" : "PENDING",
};
```

Novo mapeamento:

```ts
const CARD_CREATE_FALLBACK_EXPIRY_MS = 3600 * 1000; // 1h — ver design doc

const chargeStatus = String(data.status ?? "");
if (chargeStatus === "paid") {
  return { providerPaymentId: String(data.id), status: "PAID" };
}
if (chargeStatus === "failed" || chargeStatus === "canceled") {
  return { providerPaymentId: String(data.id), status: "CANCELLED" };
}
return {
  providerPaymentId: String(data.id),
  status: "PENDING",
  expiresAt: new Date(Date.now() + CARD_CREATE_FALLBACK_EXPIRY_MS),
};
```

`processing`/`pending` (os outros valores documentados pra criação de cobrança) caem no ramo
`PENDING` com fallback de 1h.

## 4. Reaproveitar `applyGatewayStatus` (já existe) em vez de duplicar a lógica de liberação de vaga

**Correção em relação à primeira versão desta spec:** ao invés de extrair uma função nova
(`cancelOrderAndReleaseInventory`), a checagem do código encontrou que **já existe** uma função
genérica pra exatamente essa sequência — `applyGatewayStatus` em `lib/payment/sync-payment-status.ts`
— usada hoje por webhook e reconciliação pra aplicar qualquer transição de status de gateway
(`PAID`/`EXPIRED`/`CANCELLED`/`REFUNDED`/`CHARGEBACK`) a um pagamento: atualiza `Payment`, `Order`,
cancela/confirma cada `Registration`, libera/restaura a vaga no `TicketBatch` conforme o status
anterior, e grava `AuditLog`. Reaproveitá-la evita duplicar essa lógica pela segunda vez no código
(a primeira duplicação, dentro de `cancelExpiredPayment`, já existe e **não** será tocada por esta
tarefa — refatorá-la pra usar `applyGatewayStatus` também seria uma limpeza válida, mas está fora
do escopo deste bug fix).

`applyGatewayStatus` recebe um `source: "webhook" | "reconciliation" | "refund_check"` que decide a
`action` gravada no `AuditLog`. Nenhum dos três descreve "cartão recusado na criação do checkout",
então o tipo ganha um quarto valor:

```ts
// lib/payment/sync-payment-status.ts
export type SyncSource = "webhook" | "reconciliation" | "refund_check" | "checkout";

const AUDIT_ACTION: Record<SyncSource, string> = {
  webhook: "PAYMENT_WEBHOOK",
  reconciliation: "PAYMENT_STATUS_SYNCED_RECONCILIATION",
  refund_check: "PAYMENT_STATUS_SYNCED_REFUND_CHECK",
  checkout: "PAYMENT_CARD_REJECTED",
};
```

Nenhuma outra mudança em `sync-payment-status.ts` — a função em si já cobre a transição
`PENDING → CANCELLED` corretamente (libera a vaga porque `payment.status === "PENDING"` e
`newStatus === "CANCELLED"`; cancela a `Registration` que estiver `PENDING_PAYMENT`; marca o
`Order` como `CANCELLED`).

## 5. `app/api/checkout/route.ts` — tratar `paymentResult.status === "CANCELLED"`

Depois de obter `paymentResult` (linha ~118) e antes do `db.payment.create` atual (linha 137), um
cartão recusado precisa de um caminho diferente do sucesso/pendente normal: criar o `Payment` como
`PENDING` (reflete o que de fato aconteceu — o pagamento existiu como pendente por uma fração de
segundo antes de ser recusado) e imediatamente aplicar a transição pra `CANCELLED` via
`applyGatewayStatus`, dentro da mesma transação — isso grava o pagamento, cancela o pedido e a
inscrição, libera a vaga, e grava o `AuditLog`, tudo com a função já existente e testada. Por fim,
responde com erro — reaproveitando o fluxo de erro que o front **já trata hoje**
(`CheckoutForm.tsx:282-284`: qualquer resposta não-OK vira `setError(body.error)`), sem precisar
mexer no componente React.

`applyGatewayStatus` só precisa de `{ id, status }` pro pedido e `{ id, ticketBatchId, status }`
pras inscrições — não é preciso reconsultar o banco, porque `checkout` (retorno de `createCheckout`,
linha ~53) e `checkoutData.ticketBatchId` (linha 45) já têm exatamente esses valores, recém-criados
pela mesma requisição:

```ts
if (paymentResult.status === "CANCELLED") {
  await db.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        orderId: checkout.orderId,
        provider: providerKey,
        providerPaymentId: paymentResult.providerPaymentId,
        method: paymentMethod as PaymentMethod,
        status: "PENDING",
        amount: checkout.totalAmount,
        idempotencyKey,
      },
    });
    await applyGatewayStatus(
      tx,
      payment,
      { id: checkout.orderId, status: "PENDING" },
      [{ id: checkout.registrationId, ticketBatchId: checkoutData.ticketBatchId, status: "PENDING_PAYMENT" }],
      "CANCELLED",
      "checkout",
    );
  });

  return NextResponse.json(
    { error: "Pagamento recusado pela operadora do cartão. Verifique os dados ou tente outro cartão." },
    { status: 402 },
  );
}
```

O restante da rota (criação normal do `Payment` pra `PAID`/`PENDING`) fica inalterado.

## Testes

- `lib/payment/mercadopago.ts` e `lib/payment/pagarme.ts` **não têm nenhum teste hoje** pro branch
  de criação de pagamento de cartão (só `checkPaymentStatus` é testado, em
  `tests/payment-mercadopago-status.test.ts`). Novos testes cobrindo o mapeamento
  `approved`/`rejected`/outro → `PAID`/`CANCELLED`/`PENDING`+`expiresAt`, seguindo o padrão de mock
  já usado nesse arquivo (`vi.mock("mercadopago", ...)` com `Payment: vi.fn().mockImplementation(()
  => ({ create: createMock }))`).
- `tests/checkout-route.test.ts` ganha testes pro novo branch `CANCELLED`: `getPaymentProvider` já é
  mockado nesse arquivo, então o teste só precisa fazer `createPayment` resolver
  `{ status: "CANCELLED", providerPaymentId: "..." }` e verificar que a resposta é 402 com a
  mensagem de erro, que `payment.create` foi chamado com `status: "PENDING"` (estado transitório
  correto antes de `applyGatewayStatus` assumir), que `order.update`/`registration.update`/
  `ticketBatch.update` foram chamados pra cancelar e liberar a vaga, e que nenhuma confirmação de
  inscrição foi disparada. `applyGatewayStatus` em si já tem cobertura própria em
  `tests/sync-payment-status.test.ts` — não precisa duplicar os casos de transição PENDING→CANCELLED
  ali, só verificar que a rota chama a função com os argumentos certos.
- `lib/payment/sync-payment-status.ts` ganha 1 caso de teste novo (ou verificação de que os
  existentes cobrem): `AUDIT_ACTION["checkout"]` resolve pra `"PAYMENT_CARD_REJECTED"`.

## Fora de escopo

- `lib/payment/reconciliation.ts` e o roteamento de webhook — já corretos pro fluxo de pagamentos
  que já têm status definido; o buraco era só na criação inicial do pagamento de cartão.
- Comportamento de PIX/boleto — já funcionam (sempre recebem `expiresAt`), não muda.
- Novo valor de enum no schema — `PaymentStatus.CANCELLED` e `OrderStatus.CANCELLED` já existem no
  banco, nenhuma migração necessária.
- **Verificar se o crontab da VPS ainda está rodando `/api/cron/expire-payments` a cada 6h** — não
  é possível confirmar isso a partir deste ambiente (sandbox sem acesso SSH à VPS); fica como
  verificação manual separada pro usuário, independente deste bug de código.
