# Design: Desconto PIX exclusivamente sobre a Taxa de Serviço

Data: 2026-08-27

## 1. Contexto e princípio central

O checkout cobra três componentes financeiros independentes:

```
VALOR DA INSCRIÇÃO  +  TAXA DA PLATAFORMA  +  TAXA DE SERVIÇO  =  TOTAL
```

Esta feature adiciona um **desconto percentual para pagamentos via PIX** que incide
**exclusivamente sobre a Taxa de Serviço**:

```
TOTAL (PIX)  =  VALOR DA INSCRIÇÃO  +  TAXA DA PLATAFORMA  +  (TAXA DE SERVIÇO − DESCONTO PIX)
```

A **Taxa da Plataforma nunca é alterada, descontada nem usada como base do desconto**. O valor da
inscrição também não sofre desconto por esta funcionalidade. Quem absorve o desconto é a plataforma
(reduz a `platformNetMargin`); o organizador continua recebendo o subtotal integral.

## 2. Auditoria: mapeamento dos conceitos financeiros (obrigatório, pré-implementação)

| Conceito funcional | Campo / tabela | Serviço de cálculo | Configuração | Uso |
|---|---|---|---|---|
| **Valor da inscrição** | `Order.subtotalAmount` (centavos) = `TicketBatch.priceAmount − discountAmount` (cupom) | `lib/checkout.ts:170` | `TicketBatch.priceAmount` + cupom | base das duas taxas; repasse ao organizador |
| **Taxa da Plataforma** | `Order.platformFeeAmount` (centavos) | `platformFee = max(calculatePlatformFee(subtotal, event.platformFeePercent), defaultPlatformFee)` — `lib/checkout.ts:171-172`, `lib/format.ts:36` | `Event.platformFeePercent` (bps, default `1100`) + `platform_settings["default_platform_fee"]` (centavos, default `500`) | composição do total; repasse (`generate-payout`); `revenue-breakdown`; relatórios; resumo diário; comprovante; var. `{taxa_plataforma}` |
| **Taxa de Serviço** | `Order.paymentFeeAmount` (centavos) — nome interno enganoso ("payment fee"), funcionalmente é a "Taxa de serviço de ingresso" | `raw = round(subtotal × service_fee_percent / 10000)`; `paymentFee = (percent>0 || min>0) ? max(raw, min) : 0` — `lib/checkout.ts:173-176` | **só global**: `platform_settings["service_fee_percent"]` (bps) + `platform_settings["service_fee_min"]` (centavos). Não há taxa de serviço por evento | composição do total; repasse; `revenue-breakdown`; relatórios; resumo diário; comprovante; var. `{taxa_servico}` |

### Fatos que orientam o design

- O `paymentMethod` (`PIX` / `CREDIT_CARD` / `BOLETO`) **já chega no mesmo request** que cria o
  pedido (`app/api/checkout/route.ts:68`), mas hoje é desestruturado e descartado antes de
  `createCheckout` — usado só para chamar o gateway. Logo o desconto pode ser calculado dentro do
  próprio `createCheckout`.
- **Não existe** fluxo de "trocar forma de pagamento" ou "tentar pagar de novo" sobre um `Order`
  existente. Cada checkout cria um `Order` novo com um método fixo. A alternância
  Cartão↔PIX↔Cartão↔PIX da especificação é apenas recálculo no formulário do cliente
  (`CheckoutForm.tsx`), sem mutação de pedido.
- Todos os consumidores de `Order.paymentFeeAmount` tratam o campo como "taxa de serviço
  efetivamente cobrada": `lib/revenue-breakdown.ts`, `lib/admin/generate-payout.ts`,
  `lib/alerts/daily-summary-metrics.ts`, `app/api/admin/report/export/route.ts`,
  `app/api/admin/payments/[id]/export/route.ts`, páginas de relatório admin/organizador,
  `components/ui/RevenueBreakdownCard.tsx`, `app/dashboard/inscricoes/[id]/page.tsx`.
