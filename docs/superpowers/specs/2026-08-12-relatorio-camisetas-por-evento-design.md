# Relatório de camisetas por evento — Design

## Contexto

Cada evento tem lotes, percursos, categorias e cupons exibidos em cards nas páginas de
gerenciamento do organizador (`app/organizador/eventos/[id]/page.tsx`) e do admin
(`app/admin/eventos/[id]/page.tsx`). Falta um relatório de quantidade de inscrições
**confirmadas** por tamanho de camiseta (`Registration.shirtSize`, enum `ShirtSize`:
`PP | P | M | G | GG | XGG`).

## Objetivo

Adicionar um card "Camisetas" com a contagem de inscrições confirmadas por tamanho em
ambas as páginas de gerenciamento de evento (organizador e admin).

## Dados

### Novo helper compartilhado

Em `lib/organizer/event-metrics.ts`, junto aos helpers existentes
(`computeDimensionBreakdowns`, `buildPaymentMethodSummary`):

```ts
const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XGG"] as const;

export interface ShirtSizeStat {
  size: string;   // um de SHIRT_SIZES, ou "SEM_TAMANHO"
  label: string;  // "PP", "P", ..., "XGG", "Sem tamanho informado"
  count: number;
}

export function computeShirtSizeBreakdown(
  registrations: { shirtSize: string | null }[]
): ShirtSizeStat[]
```

- Sempre retorna 7 entradas, nesta ordem: `PP, P, M, G, GG, XGG, Sem tamanho informado`
  — inclusive com `count: 0` quando não houver inscrições naquele tamanho (mesmo padrão
  de "mostrar todos, mesmo zerado" já adotado no relatório de tamanhos).
- `Sem tamanho informado` conta registrations confirmadas com `shirtSize: null`.

### Origem dos dados

Ambas as páginas já buscam as registrations confirmadas do evento para os breakdowns de
percurso/categoria/lote (`dimensionRegistrations` no organizador, equivalente no admin),
via `db.registration.findMany({ where: { eventId: id, status: "CONFIRMED" }, select: {...} })`.
Basta acrescentar `shirtSize: true` ao `select` existente — nenhuma query nova.

## UI

### Organizador (`app/organizador/eventos/[id]/page.tsx`)

A grade atual de 2 colunas (`Lotes / Percursos / Categorias / Cupons / Tipo de
pagamento`, nessa ordem no array de cards) é dividida em três blocos, na ordem final:

1. Grid 2 colunas: `Lotes` + `Percursos`
2. Card `Camisetas` em largura total
3. Grid 2 colunas: `Categorias` + `Cupons de desconto` + `Tipo de pagamento`

### Admin (`app/admin/eventos/[id]/page.tsx`)

Card `Camisetas` em largura total, inserido logo após a grade que contém `Lotes /
Percursos / Categorias / Tipo de pagamento` (antes do bloco de ações "Ver inscritos /
Exportar CSV / Ver página pública"). A posição do card `Uso de cupons`, que hoje aparece
no topo da página, não muda.

### Conteúdo do card

Mesmo estilo `card` dos demais cards da página (título `Camisetas`). Conteúdo em grade
responsiva de blocos compactos, um por tamanho — mesmo padrão visual dos blocos usados
no card "Uso de cupons" do admin (`bg-gray-50 dark:bg-gray-800 rounded-lg p-3
text-center`), com o label do tamanho em cima e a contagem em destaque embaixo:

```
grid grid-cols-4 sm:grid-cols-7 gap-2
```

Sem link de "Gerenciar" (não é uma entidade editável, é só leitura).

## Fora de escopo

- Página pública do evento (`app/(public)/eventos/[slug]/page.tsx`) — não faz parte do
  pedido, é um relatório de gerenciamento.
- Exportação/CSV do relatório de camisetas.
- Alterar a página de inscritos (`inscritos/page.tsx`), que já mostra o tamanho por
  inscrição individual na tabela.
