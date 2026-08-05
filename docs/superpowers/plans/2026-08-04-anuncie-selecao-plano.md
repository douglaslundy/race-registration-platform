# Seleção de plano em /anuncie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor on `/anuncie` pick which ad plan to subscribe to by clicking its card, instead of always submitting the cheapest plan.

**Architecture:** A single new client component, `components/advertiser/AdvertiserPlanPicker.tsx`, owns the `selectedPlanId` state, renders the plan cards (each now a clickable button) and the existing `RequestAdvertiserForm` underneath, wired to the selected plan. `app/(public)/anuncie/page.tsx` keeps its server-side data fetching (`session`, `enabled`, `plans`) and delegates rendering of the cards+form block to this new component.

**Tech Stack:** Next.js 16 App Router, React 19 client component (`useState`), Tailwind CSS, existing `lib/format.ts::formatCurrency`.

## Global Constraints

- Never use `alert()`, `confirm()`, or `window.prompt()` — this change introduces neither (per `CLAUDE.md`).
- `"use client"` components in this project do not get a dedicated test file (established convention — see `RequestAdvertiserForm.tsx`, `SocialLinksForm.tsx`).
- No changes allowed to `RequestAdvertiserForm.tsx` or `app/api/anunciante/solicitar/route.ts` — both already support this change via their existing `adPlanId` prop/field.
- Plan initially selected must be `plans[0]` (cheapest, since `plans` is fetched with `orderBy: { priceAmount: "asc" }` in `AnunciePage`) — same default as today's hardcoded behavior.
- Switching the selected plan must NOT remount `RequestAdvertiserForm` (no `key={selectedPlanId}`) — remounting would wipe out whatever the visitor already typed into the form.
- Card selection must be reachable by keyboard, not mouse-only.

---

### Task 1: `AdvertiserPlanPicker` component + wire it into `/anuncie`

**Files:**
- Create: `components/advertiser/AdvertiserPlanPicker.tsx`
- Modify: `app/(public)/anuncie/page.tsx:1-65`