- Repasse: `netAmount = totalAmount − (platformFeeAmount + paymentFeeAmount)` = `subtotalAmount`.
  O organizador é indiferente ao desconto PIX.
- Estorno (`lib/payment/refund-service.ts`): sempre integral (`amount: payment.amount`); não
  decompõe taxas. Nenhuma regra separada de devolução por tipo de taxa.
- Taxa da Plataforma e Taxa de Serviço **nunca são misturadas no cálculo**. São apenas somadas
  visualmente em alguns pontos (`generate-payout` chama a soma de `platformFee`; `RevenueBreakdownCard`
  lista as duas separadas). Nenhum ponto aplica desconto sobre a soma.

### Pontos onde as duas taxas aparecem juntas (a preservar separados na origem)

- `lib/admin/generate-payout.ts:17,38` — variável local `platformFee = platformFeeAmount + paymentFeeAmount`. É a soma para o cálculo do repasse; a origem (`Order`) mantém os campos separados. **Não alterar** (não envolve Taxa de Serviço original — usa o valor efetivamente cobrado, que é o correto para repasse).

## 3. Modelo de dados

### 3.1 Migração Prisma (aditiva)

`Event`:
```prisma
pixServiceFeeDiscountPercent Int?   // 0–100 (percentual inteiro). null = herda global; 0 = explicitamente sem desconto
```

`Order`:
```prisma
serviceFeeOriginalAmount Int        // centavos — Taxa de Serviço antes do desconto PIX
pixDiscountPercent       Int @default(0)   // percentual efetivo aplicado (0 se não-PIX ou sem desconto)
pixDiscountAmount         Int @default(0)   // centavos — desconto efetivo concedido (serviceFeeOriginal − paymentFeeAmount)
```

`Order.paymentFeeAmount` **mantém o significado atual**: Taxa de Serviço efetivamente cobrada
(líquida, já com o desconto aplicado quando houver). `totalAmount` continua sendo
`subtotalAmount + platformFeeAmount + paymentFeeAmount`.

### 3.2 Backfill de dados

- `Event.pixServiceFeeDiscountPercent` → `null` para todos os eventos existentes (herda a global,
  que nasce `0` → comportamento financeiro idêntico ao atual).
- `Order.serviceFeeOriginalAmount` → recebe o valor atual de `paymentFeeAmount` em todos os pedidos
  existentes (SQL na migração: `UPDATE "orders" SET "serviceFeeOriginalAmount" = "paymentFeeAmount"`).
- `Order.pixDiscountPercent` / `pixDiscountAmount` → `0` (default da coluna).

Não há coluna `NOT NULL` sem default sobre tabela populada: `serviceFeeOriginalAmount` entra com
default `0` na definição da coluna, o `UPDATE` de backfill roda na mesma migração, e o default é
removido depois (ou mantido — inócuo, já que `createCheckout` sempre grava o valor). Decisão:
**manter o default `0`** para simplicidade; `createCheckout` nunca depende dele.

### 3.3 Configuração global

Nova setting `pix_service_fee_discount_percent` (string, default `"0"`).

- `lib/settings.ts`: `getPixServiceFeeDiscountPercent(): Promise<number>` — `parseInt(val, 10)` com
  fallback `0`; clamp defensivo em `[0, 100]`.
- `app/api/admin/settings` (rota genérica de settings já existente): validar `key ===
  "pix_service_fee_discount_percent"` → inteiro `0–100`, rejeita negativo e `> 100`.
- UI: novo campo no `components/admin/ServiceFeeForm.tsx` (mesma tela `app/admin/configuracoes`),
  rotulado **"Desconto PIX sobre a Taxa de Serviço (%)"**, com texto curto deixando claro que
  incide só sobre a Taxa de Serviço e não afeta a Taxa da Plataforma.

### 3.4 Configuração por evento (admin-only)

- `PATCH /api/admin/events/[id]/fee` (`app/api/admin/events/[id]/fee/route.ts`) — estende o schema:
  ```ts
  pixServiceFeeDiscountPercent: z.number().int().min(0).max(100).nullable().optional()
  ```
  Quando presente no body, atualiza o campo (inclusive para `null`). Audit log
  `EVENT_FEE_UPDATED` — metadata ganha `pixServiceFeeDiscountPercent`.
