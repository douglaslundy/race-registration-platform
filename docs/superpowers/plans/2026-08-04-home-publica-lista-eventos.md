# Home pública lista eventos (Etapa 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The public home page (`/`) shows a preview of the next 6 upcoming events (reusing the
existing `/eventos` listing components), instead of being just a static hero with no event content.

**Architecture:** Single-file change to `app/(public)/page.tsx` — adds a data fetch
(`listPublicEvents({ pageSize: 6 })`, already sorted by soonest-first for non-closed events) and
renders the same `EventCard`/`EventsBanner`/`OrganizerCTA`/`AdSlotRenderer` components `/eventos`
already uses. No new components, no schema change. Two new `AdSlot` rows are needed (data only, no
schema change) — seeded via a manual SQL `INSERT` after deploy, same established pattern as the 5
existing ad slots.

**Tech Stack:** Next.js 16 App Router (Server Component page), Prisma 5, Vitest.

## Global Constraints

- `/eventos` (`app/(public)/eventos/page.tsx`) is NOT modified by this plan — same filters,
  pagination, banner, ad slots, and `OrganizerCTA` as today.
- No native `alert()`/`confirm()`/`prompt()` — not applicable here (no interactive forms on this
  page), but noting the rule per `CLAUDE.md` since it applies to every touched component.
- No schema migration — `AdSlot` table already has every column needed. The 2 new ad slot rows are
  data-only, added via a manual SQL `INSERT` documented at the end of this plan (not automated —
  `AdSlot` has no admin "create new slot" UI; `/admin/anuncios` only lists/configures existing
  rows, per `lib/ad-slots.ts`).
- Full spec: `docs/superpowers/specs/2026-08-04-home-publica-lista-eventos-design.md`.

---

### Task 1: Home page shows a preview of the next 6 events

**Files:**
- Modify: `app/(public)/page.tsx`

**Interfaces:**
- Consumes: `listPublicEvents(filters?: EventFilters)` from `@/lib/events` (already exists;
  `{ pageSize: 6 }` with no other filters returns the 6 soonest-starting non-closed events, already
  sorted `startAt` ascending — see `lib/events.ts:40`); `getBannerInterval()` from `@/lib/settings`
  (already used by `/eventos`); `EventCard` from `@/components/events/EventCard` (prop:
  `{ event: {...} }`, same shape `listPublicEvents` already returns — no mapping needed);
  `EventsBanner` from `@/components/events/EventsBanner` (prop: `{ intervalSeconds: number }`);
  `OrganizerCTA` from `@/components/events/OrganizerCTA` (prop: `{ appName: string }`);
  `AdSlotRenderer` from `@/components/ads/AdSlotRenderer` (prop: `{ position: string }`).
- Produces: nothing new consumed elsewhere — this is a leaf page.

No automated test for this task. This codebase has no precedent for rendering a Next.js Server
Component page in a test (confirmed by searching `tests/` — no file imports and renders a page
component; `IMPLEMENTATION_PLAN.md` §2.6 already documents that page/component-level code has no
dedicated tests in this project). The data-fetching function this task calls,
`listPublicEvents`, already has its own coverage in `tests/lib-events.test.ts` — this task only
supplies it a different (already-supported) argument, not new logic. Verify instead via **Step 3
manual check** (dev server) below.

- [ ] **Step 1: Read the current file**

Read `app/(public)/page.tsx` (already done during planning — reproduced here for reference, do not
skip re-reading the live file in case anything changed) and `app/(public)/eventos/page.tsx` for the
exact import paths/usage patterns of `EventsBanner`, `OrganizerCTA`, `AdSlotRenderer`.

- [ ] **Step 2: Replace `app/(public)/page.tsx` with:**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { getAppName, getSetting, getBannerInterval } from "@/lib/settings";
import JsonLd from "@/components/seo/JsonLd";
import { listPublicEvents } from "@/lib/events";
import EventCard from "@/components/events/EventCard";
import EventsBanner from "@/components/events/EventsBanner";
import OrganizerCTA from "@/components/events/OrganizerCTA";
import AdSlotRenderer from "@/components/ads/AdSlotRenderer";

export async function generateMetadata(): Promise<Metadata> {
  const [appName, defaultTitle, defaultDescription] = await Promise.all([
    getAppName(),
    getSetting("seo_default_title"),
    getSetting("seo_default_description"),
  ]);
  return {
    title: {
      absolute: defaultTitle || `${appName} — Inscrições para Corridas de Rua, Trail Run e Eventos Esportivos`,
    },
    description:
      defaultDescription ||
      "Encontre e se inscreva em corridas de rua, trail run e eventos esportivos perto de você. Inscrição online, pagamento seguro via Pix, cartão ou boleto.",
  };
}

export const revalidate = 60;

