# Filtros de status (ativa/encerrada) e estado — Página Pública de Eventos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar filtros de status (ativa/encerrada) e estado (UF, em cascata com cidade) na
página pública `/eventos`, permitindo pela primeira vez listar eventos já encerrados
(`REGISTRATIONS_CLOSED`, `COMPLETED`).

**Architecture:** Duas mudanças em `lib/events.ts` (filtro de status/estado em `listPublicEvents`,
ampliação de `listDistinctCities` → `listDistinctLocations`), um badge novo em `EventCard.tsx`,
dois selects novos + lógica de cascata em `EventFilters.tsx` (client component, sem chamada de
rede extra — cascata 100% sobre os dados já carregados), e o wiring dos novos `searchParams` em
`app/(public)/eventos/page.tsx`.

**Tech Stack:** Next.js 15 App Router (server components + client component com
`useSearchParams`/`router.push`), Prisma, Vitest (mock global de `db` via `tests/setup.ts`).

## Global Constraints

- Nunca usar `alert()`/`confirm()`/`prompt()` nativos — não se aplica a este spec (nenhum diálogo
  envolvido), mas mantido aqui por ser regra permanente do projeto (`CLAUDE.md`).
- Ativa (padrão, sem filtro) = `PUBLISHED`, `REGISTRATIONS_OPEN`, `SOLD_OUT`. Encerrada =
  `REGISTRATIONS_CLOSED`, `COMPLETED`. `DRAFT`, `UNDER_REVIEW`, `CANCELLED` nunca aparecem no
  público.
- Filtro de estado: comparação exata case-insensitive (`equals` + `mode: "insensitive"`), não
  `contains`.
- Ordenação: `startAt asc` pra ativa (comportamento atual), `startAt desc` pra encerrada.
- Sem opção "todas" combinando ativa+encerrada — só as duas opções separadas.
- Lista de estados/cidades: dinâmica, derivada dos eventos listáveis existentes — nunca lista fixa
  de 27 UFs.
- Cidade em cascata com estado: trocar de estado limpa a cidade selecionada se ela não pertencer
  ao novo estado.
- Fora de escopo: normalizar o campo `Event.state` no cadastro do organizador; filtro "todas";
  qualquer mudança nas listagens do admin/organizador (`/admin/eventos`, `/organizador/eventos`).

Spec completa: `docs/superpowers/specs/2026-07-17-filtros-eventos-publicos-design.md`.

---

## Task 1: `listPublicEvents` — filtro de status e estado, ordenação condicional

**Files:**
- Modify: `lib/events.ts:4-59`
- Test: `tests/lib-events.test.ts` (criar)