- UI: campo no `components/admin/SetPlatformFeeForm.tsx` (admin-only, permissão `events.set-fee`),
  com opção de "usar padrão da plataforma" (envia `null`) vs. valor explícito (`0–100`, onde `0`
  = evento não oferece desconto mesmo que a global seja > 0).
- Página do organizador: **não** ganha esse campo (decisão: é decisão comercial da plataforma,
  coerente com a Taxa da Plataforma por evento já ser admin-only).

## 4. Motor de cálculo — fonte única de verdade

Novo módulo puro `lib/fees.ts` (sem I/O, importável no servidor e no client).

```ts
export function resolveEffectivePixDiscountPercent(
  eventValue: number | null | undefined,
  globalValue: number,
): number {
  if (eventValue === null || eventValue === undefined) return clamp(globalValue);
  return clamp(eventValue); // eventValue === 0 -> 0, nunca cai pro global
}

export interface OrderAmountsInput {
  subtotal: number;              // centavos, já com desconto de cupom
  platformFeePercent: number;    // bps (Event.platformFeePercent)
  defaultPlatformFee: number;    // centavos (piso global da Taxa da Plataforma)
  serviceFeePercent: number;     // bps (service_fee_percent)
  serviceFeeMin: number;         // centavos (service_fee_min)
  pixDiscountPercent: number;    // percentual efetivo já resolvido (0–100)
  isPix: boolean;
}

export interface OrderAmounts {
  subtotal: number;
  platformFee: number;           // fórmula ATUAL, intocada
  serviceFeeOriginal: number;
  pixDiscountPercent: number;    // 0 se !isPix
  pixDiscountAmount: number;     // serviceFeeOriginal − serviceFeeFinal
  serviceFeeFinal: number;
  total: number;                 // subtotal + platformFee + serviceFeeFinal
}

export function computeOrderAmounts(i: OrderAmountsInput): OrderAmounts;
```

Regras internas:

- `platformFee = max(round(subtotal × platformFeePercent / 10000), defaultPlatformFee)` — **idêntico
  ao atual** (`calculatePlatformFee` + `Math.max`). Independe de `isPix`.
- `serviceFeeOriginal = (serviceFeePercent > 0 || serviceFeeMin > 0) ? max(round(subtotal ×
  serviceFeePercent / 10000), serviceFeeMin) : 0` — **idêntico ao atual**.
- Se `!isPix` ou `pixDiscountPercent === 0` ou `serviceFeeOriginal === 0`:
  `serviceFeeFinal = serviceFeeOriginal`, `pixDiscountAmount = 0`, `pixDiscountPercent = 0`.
- Senão:
  `rawDiscount = round(serviceFeeOriginal × pixDiscountPercent / 100)`
  `serviceFeeFinal = max(serviceFeeOriginal − rawDiscount, serviceFeeMin)`  ← piso respeitado
  `pixDiscountAmount = serviceFeeOriginal − serviceFeeFinal`  ← desconto efetivo (pode ser < rawDiscount se o piso limitar)
  `pixDiscountPercent` persistido = o percentual efetivo de entrada (não recalculado a partir do valor).
- `total = subtotal + platformFee + serviceFeeFinal`.

A base do desconto é **exclusivamente `serviceFeeOriginal`**. Nunca `platformFee + serviceFee`, nunca
`subtotal + platformFee + serviceFee`.

### 4.1 Backend

`lib/checkout.ts` — `createCheckout`:
- `CheckoutInput` ganha `isPix: boolean` (ou `paymentMethod: PaymentMethod`; usar `isPix` para não
  acoplar a taxa a boleto/cartão).
- Lê `pix_service_fee_discount_percent` (global) e `event.pixServiceFeeDiscountPercent` (já busca o
  `event` inteiro em `tx.event.findUnique`).
