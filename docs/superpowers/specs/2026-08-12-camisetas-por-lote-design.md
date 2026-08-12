# Camisetas por lote — Design

## Contexto

O card "Camisetas" (implementado em `docs/superpowers/specs/2026-08-12-relatorio-camisetas-por-evento-design.md`)
mostra a contagem de inscrições confirmadas por tamanho, agregada pro evento inteiro, nas
páginas de gerenciamento do organizador e do admin. Falta a possibilidade de ver essa
mesma contagem separada por lote de inscrição.

## Objetivo

No mesmo card "Camisetas", adicionar um toggle que troca a visão agregada (7 blocos, como
hoje) por uma tabela com a contagem de cada tamanho separada por lote.

## Escopo

- Toggle no card, sem navegação/nova página.
- Toggle só aparece quando o evento tem mais de 1 lote (com 0 ou 1 lote, a visão "por
  lote" seria idêntica à agregada).
- Mesma extensão nas duas páginas onde o card já existe: organizador e admin.
- Sem query nova — reaproveita os dados já buscados (`dimensionRegistrations` já traz
  `shirtSize` e `ticketBatchId`; `event.ticketBatches` já é buscado em ambas páginas).

## Fora de escopo

- Filtro por lote (mostrar só um lote de cada vez) — descartado em favor do toggle
  "tabela com todos os lotes".
- Qualquer mudança na página pública do evento ou na `/inscritos`.

## Dados

### Helper novo

Em `lib/organizer/event-metrics.ts`, ao lado de `computeShirtSizeBreakdown`:

```ts
export interface ShirtSizeByBatch {
  batchId: string;
  batchName: string;
  sizes: ShirtSizeStat[];
}

export function computeShirtSizeBreakdownByBatch(
  registrations: { shirtSize: string | null; ticketBatchId: string }[],
  batches: { id: string; name: string }[],
): ShirtSizeByBatch[]
```

Agrupa `registrations` por `ticketBatchId` e chama `computeShirtSizeBreakdown` pra cada
grupo — cada lote sempre retorna as mesmas 7 linhas fixas (`PP, P, M, G, GG, XGG, Sem
tamanho informado`), na mesma ordem de `batches` (que o chamador já passa ordenado, ex.:
por `startAt`).

## UI

### Componente novo

`components/ui/ShirtSizeReportCard.tsx` — client component (precisa de estado local pro
toggle):

```tsx
"use client";

export default function ShirtSizeReportCard({
  overall,
  byBatch,
}: {
  overall: { size: string; label: string; count: number }[];
  byBatch: { batchId: string; batchName: string; sizes: { size: string; label: string; count: number }[] }[];
})
```

- Header: título "Camisetas" + botão de toggle ("Ver por lote" / "Ver total"), só
  renderizado quando `byBatch.length > 1`.
- Modo agregado (padrão): os mesmos 7 blocos já existentes (`grid grid-cols-4
  sm:grid-cols-7`, cada bloco com contagem + label).
- Modo por lote: tabela — colunas = os 7 tamanhos, linhas = um lote por linha (nome +
  contagem de cada tamanho), mais uma linha "Total" no fim usando `overall` (soma bate
  exatamente com os lotes, já que todo registro confirmado tem lote).

### Páginas consumidoras

`app/organizador/eventos/[id]/page.tsx` e `app/admin/eventos/[id]/page.tsx`: cada uma já
calcula `shirtSizeBreakdown` (agregado) a partir de `dimensionRegistrations`; passam a
calcular também `shirtSizeByBatch` com o novo helper, usando `event.ticketBatches` (já
buscado) pra fornecer nome/ordem dos lotes. O card inline atual de "Camisetas" (blocos
direto no JSX da página) é substituído por `<ShirtSizeReportCard overall={...}
byBatch={...} />`, na mesma posição de hoje em cada página.

## Testes

- `tests/organizer-event-metrics.test.ts`: casos novos pra `computeShirtSizeBreakdownByBatch`
  — múltiplos lotes com tamanhos diferentes, lote sem nenhuma inscrição (ainda aparece com
  todos os tamanhos zerados), lista de `batches` vazia (retorna `[]`).
