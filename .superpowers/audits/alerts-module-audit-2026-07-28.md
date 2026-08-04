# Auditoria do módulo de alertas/notificações — 2026-07-28

Escopo: `lib/alerts/*`, `lib/notifications.ts`, `lib/email.ts`, `lib/whatsapp.ts`, todos os call sites e testes.
Somente leitura — nenhum arquivo foi modificado. Todos os caminhos abaixo são relativos à raiz
`C:\Users\dougl\workspace2\sistema_inscricoes_corridas_codex`.

> Nota de método: a auditoria foi feita sobre o **checkout principal** (que contém
> `lib/alerts/advertiser-request-pending.ts`, de 28/07 07:19). O worktree do agente estava no commit
> `b536043`, que ainda não tem esse arquivo nem a versão nova de `alert-settings.ts`.

---

## 0. Arquitetura em uma frase

São **dois sistemas separados que não se chamam**:

- `lib/alerts/*` — alertas **operacionais** (estoque, carrinho, erro de pagamento, conciliação,
  cancelamento, resumo diário, solicitação de anunciante). Todos com tabela de dedupe `AlertLog`,
  toggles em `platform_settings` e padrão "fire-and-forget".
- `lib/notifications.ts` — camada **transacional** (`notifyOrderConfirmed`), confirmação de
  inscrição. Não importa nada de `lib/alerts/`, não usa `AlertLog`, não usa `alert-settings.ts`, e
  tem uma regra própria de canal (só manda WhatsApp se a instância Evolution estiver com
  `getConnectionState() === "open"` — `lib/notifications.ts:9-17`), regra que **nenhum** alerta de
  `lib/alerts/` aplica.

Os dois convergem só no nível mais baixo: `sendMail()` (`lib/email.ts:16`) e `sendWhatsAppMessage()`
(`lib/whatsapp.ts:26`), ambos lançam exceção em falha e ambos gravam `MessageLog`
(`lib/email.ts:43,54`; `lib/whatsapp.ts:45,55`). Isso é importante: **o `throw` é real**, então a
lógica de `unclaimAlert` em falha de fato executa.

---

## 1. Inventário