- `effectivePct = resolveEffectivePixDiscountPercent(event.pixServiceFeeDiscountPercent, global)`.
- Substitui o cálculo inline (linhas 171-177) por `computeOrderAmounts({ ..., pixDiscountPercent:
  effectivePct, isPix: input.isPix })`.
- `tx.order.create` grava: `subtotalAmount`, `platformFeeAmount`, `paymentFeeAmount`
  (= `serviceFeeFinal`), `serviceFeeOriginalAmount`, `pixDiscountPercent`, `pixDiscountAmount`,
  `totalAmount`.
- `CheckoutResult` ganha `serviceFeeOriginalAmount`, `pixDiscountAmount`, `pixDiscountPercent`,
  `paymentFeeAmount`.

`app/api/checkout/route.ts`:
- Passa `isPix: paymentMethod === "PIX"` para `createCheckout`.
- `provider.createPayment({ amount: checkout.totalAmount })` — já usa o total do backend, sem mudança.
- `Payment.amount` = `checkout.totalAmount` — sem mudança.
- Audit `CHECKOUT_INITIATED` — metadata ganha `pixDiscountAmount`.

Garantia: `total_backend == total_persistido (Order.totalAmount) == total_gateway
(provider.createPayment.amount) == total_checkout (recalculado no form com a mesma função)`.

### 4.2 Frontend

`components/checkout/CheckoutForm.tsx`:
- Remove `calcPlatformFee` / `calcServiceFee` locais; importa `computeOrderAmounts` de `lib/fees.ts`.
- Recebe nova prop `pixServiceFeeDiscountPercent: number` (o **efetivo já resolvido** no server
  component pai — ver §5).
- O bloco de resumo (linhas ~628-661) recomputa a cada render via `computeOrderAmounts`, passando
  `isPix: selectedPaymentMethod === "PIX"`. Sem `useState` derivado → alternância
  Cartão→PIX→Cartão→PIX nunca acumula nem duplica desconto.
- Linha nova, só quando `isPix && pixDiscountAmount > 0`, **imediatamente abaixo** da linha
  "Taxa de serviço de ingresso", visualmente subordinada a ela:
  ```
  Desconto PIX na taxa de serviço      −R$ 2,00
  20% de desconto via PIX
  ```
- `amount` passado a `MPCardForm` / `PagarMeCardForm` também via `computeOrderAmounts` (com
  `isPix: false`, já que cartão não tem desconto — valor não muda, mas fica na fonte única).
- A linha "+Taxa da plataforma" e o `calcPlatformFee` de exibição no card de lote (linha ~433)
  passam a vir de `computeOrderAmounts` — valor idêntico com ou sem PIX.

## 5. Página pública do evento

`app/(public)/eventos/[slug]/page.tsx` (bloco "Taxas aplicadas", linhas ~242-255):
- O server component passa a resolver o desconto efetivo:
  `getPixServiceFeeDiscountPercent()` (global) + `event.pixServiceFeeDiscountPercent` →
  `resolveEffectivePixDiscountPercent(...)`.
- Quando `efetivo > 0`, adiciona **dentro do bloco da Taxa de Serviço** (logo abaixo da linha
  `Taxa de serviço: X%`):
  ```
  20% de desconto na Taxa de Serviço para pagamento via PIX
  ```
- A linha da Taxa da Plataforma **não muda**.
- Se o evento não exibe Taxa de Serviço hoje (`serviceFeePercent === 0 && serviceFeeMin === 0`), a
  mensagem de desconto também não aparece (não há taxa de serviço para descontar).

`app/(public)/inscricao/[slug]/page.tsx` é o host do `CheckoutForm` (não exibe bloco de taxas
próprio). Passa a buscar `getPixServiceFeeDiscountPercent()` no `Promise.all` existente e a
resolver `resolveEffectivePixDiscountPercent(event.pixServiceFeeDiscountPercent, global)`,
entregando o resultado ao form como a prop `pixServiceFeeDiscountPercent` (número final já
resolvido — o form não recebe global + evento separados). `getEventBySlug` (`lib/events.ts`) usa
`include` sem `select`, então o novo campo do `Event` já vem no retorno sem alteração ali.

