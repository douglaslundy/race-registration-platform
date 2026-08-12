# Relatório de camisetas por evento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um card "Camisetas" com a contagem de inscrições confirmadas por
tamanho de camiseta nas páginas de gerenciamento de evento do organizador e do admin.

**Architecture:** Um novo helper puro `computeShirtSizeBreakdown()` em
`lib/organizer/event-metrics.ts` (mesmo módulo dos helpers existentes de breakdown)
recebe as registrations confirmadas já buscadas por cada página e devolve sempre 7
linhas fixas (`PP, P, M, G, GG, XGG, Sem tamanho informado`). Cada página server
component acrescenta `shirtSize` ao `select` da query `dimensionRegistrations` que já
existe, chama o helper, e renderiza um novo card full-width na posição definida no
spec.

**Tech Stack:** Next.js App Router (server components), Prisma, Vitest.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-12-relatorio-camisetas-por-evento-design.md`.
- O helper sempre retorna as 7 linhas na ordem `PP, P, M, G, GG, XGG, Sem tamanho informado`, mesmo com contagem 0.
- Nenhuma query nova no banco — reaproveitar a query `dimensionRegistrations` já existente em cada página, só acrescentando `shirtSize: true` ao `select`.
- Sem link "Gerenciar" no card (é só leitura).
- Não mexer na página pública do evento nem em exportação/CSV — fora de escopo.

---

### Task 1: Helper `computeShirtSizeBreakdown`

**Files:**
- Modify: `lib/organizer/event-metrics.ts`
- Test: `tests/organizer-event-metrics.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `export interface ShirtSizeStat { size: string; label: string; count: number }`
  - `export function computeShirtSizeBreakdown(registrations: { shirtSize: string | null }[]): ShirtSizeStat[]`
  - Ordem fixa de retorno: `size` em `["PP", "P", "M", "G", "GG", "XGG", "SEM_TAMANHO"]`, `label` igual ao `size` exceto `"SEM_TAMANHO"` → `"Sem tamanho informado"`.

- [x] **Step 1: Write the failing tests**

Acrescentar ao final de `tests/organizer-event-metrics.test.ts`:

```ts
import { computeShirtSizeBreakdown } from "@/lib/organizer/event-metrics";
```

(adicionar ao import existente no topo do arquivo, junto com os outros nomes importados de `@/lib/organizer/event-metrics`)

```ts
describe("computeShirtSizeBreakdown", () => {
  it("always returns all 6 sizes plus 'sem tamanho', in fixed order, zero-filled", () => {
    const result = computeShirtSizeBreakdown([]);
    expect(result).toEqual([
      { size: "PP", label: "PP", count: 0 },
      { size: "P", label: "P", count: 0 },
      { size: "M", label: "M", count: 0 },
      { size: "G", label: "G", count: 0 },
      { size: "GG", label: "GG", count: 0 },
      { size: "XGG", label: "XGG", count: 0 },
      { size: "SEM_TAMANHO", label: "Sem tamanho informado", count: 0 },
    ]);
  });

  it("counts registrations per size and groups null shirtSize under 'sem tamanho'", () => {
    const result = computeShirtSizeBreakdown([
      { shirtSize: "M" },
      { shirtSize: "M" },
      { shirtSize: "G" },
      { shirtSize: null },
      { shirtSize: null },
    ]);

    const bySize = new Map(result.map((r) => [r.size, r.count]));
    expect(bySize.get("M")).toBe(2);
    expect(bySize.get("G")).toBe(1);
    expect(bySize.get("SEM_TAMANHO")).toBe(2);
    expect(bySize.get("PP")).toBe(0);
    expect(bySize.get("P")).toBe(0);
    expect(bySize.get("GG")).toBe(0);
    expect(bySize.get("XGG")).toBe(0);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- organizer-event-metrics`
Expected: FAIL with `computeShirtSizeBreakdown is not a function` (or import error)

- [x] **Step 3: Implement the helper**

Adicionar em `lib/organizer/event-metrics.ts`, após `buildPaymentMethodSummary`:

```ts
const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XGG"] as const;

export interface ShirtSizeStat {
  size: string;
  label: string;
  count: number;
}

export function computeShirtSizeBreakdown(
  registrations: { shirtSize: string | null }[]
): ShirtSizeStat[] {
  const counts = new Map<string, number>();
  for (const r of registrations) {
    const key = r.shirtSize ?? "SEM_TAMANHO";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sized = SHIRT_SIZES.map((size) => ({
    size,
    label: size,
    count: counts.get(size) ?? 0,
  }));

  return [
    ...sized,
    { size: "SEM_TAMANHO", label: "Sem tamanho informado", count: counts.get("SEM_TAMANHO") ?? 0 },
  ];
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- organizer-event-metrics`
Expected: PASS (todos os testes do arquivo, incluindo os pré-existentes)

