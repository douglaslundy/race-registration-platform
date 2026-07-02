# Design: correção de receita/KPIs no relatório financeiro admin e filtro de pagamentos

Sub-projeto 2 de um conjunto maior de pedidos (ver histórico de conversa / [[evento-inscritos-kpis]]). Cobre `app/admin/relatorio/page.tsx`, `app/admin/pagamentos/page.tsx`, e o export CSV associado ao relatório. Não cria nenhuma rotina de estorno — isso é o sub-projeto 4 (Mercado Pago + registro manual).

## Diagnóstico (por que isso é bug, não mudança de comportamento)

- `app/api/registrations/[id]/cancel/route.ts` cancela uma inscrição confirmada mudando `Registration.status` e `Order.status` para `CANCELLED`, mas **nunca toca em `Payment.status`** — o pagamento permanece `PAID` para sempre.
- `app/admin/relatorio/page.tsx` calcula "Receita bruta" agregando `Payment` por `status: "PAID"`, sem checar o status do `Order` associado. Resultado: uma inscrição paga e depois cancelada continua contando como receita.
- `app/organizador/eventos/[id]/page.tsx` (linha 41, já em produção) já calcula a receita do evento corretamente, filtrando `orders: { where: { status: "PAID" } } }` — ou seja, o padrão correto já existe no código, só não foi aplicado no relatório do admin.
- A tabela `Refund` existe no schema mas nenhum código do sistema cria registros nela hoje — "Receita líquida" (`bruta - estornos`) sempre foi igual a "Receita bruta" na prática.
- "Taxa da plataforma" é uma estimativa (`receita líquida × 11%`), mas cada `Order` já grava o valor real cobrado em `platformFeeAmount` no momento do checkout.
- O filtro de status em `/admin/pagamentos` lista apenas os status que já existem no banco (`distinct`). Como o cancelamento de inscrição nunca gera `Payment.status = CANCELLED` (esse status só vem de webhook do gateway), "Cancelado" nunca aparece — mesmo já estando mapeado em `PAYMENT_STATUS_LABEL` e `STATUS_COLOR`.
- `/admin/pagamentos` também mostra um "Total pago" no topo com o mesmo problema (soma `Payment.status = PAID` sem checar o `Order`).

## Decisões (confirmadas com o usuário)

1. **Receita bruta exclui pedidos cancelados.** Um pagamento só entra na receita bruta se `Payment.status = "PAID"` E `Order.status = "PAID"` — mesmo critério já usado corretamente na página do organizador.
2. **Novo KPI "Pagamentos cancelados"**: soma e contagem de pagamentos com `Payment.status = "PAID"` cujo `Order.status = "CANCELLED"`, dentro do período filtrado. Representa o dinheiro que saiu da receita bruta e ainda não foi estornado — será a base da fila de estornos do sub-projeto 4.
3. **Taxa da plataforma** passa a somar o valor real `Order.platformFeeAmount` dos pedidos pagos (não cancelados) no período, em vez da estimativa de 11%.
4. **`/admin/pagamentos` "Total pago"** recebe a mesma correção (exclui pedidos cancelados), por consistência.
5. **Filtro de status em `/admin/pagamentos`** passa a listar todos os valores do enum `PaymentStatus` (via `PAYMENT_STATUS_LABEL`), não apenas os que já existem no banco — garante que "Cancelado" (e qualquer outro status) sempre apareça como opção filtrável.
6. **Novo filtro por evento em `/admin/relatorio`**: dropdown com a lista de eventos, aplicado via `Order.eventId` (campo já existe direto no `Order`, sem precisar de join adicional). Afeta todos os KPIs, a quebra por método de pagamento, por status de pedido e a evolução mensal.

## O que muda em cada arquivo

### `app/admin/relatorio/page.tsx`
- `paymentsAgg`: adiciona `order: { status: "PAID" }` ao `where` (exclui cancelados da receita bruta e da contagem "Pagamentos confirmados").
- Novo `cancelledPaymentsAgg`: `db.payment.aggregate` com `where: { status: "PAID", paidAt: {...}, order: { status: "CANCELLED" } }` → alimenta o novo KPI.
- `platformFeeEstimate` → `platformFeeActual`: `db.order.aggregate({ _sum: { platformFeeAmount: true }, where: { status: "PAID", createdAt/paidAt no período, eventId se filtrado } })`. Usa os pedidos pagos como base (mesmo escopo da receita bruta).
- `byMethod`, `byMonth`, `ordersAgg`: recebem o mesmo filtro de evento (`eventId`) quando presente; `byMethod`/`byMonth` recebem também o `order: { status: "PAID" }` para consistência com a receita bruta.
- Novo `<select>` de evento no formulário de filtro (GET, junto com `de`/`ate`), populado com `db.event.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } })`.
- Novo card KPI "Pagamentos cancelados" na grade de 4 colunas do topo (vira 5 colunas, ou quebra em 2 linhas — mesma resolução visual dos cards existentes).
- Label do card de taxa muda de "Taxa plataforma (~11%)" para "Taxa da plataforma" (sem o `~`, já que agora é valor real).

### `app/api/admin/report/export/route.ts` (export CSV do relatório)
- Recebe o mesmo tratamento: base de receita bruta com `order: { status: "PAID" }`, taxa real em vez de estimativa, e aceita o parâmetro `eventId` para exportar filtrado pelo mesmo evento selecionado na tela.

### `app/admin/pagamentos/page.tsx`
- Query do `<select name="status">`: troca a fonte de `db.payment.findMany({ distinct: ["status"] })` por iterar as chaves de `PAYMENT_STATUS_LABEL` (import já existente no arquivo).
- `totalAmount` (`db.payment.aggregate`): adiciona `order: { status: "PAID" }` ao `where`.

## Fora de escopo

- Nenhuma rotina de estorno é criada aqui — a tabela `Refund` continua vazia até o sub-projeto 4. "Receita líquida" continua sendo `bruta - estornos`, e por enquanto `estornos = 0` (correto, pois nada estorna ainda).
- Nenhuma mudança em `app/api/registrations/[id]/cancel/route.ts` ou em qualquer fluxo de pagamento/checkout — a correção é inteiramente de leitura/agregação nos relatórios.
- Relatório financeiro do organizador (página nova) é o sub-projeto 3, não este.

## Testes

- Helpers de agregação extraídos como funções puras testáveis (seguindo o padrão de `lib/admin/payments.ts`), cobrindo: cálculo de receita bruta excluindo pedidos cancelados, cálculo do KPI de pagamentos cancelados, cálculo da taxa real da plataforma, e resolução do filtro por evento.
- Teste cobrindo que o filtro de status em `/admin/pagamentos` sempre inclui todas as chaves de `PAYMENT_STATUS_LABEL`, independente dos dados no banco.