| # | Alerta (`alertType`) | Arquivo | Gatilho / call site | Destinatário | Canais | Dedupe | Toggle admin | Wired? | Teste |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `LOW_STOCK` | `lib/alerts/low-stock.ts` | `app/api/checkout/route.ts:90` (`void`, pós-checkout) | Organizador do evento | E-mail + WhatsApp | ✅ `claimAlert("TicketBatch", batchId)` (`low-stock.ts:42,60`) | ✅ `app/admin/alertas/page.tsx:35-46` | ✅ | `tests/alert-low-stock.test.ts` (10 casos) |
| 2 | `ABANDONED_CART` | `lib/alerts/abandoned-cart.ts` | Cron `app/api/cron/abandoned-carts/route.ts:12`; reenvio manual `app/api/admin/abandoned-carts/notify/route.ts:41` e `app/api/organizer/abandoned-carts/notify/route.ts:54` (`bypassDedupe: true`) | Comprador (`buyer`) | E-mail + WhatsApp | ✅ `claimAlert("Order", orderId)` + `recordAlert` no bypass (`abandoned-cart.ts:38,46,56,62`) | ✅ `page.tsx:48-59` | ✅ | `tests/alert-abandoned-cart.test.ts` (17 casos) |
| 3 | `PAYMENT_ERROR` (a) `notifyPaymentError` | `lib/alerts/payment-error.ts:61` | `app/api/webhooks/payment/route.ts:184`; `app/api/orders/[id]/status/route.ts:54`; `lib/payment/expire-payments.ts:47`; reenvio manual admin/organizer (`bypassDedupe`) | Comprador | E-mail + WhatsApp | ✅ `claimAlert("Payment", paymentId)` (`payment-error.ts:28,46`) | ✅ `page.tsx:61-68` | ✅ | `tests/alert-payment-error.test.ts` |
| 3b | `PAYMENT_ERROR` (b) `notifyOrderCancelledWithoutPayment` | `lib/alerts/payment-error.ts:100` | **Só** reenvio manual: `app/api/admin/registrations/[id]/resend-payment-notification/route.ts:47` e o equivalente de organizador `:48` | Comprador | E-mail + WhatsApp | ✅ mesmo `alertType`, `entityId = orderId` | ⚠️ reusa o toggle de `PAYMENT_ERROR`, sem card próprio | ✅ (só manual) | `tests/alert-payment-error.test.ts:155+` |
| 4 | *(sem alertType)* Conciliação | `lib/alerts/reconciliation.ts:8` | Cron `app/api/cron/reconciliation/route.ts:15`; `app/api/organizer/reconciliation/route.ts:23` | **Todos** os `role: "ADMIN"` | E-mail + WhatsApp | ❌ **nenhum** — não importa `dedupe.ts` | ✅ `page.tsx:70-81` | ✅ | `tests/alert-reconciliation.test.ts` (5 casos) |
| 5 | `CANCELLATION_REQUESTED` | `lib/alerts/cancellation-requested.ts` | `app/api/registrations/[id]/cancel/route.ts:80` (`void`) | Todos os admins **+** organizador do evento | E-mail + WhatsApp | ✅ por destinatário: `claimAlert("Registration", "${regId}:${email\|phone}")` (`:43,63`) | ✅ `page.tsx:83-90` | ✅ | `tests/alert-cancellation-requested.test.ts` (5 casos) |
| 6 | `DAILY_SUMMARY` | `lib/alerts/daily-summary.ts` | Cron `app/api/cron/daily-summary/route.ts:18-19` | Admins ativos, organizadores ativos + `DailySummaryRecipient` extras | E-mail + WhatsApp | ✅ por dia+usuário: `"${YYYY-MM-DD}:${userId}"` e `"${dia}:recipient:${id}"` (`daily-summary.ts:87,122,181,230`) | ❌ **não** em `/admin/alertas` — usa colunas por usuário `dailySummaryEmailEnabled`/`dailySummaryWhatsappEnabled` em `app/admin/perfil/page.tsx` e `app/organizador/perfil/page.tsx` | ✅ | `tests/alert-daily-summary.test.ts` (22 casos) |
| 7 | `ADVERTISER_REQUEST_PENDING` | `lib/alerts/advertiser-request-pending.ts` | `app/api/webhooks/payment/route.ts:141` (`await`, quando `result.wentToPendingApproval`) | Todos os admins | E-mail + WhatsApp | ✅ por destinatário (`:36,55`) | ❌ **inexistente** — `alert_advertiser_request_*_enabled` não aparece em nenhuma UI | ⚠️ wired mas **morto** (ver §3) | `tests/lib-advertiser-request-pending.test.ts` (4 casos) |

Auxiliares (não são alertas): `lib/alerts/dedupe.ts`, `lib/alerts/alert-settings.ts`,
`lib/alerts/daily-summary-metrics.ts` (agregações), `lib/alerts/abandoned-cart-query.ts` (query da
tela `/admin/carrinhos-abandonados`, sem envio).

---

## 2. Corretude do dedupe

`lib/alerts/dedupe.ts` implementa **claim atômico** apoiado no unique do Prisma
(`prisma/schema.prisma:587` → `@@unique([alertType, entityId, channel])`):

- `claimAlert` (`dedupe.ts:12-27`) cria a linha; `P2002` → `false`. Isso fecha corretamente a corrida
  entre dois crons sobrepostos. Bom design.
- `unclaimAlert` (`dedupe.ts:30-34`) apaga por `(alertType, entityId, channel)` — casa exatamente com
  o unique (o `entityType` de propósito fica de fora). Correto.
- `recordAlert` (`dedupe.ts:41-52`) upsert para o caminho de reenvio manual. Correto.

**Escopo das chaves, alerta por alerta:**