- [x] **Step 5: Commit**

```bash
git add lib/organizer/event-metrics.ts tests/organizer-event-metrics.test.ts
git commit -m "feat: helper computeShirtSizeBreakdown para relatorio de camisetas por evento"
```

---

### Task 2: Card "Camisetas" na página do organizador

**Files:**
- Modify: `app/organizador/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `computeShirtSizeBreakdown` e `ShirtSizeStat` de `lib/organizer/event-metrics` (Task 1).
- Produces: nada consumido por outras tasks (Task 3 é independente, mesmo helper).

- [x] **Step 1: Incluir `shirtSize` na query `dimensionRegistrations`**

Em `app/organizador/eventos/[id]/page.tsx`, no `Promise.all` (linha ~73-76), o item
`db.registration.findMany` para `dimensionRegistrations` tem hoje:

```ts
    db.registration.findMany({
      where: { eventId: id, status: "CONFIRMED" },
      select: { routeId: true, categoryId: true, ticketBatchId: true, order: { select: { subtotalAmount: true } } },
    }),
```

Trocar o `select` para incluir `shirtSize: true`:

```ts
    db.registration.findMany({
      where: { eventId: id, status: "CONFIRMED" },
      select: { routeId: true, categoryId: true, ticketBatchId: true, shirtSize: true, order: { select: { subtotalAmount: true } } },
    }),
```

- [x] **Step 2: Importar o helper e calcular o breakdown**

No import existente (linha ~12-17):

```ts
import {
  computeRegistrationStatusBreakdown,
  computeSlotsInfo,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
} from "@/lib/organizer/event-metrics";
```

Acrescentar `computeShirtSizeBreakdown`:

```ts
import {
  computeRegistrationStatusBreakdown,
  computeSlotsInfo,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
  computeShirtSizeBreakdown,
} from "@/lib/organizer/event-metrics";
```

Logo após o bloco que calcula `byRoute, byCategory, byTicketBatch` (linha ~113-120),
acrescentar:

```ts
  const shirtSizeBreakdown = computeShirtSizeBreakdown(
    dimensionRegistrations.map((r) => ({ shirtSize: r.shirtSize })),
  );
```

- [x] **Step 3: Dividir a grade e inserir o card**

A grade atual (linhas ~277-392) é:

```tsx
      {/* Grade: Lotes / Percursos / Categorias / Cupons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Lotes */}
        <div className="card space-y-3">
          ...
        </div>

        {/* Percursos */}
        <div className="card space-y-3">
          ...
        </div>

        {/* Categorias */}
        <div className="card space-y-3">
          ...
        </div>

        {/* Cupons — card compacto */}
        <div className="card space-y-3">
          ...
        </div>

        {/* Tipo de pagamento */}
        <div className="card space-y-3">
          ...
        </div>
      </div>