export default async function HomePage() {
  const [appName, { events }, bannerInterval] = await Promise.all([
    getAppName(),
    listPublicEvents({ pageSize: 6 }),
    getBannerInterval(),
  ]);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: appName,
    url: baseUrl,
  };

  return (
    <>
      <JsonLd data={organizationJsonLd} />
      <main className="min-h-screen bg-gradient-to-br from-primary-50 to-white dark:from-gray-900 dark:to-gray-950">
        <div className="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 className="text-5xl font-bold text-primary-900 dark:text-primary-400 mb-4">{appName}</h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
            Plataforma de inscrições para corridas de rua, trail run e mais.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/eventos" className="btn-primary text-lg px-8 py-3">
              Ver Eventos
            </Link>
            <Link href="/auth/cadastro" className="btn-secondary text-lg px-8 py-3">
              Criar Conta
            </Link>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 pb-16 space-y-8">
          <EventsBanner intervalSeconds={bannerInterval} />

          <AdSlotRenderer position="HOME_ABAIXO_BANNER" />

          {events.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Próximos eventos</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
              <div className="flex justify-center mt-8">
                <Link href="/eventos" className="btn-secondary px-8 py-3">
                  Ver todos os eventos
                </Link>
              </div>
            </div>
          )}

          <AdSlotRenderer position="HOME_ENTRE_EVENTOS_CTA" />
        </div>
      </main>
      <OrganizerCTA appName={appName} />
    </>
  );
}
```

Note: `getSetting` and `getBannerInterval` are both exported from `@/lib/settings` (confirmed —
`/eventos` already imports `getBannerInterval` and `getAppName` from that same module).

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS, no test file references `app/(public)/page.tsx` directly, so this is a no-op check
confirming nothing else broke (e.g. a shared component's prop contract).

- [ ] **Step 4: Run `npx tsc --noEmit`**

Expected: clean — confirms `EventCard`'s prop type accepts `listPublicEvents`'s return type
directly (they already share the same Prisma `select` shape, verified during planning; this is the
type-level confirmation).

- [ ] **Step 5: Run `npm run build`**

Expected: clean production build.

- [ ] **Step 6: Manual verification (dev server)**

Run `npm run dev`, open `/`, confirm:
- Hero renders unchanged.
- Banner renders below the hero (same rotating banner as `/eventos`, if any banner events exist —
  if none, `EventsBanner` already handles its own empty state, unchanged from today).
- If there are upcoming published events in the dev database: "Próximos eventos" section renders
  with up to 6 cards, "Ver todos os eventos" button links to `/eventos`.
- If there are zero upcoming published events: confirm the "Próximos eventos" heading, grid, and
  "Ver todos" button do NOT render at all (not an empty state message — the whole section is
  absent).
- `/eventos` itself still renders exactly as before (unaffected by this change).

- [ ] **Step 7: Commit**

```bash
git add app/(public)/page.tsx
git commit -m "feat: home publica passa a mostrar os proximos 6 eventos, reaproveitando componentes de /eventos"
```

---

## Nota de deploy — 2 novos slots de anúncio (dados, não schema)

Depois do deploy desta mudança (`git pull` → `docker build` → restart do app, sem `prisma db push`
— nenhuma coluna nova), rodar UMA VEZ contra o banco de produção (mesmo padrão manual já usado pro
seed original dos 5 `AdSlot`s e pro `refresh-templates.ts` — ver `PROGRESSO.md` pro procedimento
exato de acesso ao container/VPS):

```sql
INSERT INTO "ad_slots" ("id", "key", "label", "width", "height", "enabled", "updatedAt") VALUES
  ('adslot_home_abaixo_banner', 'HOME_ABAIXO_BANNER', 'Abaixo do banner — home', 728, 90, false, CURRENT_TIMESTAMP),
  ('adslot_home_entre_eventos_cta', 'HOME_ENTRE_EVENTOS_CTA', 'Entre eventos e CTA de organizador — home', 728, 90, false, CURRENT_TIMESTAMP);
```

Sem esse passo, `AdSlotRenderer` simplesmente não encontra a linha (`getAdSlot` retorna `null`) e
não renderiza nada nessas 2 posições — **não quebra a página**, só significa que os slots ficam
inativos até o INSERT rodar. Ambos nascem `enabled: false` (mesmo padrão dos 5 slots existentes) —
admin liga em `/admin/anuncios` quando quiser.

## Final verification

- [ ] `npx vitest run` — suíte completa verde.
- [ ] `npx tsc --noEmit` — limpo.
- [ ] `npm run build` — limpo.
- [ ] Verificação manual (Passo 6 da Task 1) feita num navegador real.
- [ ] Critérios de aceite da spec conferidos: home mostra hero+banner+até 6 eventos+CTA; seção some
  quando não há eventos futuros; `/eventos` inalterado; 2 novos slots existem no admin depois do
  INSERT manual.