| Alerta | Chave | Veredito |
|---|---|---|
| `LOW_STOCK` | `TicketBatch:batchId` | Permanente por lote — é o design declarado ("nunca repetir por lote+canal"). Efeito colateral aceito: se o limiar for baixado depois, ou se o lote tiver a capacidade aumentada, o alerta nunca reaparece. |
| `ABANDONED_CART` | `Order:orderId` | Correto — 1 lembrete por pedido por canal, com bypass explícito no reenvio manual. |
| `PAYMENT_ERROR` | `Payment:paymentId` **ou** `Order:orderId` | ⚠️ **Sobreposição**: as duas funções compartilham o `alertType` mas usam entidades diferentes. Como `paymentId ≠ orderId`, o mesmo comprador pode receber **duas vezes** a mesma mensagem ("sua inscrição foi cancelada porque não identificamos o pagamento") — uma automática via `notifyPaymentError(payment.id)` e outra via reenvio manual `notifyOrderCancelledWithoutPayment(orderId)`. Baixa severidade porque o segundo caminho é sempre uma ação humana deliberada. |
| Conciliação | — | ❌ **sem dedupe nenhum** (ver §7, risco 2). |
| `CANCELLATION_REQUESTED` | `Registration:"${regId}:${email\|phone}"` | Escopo por destinatário, correto — inclusive resolve de graça o caso do admin que também é o organizador do evento (aparece 2x em `recipients`, `cancellation-requested.ts:36`, e o 2º claim retorna `false`). **Porém a chave é permanente**: ver §7, risco 3. |
| `DAILY_SUMMARY` | `"${dia}:${userId}"` | Correto — escopado por dia e por destinatário, e destinatários extras têm namespace próprio (`:recipient:`), então não colidem com o usuário principal. |
| `ADVERTISER_REQUEST_PENDING` | `AdPurchase:"${id}:${email\|phone}"` | Correto e adequado ao risco de reentrega de webhook. |

**Risco de disparo duplicado onde falta dedupe:** só a conciliação. O webhook de pagamento
(`app/api/webhooks/payment/route.ts`) é reentregue rotineiramente pelo Mercado Pago, e tanto
`notifyPaymentError` quanto `notifyAdvertiserRequestPending` estão protegidos por claim. A
conciliação, não — e ela roda em loop por cron.

**Um detalhe positivo já tratado:** `payment-error.ts:27-28` só faz o claim **depois** de verificar
`isSmtpReady(cfg)`, evitando "queimar" o claim quando o SMTP nem está configurado (há teste
explícito disso em `tests/alert-payment-error.test.ts:138`). `low-stock.ts:42` e
`abandoned-cart.ts:38` fazem o mesmo. `cancellation-requested.ts:41` e
`advertiser-request-pending.ts:34` também. Consistente e correto em todos.

---

## 3. Cobertura de configurações (settings)

`app/admin/alertas/page.tsx` expõe **5** cards, todos via `components/admin/AlertConfigCard.tsx` →
`POST /api/admin/settings`:

| Chave de setting | Lida em `alert-settings.ts` | Exposta na UI |
|---|---|---|
| `alert_low_stock_{email,whatsapp}_enabled`, `_threshold_percent` | `:20-31` | ✅ `page.tsx:38-40` |
| `alert_abandoned_cart_{email,whatsapp}_enabled`, `_minutes` | `:33-44` | ✅ `page.tsx:51-53` |
| `alert_payment_error_{email,whatsapp}_enabled` | `:46-55` | ✅ `page.tsx:64-65` |
| `alert_reconciliation_{email,whatsapp}_enabled`, `_minutes_threshold` | `:63-74` | ✅ `page.tsx:73-75` |
| `alert_cancellation_{email,whatsapp}_enabled` | `:81-90` | ✅ `page.tsx:86-87` |
| **`alert_advertiser_request_{email,whatsapp}_enabled`** | **`:97-106`** | ❌ **em lugar nenhum** |

Confirmado por busca: as chaves `alert_advertiser_request_*` só aparecem em
`lib/alerts/alert-settings.ts`. Como `getSetting` retorna `null` quando a linha não existe
(`lib/settings.ts:24-33`) e o parse é `=== "true"` (`alert-settings.ts:103-104`), o resultado é
`{ emailEnabled: false, whatsappEnabled: false }` → o guard em
`advertiser-request-pending.ts:18` faz `return` imediato. **O alerta nº 7 nunca envia nada em
produção** e não há nenhuma tela onde ligá-lo (nem `INSERT` de seed: nenhuma migration/seed grava
essas chaves).

Gaps secundários de settings:

- **`DAILY_SUMMARY` não tem card em `/admin/alertas`** — é o único alerta cujo on/off é por usuário
  (`user.dailySummaryEmailEnabled`, em `/admin/perfil` e `/organizador/perfil`). Não é um bug, mas é
  um segundo padrão de configuração convivendo com o primeiro, e um admin que procure "resumo
  diário" na tela de Alertas não encontra.