**Interfaces:**
- Produces: `EventFilters` interface (`city?, state?, modality?, from?, to?, status?: "ativa" |
  "encerrada", page?, pageSize?`) e `listPublicEvents(filters: EventFilters)` — consumido pela
  Task 4 (`app/(public)/eventos/page.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-events.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { listPublicEvents } from "@/lib/events";

const dbMock = db as any;

describe("listPublicEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.findMany.mockResolvedValue([]);
    dbMock.event.count.mockResolvedValue(0);
  });

  it("sem filtro de status, usa o conjunto ativa (comportamento atual) ordenado por startAt asc", async () => {
    await listPublicEvents({});

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"] },
        }),
        orderBy: { startAt: "asc" },
      })
    );
  });

  it('status: "ativa" explícito usa o mesmo conjunto e ordenação que o padrão', async () => {
    await listPublicEvents({ status: "ativa" });

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"] },
        }),
        orderBy: { startAt: "asc" },
      })
    );
  });

  it('status: "encerrada" filtra REGISTRATIONS_CLOSED/COMPLETED e ordena startAt desc', async () => {
    await listPublicEvents({ status: "encerrada" });

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["REGISTRATIONS_CLOSED", "COMPLETED"] },
        }),
        orderBy: { startAt: "desc" },
      })
    );
  });

  it("filtro de estado usa comparação exata case-insensitive, não contains", async () => {
    await listPublicEvents({ state: "sp" });

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: { equals: "sp", mode: "insensitive" },
        }),
      })
    );
  });

  it("sem filtro de estado, não inclui a chave state no where", async () => {
    await listPublicEvents({});

    const call = dbMock.event.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty("state");
  });

  it("combina estado com cidade e modalidade sem conflito", async () => {
    await listPublicEvents({ state: "RJ", city: "Niterói", modality: "TRAIL_RUN" as any });

    expect(dbMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: { equals: "RJ", mode: "insensitive" },
          city: { contains: "Niterói", mode: "insensitive" },
          modality: "TRAIL_RUN",
        }),
      })
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-events.test.ts`
Expected: FAIL — `state` ausente do `where`, `orderBy` sempre `asc`, `status.in` sempre o array
fixo atual (os 2 primeiros testes passam por acidente já que replicam o comportamento atual; os
outros 4 falham).

- [ ] **Step 3: Implementar**

Substituir em `lib/events.ts` (linhas 1-28 atuais):

```ts
import { db } from "./db";
import type { EventModality, EventStatus } from "@prisma/client";

const ACTIVE_STATUSES: EventStatus[] = ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"];
const CLOSED_STATUSES: EventStatus[] = ["REGISTRATIONS_CLOSED", "COMPLETED"];

export interface EventFilters {
  city?: string;
  state?: string;
  modality?: EventModality;
  from?: Date;
  to?: Date;
  status?: "ativa" | "encerrada";
  page?: number;
  pageSize?: number;
}

export async function listPublicEvents(filters: EventFilters = {}) {
  const { city, state, modality, from, to, status, page = 1, pageSize = 12 } = filters;
  const isClosed = status === "encerrada";

  const where = {
    status: { in: isClosed ? CLOSED_STATUSES : ACTIVE_STATUSES },
    ...(city ? { city: { contains: city, mode: "insensitive" as const } } : {}),
    ...(state ? { state: { equals: state, mode: "insensitive" as const } } : {}),
    ...(modality ? { modality } : {}),
    ...(from || to
      ? {
          startAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [events, total] = await Promise.all([
    db.event.findMany({
      where,
      orderBy: { startAt: isClosed ? "desc" : "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        slug: true,
        modality: true,
        status: true,
        startAt: true,
        city: true,
        state: true,
        bannerUrl: true,
        listBannerUrl: true,
        ticketBatches: {
          where: { active: true },
          orderBy: { priceAmount: "asc" },
          take: 1,
          select: { priceAmount: true, soldCount: true, capacity: true },
        },
      },
    }),
    db.event.count({ where }),
  ]);

  return { events, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
```

(O restante do arquivo — `getEventBySlug` — não muda nesta task.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-events.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add lib/events.ts tests/lib-events.test.ts
git commit -m "feat: add status and state filters to listPublicEvents"
```

---

## Task 2: `listDistinctCities` → `listDistinctLocations` (ampliar status cobertos)

**Files:**
- Modify: `lib/events.ts:83-91` (função `listDistinctCities`)
- Test: `tests/lib-events.test.ts` (adicionar `describe` nesse mesmo arquivo criado na Task 1)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `listDistinctLocations(): Promise<{ city: string; state: string }[]>` — consumido pela
  Task 4 (`page.tsx`) e indiretamente pela Task 3 (`EventFilters` recebe o resultado como prop
  `locations`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `tests/lib-events.test.ts`:

```ts
import { listDistinctLocations } from "@/lib/events";

describe("listDistinctLocations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.event.findMany.mockResolvedValue([]);
  });

  it("busca cidades/estados cobrindo tanto status ativos quanto encerrados", async () => {
    await listDistinctLocations();

    expect(dbMock.event.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT", "REGISTRATIONS_CLOSED", "COMPLETED"],
        },
      },
      select: { city: true, state: true },
      distinct: ["city"],
      orderBy: { city: "asc" },
    });
  });
});
```

(Ajustar o `import` no topo do arquivo pra trazer `listDistinctLocations` junto com
`listPublicEvents` numa linha só.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/lib-events.test.ts`
Expected: FAIL — função `listDistinctLocations` não existe ainda (erro de import/undefined).

- [ ] **Step 3: Implementar**

Em `lib/events.ts`, renomear `listDistinctCities` para `listDistinctLocations` e ampliar o filtro
de status:

```ts
export async function listDistinctLocations() {
  const results = await db.event.findMany({
    where: { status: { in: [...ACTIVE_STATUSES, ...CLOSED_STATUSES] } },
    select: { city: true, state: true },
    distinct: ["city"],
    orderBy: { city: "asc" },
  });
  return results;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/lib-events.test.ts`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add lib/events.ts tests/lib-events.test.ts
