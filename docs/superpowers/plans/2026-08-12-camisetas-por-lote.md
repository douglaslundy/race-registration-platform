# Camisetas por lote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No card "Camisetas" (organizador e admin), adicionar um toggle que troca a
visão agregada de hoje por uma tabela com a contagem de cada tamanho separada por lote.

**Architecture:** Um novo helper puro `computeShirtSizeBreakdownByBatch()` em
`lib/organizer/event-metrics.ts`, ao lado do `computeShirtSizeBreakdown` já existente.
Um novo client component `ShirtSizeReportCard` recebe os dois formatos já calculados
(agregado + por lote) como props e faz o toggle localmente (sem round-trip ao servidor).
As duas páginas de evento passam a montar `shirtSizeByBatch` com os dados que já buscam
hoje (sem query nova) e trocam o card inline atual pelo componente novo.

**Tech Stack:** Next.js App Router (Server + Client Components), Vitest.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-12-camisetas-por-lote-design.md`.
- Sem query nova no banco — `dimensionRegistrations` já tem `shirtSize`/`ticketBatchId`,
  `event.ticketBatches` já é buscado nas duas páginas.
- Toggle só aparece quando há mais de 1 lote (`byBatch.length > 1`); com 0 ou 1 lote, só
  a visão agregada é mostrada (sem botão de toggle).
- Cada lote sempre retorna as 7 linhas fixas (`PP, P, M, G, GG, XGG, Sem tamanho
  informado`), mesmo zerado — mesmo padrão do helper agregado existente.
- Mesma extensão nas duas páginas: `app/organizador/eventos/[id]/page.tsx` e
  `app/admin/eventos/[id]/page.tsx`.

---

### Task 1: Helper `computeShirtSizeBreakdownByBatch`

**Files:**
- Modify: `lib/organizer/event-metrics.ts`
- Test: `tests/organizer-event-metrics.test.ts`

**Interfaces:**
- Consumes: `computeShirtSizeBreakdown` (já existe no mesmo arquivo).
- Produces:
  - `export interface ShirtSizeByBatch { batchId: string; batchName: string; sizes: ShirtSizeStat[] }`
  - `export function computeShirtSizeBreakdownByBatch(registrations: { shirtSize: string | null; ticketBatchId: string }[], batches: { id: string; name: string }[]): ShirtSizeByBatch[]`
  - Consumido por Task 2 e Task 3 (as duas páginas).

- [ ] **Step 1: Write the failing tests**

Acrescentar ao final de `tests/organizer-event-metrics.test.ts` (o import no topo do
arquivo já traz vários nomes de `@/lib/organizer/event-metrics` — acrescentar
`computeShirtSizeBreakdownByBatch` a esse import existente):

```ts
describe("computeShirtSizeBreakdownByBatch", () => {
  it("agrupa por lote, cada um com as 7 linhas fixas, na ordem de 'batches'", () => {
    const result = computeShirtSizeBreakdownByBatch(
      [
        { shirtSize: "M", ticketBatchId: "batch-2" },
        { shirtSize: "M", ticketBatchId: "batch-1" },
        { shirtSize: "G", ticketBatchId: "batch-1" },
        { shirtSize: null, ticketBatchId: "batch-1" },
      ],
      [
        { id: "batch-1", name: "Lote 1" },
        { id: "batch-2", name: "Lote 2" },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result[0].batchId).toBe("batch-1");
    expect(result[0].batchName).toBe("Lote 1");
    expect(result[0].sizes).toHaveLength(7);
    const batch1BySize = new Map(result[0].sizes.map((s) => [s.size, s.count]));
    expect(batch1BySize.get("M")).toBe(1);
    expect(batch1BySize.get("G")).toBe(1);
    expect(batch1BySize.get("SEM_TAMANHO")).toBe(1);
    expect(batch1BySize.get("PP")).toBe(0);

    expect(result[1].batchId).toBe("batch-2");
    const batch2BySize = new Map(result[1].sizes.map((s) => [s.size, s.count]));
    expect(batch2BySize.get("M")).toBe(1);
    expect(batch2BySize.get("G")).toBe(0);
  });

  it("inclui lotes sem nenhuma inscrição, com todos os tamanhos zerados", () => {
    const result = computeShirtSizeBreakdownByBatch(
      [{ shirtSize: "G", ticketBatchId: "batch-1" }],
      [
        { id: "batch-1", name: "Lote 1" },
        { id: "batch-2", name: "Lote vazio" },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result[1].batchName).toBe("Lote vazio");
    expect(result[1].sizes.every((s) => s.count === 0)).toBe(true);
  });

  it("retorna array vazio quando não há lotes", () => {
    const result = computeShirtSizeBreakdownByBatch([{ shirtSize: "G", ticketBatchId: "batch-1" }], []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/organizer-event-metrics.test.ts`
Expected: FAIL — `computeShirtSizeBreakdownByBatch is not a function` (ou erro de import).

- [ ] **Step 3: Implementar o helper**

Em `lib/organizer/event-metrics.ts`, logo após a função `computeShirtSizeBreakdown`
existente:

```ts
export interface ShirtSizeByBatch {
  batchId: string;
  batchName: string;
  sizes: ShirtSizeStat[];
}

export function computeShirtSizeBreakdownByBatch(
  registrations: { shirtSize: string | null; ticketBatchId: string }[],
  batches: { id: string; name: string }[],
): ShirtSizeByBatch[] {
  const byBatchId = new Map<string, { shirtSize: string | null }[]>();
  for (const r of registrations) {
    const list = byBatchId.get(r.ticketBatchId) ?? [];
    list.push({ shirtSize: r.shirtSize });
    byBatchId.set(r.ticketBatchId, list);
  }

  return batches.map((batch) => ({
    batchId: batch.id,
    batchName: batch.name,
    sizes: computeShirtSizeBreakdown(byBatchId.get(batch.id) ?? []),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/organizer-event-metrics.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os pré-existentes).

- [ ] **Step 5: Commit**

```bash
git add lib/organizer/event-metrics.ts tests/organizer-event-metrics.test.ts
git commit -m "feat: helper computeShirtSizeBreakdownByBatch para quebra de camisetas por lote"
```

---

### Task 2: Componente `ShirtSizeReportCard` + integração na página do organizador

**Files:**
- Create: `components/ui/ShirtSizeReportCard.tsx`
- Modify: `app/organizador/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `computeShirtSizeBreakdownByBatch` e `ShirtSizeByBatch` de
  `lib/organizer/event-metrics` (Task 1); `computeShirtSizeBreakdown`/`ShirtSizeStat` já
  usados hoje na página.
- Produces: `ShirtSizeReportCard` (componente), consumido também por Task 3.

- [ ] **Step 1: Criar o componente**

Criar `components/ui/ShirtSizeReportCard.tsx`:

```tsx
"use client";

import { useState } from "react";

interface ShirtSizeStat {
  size: string;
  label: string;
  count: number;
}

interface ShirtSizeByBatch {
  batchId: string;
  batchName: string;
  sizes: ShirtSizeStat[];
}

export default function ShirtSizeReportCard({
  overall,
  byBatch,
  headingClassName = "font-semibold",
}: {
  overall: ShirtSizeStat[];
  byBatch: ShirtSizeByBatch[];
  headingClassName?: string;
}) {
  const [byLote, setByLote] = useState(false);
  const showToggle = byBatch.length > 1;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className={headingClassName}>Camisetas</h2>
        {showToggle && (
          <button
            type="button"
            onClick={() => setByLote((v) => !v)}
            className="text-xs text-primary-600 hover:underline"
          >
            {byLote ? "Ver total" : "Ver por lote"}
          </button>
        )}
      </div>

      {!byLote || !showToggle ? (
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {overall.map((s) => (
            <div key={s.size} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary-600">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5 break-words leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 pr-3">Lote</th>
                {overall.map((s) => (
                  <th key={s.size} className="pb-2 pr-3 text-center">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byBatch.map((b) => (
                <tr key={b.batchId} className="border-b dark:border-gray-700 last:border-0">
                  <td className="py-2 pr-3 font-medium">{b.batchName}</td>
                  {b.sizes.map((s) => (
                    <td key={s.size} className="py-2 pr-3 text-center text-gray-700">{s.count}</td>
                  ))}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 pr-3">Total</td>
                {overall.map((s) => (
                  <td key={s.size} className="py-2 pr-3 text-center">{s.count}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Calcular `shirtSizeByBatch` e importar o componente**

Em `app/organizador/eventos/[id]/page.tsx`, no import existente de
`@/lib/organizer/event-metrics` (mesma linha que já importa `computeShirtSizeBreakdown`),
acrescentar `computeShirtSizeBreakdownByBatch`:

```ts
import {
  computeRegistrationStatusBreakdown,
  computeSlotsInfo,
  computeDimensionBreakdowns,
  buildPaymentMethodSummary,
  computeShirtSizeBreakdown,
  computeShirtSizeBreakdownByBatch,
} from "@/lib/organizer/event-metrics";
```

Acrescentar o import do componente novo, junto aos outros imports de componentes no topo
do arquivo:

```ts
import ShirtSizeReportCard from "@/components/ui/ShirtSizeReportCard";
```

Logo após o bloco que já calcula `shirtSizeBreakdown` (linha ~122-124 atual):

```ts
  const shirtSizeBreakdown = computeShirtSizeBreakdown(
    dimensionRegistrations.map((r) => ({ shirtSize: r.shirtSize })),
  );
  const shirtSizeByBatch = computeShirtSizeBreakdownByBatch(
    dimensionRegistrations.map((r) => ({ shirtSize: r.shirtSize, ticketBatchId: r.ticketBatchId })),
    event.ticketBatches.map((b) => ({ id: b.id, name: b.name })),
  );
```

- [ ] **Step 3: Trocar o card inline pelo componente**

O card atual (linhas ~334-345 atuais):

```tsx
      {/* Camisetas — inscrições confirmadas por tamanho */}
      <div className="card space-y-3">
        <h2 className="font-semibold">Camisetas</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {shirtSizeBreakdown.map((s) => (
            <div key={s.size} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary-600">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5 break-words leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
```

Trocar por:

```tsx
      {/* Camisetas — inscrições confirmadas por tamanho */}
      <ShirtSizeReportCard overall={shirtSizeBreakdown} byBatch={shirtSizeByBatch} />
```

- [ ] **Step 4: Rodar typecheck e a suíte de testes**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 5: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/organizador/eventos/<id>` de um evento com pelo menos 2 lotes
e inscrições confirmadas em tamanhos diferentes. Confirmar:
- Card "Camisetas" mostra os 7 blocos normalmente, com o botão "Ver por lote" no canto.
- Clicar no botão troca pra tabela com uma linha por lote + linha "Total" batendo com os
  7 blocos de antes.
- Clicar em "Ver total" volta pro modo agregado.
- Testar também um evento com só 1 lote: o botão de toggle não aparece.

- [ ] **Step 6: Commit**

```bash
git add components/ui/ShirtSizeReportCard.tsx "app/organizador/eventos/[id]/page.tsx"
git commit -m "feat: toggle de camisetas por lote no card do organizador"
```

---

### Task 3: Integração na página do admin

**Files:**
- Modify: `app/admin/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `ShirtSizeReportCard` (Task 2) e `computeShirtSizeBreakdownByBatch` (Task 1).
- Produces: nada.

- [ ] **Step 1: Calcular `shirtSizeByBatch` e importar o componente**

Em `app/admin/eventos/[id]/page.tsx`, no import existente de `@/lib/organizer/event-metrics`
(mesma linha que já importa `computeShirtSizeBreakdown`), acrescentar
`computeShirtSizeBreakdownByBatch`, igual à Task 2.

Acrescentar o import do componente:

```ts
import ShirtSizeReportCard from "@/components/ui/ShirtSizeReportCard";
```

Logo após o bloco que já calcula `shirtSizeBreakdown` (linha ~110 atual):

```ts
  const shirtSizeBreakdown = computeShirtSizeBreakdown(
    dimensionRegistrations.map((r) => ({ shirtSize: r.shirtSize })),
  );
  const shirtSizeByBatch = computeShirtSizeBreakdownByBatch(
    dimensionRegistrations.map((r) => ({ shirtSize: r.shirtSize, ticketBatchId: r.ticketBatchId })),
    event.ticketBatches.map((b) => ({ id: b.id, name: b.name })),
  );
```

- [ ] **Step 2: Trocar o card inline pelo componente**

O card atual (linhas ~286-296 atuais):

```tsx
      <div className="card space-y-3">
        <h2 className="font-semibold text-sm">Camisetas</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {shirtSizeBreakdown.map((s) => (
            <div key={s.size} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary-600">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5 break-words leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
```

Trocar por (usa `headingClassName="font-semibold text-sm"` pra manter o tamanho de
título já usado pelos outros cards do admin, igual foi feito quando o card "Camisetas"
original foi adicionado nessa página):

```tsx
      <ShirtSizeReportCard
        overall={shirtSizeBreakdown}
        byBatch={shirtSizeByBatch}
        headingClassName="font-semibold text-sm"
      />
```

- [ ] **Step 3: Rodar typecheck e a suíte de testes**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 4: Conferir visualmente no navegador**

Com `npm run dev` já rodando, abrir `/admin/eventos/<id>` do mesmo evento usado na Task 2.
Confirmar que o toggle funciona igual, e que os números batem com os vistos na página do
organizador pro mesmo evento.

- [ ] **Step 5: Commit**

```bash
git add "app/admin/eventos/[id]/page.tsx"
git commit -m "feat: toggle de camisetas por lote no card do admin"
```

---

## Self-Review Notes

- **Spec coverage:** helper agrupado por lote com 7 linhas fixas mesmo zerado (Task 1) ✓;
  toggle só quando `byBatch.length > 1` (Task 2) ✓; mesma extensão nas duas páginas
  (Task 2 + Task 3) ✓; sem query nova em nenhuma das duas páginas ✓.
- **Placeholder scan:** nenhum "TBD"/"similar to Task N" — cada task tem o código
  completo a ser inserido.
- **Type consistency:** `ShirtSizeByBatch { batchId, batchName, sizes: ShirtSizeStat[] }`
  usado de forma idêntica em Task 1 (produção), Task 2 e Task 3 (consumo);
  `ShirtSizeReportCard` recebe exatamente `overall`/`byBatch`/`headingClassName?` nas duas
  integrações, com o mesmo componente reaproveitado sem duplicação.