- **`notifyOrderCancelledWithoutPayment` não tem card próprio** — reusa o toggle `PAYMENT_ERROR`.
  Decisão deliberada (documentada em `TODO-RETOMAR-DESENVOLVIMENTO.md:161`), sem gap real.
- **`lib/notifications.ts` (confirmação de inscrição) não tem toggle nenhum** — é transacional e sempre
  envia. Correto por natureza, mas vale saber que ele não respeita nada de `/admin/alertas`.
- `tests/alert-settings.test.ts` só cobre 3 dos 6 getters — faltam
  `getReconciliationAlertSettings`, `getCancellationAlertSettings` e
  `getAdvertiserRequestAlertSettings`. Justamente o getter novo, o que está quebrado na prática, é o
  que não tem teste de settings (o teste do módulo, `tests/lib-advertiser-request-pending.test.ts`,
  mocka `alert-settings` inteiro, então não pega o gap).

---

## 4. Isolamento de falhas

Regra do módulo: **toda** função de alerta em `lib/alerts/` tem um `try/catch` externo que só loga
(`low-stock.ts:72`, `reconciliation.ts:48`, `cancellation-requested.ts:76`, `payment-error.ts:95,125`,
`daily-summary.ts:153,266`, `advertiser-request-pending.ts:68`). Ou seja: elas nunca lançam para
quem chama. Exceção deliberada: `sendAbandonedCartAlert` (`abandoned-cart.ts:17`) **lança**, e os 3
call sites dela envolvem em `try/catch` por pedido (`abandoned-cart.ts:91-96`,
`app/api/admin/abandoned-carts/notify/route.ts:39-56`, `app/api/organizer/.../notify/route.ts:52+`).

| Call site | Forma | Protegido? |
|---|---|---|
| `app/api/checkout/route.ts:90` | `void checkLowStockAlert(...)` | ✅ (função não lança) |
| `app/api/webhooks/payment/route.ts:184` | `void notifyPaymentError(...)` | ✅ |
| `app/api/webhooks/payment/route.ts:141` | `await notifyAdvertiserRequestPending(...)` | ✅ quanto a exceção, ⚠️ quanto a padrão — é o único alerta **awaited** no webhook; bloqueia a resposta ao gateway pelo tempo de N e-mails + N WhatsApps sequenciais (loop por admin, `advertiser-request-pending.ts:35,53`). Os vizinhos usam `void`. |
| **`app/api/webhooks/payment/route.ts:133`** | **`await sendAdPurchaseConfirmationEmail(...)` sem `try/catch`** | ❌ **NÃO PROTEGIDO** — é uma chamada direta a `lib/email.ts:124`, que chama `sendMail`, que **lança** se o SMTP falhar (`lib/email.ts:26,51`). Uma falha de SMTP aqui derruba o handler → 500 para o Mercado Pago → reentrega. Mitigação parcial: `confirmAdPurchasePayment` é idempotente (`lib/ads/ad-purchase-confirmation.ts:39,48`), então a reentrega não duplica dados — mas o e-mail simplesmente se perde e o webhook fica em loop de retry. É a **única** chamada de envio não isolada em todo o fluxo de webhook. |
| `app/api/orders/[id]/status/route.ts:54` | `void notifyPaymentError(...)` | ✅ |
| `app/api/registrations/[id]/cancel/route.ts:80` | `void notifyCancellationRequested(id)` — fora da transação, depois do commit | ✅ (ordem correta) |
| `lib/payment/expire-payments.ts:47` | `void notifyPaymentError(paymentId)` — após o commit | ✅ |
| `app/api/cron/reconciliation/route.ts:15` / `app/api/organizer/reconciliation/route.ts:23` | `void notifyReconciliationMismatches(...)` | ✅ |
| `app/api/cron/daily-summary/route.ts:18-19` | `await Promise.all([...])`, funções não lançam e retornam contadores | ✅ |
| `app/api/cron/abandoned-carts/route.ts:12` | `await checkAbandonedCarts()` — laço interno com try/catch por pedido | ✅ |
| Rotas de reenvio manual (admin/organizer) | `await notifyPaymentError(..., { bypassDedupe: true })` | ✅ (não lançam) |