**Interfaces:**
- Consumes: `RequestAdvertiserForm` from `components/advertiser/RequestAdvertiserForm.tsx`, unchanged signature `{ adPlanId: string; isLoggedIn: boolean }`. `formatCurrency` from `lib/format.ts`, unchanged signature `(amount: number) => string`.
- Produces: `AdvertiserPlanPicker`, a default export, signature:
  ```ts
  export default function AdvertiserPlanPicker({
    plans,
    isLoggedIn,
  }: {
    plans: { id: string; name: string; priceAmount: number; durationDays: number; maxSimultaneousSlots: number }[];
    isLoggedIn: boolean;
  }): JSX.Element
  ```
  Callers must guarantee `plans.length > 0` (the page already only renders this component when `plans.length > 0`, same guard as today's inline block).

This task has no dedicated test file per the Global Constraints (client component convention). Verification is `tsc --noEmit` + `npm run build` + a manual read-through, not a test run — there is no RED/GREEN cycle here because there's nothing to assert against without a browser or React Testing Library setup already wired for this component pattern in this project.

- [ ] **Step 1: Create the component**

Write `components/advertiser/AdvertiserPlanPicker.tsx`:

```tsx
"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import RequestAdvertiserForm from "@/components/advertiser/RequestAdvertiserForm";

interface AdPlanSummary {
  id: string;
  name: string;
  priceAmount: number;
  durationDays: number;
  maxSimultaneousSlots: number;
}

export default function AdvertiserPlanPicker({
  plans,
  isLoggedIn,
}: {
  plans: AdPlanSummary[];
  isLoggedIn: boolean;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0].id);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isSelected = plan.id === selectedPlanId;
          return (
            <button
              key={plan.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedPlanId(plan.id)}
              className={`card space-y-2 text-left transition-colors ${
                isSelected
                  ? "border-primary-600 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-500"
                  : "hover:border-primary-400 dark:hover:border-primary-500"
              }`}
            >
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="text-2xl font-bold text-primary-700 dark:text-primary-400">
                {formatCurrency(plan.priceAmount)}
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>Duração: {plan.durationDays} dias</li>
                <li>Posições simultâneas: {plan.maxSimultaneousSlots}</li>
              </ul>
            </button>
          );
        })}
      </div>

      <div className="card max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">Dados da solicitação</h2>
        <RequestAdvertiserForm adPlanId={selectedPlanId} isLoggedIn={isLoggedIn} />
      </div>
    </>
  );
}
```

Notes for the implementer:
- `card` is an existing global class (already used by the plan cards and the form wrapper in today's `app/(public)/anuncie/page.tsx` — grep for `className="card` in `app/globals.css` if you need to confirm it exists; do not invent a new class).
- `border-primary-600 bg-primary-50` / `hover:border-primary-400` matches the "selected card" pattern already used elsewhere in this project (e.g. `app/dashboard/perfil/page.tsx`, `app/admin/eventos/page.tsx`) — reuse it verbatim, don't invent new colors.
- The `<button>` element is natively focusable and keyboard-activatable (Enter/Space), satisfying the keyboard-reachability constraint without extra `onKeyDown` handling.

- [ ] **Step 2: Rewrite `app/(public)/anuncie/page.tsx` to delegate to the new component**

Replace the file's content (it is 65 lines today) with:

```tsx
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import AdvertiserPlanPicker from "@/components/advertiser/AdvertiserPlanPicker";

export const metadata: Metadata = { title: "Anuncie no site" };
export const dynamic = "force-dynamic";

export default async function AnunciePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user) && session?.user.role !== "ADVERTISER";
  const enabled = (await getSetting("ads_marketplace_enabled")) === "true";

  const plans = enabled
    ? await db.adPlan.findMany({ where: { active: true }, orderBy: { priceAmount: "asc" } })
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Anuncie no site</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Escolha um plano, envie os dados da sua empresa e faça o pagamento. Sua conta de
          anunciante é liberada assim que aprovarmos a solicitação.
        </p>
      </div>

      {!enabled ? (
        <p className="text-gray-500 dark:text-gray-400">
          Não estamos aceitando novas solicitações de anunciante no momento.
        </p>
      ) : plans.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">Nenhum plano disponível no momento.</p>
      ) : (
        <AdvertiserPlanPicker plans={plans} isLoggedIn={isLoggedIn} />
      )}
    </div>
  );
}
```

Notes for the implementer:
- This removes the now-unused `formatCurrency` import from this file (it moved into `AdvertiserPlanPicker`) — do not leave a dangling unused import, `tsc`/lint will flag it.
- `db.adPlan.findMany` returns the full `AdPlan` Prisma model, which is a structural superset of `AdPlanSummary` (it has `id`, `name`, `priceAmount`, `durationDays`, `maxSimultaneousSlots` plus other fields) — passing it straight into `plans={plans}` type-checks without any mapping, same as how the original inline code used `plan.name`/`plan.priceAmount`/etc. directly.
- The `!enabled` / `plans.length === 0` / else chain replaces the old nested `{!enabled ? ... : (<>...</>)}` — behavior is identical (three mutually exclusive states: disabled, no plans, has plans), just flattened since there's no longer a second conditional nested inside for the form block.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. In particular, confirm no "unused import" or "property does not exist" errors on either file.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds, no warnings about the two touched files.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (this task adds no new test files, so the count should be unchanged from before this task). Confirm specifically that no existing test imports `app/(public)/anuncie/page.tsx`'s old shape (e.g. asserting on `formatCurrency` being called from the page) — if one does, update it to match the new delegation to `AdvertiserPlanPicker` rather than deleting coverage.

- [ ] **Step 6: Commit**

```bash
git add components/advertiser/AdvertiserPlanPicker.tsx "app/(public)/anuncie/page.tsx"
git commit -m "feat: visitante escolhe o plano de anunciante clicando no card em /anuncie"
```

---

## Deploy note (for whoever runs the next production deploy)

No schema change, no new environment variable, no new `PlatformSetting` key, no new API route. This ships with the normal `git pull` → `docker build` → `docker compose up -d --no-deps app` sequence — no manual post-deploy step required.
