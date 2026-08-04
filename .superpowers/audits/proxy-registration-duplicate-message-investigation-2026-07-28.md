# Investigação: "mensagem duplicada" na inscrição por procuração

Data: 2026-07-28
Escopo: investigação de causa raiz apenas. Nenhum código foi alterado.

## Sintoma reportado

Ao se inscrever "por procuração" (uma pessoa se inscreve e convida outra para preencher os
próprios dados de atleta), algum tipo de mensagem é enviada/exibida duas vezes. O usuário não
especificou o canal (e-mail de convite? confirmação de pedido? WhatsApp? toast de UI?).

## Métodos de disparo de mensagem no fluxo de procuração (mapeados)

Existem **dois** disparos de mensagem distintos e independentes ligados a uma inscrição por
procuração:

1. **Convite de acesso** (`sendProxyRegistrationInvite` → `sendProxyRegistrationInviteEmail`,
   `lib/proxy-athlete.ts:23`, chamado uma única vez em `app/api/checkout/route.ts:129-135`,
   síncrono ao POST de checkout). Este disparo **não** apresentou mecanismo de duplicação — ver
   seção "Descartado: convite de acesso" abaixo.

2. **Confirmação de inscrição** (`notifyOrderConfirmed`, `lib/notifications.ts:47-129`). Esta é a
   função que, quando a inscrição é por procuração (`order.buyerUserId !== registration.athleteUserId`),
   manda uma mensagem para o comprador ("Você inscreveu Fulano...") **e** uma mensagem separada
   para o atleta convidado ("Fulano criou uma inscrição pra você..."), por e-mail e por WhatsApp —
   4 envios possíveis por chamada. **Esta função é chamada por três rotas/jobs independentes para
   o mesmo pedido, sem nenhuma trava de idempotência real**, e é aqui que está a causa raiz mais
   provável.

## Causa raiz (confiança: alta)

### O mecanismo

`notifyOrderConfirmed(orderId)` é invocada, sem nenhum lock/idempotência compartilhado, a partir de:

- `app/api/checkout/route.ts:224` — quando o pagamento já nasce `PAID` (ex.: cartão aprovado na
  hora).
- `app/api/webhooks/payment/route.ts:179` — quando o gateway (Mercado Pago/Pagar.me) notifica
  aprovação via webhook.
- `app/api/orders/[id]/status/route.ts:46` — quando o **poller client-side** (ver abaixo) detecta
  que o pagamento foi aprovado.
- `lib/payment/reconciliation.ts:86` e `:217` — job de conciliação (cron).
- Rotas de reenvio manual/organizador (`resend-confirmation-email`, `manual-confirm`) — estas são
  intencionais, não fazem parte do bug.

Para pagamento via PIX (o método mais comum em inscrição por procuração, já que o comprador não
tem cartão do atleta), o checkout redireciona o comprador para
`app/dashboard/inscricoes/[id]/page.tsx`, que — enquanto `registration.status === "PENDING_PAYMENT"`
— monta `<PaymentStatusPoller orderId=... />` (`components/dashboard/PaymentStatusPoller.tsx:10-26`).
Esse componente roda um `setInterval` de **10 segundos** chamando
`GET /api/orders/[id]/status` até o status virar `PAID`.

`app/api/orders/[id]/status/route.ts:14-48` faz, dentro de uma única requisição GET:

```
14  const order = await db.order.findFirst({ ...select payments[0].status... });  // leitura 1
...
32  if (order.status === "PENDING") {
36    if (providerSetting === "mercadopago") {
37      const mpStatus = await checkMPPaymentStatus(payment.providerPaymentId);   // chamada de rede externa (lenta)
38      if (mpStatus === "PAID" && payment.status !== "PAID") {                    // decisão baseada na leitura 1, JÁ ANTIGA
39        await db.$transaction([ ...update payment/order/registration para PAID... ]);
46        void notifyOrderConfirmed(order.id);                                    // disparo incondicional
```

O problema: a checagem `payment.status !== "PAID"` na linha 38 usa o valor lido **antes** da
chamada de rede (linha 37) à API do Mercado Pago, que sozinha já introduz uma janela de
centenas de milissegundos. Se, durante essa janela, o **webhook** (`app/api/webhooks/payment/route.ts`)
processar a aprovação do mesmo pagamento — o que é o caso comum: o gateway manda o webhook quase
em tempo real assim que o PIX é liquidado — o webhook já terá:

- marcado `payment.status = PAID` e `order.status = PAID` via `applyGatewayStatus`
  (`lib/payment/sync-payment-status.ts:29-118`);
- chamado `notifyOrderConfirmed(orderId)` uma primeira vez (`app/api/webhooks/payment/route.ts:179`).

O poller, que já tinha lido `payment.status = PENDING` **antes** de o webhook rodar, não volta a
checar o banco depois da chamada de rede — ele confia cegamente na variável local `payment` obtida
no início da requisição (clássico TOCTOU: time-of-check/time-of-use). Ele então executa sua própria
transação (linha 39-45, que **não** verifica se o status já mudou, apenas escreve) e chama
`notifyOrderConfirmed(order.id)` **uma segunda vez** para o mesmo pedido.

Resultado concreto: o comprador recebe 2x "Você inscreveu Fulano..." (e-mail e/ou WhatsApp) e o
atleta convidado recebe 2x "Fulano criou uma inscrição pra você...". Numa inscrição normal
(não-procuração) o mesmo bug existiria, mas afeta só uma pessoa recebendo 2 confirmações — menos
perceptível/reportável. Na inscrição por procuração, **duas pessoas diferentes** recebem mensagens
duplicadas ao mesmo tempo, o que casa exatamente com o sintoma relatado.

### Reprodução concreta

1. Evento com `allowProxyRegistration = true`. Comprador faz checkout via PIX para outro atleta,
   informando e-mail real do atleta (`proxyAthlete.email`).
2. Comprador é redirecionado para `/dashboard/inscricoes/{registrationId}`, que monta
   `PaymentStatusPoller` (polling a cada 10s).
3. Comprador paga o PIX no app do banco. O Mercado Pago dispara o webhook de aprovação quase
   imediatamente.
4. Se o webhook chegar e for processado **enquanto uma requisição de polling já em voo** (ou a
   próxima, dentro da mesma janela de ~10s) já tiver lido `payment.status = PENDING` e estiver
   aguardando a resposta de `checkMPPaymentStatus` — cenário realista, já que essa chamada de rede
   e o próprio processamento do webhook competem pelo mesmo intervalo de tempo — as duas rotas
   processam a aprovação **de forma independente** e cada uma chama `notifyOrderConfirmed`.
5. Buyer e atleta convidado recebem a confirmação (e-mail/WhatsApp) duas vezes.

### Evidência de que não há nenhuma trava real

- `applyGatewayStatus` (`lib/payment/sync-payment-status.ts:38`) tem um guard
  `if (newStatus === payment.status) return { changed: false };`, mas compara contra o objeto
  `payment` que a rota chamadora buscou **antes** de entrar na transação — não há
  `SELECT ... FOR UPDATE` nem releitura dentro da própria transação. Ou seja, o guard protege
  contra reprocessar o **mesmo request** duas vezes, mas não contra duas requisições concorrentes
  (webhook vs. poller) que cada uma leu seu próprio snapshot "PENDING" antes de a outra escrever.
- O poller (`app/api/orders/[id]/status/route.ts`) nem chama `applyGatewayStatus` — ele reimplementa
  a transição manualmente (linhas 39-45) e não confere `result.changed` porque nunca usou essa
  função para começo de conversa.
- `lib/payment/reconciliation.ts:77-86` tem o mesmo padrão: lê `payment.status` numa query
  (`checkPendingMismatches`, filtrando `status: "PENDING"`), faz uma chamada de rede
  (`provider.checkPaymentStatus`), e **chama `notifyOrderConfirmed` incondicionalmente após
  `applyGatewayStatus`, sem checar o `{ changed }` retornado** — se o webhook já tiver aplicado a
  mudança durante a janela entre a query do cron e o processamento item-a-item do loop, este é um
  terceiro caminho capaz de gerar o mesmo duplo envio (janela menor/mais rara que a do poller, já
  que o cron roda em intervalos de minutos, mas existe).
- `Order.confirmationEmailSentAt` (setado em `lib/notifications.ts:88` depois de mandar o e-mail do
  comprador) é **gravado mas nunca lido/checado** em nenhum dos três pontos de disparo — existe o
  campo que daria pra usar como trava de idempotência, mas ele não é consultado antes de decidir
  enviar.

### Descartado: convite de acesso (`sendProxyRegistrationInvite`)