Dentro dos módulos, o isolamento **por destinatário** também é bom: `reconciliation.ts:24-28,43-45`,
`cancellation-requested.ts:52-55,70-73`, `advertiser-request-pending.ts:44-47,61-65` e todo o
`daily-summary.ts` continuam para o próximo destinatário quando um falha. `low-stock.ts:52-55` e
`payment-error.ts:37-40` fazem `unclaim` + `throw` (destinatário único; o `throw` é capturado pelo
catch externo) — aceitável, mas com uma consequência: em `low-stock.ts`, uma falha no e-mail
(`:54 throw err`) **impede a tentativa de WhatsApp**, porque o `throw` pula direto para o catch de
`:72`. `daily-summary.ts` trata esse caso explicitamente e tem teste ("ainda tenta o whatsapp mesmo
quando o e-mail falha", `tests/alert-daily-summary.test.ts:172`). `low-stock.ts` e `payment-error.ts`
não. Inconsistência real, severidade baixa/média.

---

## 5. Consistência de padrões

O padrão canônico (o mais robusto, exemplificado por `cancellation-requested.ts` e replicado fielmente
em `advertiser-request-pending.ts`) é:

1. `getXAlertSettings()` → early return se os dois canais estão desligados;
2. carrega a entidade, `return` silencioso se sumiu;
3. **por canal**: checa `isSmtpReady` antes do claim;
4. **por destinatário**: `claimAlert` → envia → em falha `unclaimAlert` + `console.error` + `continue`;
5. `try/catch` externo que só loga.

Desvios encontrados:

| Arquivo | Desvio | Gravidade |
|---|---|---|
| `reconciliation.ts` | Não usa `dedupe.ts` **de forma alguma**. É o único. Também não usa `claimAlert`/`unclaimAlert` nem tem `alertType`. | **Alta** |
| `low-stock.ts:54,68` / `payment-error.ts:39,55` | `throw` depois do `unclaim` em vez de `continue` — aborta os canais restantes. | Média |
| `daily-summary.ts` | Não usa `alert-settings.ts`; usa flags por usuário no banco. Único a fazer isso. Também é o único que retorna contadores `{sent, failed}`. | Média (é um alerta de natureza diferente, mas o desalinhamento com `/admin/alertas` é real) |
| `payment-error.ts:18-59` | É o **único** que fatorou o envio num helper compartilhado (`sendCancellationInviteNotification`) reusado por duas funções públicas. Tecnicamente o melhor pedaço do módulo — e ninguém mais o imita. Os outros 6 arquivos repetem o mesmo bloco "for admin → claim → send → unclaim" copiado à mão. | Baixa (dívida, não bug) |
| `advertiser-request-pending.ts` vs `cancellation-requested.ts` | Usam `@/lib/alerts/...`; `low-stock`, `abandoned-cart`, `payment-error`, `reconciliation` usam `./alert-settings`. Puramente cosmético. | Nenhuma |
| `app/api/webhooks/payment/route.ts:141` | `await` onde os vizinhos usam `void`. | Baixa |
| `lib/notifications.ts:26` | Único lugar do código que checa `getConnectionState() === "open"` antes de mandar WhatsApp. Nenhum alerta de `lib/alerts/` faz isso — eles chamam `sendWhatsAppMessage` direto e engolem o erro. Resultado: com a instância Evolution desconectada, cada alerta gera uma linha `MessageLog` `FAILED` (`lib/whatsapp.ts:52-62`) e, nos caminhos com `throw`, pode consumir/liberar claims sem necessidade. | Média |

---

## 6. Código morto e lacunas

- **Nada de "setting sem sender"**: os 6 getters de `alert-settings.ts` têm sender correspondente.
- **Um "sender sem setting exposto"**: `advertiser-request-pending.ts` (§3). É o inverso exato do
  padrão de gap procurado, e o único caso.
- **Nenhum módulo de `lib/alerts/` está sem call site.** Todos os 7 tipos estão ligados a pelo menos
  uma rota real.
- **`notifyOrderCancelledWithoutPayment` só tem gatilho manual** — não existe nenhum caminho
  automático que detecte "pedido cancelado sem `Payment` associado" e notifique. Se um pedido
  morrer sem registro de pagamento, ninguém é avisado até que um humano clique em "reenviar" na
  tela de inscrições. Lacuna de cobertura, não código morto.
- **`checkLowStockAlert` só é chamado no checkout** (`app/api/checkout/route.ts:90`), e `createCheckout`
  só tem esse call site (`lib/checkout.ts:42`). Mas `soldCount` é alterado em mais 6 lugares
  (`lib/payment/sync-payment-status.ts:94,102`, `lib/payment/expire-payments.ts:31,95`,
  `lib/payment/refund-service.ts:78`, `lib/registrations/cancellation-decision-service.ts:63`,
  `app/api/registrations/[id]/cancel/route.ts:98`). O único **incremento** fora do checkout é
  `sync-payment-status.ts:102` (aprovação tardia devolvendo a vaga) — ali um lote pode cruzar o
  limiar sem nunca disparar o alerta. Impacto real baixo (caso de borda), mas é uma afirmação
  incorreta comum sobre o módulo: "low-stock roda sempre que o estoque muda" — não roda.
- **Assimetria admin × organizador na conciliação**: `app/api/organizer/reconciliation/route.ts:23`
  notifica todos os admins; `app/api/admin/reconciliation/route.ts` (arquivo inteiro, 11 linhas)
  **não notifica ninguém**. Um admin rodando a conciliação manualmente não gera alerta; um
  organizador rodando gera — para todos os admins.
- **Nenhum alerta para estornos/reembolsos pendentes.** `lib/payment/manual-refund-resolution.ts` e
  `lib/registrations/pending-queue.ts` existem, e a tela `/admin/reembolsos-pendentes` existe, mas
  nenhum arquivo em `lib/alerts/` referencia refund a não ser como **métrica** no resumo diário
  (`daily-summary-metrics.ts:48`, `cancelledOrRefundedCount`). Ou seja: um estorno manual pendente
  só é "sinalizado" no e-mail de resumo do dia seguinte, e apenas como um número agregado, sem
  link nem identificação. Se o resumo diário estiver desligado no perfil do admin (padrão do
  schema), **ninguém é notificado de estorno pendente por nenhum canal**.
- **Nenhum crontab no repositório.** A intenção só está documentada em texto de UI
  (`app/admin/alertas/page.tsx:50` e `:72` — "Requer uma tarefa agendada (crontab) chamando
  /api/cron/..."). Rotas destinadas a cron, todas com guard `x-cron-secret` idêntico:
  `/api/cron/abandoned-carts`, `/api/cron/reconciliation`, `/api/cron/daily-summary`,
  `/api/cron/expire-payments`, `/api/cron/ad-metrics-sync`, `/api/cron/expire-private-ads`.
  Não é possível verificar daqui se estão de fato agendadas.

**Cobertura de testes** — o módulo é bem testado no geral: 9 arquivos `tests/alert-*.test.ts` mais
`lib-advertiser-request-pending`, `webhook-payment-alerts`, `order-status-alerts`,
`cron-{abandoned-carts,reconciliation,daily-summary}-route`. Furos concretos:
`tests/alert-settings.test.ts` cobre 3 de 6 getters (§3); `tests/alert-reconciliation.test.ts` tem só
5 casos e **nenhum** sobre repetição entre execuções (coerente — não há o que testar, já que não há
dedupe); não existe teste do call site `app/api/webhooks/payment/route.ts:141`
(`tests/payment-webhook-ad-purchase.test.ts:35` testa só que `confirmAdPurchasePayment` é chamado,
não o disparo do alerta).

---

## 7. Ranking de risco — o que consertar primeiro

### 1. `ADVERTISER_REQUEST_PENDING` está permanentemente desligado — solicitação de anunciante paga nunca avisa ninguém
`lib/alerts/alert-settings.ts:97-106` lê `alert_advertiser_request_{email,whatsapp}_enabled`, chaves
que não existem em nenhuma UI, seed ou migration; `advertiser-request-pending.ts:18` retorna cedo.
Efeito: a solicitação **já paga** entra em `PENDING_APPROVAL` e fica esperando alguém abrir
`/admin/anunciantes/solicitacoes` por acaso. É exatamente o cenário "ninguém é notificado", e com
dinheiro já cobrado. Correção: um sexto `AlertConfigCard` em `app/admin/alertas/page.tsx`
(3 linhas de import + ~8 de JSX, mesmo formato do card de cancelamento).

### 2. Conciliação não tem dedupe e re-alerta todos os admins a cada execução do cron
`lib/alerts/reconciliation.ts` é o único módulo que não importa `dedupe.ts`. Pior: em
`lib/payment/reconciliation.ts:95-104`, uma divergência de pagamento `PENDING` cujo status no gateway
**não** é `PAID` é registrada com `corrected: false` e **nada é alterado no banco** — o pagamento
continua `PENDING` e volta a aparecer na consulta de `checkPendingMismatches` na execução seguinte,
indefinidamente. Com o cron de conciliação ativo, cada admin recebe e-mail **e** WhatsApp a cada
ciclo, para sempre, até alguém resolver a divergência à mão. É o risco clássico de spam de alerta, e
o mais provável de já estar acontecendo hoje. Agravante: `app/api/organizer/reconciliation/route.ts:23`
deixa **qualquer organizador** disparar essa notificação a todos os admins, sem rate limit e sem
dedupe (nenhum `rateLimit` nessa rota).

### 3. `CANCELLATION_REQUESTED` tem claim permanente — a segunda solicitação de cancelamento nunca é anunciada
A chave é `"${registrationId}:${email}"` sem componente de tempo nem de tentativa
(`cancellation-requested.ts:43,63`). O ciclo "atleta solicita → admin **rejeita** → inscrição volta a
`CONFIRMED` (`lib/registrations/cancellation-decision-service.ts:45`) → atleta solicita de novo
(permitido: `app/api/registrations/[id]/cancel/route.ts:33` só exige `CONFIRMED`)" resulta num
segundo pedido que **não gera alerta nenhum** — `claimAlert` já encontra a linha e retorna `false`,
e o `catch` externo nem chega a rodar. Cancelamento parado sem ninguém saber. Correção: incluir
`cancellationRequestedAt` (ou um contador) na chave.

### 4. `sendAdPurchaseConfirmationEmail` no webhook não está isolado — falha de SMTP devolve 500 ao gateway
`app/api/webhooks/payment/route.ts:133` faz `await` direto, sem `try/catch`, numa função que lança
(`lib/email.ts:26,51`). É a única chamada de envio não isolada em todo o handler — todas as outras
usam `void` (`:179`, `:184`). Consequência: SMTP fora do ar transforma uma confirmação de compra de
anúncio numa resposta 500 e num loop de reentrega do Mercado Pago. Correção trivial: envolver em
`try/catch` com `console.error`, ou trocar por `void`.

### 5. `checkAbandonedCarts` grava um `AuditLog` por pedido **por execução do cron**, independentemente de dedupe e de settings
`lib/alerts/abandoned-cart.ts:24-32` cria a linha `CART_ABANDONED` **antes** de qualquer verificação
de canal ou claim — comportamento confirmado como intencional pelo teste
`tests/alert-abandoned-cart.test.ts:47` ("grava auditoria mesmo com os dois canais desligados"). Mas
como `checkAbandonedCarts` reprocessa **todos** os pedidos `PENDING` mais velhos que o limiar a cada
execução (`abandoned-cart.ts:78-86`, sem filtro por alerta já enviado), um pedido abandonado que
nunca é pago gera uma linha de auditoria nova a cada ciclo de cron, para sempre. Crescimento
ilimitado da tabela `audit_logs` e poluição da tela `/admin/auditoria`. O envio em si está protegido
pelo claim — só a auditoria vaza.

**Fora do ranking (menor):** duplicidade possível de mensagem ao comprador entre
`notifyPaymentError(paymentId)` e `notifyOrderCancelledWithoutPayment(orderId)` (§2); `low-stock` e
`payment-error` abortando o canal de WhatsApp quando o e-mail falha (§4); alertas de `lib/alerts/`
não checarem a conexão da Evolution como `lib/notifications.ts` faz (§5); `/admin/reconciliation` não
notificar enquanto `/organizer/reconciliation` notifica (§6); 3 getters de settings sem teste (§3).