## 6. Persistência histórica, relatórios e estorno

### 6.1 Sem alteração (continuam corretos com `paymentFeeAmount` líquido)

- `lib/admin/generate-payout.ts` — repasse. Organizador recebe `subtotal` integral.
- `lib/revenue-breakdown.ts` / `components/ui/RevenueBreakdownCard.tsx` — `platformNetMargin`
  cai pelo valor do desconto (plataforma absorve). Correto.
- `lib/alerts/daily-summary-metrics.ts` — `serviceFeeAmount` = Σ `paymentFeeAmount` (líquido).
  Sem nova linha (decisão de escopo).
- Relatório do organizador — usa `subtotalAmount`; indiferente.
- Variáveis `{taxa_servico}` / `{taxa_plataforma}` — `{taxa_servico}` passa a refletir o valor
  líquido; atualizar só a `description` em `lib/templates/variables.ts:94` para "Soma de
  `Order.paymentFeeAmount` (Taxa de Serviço já com o desconto PIX quando houver)".
- `lib/payment/refund-service.ts` / `reconciliation.ts` — estorno integral de `payment.amount`
  (já é o total com desconto); reconciliação não recalcula taxas. Sem mudança. Snapshot no `Order`
  garante rastreabilidade histórica: `serviceFeeOriginalAmount − pixDiscountAmount = paymentFeeAmount`.
  Pedidos antigos nunca são recalculados com a config atual do evento (valores congelados).

### 6.2 Com alteração (breakdown original / desconto / líquida)

**`app/api/admin/report/export/route.ts`** + a página `app/admin/relatorio/page.tsx`:
- Agregar também `serviceFeeOriginalAmount` e `pixDiscountAmount` (via
  `buildReportOrderFeeWhere`).
- Substituir a linha única "Taxa de serviço" por:
  ```
  Taxa de serviço (original)      Σ serviceFeeOriginalAmount
  Desconto PIX concedido         − Σ pixDiscountAmount
  Taxa de serviço (líquida)       Σ paymentFeeAmount
  ```
- "Taxa da plataforma" **intocada**.

**`app/api/admin/payments/[id]/export/route.ts`** + `app/admin/pagamentos/[id]/page.tsx`:
- Linha "Taxa de serviço" vira 3 linhas (original / desconto PIX / líquida) + "Desc. PIX %"
  (`Order.pixDiscountPercent`).
- Só decompõe quando `pixDiscountAmount > 0`; senão mantém a linha única.

**`app/dashboard/inscricoes/[id]/page.tsx`** (comprovante do atleta, linhas ~194-205):
- Adicionar `serviceFeeOriginalAmount`, `pixDiscountAmount` ao `select` do `order`.
- Quando `pixDiscountAmount > 0`:
  ```
  Taxa de serviço original            + R$ 10,00
  Desconto PIX na taxa de serviço     − R$ 2,00
  Taxa de serviço de ingresso         + R$ 8,00
  ```
  Senão, uma linha só (`Taxa de serviço de ingresso` = `paymentFeeAmount`) como hoje.

### 6.3 Fora de escopo (números permanecem corretos, sem nova linha de breakdown)

Resumo diário (admin/organizador/evento), relatório do organizador, `RevenueBreakdownCard`,
exportação de inscrições CSV/XLSX, variáveis de template. Justificativa: a Taxa de Serviço nesses
pontos é sempre o valor efetivamente cobrado (`paymentFeeAmount`), que é o número contábil correto
para eles; o detalhamento original/desconto é uma necessidade de auditoria financeira, coberta pelo
relatório financeiro do admin e pelo detalhe de pagamento.

## 7. `event/[id]/duplicate` e outras cópias de config

`app/api/events/[id]/duplicate/route.ts:53` copia `platformFeePercent`. Adicionar
`pixServiceFeeDiscountPercent: event.pixServiceFeeDiscountPercent` à cópia (preserva a intenção
do organizador ao duplicar um evento).

## 8. Testes (seção 19 da especificação)

