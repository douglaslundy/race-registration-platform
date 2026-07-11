# Filtros e resumo na página do evento (categoria/percurso/lote/cupom/pagamento)

## Contexto

Segundo de uma leva de 6 sub-projetos pedidos pelo usuário nesta sessão (ordem: carrinhos
abandonados ✅ → filtros/resumo no evento → verificar resultados → corrigir expiração de pagamentos
→ verificar repasses → dashboards). Hoje a lista de inscritos (`app/organizador/eventos/[id]/
inscritos/page.tsx` e `app/admin/eventos/[id]/inscritos/page.tsx`, quase idênticas) só filtra por
`status` e busca livre (`q`). A página do evento do organizador já mostra alguns resumos (status
geral, receita, cupons por uso), mas percursos/categorias são listas estáticas sem número, lotes só
mostram vagas vendidas/capacidade sem receita, e não existe nenhum resumo por tipo de pagamento. A
página do evento do admin é ainda mais simples — nem tem o card de cupons nem o de categorias.

Escopo confirmado com o usuário: os filtros e os resumos valem para as duas telas (admin e
organizador), trazendo a página de evento do admin à paridade com a do organizador.

## 1. Refatorar `buildRegistrationWhere` para receber um objeto de filtros

`lib/organizer/registrations.ts` — assinatura atual `buildRegistrationWhere(eventId, status?, q?)`
vira:

```ts
export interface RegistrationFilters {
  status?: string;
  q?: string;
  categoryId?: string;
  routeId?: string;
  ticketBatchId?: string;
  couponId?: string;
  paymentMethod?: string;
}

export function buildRegistrationWhere(
  eventId: string,
  filters: RegistrationFilters = {},
): Prisma.RegistrationWhereInput
```

Os filtros novos, cada um só entra no `AND` quando o valor está presente:
- `categoryId` → `{ categoryId }` (campo escalar direto em `Registration`)
- `routeId` → `{ routeId }` (idem)
- `ticketBatchId` → `{ ticketBatchId }` (idem)
- `couponId` → `{ order: { couponId } }` (cupom vive em `Order`, não em `Registration`)
- `paymentMethod` → `{ order: { payments: { some: { method: paymentMethod } } } }` — mesmo padrão
  `some` já usado pelos filtros existentes de `REFUNDED`/`REFUND_PENDING`; não tenta isolar
  especificamente o pagamento *mais recente* do pedido (isso exigiria uma subquery), então um pedido
  com uma tentativa PIX falha seguida de um cartão bem-sucedido aparece em ambos os filtros — mesma
  aproximação que o código já faz para status de pagamento.

`buildRegistrationOrderBy` não muda.

`tests/organizer-registrations-helpers.test.ts` é reescrito para a nova assinatura (todas as
chamadas passam a usar o objeto), mais um teste novo por filtro novo.

## 2. Filtros na lista de inscritos (admin + organizador)

Ambos os arquivos de página (`app/organizador/eventos/[id]/inscritos/page.tsx` e
`app/admin/eventos/[id]/inscritos/page.tsx`) ganham, no mesmo `<form method="GET">` que já tem busca
e status:

- **Categoria** — `<select>` populado com `event.categories` (precisa incluir esse relation na
  query do evento, hoje só busca `{ id, title }`).
- **Percurso** — `<select>` com `event.routes`.
- **Lote** — `<select>` com `event.ticketBatches`.
- **Cupom** — `<select>` com `event.coupons` (mostrando `code`).
- **Tipo de pagamento** — `<select>` estático: PIX / Cartão de crédito / Cartão de débito / Boleto.
  `components/registrations/RegistrationsTable.tsx:8-13` já define `PAYMENT_METHOD_LABEL` (mapa
  local, não exportado hoje) — passa a ser `export const`, e tanto as páginas de inscritos quanto as
  de evento (seção 4 abaixo) importam esse mesmo mapa em vez de recriar a tradução em 3 lugares.

`SearchParams` ganha `categoryId?`, `routeId?`, `ticketBatchId?`, `couponId?`, `paymentMethod?`.
`buildInscritosUrl` e a chamada a `buildRegistrationWhere` propagam os 5 novos parâmetros. O bloco
"Limpar" passa a considerar os novos filtros na condição de exibição.

## 3. Resumo por dimensão nos cards da página do evento

Novo helper puro em `lib/organizer/event-metrics.ts` (arquivo já existente,
`computeRegistrationStatusBreakdown`/`computeSlotsInfo`):

```ts
export interface DimensionStats { count: number; revenue: number }

export interface RegistrationForBreakdown {
  routeId: string | null;
  categoryId: string | null;
  ticketBatchId: string;
  orderSubtotalAmount: number;
}

export function computeDimensionBreakdowns(registrations: RegistrationForBreakdown[]): {
  byRoute: Map<string, DimensionStats>;
  byCategory: Map<string, DimensionStats>;
  byTicketBatch: Map<string, DimensionStats>;
}
```