git commit -m "feat: rename listDistinctCities to listDistinctLocations, cover closed statuses"
```

---

## Task 3: `EventCard.tsx` — badge para status `COMPLETED`

**Files:**
- Modify: `components/events/EventCard.tsx:46-51`

**Interfaces:**
- Consumes: nada de tasks anteriores (mudança isolada e independente).
- Produces: nada consumido por outras tasks.

Sem teste automatizado — não há testes de componente React neste repo (confirmado: nenhum
`tests/*.tsx`, UI é verificada manualmente no navegador). Verificação: passo 2 abaixo.

- [ ] **Step 1: Adicionar a entrada no mapa de badges**

Em `components/events/EventCard.tsx`, dentro de `STATUS_BADGE` (linha 46-51):

```ts
const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  REGISTRATIONS_OPEN: { label: "Inscrições abertas", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  SOLD_OUT: { label: "Esgotado", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  PUBLISHED: { label: "Em breve", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  REGISTRATIONS_CLOSED: { label: "Encerrado", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  COMPLETED: { label: "Realizado", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};
```

- [ ] **Step 2: Verificar visualmente**

Não roda testes automatizados nesta task. A verificação acontece na Task 5 (passo final de
navegador), quando o filtro "Encerradas" já estiver disponível na UI pra de fato mostrar um evento
`COMPLETED` na listagem.

- [ ] **Step 3: Commit**

```bash
git add components/events/EventCard.tsx
git commit -m "feat: add COMPLETED status badge to EventCard"
```

---

## Task 4: `EventFilters.tsx` — selects de Status e Estado, cascata com Cidade

**Files:**
- Modify: `components/events/EventFilters.tsx`

**Interfaces:**
- Consumes: prop `locations: { city: string; state: string }[]` (produzida por
  `listDistinctLocations`, Task 2) no lugar da prop `cities` atual.
- Produces: nada consumido por outras tasks (folha da árvore de componentes).

Sem teste automatizado (mesmo motivo da Task 3). Verificação: Task 5.

- [ ] **Step 1: Reescrever o componente**

Substituir o conteúdo de `components/events/EventFilters.tsx` inteiro por:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

const MODALITIES = [
  { value: "", label: "Todas modalidades" },
  { value: "ROAD_RACE", label: "Corrida de Rua" },
  { value: "TRAIL_RUN", label: "Trail Run" },
  { value: "MTB", label: "MTB" },
  { value: "CYCLING", label: "Ciclismo" },
  { value: "WALK", label: "Caminhada" },
  { value: "TRIATHLON", label: "Triathlon" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Ativas" },
  { value: "encerrada", label: "Encerradas" },
];

interface EventFiltersProps {
  locations: { city: string; state: string }[];
}

export default function EventFilters({ locations }: EventFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedState = searchParams.get("estado") || "";

  const states = useMemo(
    () => Array.from(new Set(locations.map((l) => l.state))).sort(),
    [locations]
  );

  const cities = useMemo(
    () =>
      selectedState
        ? locations.filter((l) => l.state === selectedState)
        : locations,
    [locations, selectedState]
  );

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("pagina");
      router.push(`/eventos?${params.toString()}`);
    },
    [router, searchParams]
  );

  const updateState = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("estado", value);
      } else {
        params.delete("estado");
      }
      const currentCity = params.get("cidade");
      if (currentCity) {
        const cityStillValid = locations.some(
          (l) => l.city === currentCity && (!value || l.state === value)
        );
        if (!cityStillValid) {
          params.delete("cidade");
        }
      }
      params.delete("pagina");
      router.push(`/eventos?${params.toString()}`);
    },
    [router, searchParams, locations]
  );

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">Filtros</h3>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
        <select
          className="input-field"
          value={searchParams.get("status") || ""}
          onChange={(e) => updateFilter("status", e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado</label>
        <select
          className="input-field"
          value={selectedState}
          onChange={(e) => updateState(e.target.value)}
        >
          <option value="">Todos os estados</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modalidade</label>
        <select
          className="input-field"
          value={searchParams.get("modalidade") || ""}
          onChange={(e) => updateFilter("modalidade", e.target.value)}
        >
          {MODALITIES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade</label>
        <select
          className="input-field"
          value={searchParams.get("cidade") || ""}
          onChange={(e) => updateFilter("cidade", e.target.value)}
        >
          <option value="">Todas as cidades</option>
          {cities.map((c) => (
            <option key={c.city} value={c.city}>{c.city}/{c.state}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">A partir de</label>
        <input
          type="date"
          className="input-field"
          value={searchParams.get("de") || ""}
          onChange={(e) => updateFilter("de", e.target.value)}
        />
      </div>

      <button
        onClick={() => router.push("/eventos")}
        className="btn-secondary w-full text-sm"
      >
        Limpar filtros
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Confirmar que `tsc` ainda acusa erro nesse ponto (esperado)**

Run: `npx tsc --noEmit`
Expected: erro(s) em `app/(public)/eventos/page.tsx` — a função `listDistinctCities` não existe
mais (renomeada na Task 2) e/ou a prop `cities` não existe em `EventFiltersProps` (renomeada nesta
task). Esperado nesse ponto; corrigido na Task 5. Não commitar ainda com esse erro presente —
seguir direto pra Task 5 antes do commit desta task (as duas ficam num commit só — ver Step 3 da
Task 5).

---

## Task 5: `app/(public)/eventos/page.tsx` — wiring dos novos parâmetros

**Files:**
- Modify: `app/(public)/eventos/page.tsx`

**Interfaces:**
- Consumes: `listPublicEvents` (Task 1), `listDistinctLocations` (Task 2), `EventFilters` com prop
  `locations` (Task 4).

- [ ] **Step 1: Atualizar o arquivo**

```tsx
import type { Metadata } from "next";
import { listPublicEvents, listDistinctLocations } from "@/lib/events";
import EventCard from "@/components/events/EventCard";
import EventFilters from "@/components/events/EventFilters";
import EventsBanner from "@/components/events/EventsBanner";
import OrganizerCTA from "@/components/events/OrganizerCTA";
import { getBannerInterval, getAppName } from "@/lib/settings";
import type { EventModality } from "@prisma/client";

export const metadata: Metadata = { title: "Eventos" };
export const revalidate = 60;

interface SearchParams {
  cidade?: string;
  estado?: string;
  modalidade?: string;
  status?: string;
  de?: string;
  ate?: string;
  pagina?: string;
}

export default async function EventosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  const [{ events, total, totalPages, page }, locations, bannerInterval, appName] = await Promise.all([
    listPublicEvents({
      city: params.cidade,
      state: params.estado,
      modality: params.modalidade as EventModality | undefined,
      status: params.status === "encerrada" ? "encerrada" : undefined,
      from: params.de ? new Date(params.de) : undefined,
      to: params.ate ? new Date(params.ate) : undefined,
      page: params.pagina ? Number(params.pagina) : 1,
    }),
    listDistinctLocations(),
    getBannerInterval(),
    getAppName(),
  ]);

  return (
    <>
    <main className="max-w-7xl mx-auto px-4 py-8">
      <EventsBanner intervalSeconds={bannerInterval} />

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Eventos</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{total} evento{total !== 1 ? "s" : ""} encontrado{total !== 1 ? "s" : ""}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <aside>
          <EventFilters locations={locations} />
        </aside>

        <div className="lg:col-span-3">
          {events.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-lg">Nenhum evento encontrado</p>
              <p className="text-sm mt-2">Tente ajustar os filtros</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex justify-center mt-8 gap-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <a
                      key={p}
                      href={`?pagina=${p}`}
                      className={`px-3 py-1 rounded ${p === page ? "bg-primary-600 text-white" : "bg-white dark:bg-gray-800 border dark:border-gray-700 dark:text-gray-300"}`}
                    >
                      {p}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
    <OrganizerCTA appName={appName} />
    </>
  );
}
```

- [ ] **Step 2: Rodar `tsc --noEmit` e a suíte completa**

Run: `npx tsc --noEmit`
Expected: sem erros (a Task 4 fica limpa agora que o chamador foi atualizado).

Run: `npx vitest run`
Expected: todos os testes passam, incluindo os novos de `tests/lib-events.test.ts`.

- [ ] **Step 3: Commit (Tasks 4 e 5 juntas, já que a 4 fica com erro de tipo até a 5 entrar)**

```bash
git add components/events/EventFilters.tsx app/\(public\)/eventos/page.tsx
git commit -m "feat: wire status and state filters into the public events page"
```

- [ ] **Step 4: Verificação manual no navegador**

Pré-requisito: banco de dev com pelo menos 1 evento `COMPLETED` ou `REGISTRATIONS_CLOSED` e eventos
em >= 2 estados diferentes (criar/ajustar via `/organizador/eventos` ou Prisma Studio se
necessário).

Run: `npm run dev`, abrir `http://localhost:3000/eventos`.

Checklist:
- [ ] Sem filtro: só eventos ativos aparecem (comportamento igual ao de antes da mudança).
- [ ] Selecionar "Encerradas": eventos `REGISTRATIONS_CLOSED`/`COMPLETED` aparecem, ordenados do
  mais recente pro mais antigo; badge "Realizado" aparece nos `COMPLETED`.
- [ ] Selecionar um estado: dropdown de cidade estreita pra só as cidades daquele estado.
- [ ] Selecionar estado, depois trocar pra outro que não tem a cidade atualmente selecionada:
  cidade é limpa automaticamente (verificar na URL e no select).
- [ ] "Limpar filtros": volta pro estado inicial (sem status/estado/cidade/modalidade/data).
- [ ] Testar em dark mode (toggle do tema) — selects/badges legíveis.

- [ ] **Step 5: Atualizar `PROGRESSO.md`**

Marcar o sub-projeto "filtros de eventos" como implementado (não deployado), registrar os commits
das Tasks 1-5, e apontar a próxima tarefa da sessão: brainstorm do 2º sub-projeto (caixa de entrada
de alertas).

```bash
git add PROGRESSO.md
git commit -m "docs: record completion of public events filters sub-project"
```