### 8.1 `tests/unit/fees.test.ts` (novo)

Cenário base: `subtotal = 10000`, `platformFeePercent = 500` (→ R$5, sem piso maior),
`serviceFeePercent = 1000` (→ R$10), `serviceFeeMin = 0`, `pixDiscountPercent = 20`.

- **Cartão** (`isPix: false`): `platformFee = 500`, `serviceFeeOriginal = 1000`,
  `serviceFeeFinal = 1000`, `pixDiscountAmount = 0`, `total = 11500`.
- **PIX** (`isPix: true`): `platformFee = 500`, `serviceFeeOriginal = 1000`,
  `pixDiscountAmount = 200`, `serviceFeeFinal = 800`, `pixDiscountPercent = 20`, `total = 11300`.
- **Validação crítica:** `platformFee` do cenário cartão === `platformFee` do cenário PIX (=== 500).
  Teste dedicado, com comentário explicando que ele deve falhar se o desconto tocar a Taxa da
  Plataforma direta ou indiretamente.
- **Herança:** `resolveEffectivePixDiscountPercent(null, 20) === 20`;
  `resolveEffectivePixDiscountPercent(0, 20) === 0`;
  `resolveEffectivePixDiscountPercent(30, 20) === 30`;
  `resolveEffectivePixDiscountPercent(undefined, 20) === 20`.
- **Piso:** `serviceFeeMin = 900`, `serviceFeePercent = 1000` (→ original R$10), desconto 20%
  (→ R$2) → `serviceFeeFinal = max(1000 − 200, 900) = 900`, `pixDiscountAmount = 100` (efetivo,
  não 200).
- **Sem taxa de serviço:** `serviceFeePercent = 0`, `serviceFeeMin = 0` → `serviceFeeOriginal = 0`,
  desconto = 0 mesmo com PIX e `pixDiscountPercent = 20`.
- **Clamp:** entrada `150` → tratada como `100`; entrada negativa → `0`.

### 8.2 `tests/checkout-route.test.ts` + `tests/unit/checkout-*.test.ts` (estender)

- Pedido PIX com desconto global configurado: `Order` persiste `serviceFeeOriginalAmount`,
  `pixDiscountPercent`, `pixDiscountAmount` corretos; `paymentFeeAmount` = líquido;
  `totalAmount` = com desconto; `Payment.amount` === `Order.totalAmount`.
- Pedido cartão no mesmo evento: `pixDiscountAmount = 0`, `paymentFeeAmount` = taxa cheia,
  `serviceFeeOriginalAmount === paymentFeeAmount`.
- **`platformFeeAmount` idêntico** entre o pedido PIX e o pedido cartão do mesmo evento/lote.
- Evento com `pixServiceFeeDiscountPercent = 0` e global = 20: pedido PIX sem desconto.
- Evento com `pixServiceFeeDiscountPercent = null` e global = 20: pedido PIX com 20%.

### 8.3 `tests/admin-report-route.test.ts` / `tests/admin-payment-detail-export.test.ts` (estender)

- Relatório financeiro admin: linhas "Taxa de serviço (original)", "Desconto PIX concedido",
  "Taxa de serviço (líquida)" com os somatórios certos; "Taxa da plataforma" inalterada.
- Export de detalhe de pagamento PIX com desconto: 3 linhas + "Desc. PIX %".

### 8.4 Validação final

Suíte completa verde, `tsc --noEmit` limpo, `npm run build` limpo, migração aplicada em ambiente
de teste. Nenhum teste desabilitado, nenhum `@ts-ignore`/catch vazio novo.

## 9. Critérios de aceite