Conta e soma `orderSubtotalAmount` por `routeId`/`categoryId`/`ticketBatchId`, ignorando `null`
(percurso/categoria opcionais). O chamador (a página) já filtra a lista de `registrations` de entrada
para `status: "CONFIRMED"` antes de passar pra essa função — mesmo critério de "pago" já usado pela
métrica geral (`computeRegistrationStatusBreakdown`'s `paid`), então count e receita usam a mesma
definição de "pago" em toda a página. Isso é uma função pura, testável sem mock de banco.

Query nova nas duas páginas de evento (`app/organizador/eventos/[id]/page.tsx` e
`app/admin/eventos/[id]/page.tsx`):

```ts
db.registration.findMany({
  where: { eventId: id, status: "CONFIRMED" },
  select: { routeId: true, categoryId: true, ticketBatchId: true, order: { select: { subtotalAmount: true } } },
})
```
— mapeado para `{ routeId, categoryId, ticketBatchId, orderSubtotalAmount: r.order.subtotalAmount }`
antes de passar pra `computeDimensionBreakdowns`.

## 4. Resumo por tipo de pagamento (card novo)

Novo helper puro, mesmo arquivo:

```ts
export interface PaymentMethodStats { method: string; count: number; revenue: number }

export function buildPaymentMethodSummary(
  groups: { method: string; count: number; revenue: number }[],
): PaymentMethodStats[]
```

Sempre retorna as 4 entradas do enum `PaymentMethod` (PIX, CREDIT_CARD, DEBIT_CARD, BOLETO), na
mesma ordem, zerando as que não apareceram em `groups` — assim o card sempre mostra os 4 métodos,
mesmo com uso zero, útil pro organizador enxergar rapidamente que "ninguém pagou boleto ainda".

Query nova nas duas páginas de evento:

```ts
db.payment.groupBy({
  by: ["method"],
  where: { status: "PAID", order: { eventId: id } },
  _count: { id: true },
  _sum: { amount: true },
})
```
— mapeado para `{ method, count: g._count.id, revenue: g._sum.amount ?? 0 }` antes de passar pra
`buildPaymentMethodSummary`.

Novo card "Tipo de pagamento" na grade de cards já existente (`Lotes / Percursos / Categorias /
Cupons`), mesmo padrão visual (título + lista `flex justify-between` por linha), usando o mesmo
`PAYMENT_METHOD_LABEL` exportado de `RegistrationsTable.tsx` (seção 2) pra mostrar o label em
português, contagem e receita por método.

## 5. Cards atualizados

- **Percursos**: cada linha ganha, além do nome e distância já existentes, a contagem de inscritos
  confirmados e a receita (`byRoute.get(r.id)`, com fallback `{ count: 0, revenue: 0 }` para
  percursos sem nenhuma inscrição confirmada ainda).
- **Categorias**: mesma mudança — de tags simples (`<span>`) para uma lista com contagem + receita
  por linha, no mesmo formato visual das outras seções (a mudança de "tags" pra "lista" é necessária
  pra caber os números; segue o padrão de linha usado em Lotes/Percursos).
- **Lotes**: mantém o formato atual (`soldCount/capacity · preço`), acrescentando a receita
  (`byTicketBatch.get(b.id)`) na mesma linha.
- **Cupons**: seção já existe inteira no organizador (visão geral + agrupado por cupom); replicada
  tal e qual na página do admin, que hoje não tem nada de cupom. A lógica de `couponStats`/`statsMap`
  já existente no organizador é reaproveitada como está (não é extraída pra helper novo — mover
  código que já funciona e já tem seu próprio grupo de queries não é necessário pro escopo deste
  sub-projeto).
- **Categorias no admin**: card inteiramente novo lá (hoje nem existe), mesmo formato do
  organizador.

## Testes

- `tests/organizer-registrations-helpers.test.ts` reescrito para a nova assinatura de
  `buildRegistrationWhere`, + 5 testes novos (um por filtro novo) + 1 teste combinando múltiplos
  filtros ao mesmo tempo.
- `tests/organizer-event-metrics.test.ts` (arquivo novo, ou extensão se já existir um cobrindo
  `computeRegistrationStatusBreakdown`/`computeSlotsInfo` — verificar antes de criar) ganha testes
  pra `computeDimensionBreakdowns` (percurso/categoria/lote nulos e não-nulos, múltiplas inscrições
  no mesmo percurso somando receita) e `buildPaymentMethodSummary` (zera método sem uso, preserva
  ordem fixa dos 4 métodos).

## Fora de escopo

- Filtro por status de pagamento (PAID/PENDING/EXPIRED) separado do filtro por status de inscrição
  — já existe o filtro de `status` de inscrição, que cobre o caso de uso principal; não duplicar com
  outro filtro de status de pagamento bruto.
- Exportar CSV com os novos filtros aplicados — verificado: `ExportCsvButton` hoje ignora
  completamente os filtros da página (só manda `eventId`), e `/api/events/[id]/registrations`
  também não lê nenhum query param de filtro, exporta tudo do evento sempre. Continua assim; passar
  os filtros pro export é trabalho novo, não pedido nesta sessão.
- Filtro por faixa de valor pago ou por data de inscrição — não pedido.
- Refatorar a seção de cupons pra um helper compartilhado entre as duas páginas — copiar o bloco já
  pronto do organizador pro admin é suficiente; extrair duplicação é um passo de limpeza futuro, não
  pedido agora.