- Único ponto de disparo: `app/api/checkout/route.ts:129-135`, dentro do mesmo POST que chama
  `createCheckout`.
- `createCheckout` (`lib/checkout.ts:92-127`) já é auto-idempotente para o cenário de resubmissão:
  busca o atleta por CPF (`tx.athleteProfile.findFirst({ where: { cpf: proxyCpf } })`) *dentro da
  mesma transação* do checkout; se o perfil já existir (porque uma tentativa anterior de checkout
  já criou o usuário-atleta), reaproveita o `athleteUserId` e **não** popula
  `proxyAthleteInvite`, então o e-mail de convite não volta a ser disparado numa segunda submissão
  do formulário (ex.: usuário reenviando o checkout após cartão recusado).
- Botão de submit do `CheckoutForm.tsx` (`disabled={isSubmitting}`, linha 678) previne duplo clique
  no nível de UI; `isSubmitting` do react-hook-form é setado de forma síncrona antes do handler
  assíncrono rodar.
- Único cenário residual não descartado por análise estática: duas requisições **verdadeiramente
  concorrentes** de checkout (ex.: duplo clique bem cronometrado antes do React re-renderizar o
  botão, ou duas abas), que poderiam ambas passar pelo `findFirst` de CPF antes de qualquer commit.
  Isso exigiria teste dinâmico (não foi possível confirmar nem descartar via leitura estática) —
  ver seção "O que falta" abaixo. Mas isso é um caminho separado do problema principal encontrado
  acima e não parece ser o que o usuário está vendo, dado que o sintoma de e-mail duplicado bate
  muito melhor com `notifyOrderConfirmed`.

## Lacunas de teste identificadas (per instrução do investigador)

- `tests/checkout-route.test.ts:304` — `expect(sendProxyRegistrationInvite).toHaveBeenCalledWith(...)`
  sem `toHaveBeenCalledTimes(1)` — não pegaria uma regressão de duplo disparo do convite.
- `tests/notifications.test.ts` testa `notifyOrderConfirmed` **isoladamente** (chamando a função uma
  vez por teste) e até verifica corretamente `toHaveBeenCalledTimes(2)` para o fan-out
  comprador+atleta dentro de uma única chamada (linhas 238-239) — mas **não existe nenhum teste de
  integração que simule duas rotas diferentes (webhook + poller, ou webhook + reconciliação)
  chamando `notifyOrderConfirmed` para o mesmo `orderId`**. Essa é exatamente a lacuna que
  escondeu este bug: cada rota tem teste unitário próprio mockando `notifyOrderConfirmed`
  (`vi.mock("@/lib/notifications", ...)`), então nenhum teste observa o comportamento cruzado
  entre rotas para o mesmo pedido.

## O que fixaria isso (não implementado — só para orientar a correção)

Tornar `notifyOrderConfirmed` idempotente por pedido usando uma escrita condicional atômica sobre
`Order.confirmationEmailSentAt` (ex.: `UPDATE Order SET confirmationEmailSentAt = now() WHERE id = ?
AND confirmationEmailSentAt IS NULL`, só prosseguindo com os envios se a atualização afetar 1 linha)
— e/ou fazer as três origens (webhook, poller de `/api/orders/[id]/status`, reconciliação) pararem de
decidir com base num `payment.status` pré-buscado fora da transação, usando em vez disso somente o
`{ changed }` retornado por `applyGatewayStatus` (chamado sempre dentro da própria transação) como
único gatilho para notificar.

## O que falta para confirmar 100% em produção (caso se queira ir além da análise estática)

- Logs de produção do webhook e da rota `/api/orders/[id]/status` para o mesmo `orderId` num
  intervalo de poucos segundos, mostrando duas chamadas a `notifyOrderConfirmed` (ex.: grep por
  `[notifyOrderConfirmed]` e pelos logs de auditoria `PAYMENT_WEBHOOK` vs. o timestamp da
  requisição GET de status).
- Confirmar no provedor (Mercado Pago) se o evento reportado usou PIX (torna o poller de 10s
  relevante) e se o horário de aprovação do webhook coincide com uma janela de poll ativa.
- Se possível, reproduzir em ambiente de teste com um mock de gateway que atrase a resposta do
  webhook por ~1-2s e dispare o poller nesse meio tempo, para confirmar o duplo envio de ponta a
  ponta (não só por leitura estática do código).