```

Trocar por três blocos, com o card de Camisetas em largura total entre o primeiro e o
segundo grid (manter o conteúdo interno de cada card `Lotes`, `Percursos`,
`Categorias`, `Cupons`, `Tipo de pagamento` exatamente como está hoje, só mudando os
divs que os agrupam):

```tsx
      {/* Grade: Lotes / Percursos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Lotes */}
        <div className="card space-y-3">
          ... (conteúdo inalterado)
        </div>

        {/* Percursos */}
        <div className="card space-y-3">
          ... (conteúdo inalterado)
        </div>
      </div>

      {/* Camisetas — inscrições confirmadas por tamanho */}
      <div className="card space-y-3">
        <h2 className="font-semibold">Camisetas</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {shirtSizeBreakdown.map((s) => (
            <div key={s.size} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary-600">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Grade: Categorias / Cupons / Tipo de pagamento */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Categorias */}
        <div className="card space-y-3">
          ... (conteúdo inalterado)
        </div>

        {/* Cupons — card compacto */}
        <div className="card space-y-3">
          ... (conteúdo inalterado)
        </div>

        {/* Tipo de pagamento */}
        <div className="card space-y-3">
          ... (conteúdo inalterado)
        </div>
      </div>
```

- [x] **Step 4: Rodar typecheck e a suíte de testes**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a este arquivo.

Run: `npm test`
Expected: PASS (nenhum teste existente quebrado — não há teste de página dedicado para este arquivo).

- [x] **Step 5: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/organizador/eventos/<id>` de um evento com inscrições
confirmadas (qualquer evento existente no banco de dev). Confirmar:
- Card "Camisetas" aparece abaixo da linha Lotes/Percursos e acima da linha
  Categorias/Cupons/Tipo de pagamento.
- Os 7 blocos aparecem, com contagem 0 nos tamanhos sem inscrição.
- Layout não estoura em mobile (largura estreita) nem em desktop.

- [x] **Step 6: Commit**

```bash
git add "app/organizador/eventos/[id]/page.tsx"
git commit -m "feat: card de camisetas por tamanho na pagina de gerenciamento do organizador"
```

---

### Task 3: Card "Camisetas" na página do admin

**Files:**
- Modify: `app/admin/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `computeShirtSizeBreakdown` e `ShirtSizeStat` de `lib/organizer/event-metrics` (Task 1).
- Produces: nada.

- [x] **Step 1: Incluir `shirtSize` na query `dimensionRegistrations`**

Em `app/admin/eventos/[id]/page.tsx`, no `Promise.all` (linha ~57-60):

```ts
    db.registration.findMany({
      where: { eventId: id, status: "CONFIRMED" },
      select: { routeId: true, categoryId: true, ticketBatchId: true, order: { select: { subtotalAmount: true } } },
    }),
```

Trocar o `select` para incluir `shirtSize: true`, igual à Task 2:

```ts
    db.registration.findMany({
      where: { eventId: id, status: "CONFIRMED" },
      select: { routeId: true, categoryId: true, ticketBatchId: true, shirtSize: true, order: { select: { subtotalAmount: true } } },
    }),
```

- [x] **Step 2: Importar o helper e calcular o breakdown**

No import existente (linha ~10-14):

```ts
import {
  computeRegistrationStatusBreakdown,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
} from "@/lib/organizer/event-metrics";
```

Acrescentar `computeShirtSizeBreakdown`:

```ts
import {
  computeRegistrationStatusBreakdown,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
  computeShirtSizeBreakdown,
} from "@/lib/organizer/event-metrics";
```

Logo após o bloco que calcula `byRoute, byCategory, byTicketBatch` (linha ~98-104),
acrescentar:

```ts
  const shirtSizeBreakdown = computeShirtSizeBreakdown(
    dimensionRegistrations.map((r) => ({ shirtSize: r.shirtSize })),
  );
```

- [x] **Step 3: Inserir o card após a grade que contém Percursos**

A grade atual (linhas ~233-280) termina assim:

```tsx
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Tipo de pagamento</h2>
          ...
        </div>
      </div>

      <div className="flex gap-3">
        <Link href={`/admin/eventos/${event.id}/inscritos`} className="btn-secondary text-sm">
```

Inserir o novo card entre o `</div>` que fecha a grade e o `<div className="flex gap-3">`
de ações:

```tsx
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Tipo de pagamento</h2>
          ...
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-sm">Camisetas</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {shirtSizeBreakdown.map((s) => (
            <div key={s.size} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary-600">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <Link href={`/admin/eventos/${event.id}/inscritos`} className="btn-secondary text-sm">
```

- [x] **Step 4: Rodar typecheck e a suíte de testes**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a este arquivo.

Run: `npm test`
Expected: PASS.

- [x] **Step 5: Conferir visualmente no navegador**

Com `npm run dev` já rodando, abrir `/admin/eventos/<id>` do mesmo evento usado na
Task 2. Confirmar:
- Card "Camisetas" aparece logo abaixo da grade que contém "Percursos" (e abaixo de
  "Tipo de pagamento", último card da grade), acima do bloco de ações
  "Ver inscritos / Exportar CSV / Ver página pública".
- Os 7 blocos e as contagens batem com o que apareceu na página do organizador para o
  mesmo evento.

- [x] **Step 6: Commit**

```bash
git add "app/admin/eventos/[id]/page.tsx"
git commit -m "feat: card de camisetas por tamanho na pagina de detalhe do evento no admin"
```

---

## Self-Review Notes

- **Spec coverage:** helper com 7 linhas fixas (Task 1) ✓; posição no organizador —
  full-width entre as duas grades (Task 2) ✓; posição no admin — após a grade com
  Percursos, sem mover o card de Cupons (Task 3) ✓; sem link "Gerenciar" ✓; sem query
  nova (reaproveita `dimensionRegistrations`, só acrescenta `shirtSize` ao `select`) ✓.
- **Placeholder scan:** nenhum "TBD"/"similar to Task N" — cada task tem o JSX/código
  completo a ser inserido.
- **Type consistency:** `ShirtSizeStat { size, label, count }` usado de forma idêntica
  nas Tasks 2 e 3; `computeShirtSizeBreakdown(registrations: { shirtSize: string | null }[])`
  consumido com o mesmo shape (`{ shirtSize: r.shirtSize }`) nas duas páginas.