- [x] Taxa da Plataforma e Taxa de Serviço permanecem conceitos independentes em todas as camadas.
- [x] O desconto PIX incide somente sobre `serviceFeeOriginalAmount`.
- [x] O desconto PIX nunca incide sobre `platformFeeAmount` nem sobre a soma das taxas.
- [x] `platformFeeAmount` idêntico em cartão e PIX (teste automatizado prova).
- [x] Valor da inscrição (`subtotalAmount`) não sofre o desconto.
- [x] Checkout exibe inscrição, Taxa da Plataforma, Taxa de Serviço e (se PIX) desconto separados.
- [x] Desconto visualmente subordinado à linha da Taxa de Serviço, no checkout e na página pública.
- [x] Mensagem de desconto na página pública só quando `efetivo > 0`.
- [x] Config global e por evento com validação `0–100`, sem negativo, sem `> 100`.
- [x] Evento `null` herda global; evento `0` = sem desconto mesmo com global `> 0`.
- [x] Instalações e eventos existentes: comportamento financeiro idêntico ao atual (default `0`).
- [x] `Order` preserva original, percentual, desconto e líquida separadamente.
- [x] `total_backend == total_persistido == total_gateway == total_checkout`.
- [x] Relatório financeiro admin, export de pagamento e comprovante do atleta mostram
      original / desconto PIX / líquida.
- [x] Repasse do organizador inalterado (recebe subtotal integral).
- [x] Estorno histórico usa os valores congelados no `Order`, nunca recalcula com a config atual.

## 10. Entrega técnica final — Separação entre Taxa da Plataforma e Taxa de Serviço

**Taxa da Plataforma**
- campo/tabela: `Order.platformFeeAmount`; config `Event.platformFeePercent` +
  `platform_settings["default_platform_fee"]`
- serviço de cálculo: `computeOrderAmounts` (extrai a fórmula hoje inline em `lib/checkout.ts`) —
  `max(calculatePlatformFee(subtotal, platformFeePercent), defaultPlatformFee)`
- fórmula: inalterada
- relatórios: relatório financeiro admin, resumo diário admin, comprovante, `revenue-breakdown`,
  export de pagamento, var. `{taxa_plataforma}`
- impacto da feature: **NENHUM**, salvo composição do total final

**Taxa de Serviço**
- campo/tabela: `Order.paymentFeeAmount` (líquida) + novos `Order.serviceFeeOriginalAmount`,
  `Order.pixDiscountPercent`, `Order.pixDiscountAmount`; config `service_fee_percent` +
  `service_fee_min` (global) + novo `pix_service_fee_discount_percent` (global) +
  `Event.pixServiceFeeDiscountPercent` (por evento)
- serviço de cálculo: `computeOrderAmounts`
- fórmula original: `(pct>0||min>0) ? max(round(subtotal×pct/10000), min) : 0`
- fórmula após desconto PIX: `serviceFeeFinal = isPix ? max(serviceFeeOriginal − round(serviceFeeOriginal×efetivo/100), serviceFeeMin) : serviceFeeOriginal`
- relatórios: idem Taxa da Plataforma + as novas linhas de breakdown no relatório financeiro admin,
  export de pagamento e comprovante
- impacto da feature: passa a ser descontada quando `isPix` e desconto efetivo `> 0`; o valor
  cobrado (`paymentFeeAmount`) diminui; a `platformNetMargin` diminui na mesma medida

**Pontos onde as duas cobranças estão hoje misturadas:** `lib/admin/generate-payout.ts` usa a
variável local `platformFee = platformFeeAmount + paymentFeeAmount` para o cálculo do repasse. Não é
um bug (o repasse precisa da soma das duas taxas efetivamente cobradas, e usa o valor líquido, que é
o correto), a origem no `Order` mantém os campos separados, e a feature não altera esse ponto.
Sinalizado por completude.

## 11. Fora de escopo

- Desconto PIX sobre valor da inscrição ou Taxa da Plataforma (proibido pela especificação).
- Taxa de Serviço por evento (não existe hoje; não é criada aqui — só o desconto é por evento).
- Fluxo de "trocar forma de pagamento" / "pagar novamente" sobre `Order` existente (não existe).
- Breakdown original/desconto/líquida no resumo diário, relatório do organizador,
  `RevenueBreakdownCard`, exportação de inscrições e variáveis de template.
- Regras separadas de estorno por tipo de taxa (não existem hoje).
- Boleto/cartão com desconto (só PIX).
