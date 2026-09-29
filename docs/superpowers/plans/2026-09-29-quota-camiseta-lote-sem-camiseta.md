# Quota de camiseta por tamanho + lote sem camiseta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let organizers cap how many camisetas of each size exist per event (default: unlimited), and let each lote declare whether it includes a camiseta at all — with both rules enforced server-side everywhere a registration's `shirtSize` is set or changed (new registration, proxy registration, and editing an existing registration).

**Architecture:** Two new pieces of state — `TicketBatch.hasShirt` (boolean, default `true`) and a new `EventShirtSizeQuota` table (`eventId + size → quantity`, absence = unlimited) — gate a single enforcement point inside `createCheckout`'s existing transaction (mirroring how it already validates lote/percurso/categoria), plus the equivalent checks added to the one other place a registration's `shirtSize` can change after creation (`PATCH /api/athlete/registrations/[id]`). Quota usage is always a live `Registration.count`/`groupBy`, never a denormalized counter, so it never needs decrementing anywhere.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, Zod, react-hook-form, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-quota-camiseta-lote-sem-camiseta-design.md`

## Global Constraints

- Every existing `TicketBatch` keeps requiring a camiseta exactly as today — `hasShirt` defaults to `true`.
- A size with no `EventShirtSizeQuota` row is unlimited — never treat "no row" as "quota = 0".
- Enforcement of both rules is always server-side (inside the same transaction/route that already validates lote/percurso/categoria) — client-side hiding/requiring is UX only.
- No native `alert()`/`confirm()`/`prompt()` anywhere — use `ErrorModal`/`ConfirmModal` per `CLAUDE.md`.
- Quota is **per event**, not per lote — it sums registrations across every lote with `hasShirt: true` in that event.
- Sold-out sizes disappear from the `<select>` — they are never shown disabled.
- Editing an existing registration that keeps the *same* shirt size must never fail on quota, even if the event has since sold out that size (only a genuine size *change* is checked against quota).

## Review Focus

- Editing a registration whose lote has `hasShirt: false` must not let a stray `shirtSize` in the request body get written — the route must silently ignore it, not 500 or accept it.
- A quota of exactly `0` for a size must block it immediately (distinct from "no row" = unlimited) — the code must never `?? Infinity` on a missing quota and never treat `quantity: 0` as falsy-therefore-unlimited.
- Switching `ticketBatchId` in the checkout form to a lote with `hasShirt: false` after already having picked a shirt size must clear/ignore that leftover value, not silently submit it.
- Cancelled registrations (`status: "CANCELLED"`) must never count against quota — every usage query filters `status: { not: "CANCELLED" }`, including the one inside `createCheckout`'s transaction and the one in the athlete registration edit route.
- Editing a registration's shirt size to a *different* size that's exactly at capacity must be rejected; editing any *other* field while leaving `shirtSize` untouched must never trigger a quota check at all (untouched fields aren't in `parsed.data`).

---

## Task 1: Schema — `hasShirt` + `EventShirtSizeQuota` + shared quota helper

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/setup.ts`
- Create: `lib/shirt-size-quota.ts`
- Test: `tests/unit/shirt-size-quota.test.ts`

**Interfaces:**
- Produces: `computeSoldOutShirtSizes(quotas: { size: string; quantity: number }[], usage: { size: string; count: number }[]): string[]` — pure, used by later tasks.
- Produces: `getSoldOutShirtSizes(eventId: string): Promise<string[]>` — used by Task 5 (checkout page) and Task 6 (edit-registration page).
- Produces: Prisma model `EventShirtSizeQuota { id, eventId, size: ShirtSize, quantity: Int }`, unique on `(eventId, size)`, generated composite-key name `eventId_size` — used by Task 2 (checkout), Task 4 (quota API), Task 6 (edit route).
- Produces: `TicketBatch.hasShirt: boolean` — used by Task 2 through Task 6.

- [ ] **Step 1: Add the schema fields**

In `prisma/schema.prisma`, find the `TicketBatch` model and add `hasShirt` right after `soldCount`:

```prisma
model TicketBatch {
  id             String   @id @default(cuid())
  eventId        String
  name           String
  description    String?
  priceAmount    Int // centavos
  capacity       Int
  soldCount      Int      @default(0)
  hasShirt       Boolean  @default(true)
  startAt        DateTime
  endAt          DateTime
  active         Boolean  @default(true)
  activationMode String   @default("MANUAL") // MANUAL | DATE | AFTER_PREVIOUS
  createdAt      DateTime @default(now())

  event         Event          @relation(fields: [eventId], references: [id], onDelete: Cascade)
  registrations Registration[]

  @@map("ticket_batches")
}
```

Then find the `Event` model and add a new relation field anywhere among its other relation fields (e.g. right after `shirtSizeRestrictionSizes`... actually that's a scalar array, not a relation — add it near the bottom of the model, next to other `[]` relations like `routes`/`categories`):

```prisma
  shirtSizeQuotas EventShirtSizeQuota[]
```

Then add the new model, right after the `TicketBatch` model block:

```prisma
model EventShirtSizeQuota {
  id       String    @id @default(cuid())
  eventId  String
  size     ShirtSize
  quantity Int

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([eventId, size])
  @@map("event_shirt_size_quotas")
}
```

- [ ] **Step 2: Create the migration and regenerate the client**

```bash
npx prisma migrate dev --name add_shirt_hasshirt_and_size_quota
npm run db:generate
```

Confirm the migration folder was created under `prisma/migrations/` and that `npx tsc --noEmit` still runs (it will still show pre-existing unrelated state at this point — just confirm this command doesn't fail to even start, e.g. due to a schema typo).

- [ ] **Step 3: Add the new model to the global test db mock**

In `tests/setup.ts`, add a new entry to the `db` mock object (next to `eventSponsor`/`eventSocialLink` is a natural spot):

```ts
    eventShirtSizeQuota: { findMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
```

- [ ] **Step 4: Write the failing tests for the pure helper**

Create `tests/unit/shirt-size-quota.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeSoldOutShirtSizes } from "@/lib/shirt-size-quota";

describe("computeSoldOutShirtSizes", () => {
  it("retorna vazio quando não há nenhuma quota configurada", () => {
    expect(computeSoldOutShirtSizes([], [{ size: "M", count: 999 }])).toEqual([]);
  });

  it("não marca como esgotado um tamanho abaixo da quota", () => {
    const result = computeSoldOutShirtSizes(
      [{ size: "M", quantity: 10 }],
      [{ size: "M", count: 9 }],
    );
    expect(result).toEqual([]);
  });

  it("marca como esgotado um tamanho que atingiu exatamente a quota", () => {
    const result = computeSoldOutShirtSizes(
      [{ size: "M", quantity: 10 }],
      [{ size: "M", count: 10 }],
    );
    expect(result).toEqual(["M"]);
  });

  it("marca como esgotado um tamanho que passou da quota", () => {
    const result = computeSoldOutShirtSizes(
      [{ size: "M", quantity: 10 }],
      [{ size: "M", count: 15 }],
    );
    expect(result).toEqual(["M"]);
  });

  it("trata quota configurada sem nenhum uso registrado como uso = 0 (não esgotado)", () => {
    const result = computeSoldOutShirtSizes([{ size: "M", quantity: 10 }], []);
    expect(result).toEqual([]);
  });

  it("quota = 0 esgota o tamanho imediatamente, mesmo sem nenhum uso", () => {
    const result = computeSoldOutShirtSizes([{ size: "PP", quantity: 0 }], []);
    expect(result).toEqual(["PP"]);
  });

  it("avalia múltiplos tamanhos de forma independente", () => {
    const result = computeSoldOutShirtSizes(
      [{ size: "M", quantity: 10 }, { size: "G", quantity: 5 }],
      [{ size: "M", count: 10 }, { size: "G", count: 2 }],
    );
    expect(result).toEqual(["M"]);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
npx vitest run tests/unit/shirt-size-quota.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/shirt-size-quota'` (file doesn't exist yet).

- [ ] **Step 6: Implement `lib/shirt-size-quota.ts`**

```ts
import { db } from "./db";

export function computeSoldOutShirtSizes(
  quotas: { size: string; quantity: number }[],
  usage: { size: string; count: number }[],
): string[] {
  const usedBySize = new Map(usage.map((u) => [u.size, u.count]));
  return quotas.filter((q) => (usedBySize.get(q.size) ?? 0) >= q.quantity).map((q) => q.size);
}

export async function getSoldOutShirtSizes(eventId: string): Promise<string[]> {
  const [quotas, usage] = await Promise.all([
    db.eventShirtSizeQuota.findMany({ where: { eventId }, select: { size: true, quantity: true } }),
    db.registration.groupBy({
      by: ["shirtSize"],
      where: { eventId, shirtSize: { not: null }, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
  ]);

  return computeSoldOutShirtSizes(
    quotas,
    usage
      .filter((u) => u.shirtSize !== null)
      .map((u) => ({ size: u.shirtSize as string, count: u._count._all })),
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/shirt-size-quota.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/setup.ts lib/shirt-size-quota.ts tests/unit/shirt-size-quota.test.ts
git commit -m "feat(camiseta): adiciona hasShirt no lote e tabela de quota por tamanho"
```

---

## Task 2: `createCheckout` — obrigatoriedade condicionada ao lote + checagem de quota

**Files:**
- Modify: `lib/checkout-validation.ts`
- Modify: `lib/checkout.ts`
- Modify: `app/api/checkout/route.ts`
- Modify: `components/checkout/CheckoutForm.tsx` (import only — full UI rework is Task 5)
- Test: `tests/unit/checkout-validation.test.ts`
- Test: `tests/unit/checkout-shirt-size-restriction.test.ts`
- Modify (test fixtures only): `tests/unit/checkout-coupon.test.ts`, `tests/unit/checkout-pix-discount.test.ts`, `tests/unit/checkout-notes.test.ts`, `tests/checkout-participant-snapshot-wiring.test.ts`, `tests/unit/checkout-proxy-athlete.test.ts`

**Interfaces:**
- Consumes: `EventShirtSizeQuota` model, `TicketBatch.hasShirt` (Task 1).
- Produces: `optionalEnumField<T>(values: T)` (restored, in `lib/checkout-validation.ts`) — consumed by Task 5's `CheckoutForm.tsx` schema.
- Produces: `CheckoutInput.shirtSize?: ShirtSize` (optional again) — consumed by Task 5 and Task 6.

- [ ] **Step 1: Restore `optionalEnumField`, drop `requiredEnumField`**

In `lib/checkout-validation.ts`, replace:

```ts
export function requiredEnumField<const T extends readonly [string, ...string[]]>(values: T, message: string) {
  return z.preprocess(emptyStringToUndefined, z.enum(values, { errorMap: () => ({ message }) }));
}
```

with:

```ts
export function optionalEnumField<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(emptyStringToUndefined, z.enum(values).optional());
}
```

- [ ] **Step 2: Update `checkout-validation.test.ts` to test `optionalEnumField` again**

Replace the two `requiredEnumField` tests with:

```ts
import { emptyStringToUndefined, extractApiErrorMessage, optionalEnumField, optionalOpaqueIdField, opaqueIdField } from "@/lib/checkout-validation";

describe("checkout validation helpers", () => {
  it("treats empty strings as undefined for optional fields", () => {
    const schema = z.object({
      routeId: optionalOpaqueIdField(),
      shirtSize: optionalEnumField(["PP", "P", "M", "G", "GG", "XGG"] as const),
    });

    const parsed = schema.parse({ routeId: "", shirtSize: "" });
    expect(parsed.routeId).toBeUndefined();
    expect(parsed.shirtSize).toBeUndefined();
  });
```

(Keep the other existing `it(...)` blocks — `accepts opaque internal ids...`, `keeps valid values intact`, `extracts meaningful api errors` — unchanged, just update the `import` line above and remove the two `it("rejects an empty string...")` / `it("accepts a valid value...")` blocks entirely since `requiredEnumField` no longer exists.)

- [ ] **Step 3: Run the validation tests to verify they pass**

```bash
npx vitest run tests/unit/checkout-validation.test.ts
```

Expected: PASS.

- [ ] **Step 4: Revert `app/api/checkout/route.ts`'s schema to optional**

Change the import (line 13):

```ts
import { emptyStringToUndefined, optionalEnumField, optionalOpaqueIdField, opaqueIdField } from "@/lib/checkout-validation";
```

Change the schema field:

```ts
  shirtSize: optionalEnumField(["PP", "P", "M", "G", "GG", "XGG"] as const),
```

Change the cast passed into `createCheckout` (currently `shirtSize: checkoutData.shirtSize as ShirtSize,`):

```ts
      shirtSize: checkoutData.shirtSize as ShirtSize | undefined,
```

- [ ] **Step 5: Revert `CheckoutForm.tsx`'s import (schema itself is reworked in Task 5, but fix the import now so the file still compiles)**

Change line 10's import from `requiredEnumField` to `optionalEnumField`, and line 26's schema field:

```ts
import { emptyStringToUndefined, extractApiErrorMessage, optionalEnumField, opaqueIdField, optionalOpaqueIdField } from "@/lib/checkout-validation";
```

```ts
  shirtSize: optionalEnumField(["PP", "P", "M", "G", "GG", "XGG"] as const),
```

(This makes the schema unconditionally optional again for now — Task 5 adds the conditional-on-lote requirement in `onSubmit` and the UI. Run `npx tsc --noEmit` after this step; it should be clean since nothing else in this file referenced `requiredEnumField`.)

- [ ] **Step 6: Write the new failing tests in `checkout-shirt-size-restriction.test.ts`**

This file already has a `createTx(event)` helper and a `ticketBatch` fixture (`{ id: "batch-1", active: true, soldCount: 0, capacity: 10, priceAmount: 20000 }`) reused by every test via `createTx`. Two things change:

First, add `hasShirt: true` to the shared fixture so every *existing* test in this file keeps testing "lote com camiseta" (find `priceAmount: 20000,` inside the `ticketBatch` object and add the field right after it):

```ts
  const ticketBatch = {
    id: "batch-1",
    active: true,
    soldCount: 0,
    capacity: 10,
    priceAmount: 20000,
    hasShirt: true,
  };
```

Second, add `eventShirtSizeQuota: { findUnique: vi.fn().mockResolvedValue(null) }` to the `createTx` return object (insert right before the existing `coupon: {` key):

```ts
    eventShirtSizeQuota: { findUnique: vi.fn().mockResolvedValue(null) },
    coupon: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
```

Then add these new `it(...)` blocks at the end of the `describe` block, before the closing `});`:

```ts
  it("não exige nem grava tamanho de camiseta quando o lote não inclui camiseta", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: null,
      shirtSizeRestrictionSizes: [],
    };
    const tx = createTx(event);
    tx.ticketBatch.findUnique.mockResolvedValue({ ...ticketBatch, hasShirt: false });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await createCheckout({
      eventId: "event-1",
      ticketBatchId: "batch-1",
      buyerUserId: "user-1",
      athleteUserId: "user-1",
      shirtSize: "G" as any, // enviado mesmo assim — deve ser ignorado
    } as any);

    expect(result).toBeDefined();
    expect(tx.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ shirtSize: undefined }) }),
    );
  });

  it("rejeita quando o tamanho escolhido já atingiu a quota configurada para o evento", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: null,
      shirtSizeRestrictionSizes: [],
    };
    const tx = createTx(event);
    tx.eventShirtSizeQuota.findUnique.mockResolvedValueOnce({ id: "q1", eventId: "event-1", size: "M", quantity: 5 });
    tx.registration.count.mockResolvedValueOnce(5);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "M" as any,
      } as any),
    ).rejects.toThrow("Tamanho de camiseta esgotado para este evento");
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.registration.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "CANCELLED" } }) }),
    );
  });

  it("aceita quando o tamanho escolhido tem quota configurada mas ainda não esgotou", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: null,
      shirtSizeRestrictionSizes: [],
    };
    const tx = createTx(event);
    tx.eventShirtSizeQuota.findUnique.mockResolvedValueOnce({ id: "q1", eventId: "event-1", size: "M", quantity: 5 });
    tx.registration.count.mockResolvedValueOnce(4);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "M" as any,
      } as any),
    ).resolves.toBeDefined();
  });
```

Note: the `createTx` helper in this file doesn't include a `registration: { count: vi.fn() }` today — check the existing `createTx` return object; it only has `registration: { create: vi.fn().mockResolvedValue({ id: "reg-1" }) }`. Add `count: vi.fn().mockResolvedValue(0)` alongside `create` so the two new tests above can override it per-test:

```ts
    registration: {
      create: vi.fn().mockResolvedValue({ id: "reg-1" }),
      count: vi.fn().mockResolvedValue(0),
    },
```

- [ ] **Step 7: Run the shirt-size-restriction tests to verify the new ones fail**

```bash
npx vitest run tests/unit/checkout-shirt-size-restriction.test.ts
```

Expected: the 3 new tests FAIL (`batch.hasShirt` doesn't exist yet in `lib/checkout.ts`'s logic; quota isn't checked yet). The pre-existing tests should still PASS at this point (they were already passing before this step).

- [ ] **Step 8: Implement the conditional requirement + quota check in `lib/checkout.ts`**

Replace lines 17-18 (`shirtSize: ShirtSize;` in `CheckoutInput`):

```ts
  shirtSize?: ShirtSize;
```

Replace the current block (currently lines 70-76):

```ts
    if (!input.shirtSize) {
      throw new Error("Selecione o tamanho de camiseta para concluir a inscrição");
    }
    const allowedSizes = getAllowedShirtSizes(event, new Date());
    if (!allowedSizes.includes(input.shirtSize)) {
      throw new Error("Tamanho de camiseta indisponível para este evento");
    }
```

with:

```ts
    if (batch.hasShirt) {
      if (!input.shirtSize) {
        throw new Error("Selecione o tamanho de camiseta para concluir a inscrição");
      }
      const allowedSizes = getAllowedShirtSizes(event, new Date());
      if (!allowedSizes.includes(input.shirtSize)) {
        throw new Error("Tamanho de camiseta indisponível para este evento");
      }
      const quota = await tx.eventShirtSizeQuota.findUnique({
        where: { eventId_size: { eventId: input.eventId, size: input.shirtSize } },
      });
      if (quota) {
        const usedCount = await tx.registration.count({
          where: { eventId: input.eventId, shirtSize: input.shirtSize, status: { not: "CANCELLED" } },
        });
        if (usedCount >= quota.quantity) {
          throw new Error("Tamanho de camiseta esgotado para este evento");
        }
      }
    }
```

Then, in the `tx.registration.create` call (currently `shirtSize: input.shirtSize,` around line 225), change it to:

```ts
        shirtSize: batch.hasShirt ? input.shirtSize : undefined,
```

- [ ] **Step 9: Run the shirt-size-restriction tests to verify everything passes**

```bash
npx vitest run tests/unit/checkout-shirt-size-restriction.test.ts
```

Expected: PASS (7 tests: 4 pre-existing + 3 new).

- [ ] **Step 10: Add `hasShirt: true` + `eventShirtSizeQuota` mock to the other 5 checkout test files**

The problem: `batch.hasShirt` now gates the entire shirt-size check. These 5 files' mock `ticketBatch` fixtures don't set `hasShirt` at all, so it would read as `undefined` (falsy) and silently skip validation — breaking the intent of tests that already pass `shirtSize: "M"` expecting it to be validated/persisted.

In **`tests/unit/checkout-coupon.test.ts`**: find the `ticketBatch` object (`priceAmount: 20000,`) and add `hasShirt: true,` right after it. Find the `coupon: {` line in `createTx` and insert right before it: `eventShirtSizeQuota: { findUnique: vi.fn().mockResolvedValue(null) },`.

In **`tests/unit/checkout-pix-discount.test.ts`**: the `ticketBatch` is a one-liner: `const ticketBatch = { id: "batch-1", active: true, soldCount: 0, capacity: 10, priceAmount: 10000 };` — change to:

```ts
const ticketBatch = { id: "batch-1", active: true, soldCount: 0, capacity: 10, priceAmount: 10000, hasShirt: true };
```

and in `makeTx`, insert right before `coupon: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },`:

```ts
    eventShirtSizeQuota: { findUnique: vi.fn().mockResolvedValue(null) },
```

In **`tests/unit/checkout-notes.test.ts`**: same as `checkout-coupon.test.ts` — add `hasShirt: true,` after `priceAmount: 20000,` in the `ticketBatch` object, and `eventShirtSizeQuota: { findUnique: vi.fn().mockResolvedValue(null) },` right before `coupon: {` in `createTx`.

In **`tests/checkout-participant-snapshot-wiring.test.ts`**: same pattern — `ticketBatch` object has `priceAmount: 20000,`, add `hasShirt: true,` after it; `createTx` has `coupon: {`, insert the quota mock right before it.

In **`tests/unit/checkout-proxy-athlete.test.ts`**: same pattern, but this file's `createTx` object is indented one level deeper (6 spaces) — the `ticketBatch` fixture has `priceAmount: 20000,` (add `hasShirt: true,` after), and `createTx` has `coupon: {` at 6-space indent (insert `eventShirtSizeQuota: { findUnique: vi.fn().mockResolvedValue(null) },` at the same 6-space indent right before it).

- [ ] **Step 11: Run the full checkout test suite to verify nothing broke**

```bash
npx vitest run tests/unit/checkout-coupon.test.ts tests/unit/checkout-pix-discount.test.ts tests/unit/checkout-notes.test.ts tests/checkout-participant-snapshot-wiring.test.ts tests/unit/checkout-proxy-athlete.test.ts tests/unit/checkout-shirt-size-restriction.test.ts tests/unit/checkout-validation.test.ts
```

Expected: PASS, all files.

- [ ] **Step 12: Run `tsc` and the checkout-route integration tests**

```bash
npx tsc --noEmit
npx vitest run tests/checkout-route.test.ts tests/checkout-payment-account.test.ts
```

Expected: both clean/PASS — these two files mock `createCheckout` entirely and already send `shirtSize: "M"` in every request body they need to reach 200, and the API schema is optional again so no request there is rejected for lacking it.

- [ ] **Step 13: Commit**

```bash
git add lib/checkout-validation.ts lib/checkout.ts app/api/checkout/route.ts components/checkout/CheckoutForm.tsx tests/unit/checkout-validation.test.ts tests/unit/checkout-shirt-size-restriction.test.ts tests/unit/checkout-coupon.test.ts tests/unit/checkout-pix-discount.test.ts tests/unit/checkout-notes.test.ts tests/checkout-participant-snapshot-wiring.test.ts tests/unit/checkout-proxy-athlete.test.ts
git commit -m "feat(camiseta): exige tamanho e checa quota só quando o lote tem camiseta"
```

---

## Task 3: Lote — flag "possui camiseta"

**Files:**
- Modify: `app/api/events/[id]/batches/route.ts`
- Modify: `app/api/events/[id]/batches/[batchId]/route.ts`
- Modify: `app/organizador/eventos/[id]/lotes/LotesClient.tsx`
- Test: `tests/event-batches-route.test.ts`
- Test: `tests/event-batch-detail-route.test.ts`

**Interfaces:**
- Consumes: `TicketBatch.hasShirt` (Task 1).
- Produces: nothing new consumed by later tasks (this is a leaf UI+API task).

- [ ] **Step 1: Write the failing test for POST accepting `hasShirt`**

In `tests/event-batches-route.test.ts`, add this test after the existing `"organizador titular cria lote no próprio evento"` test:

```ts
  it("aceita hasShirt: false e repassa pro create", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.create.mockResolvedValueOnce({ id: "batch-5", ...validBody, hasShirt: false });

    const res = await POST(makeRequest({ ...validBody, hasShirt: false }), makeContext("ev-1"));

    expect(dbMock.ticketBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hasShirt: false }) }),
    );
    expect(res.status).toBe(201);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/event-batches-route.test.ts -t "aceita hasShirt"
```

Expected: FAIL — `hasShirt` isn't in `batchSchema` yet, so `parsed.data` never contains it and the `expect.objectContaining` assertion fails.

- [ ] **Step 3: Add `hasShirt` to the POST schema**

In `app/api/events/[id]/batches/route.ts`, add to `batchSchema`:

```ts
const batchSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  priceAmount: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  activationMode: z.enum(["MANUAL", "DATE", "AFTER_PREVIOUS"]).optional(),
  hasShirt: z.boolean().optional(),
});
```

(No change needed to the `db.ticketBatch.create({ data: { ...parsed.data, ... } })` call — `hasShirt` is already spread in via `...parsed.data`, and when omitted, Prisma's schema `@default(true)` takes over.)

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run tests/event-batches-route.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Write the failing test for PATCH accepting `hasShirt`**

In `tests/event-batch-detail-route.test.ts`, add after the existing `"organizador titular edita lote do próprio evento"` test:

```ts
  it("aceita hasShirt no PATCH e repassa pro update", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.ticketBatch.findFirst.mockResolvedValueOnce({ id: "batch-1", eventId: "ev-1" });
    dbMock.ticketBatch.update.mockResolvedValueOnce({ id: "batch-1", hasShirt: false });

    const res = await PATCH(makePatchRequest({ hasShirt: false }), makeContext("ev-1", "batch-1"));

    expect(dbMock.ticketBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hasShirt: false }) }),
    );
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 6: Run it to verify it fails**

```bash
npx vitest run tests/event-batch-detail-route.test.ts -t "aceita hasShirt no PATCH"
```

Expected: FAIL — `hasShirt` isn't in `patchSchema` yet.

- [ ] **Step 7: Add `hasShirt` to the PATCH schema**

In `app/api/events/[id]/batches/[batchId]/route.ts`, add to `patchSchema`:

```ts
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  priceAmount: z.number().int().nonnegative().optional(),
  capacity: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  activationMode: z.enum(["MANUAL", "DATE", "AFTER_PREVIOUS"]).optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  hasShirt: z.boolean().optional(),
});
```

- [ ] **Step 8: Run it to verify it passes**

```bash
npx vitest run tests/event-batch-detail-route.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 9: Update `LotesClient.tsx` — types, create form, edit modal, list badge**

Add `hasShirt: boolean` to the `Batch` type:

```ts
type Batch = {
  id: string;
  name: string;
  priceAmount: number;
  capacity: number;
  soldCount: number;
  startAt: string;
  endAt: string;
  active: boolean;
  activationMode: string;
  status: string;
  hasShirt: boolean;
};
```

Add `hasShirt: true` to the initial `form` state:

```ts
  const [form, setForm] = useState({
    name: "", priceAmount: "", capacity: "", startAt: "", endAt: "",
    activationMode: "MANUAL", hasShirt: true,
  });
```

In `handleCreate`, add `hasShirt: form.hasShirt` to the POST body:

```ts
      body: JSON.stringify({
        name: form.name,
        priceAmount: Number.isFinite(priceReais) ? Math.round(priceReais * 100) : 0,
        capacity: parseInt(form.capacity),
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        activationMode: form.activationMode,
        hasShirt: form.hasShirt,
      }),
```

Reset `hasShirt: true` in the post-create state reset:

```ts
    setForm({ name: "", priceAmount: "", capacity: "", startAt: "", endAt: "", activationMode: "MANUAL", hasShirt: true });
```

Add a checkbox to the create form, right after the "Modo de ativação" `<div>` block and before the start/end date grid:

```tsx
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="hasShirt"
              checked={form.hasShirt}
              onChange={(e) => setForm({ ...form, hasShirt: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="hasShirt" className="text-sm text-gray-700">Este lote inclui camiseta?</label>
          </div>
```

Add `hasShirt: true` to `editForm`'s initial state and its type (the `useState` call at the top of the component):

```ts
  const [editForm, setEditForm] = useState({ name: "", priceAmount: "", capacity: "", startAt: "", endAt: "", hasShirt: true });
```

In `openEdit`, populate it from the batch being edited:

```ts
  function openEdit(b: Batch) {
    setEditId(b.id);
    setEditForm({
      name: b.name,
      priceAmount: String(b.priceAmount / 100),
      capacity: String(b.capacity),
      startAt: b.startAt.slice(0, 16),
      endAt: b.endAt.slice(0, 16),
      hasShirt: b.hasShirt,
    });
  }
```

In `saveEdit`, add `hasShirt: editForm.hasShirt` to the PATCH body:

```ts
      body: JSON.stringify({
        name: editForm.name,
        priceAmount: Number.isFinite(priceReais) ? Math.round(priceReais * 100) : 0,
        capacity: parseInt(editForm.capacity),
        startAt: new Date(editForm.startAt).toISOString(),
        endAt: new Date(editForm.endAt).toISOString(),
        hasShirt: editForm.hasShirt,
      }),
```

Add the same checkbox to the edit modal's form, right after the "Vagas"/"Preço" grid and before the start/end date grid:

```tsx
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="editHasShirt"
                checked={editForm.hasShirt}
                onChange={(e) => setEditForm({ ...editForm, hasShirt: e.target.checked })}
                className="h-4 w-4"
              />
              <label htmlFor="editHasShirt" className="text-sm text-gray-700 dark:text-gray-300">Este lote inclui camiseta?</label>
            </div>
```

Add a small badge to the batch list card, right after the existing status/activation-mode badges row (`<span className={... badge.cls}>{badge.label}</span>` / `<span className="text-xs text-gray-400">{ACTIVATION_LABEL...}</span>`):

```tsx
                      {!b.hasShirt && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">Sem camiseta</span>
                      )}
```

- [ ] **Step 10: Verify the whole app still typechecks and builds**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add app/api/events/\[id\]/batches/route.ts app/api/events/\[id\]/batches/\[batchId\]/route.ts app/organizador/eventos/\[id\]/lotes/LotesClient.tsx tests/event-batches-route.test.ts tests/event-batch-detail-route.test.ts
git commit -m "feat(lotes): organizador marca se o lote inclui camiseta"
```

---

## Task 4: Quota de camiseta por tamanho — API + tela do organizador

**Files:**
- Create: `app/api/events/[id]/shirt-quotas/route.ts`
- Create: `components/organizer/ShirtSizeQuotaManager.tsx`
- Modify: `app/organizador/eventos/[id]/editar/page.tsx`
- Test: `tests/events-shirt-quotas-route.test.ts`

**Interfaces:**
- Consumes: `EventShirtSizeQuota` model, `ALL_SHIRT_SIZES` from `lib/shirt-size-restriction.ts` (Task 1, pre-existing).
- Produces: `GET /api/events/[id]/shirt-quotas` → `{ quotas: { size: string; quantity: number | null; usedCount: number }[] }` (always all 6 sizes). `PUT` body `{ quotas: { size: string; quantity: number | null }[] }` → `{ quotas: [...] }` (same shape as GET). Not consumed by any other task — this is the organizer-facing leaf.

- [ ] **Step 1: Write the failing route tests**

Create `tests/events-shirt-quotas-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/events/[id]/shirt-quotas/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePutRequest(body: unknown) {
  return new Request("http://localhost/api/events/ev-1/shirt-quotas", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("GET/PUT /api/events/[id]/shirt-quotas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET retorna 403 para quem não tem permissão", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(new Request("http://localhost/api/events/ev-1/shirt-quotas") as any, makeContext("ev-1"));
    expect(res.status).toBe(403);
  });

  it("GET devolve os 6 tamanhos, com quantity null pra quem não tem quota configurada", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventShirtSizeQuota.findMany.mockResolvedValueOnce([{ size: "M", quantity: 50 }]);
    dbMock.registration.groupBy.mockResolvedValueOnce([{ shirtSize: "M", _count: { _all: 12 } }]);

    const res = await GET(new Request("http://localhost/api/events/ev-1/shirt-quotas") as any, makeContext("ev-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.quotas).toContainEqual({ size: "M", quantity: 50, usedCount: 12 });
    expect(body.quotas).toContainEqual({ size: "PP", quantity: null, usedCount: 0 });
    expect(body.quotas).toHaveLength(6);
  });

  it("PUT substitui as quotas do evento", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "ev-1", organizerId: "org-1" });
    dbMock.eventShirtSizeQuota.deleteMany.mockResolvedValueOnce({ count: 1 });
    dbMock.eventShirtSizeQuota.createMany.mockResolvedValueOnce({ count: 2 });
    dbMock.eventShirtSizeQuota.findMany.mockResolvedValueOnce([
      { size: "M", quantity: 50 },
      { size: "G", quantity: 0 },
    ]);
    dbMock.registration.groupBy.mockResolvedValueOnce([]);
    dbMock.$transaction.mockImplementationOnce(async (arg: any) => Promise.all(arg));

    const res = await PUT(
      makePutRequest({
        quotas: [
          { size: "PP", quantity: null },
          { size: "M", quantity: 50 },
          { size: "G", quantity: 0 },
        ],
      }),
      makeContext("ev-1"),
    );

    expect(dbMock.eventShirtSizeQuota.deleteMany).toHaveBeenCalledWith({ where: { eventId: "ev-1" } });
    expect(dbMock.eventShirtSizeQuota.createMany).toHaveBeenCalledWith({
      data: [
        { eventId: "ev-1", size: "M", quantity: 50 },
        { eventId: "ev-1", size: "G", quantity: 0 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("PUT retorna 404 pra evento de outro organizador", async () => {
    authMock.mockResolvedValue({ user: { id: "org-user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValueOnce(null);

    const res = await PUT(makePutRequest({ quotas: [] }), makeContext("ev-2"));
    expect(res.status).toBe(404);
    expect(dbMock.eventShirtSizeQuota.deleteMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/events-shirt-quotas-route.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/events/[id]/shirt-quotas/route'`.

- [ ] **Step 3: Implement `app/api/events/[id]/shirt-quotas/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { zodErrorResponse } from "@/lib/http/zod-error";
import { ALL_SHIRT_SIZES } from "@/lib/shirt-size-restriction";

const putSchema = z.object({
  quotas: z.array(
    z.object({
      size: z.enum(["PP", "P", "M", "G", "GG", "XGG"]),
      quantity: z.number().int().min(0).nullable(),
    }),
  ),
});

async function getOwnedEvent(eventId: string, organizerId: string | null, actingAsAdmin: boolean) {
  return actingAsAdmin
    ? db.event.findUnique({ where: { id: eventId } })
    : db.event.findFirst({ where: { id: eventId, organizerId: organizerId ?? "__none__" } });
}

async function getQuotasWithUsage(eventId: string) {
  const [quotas, usage] = await Promise.all([
    db.eventShirtSizeQuota.findMany({ where: { eventId }, select: { size: true, quantity: true } }),
    db.registration.groupBy({
      by: ["shirtSize"],
      where: { eventId, shirtSize: { not: null }, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
  ]);

  const quotaBySize = new Map<string, number>(quotas.map((q) => [q.size as string, q.quantity]));
  const usedBySize = new Map<string, number>(
    usage.filter((u) => u.shirtSize !== null).map((u) => [u.shirtSize as string, u._count._all]),
  );

  return ALL_SHIRT_SIZES.map((size) => ({
    size,
    quantity: quotaBySize.get(size) ?? null,
    usedCount: usedBySize.get(size) ?? 0,
  }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const check = await checkApiPermission("events.edit", { eventId });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await getOwnedEvent(eventId, scope.organizerId ?? null, scope.actingAsAdmin);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  return NextResponse.json({ quotas: await getQuotasWithUsage(eventId) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const check = await checkApiPermission("events.edit", { eventId });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await getOwnedEvent(eventId, scope.organizerId ?? null, scope.actingAsAdmin);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return zodErrorResponse(parsed.error);

  const rowsToCreate = parsed.data.quotas
    .filter((q) => q.quantity !== null)
    .map((q) => ({ eventId, size: q.size, quantity: q.quantity as number }));

  await db.$transaction([
    db.eventShirtSizeQuota.deleteMany({ where: { eventId } }),
    db.eventShirtSizeQuota.createMany({ data: rowsToCreate }),
  ]);

  return NextResponse.json({ quotas: await getQuotasWithUsage(eventId) });
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run tests/events-shirt-quotas-route.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Create `components/organizer/ShirtSizeQuotaManager.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import ErrorModal from "@/components/ui/ErrorModal";

type QuotaRow = { size: string; quantity: number | null; usedCount: number };

export default function ShirtSizeQuotaManager({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<QuotaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/events/${eventId}/shirt-quotas`)
      .then((res) => res.json())
      .then(({ quotas }) => setRows(quotas ?? []))
      .finally(() => setLoading(false));
  }, [eventId]);

  function setQuantity(size: string, raw: string) {
    const quantity = raw.trim() === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
    setRows((prev) => prev.map((r) => (r.size === size ? { ...r, quantity } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/shirt-quotas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotas: rows.map(({ size, quantity }) => ({ size, quantity })) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Erro ao salvar a quota de camisetas.");
        return;
      }
      const { quotas } = await res.json();
      setRows(quotas ?? []);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Quota de camisetas por tamanho</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Defina quantas camisetas de cada tamanho existem. Deixe em branco para manter um tamanho
        ilimitado (padrão). Ao atingir a quantidade configurada, o tamanho some das opções na
        inscrição.
      </p>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.size} className="flex items-center gap-3">
            <span className="w-10 font-medium text-sm">{row.size}</span>
            <input
              type="number"
              min={0}
              value={row.quantity ?? ""}
              onChange={(e) => setQuantity(row.size, e.target.value)}
              placeholder="Ilimitado"
              className="input-field text-sm w-32"
            />
            <span className="text-xs text-gray-500">usado: {row.usedCount}</span>
          </div>
        ))}
      </div>

      <button type="button" onClick={handleSave} disabled={saving} className="btn-secondary text-sm">
        {saving ? "Salvando..." : "Salvar quota"}
      </button>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
```

- [ ] **Step 6: Wire it into the event settings page**

In `app/organizador/eventos/[id]/editar/page.tsx`, add the import:

```ts
import ShirtSizeQuotaManager from "@/components/organizer/ShirtSizeQuotaManager";
```

Add the component right after `<EditEventForm ... />` and before `<EventDailySummaryRecipientsManager ... />`:

```tsx
      <EditEventForm event={event} cancellationPolicyEnabled={cancellationPolicyEnabled} />
      <ShirtSizeQuotaManager eventId={id} />
      <EventDailySummaryRecipientsManager eventId={id} />
```

- [ ] **Step 7: Verify typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add app/api/events/\[id\]/shirt-quotas/route.ts components/organizer/ShirtSizeQuotaManager.tsx app/organizador/eventos/\[id\]/editar/page.tsx tests/events-shirt-quotas-route.test.ts
git commit -m "feat(camiseta): organizador configura quota por tamanho no evento"
```

---

## Task 5: Checkout — esconder/filtrar camiseta conforme o lote e a quota

**Files:**
- Modify: `components/checkout/CheckoutForm.tsx`
- Modify: `components/checkout/ProxyAthleteModal.tsx`
- Modify: `app/(public)/inscricao/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getSoldOutShirtSizes` (Task 1), `optionalEnumField` + `CheckoutInput.shirtSize?` semantics (Task 2), `TicketBatch.hasShirt` (Task 1).
- Produces: nothing consumed by later tasks — this is the athlete-facing leaf for new registrations.

No new automated tests in this task — this codebase has no component-level (RTL/jsdom) tests for any checkout component today (confirmed: `CheckoutForm`/`ProxyAthleteModal` have zero existing test files), so verification here is `tsc`/`build` plus the reasoning below. If a browser is available when this task is executed, manually exercise: (a) a lote with `hasShirt: true` shows the field and blocks submit without a size, (b) a lote with `hasShirt: false` hides the field entirely and submits fine, (c) switching between such lotes toggles the field live.

- [ ] **Step 1: `app/(public)/inscricao/[slug]/page.tsx` — compute and pass `soldOutShirtSizes`**

Add the import:

```ts
import { getSoldOutShirtSizes } from "@/lib/shirt-size-quota";
```

Add `getSoldOutShirtSizes(event.id)` to the existing `Promise.all` that already fetches `athleteProfile`/`paymentMethods`/etc.:

```ts
  const [athleteProfile, paymentMethods, defaultPlatformFee, serviceFeePercent, serviceFeeMin, globalPixDiscount, appName, soldOutShirtSizes] = await Promise.all([
    db.athleteProfile.findUnique({
      where: { userId: session.user.id },
      select: { preferredShirtSize: true, teamName: true, emergencyName: true, emergencyPhone: true, medicalNotes: true, cpf: true },
    }),
    getEnabledPaymentMethods(),
    getDefaultPlatformFee(),
    getServiceFeePercent(),
    getServiceFeeMin(),
    getPixServiceFeeDiscountPercent(),
    getAppName(),
    getSoldOutShirtSizes(event.id),
  ]);
```

Pass it to `<CheckoutForm>`:

```tsx
        pixServiceFeeDiscountPercent={pixServiceFeeDiscountPercent}
        appName={appName}
        allowProxyRegistration={event.allowProxyRegistration}
        soldOutShirtSizes={soldOutShirtSizes}
```

(No change needed to `lib/events.ts`'s `getEventBySlug` — `ticketBatches: true` already selects every scalar field, so `hasShirt` is included automatically once Task 1's migration lands.)

- [ ] **Step 2: `CheckoutForm.tsx` — add `hasShirt` to `Batch`, add `soldOutShirtSizes` prop, filter the size list**

Add `hasShirt: boolean` to the `Batch` interface:

```ts
interface Batch {
  id: string;
  name: string;
  priceAmount: number;
  capacity: number;
  soldCount: number;
  hasShirt: boolean;
}
```

Add `soldOutShirtSizes` to the component's props and destructure it with a default:

```ts
export default function CheckoutForm({
  event,
  batches,
  paymentMethods,
  userId: _userId,
  athleteProfile,
  platformFeePercent,
  defaultPlatformFee,
  serviceFeePercent = 0,
  serviceFeeMin = 0,
  pixServiceFeeDiscountPercent = 0,
  appName,
  allowProxyRegistration,
  soldOutShirtSizes = [],
}: {
  event: EventData;
  batches: Batch[];
  paymentMethods: CheckoutPaymentMethod[];
  userId: string;
  athleteProfile?: AthleteProfile;
  platformFeePercent: number;
  defaultPlatformFee: number;
  serviceFeePercent?: number;
  serviceFeeMin?: number;
  pixServiceFeeDiscountPercent?: number;
  appName?: string;
  allowProxyRegistration?: boolean;
  soldOutShirtSizes?: string[];
}) {
```

Filter `allowedShirtSizes` by `soldOutShirtSizes` (this combines the existing date-based restriction with the new quota-based one):

```ts
  const allowedShirtSizes = getAllowedShirtSizes(
    {
      shirtSizeRestrictionDate: event.shirtSizeRestrictionDate ? new Date(event.shirtSizeRestrictionDate) : null,
      shirtSizeRestrictionSizes: event.shirtSizeRestrictionSizes ?? [],
    },
    new Date(),
  ).filter((s) => !soldOutShirtSizes.includes(s));
```

- [ ] **Step 3: Add `showShirtSize`, gate the field, gate the requirement**

Right after `const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? batches[0];`, add:

```ts
  const showShirtSize = selectedBatch?.hasShirt !== false;
```

In `onSubmit`, right after the existing `categoryId` check and before the `proxyAthlete` check, add:

```ts
    if (showShirtSize && !emptyStringToUndefined(data.shirtSize)) {
      setError("Selecione o tamanho de camiseta para concluir a inscrição.");
      return;
    }
```

Wrap the whole "Camiseta" field block in a `showShirtSize &&` conditional, and drop the now-irrelevant `errors.shirtSize` inline message (the field is optional at the schema level again, so `errors.shirtSize` never populates — the check above sets the top-level `error` banner instead, same pattern as `routeId`/`categoryId`):

```tsx
          {showShirtSize && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Camiseta <span className="text-red-500">*</span></label>
              <select {...register("shirtSize")} className="input-field">
                <option value="">Selecione</option>
                {allowedShirtSizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {shirtSizeRestricted && event.shirtSizeRestrictionDate && (
                <p className="text-xs text-gray-500 mt-1">
                  Alguns tamanhos deixaram de estar disponíveis a partir de{" "}
                  {new Date(event.shirtSizeRestrictionDate).toLocaleDateString("pt-BR")}.
                </p>
              )}
              {soldOutShirtSizes.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">Alguns tamanhos estão esgotados.</p>
              )}
            </div>
          )}
```

Pass `hasShirt={showShirtSize}` to `<ProxyAthleteModal>`:

```tsx
      <ProxyAthleteModal
        open={proxyModalOpen}
        routes={event.routes}
        categories={event.categories}
        allowedShirtSizes={allowedShirtSizes}
        hasShirt={showShirtSize}
        onSave={(saved) => {
```

- [ ] **Step 4: `ProxyAthleteModal.tsx` — add `hasShirt` prop, gate field and requirement**

Add `hasShirt: boolean` to the props type and destructure it:

```ts
export default function ProxyAthleteModal({
  open,
  routes,
  categories,
  allowedShirtSizes,
  hasShirt,
  onSave,
  onCancel,
}: {
  open: boolean;
  routes: { id: string; name: string; distanceKm: number }[];
  categories: { id: string; name: string }[];
  allowedShirtSizes: string[];
  hasShirt: boolean;
  onSave: (data: ProxyAthleteData) => void;
  onCancel: () => void;
}) {
```

In `handleSave`, gate the shirt-size requirement:

```ts
    if (hasShirt && !form.shirtSize) return setError("Selecione o tamanho de camiseta.");
```

Wrap the "Camiseta" field in `hasShirt &&`:

```tsx
          {hasShirt && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Camiseta *</label>
              <select value={form.shirtSize ?? ""} onChange={(e) => set("shirtSize", e.target.value)} className="input-field">
                <option value="">Selecione</option>
                {allowedShirtSizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
```

- [ ] **Step 5: Verify typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add components/checkout/CheckoutForm.tsx components/checkout/ProxyAthleteModal.tsx "app/(public)/inscricao/[slug]/page.tsx"
git commit -m "feat(inscricao): esconde/filtra camiseta conforme o lote e a quota do evento"
```

---

## Task 6: Edição de inscrição existente — mesma regra

**Files:**
- Modify: `app/dashboard/inscricoes/[id]/page.tsx`
- Modify: `components/dashboard/EditMyRegistrationButton.tsx`
- Modify: `app/api/athlete/registrations/[id]/route.ts`
- Test: `tests/athlete-registration-participant-route.test.ts` (this file already exists per the earlier grep of `shirtSize` usages — extend it)

**Interfaces:**
- Consumes: `getSoldOutShirtSizes`, `getAllowedShirtSizes`, `TicketBatch.hasShirt`, `EventShirtSizeQuota` (Task 1).

- [ ] **Step 1: Run the current suite as a baseline**

```bash
npx vitest run tests/athlete-registration-participant-route.test.ts
```

Expected: PASS (this file exists today; confirm the baseline before touching it).

- [ ] **Step 2: Update the shared fixture, then write the failing tests**

The file's `REG` constant (top of file) and its `beforeEach` default mock are reused by every test via `dbMock.registration.findUnique.mockResolvedValue({ ...REG, event: { registrationEditDeadline: FUTURE } })`. The new code reads `reg.ticketBatch.hasShirt` and `reg.event.shirtSizeRestrictionDate/Sizes` whenever `shirtSize` is in the request body — including the pre-existing test `"shirtSize/teamName/emergencyContact* também são editáveis"` (line 182), which sends `shirtSize: "G"` and relies on the `beforeEach` default, not its own override. Without updating the shared fixture, that pre-existing test would crash on `reg.ticketBatch` being `undefined`.

Add `eventId: "event-1"` and `ticketBatch: { hasShirt: true }` to `REG`:

```ts
const REG = {
  athleteUserId: "athlete-1",
  eventId: "event-1",
  participantName: "Nome Antigo",
  participantEmail: "antigo@exemplo.com",
  participantPhone: "11900000000",
  participantBirthDate: new Date("1990-01-01"),
  participantGender: "M",
  participantCpf: "11144477735",
  shirtSize: "M",
  teamName: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  ticketBatch: { hasShirt: true },
};
```

Add the restriction fields to the `beforeEach`'s default `event` object:

```ts
    dbMock.registration.findUnique.mockResolvedValue({
      ...REG,
      event: { registrationEditDeadline: FUTURE, shirtSizeRestrictionDate: null, shirtSizeRestrictionSizes: [] },
    });
```

Now add these `it(...)` blocks inside the existing `describe` block, following the same style as the neighboring tests (plain `mockResolvedValueOnce` overrides spreading `...REG`, direct `dbMock.registration.update` assertions — this route never mocks `dbMock.$transaction` directly, since the global `tests/setup.ts` default already runs the array form via `Promise.all`):

```ts
  it("rejeita apagar o tamanho de camiseta quando o lote inclui camiseta", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...REG,
      event: { registrationEditDeadline: FUTURE, shirtSizeRestrictionDate: null, shirtSizeRestrictionSizes: [] },
    });

    const res = await PATCH(makeRequest({ shirtSize: null }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
  });

  it("ignora o tamanho de camiseta enviado quando o lote não inclui camiseta", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...REG,
      ticketBatch: { hasShirt: false },
      event: { registrationEditDeadline: FUTURE, shirtSizeRestrictionDate: null, shirtSizeRestrictionSizes: [] },
    });

    const res = await PATCH(makeRequest({ shirtSize: "G" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.registration.update).toHaveBeenCalledWith({ where: { id: "reg-1" }, data: {} });
  });

  it("rejeita trocar para um tamanho que já atingiu a quota do evento", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...REG,
      shirtSize: "P",
      event: { registrationEditDeadline: FUTURE, shirtSizeRestrictionDate: null, shirtSizeRestrictionSizes: [] },
    });
    dbMock.eventShirtSizeQuota.findUnique.mockResolvedValueOnce({ id: "q1", eventId: "event-1", size: "M", quantity: 5 });
    dbMock.registration.count.mockResolvedValueOnce(5);

    const res = await PATCH(makeRequest({ shirtSize: "M" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.registration.update).not.toHaveBeenCalled();
    expect(dbMock.registration.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "CANCELLED" } }) }),
    );
  });

  it("permite manter o mesmo tamanho mesmo se o evento já esgotou a quota daquele tamanho", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...REG,
      event: { registrationEditDeadline: FUTURE, shirtSizeRestrictionDate: null, shirtSizeRestrictionSizes: [] },
    });

    const res = await PATCH(
      makeRequest({ shirtSize: "M", teamName: "Nova equipe" }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.eventShirtSizeQuota.findUnique).not.toHaveBeenCalled();
    expect(dbMock.registration.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: { shirtSize: "M", teamName: "Nova equipe" },
    });
  });
```

Note on the second test above: with `shirtSize` the only field sent and the batch having no shirt, the route ends up calling `data.shirtSize = ...` never — so `data` stays `{}` and `registration.update` is still called with an empty `data` object (matching how the existing `"retorna 400 para corpo vazio"` test only rejects when the *parsed* body is empty via zod's own `.refine`, not when the resulting `data` object is empty — sending `{ shirtSize: "G" }` passes zod's "at least one field" refine just fine, it's the post-processing that drops it).

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
npx vitest run tests/athlete-registration-participant-route.test.ts
```

Expected: the 4 new tests FAIL (route doesn't know about `ticketBatch.hasShirt` or quota yet).

- [ ] **Step 4: Implement the route changes**

In `app/api/athlete/registrations/[id]/route.ts`, extend the `select`:

```ts
  const reg = await db.registration.findUnique({
    where: { id },
    select: {
      athleteUserId: true,
      eventId: true,
      shirtSize: true,
      participantName: true,
      participantEmail: true,
      participantPhone: true,
      participantBirthDate: true,
      participantGender: true,
      participantCpf: true,
      ticketBatch: { select: { hasShirt: true } },
      event: {
        select: {
          registrationEditDeadline: true,
          shirtSizeRestrictionDate: true,
          shirtSizeRestrictionSizes: true,
        },
      },
    },
  });
```

Add the import:

```ts
import { getAllowedShirtSizes } from "@/lib/shirt-size-restriction";
```

Replace the current line `if (b.shirtSize !== undefined) data.shirtSize = b.shirtSize;` with:

```ts
  if (b.shirtSize !== undefined) {
    if (!reg.ticketBatch.hasShirt) {
      // Lote não inclui camiseta — ignora qualquer valor enviado, defesa em profundidade
      // já que a UI nem mostra o campo nesse caso.
    } else if (b.shirtSize === null) {
      return NextResponse.json({ error: "Selecione o tamanho de camiseta." }, { status: 400 });
    } else {
      const allowedSizes = getAllowedShirtSizes(reg.event, new Date());
      if (!allowedSizes.includes(b.shirtSize)) {
        return NextResponse.json({ error: "Tamanho de camiseta indisponível para este evento" }, { status: 400 });
      }
      if (b.shirtSize !== reg.shirtSize) {
        const quota = await db.eventShirtSizeQuota.findUnique({
          where: { eventId_size: { eventId: reg.eventId, size: b.shirtSize } },
        });
        if (quota) {
          const usedCount = await db.registration.count({
            where: { eventId: reg.eventId, shirtSize: b.shirtSize, status: { not: "CANCELLED" } },
          });
          if (usedCount >= quota.quantity) {
            return NextResponse.json({ error: "Tamanho de camiseta esgotado para este evento" }, { status: 400 });
          }
        }
      }
      data.shirtSize = b.shirtSize;
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/athlete-registration-participant-route.test.ts
```

Expected: PASS, all tests in the file (pre-existing + 4 new).

- [ ] **Step 6: `app/dashboard/inscricoes/[id]/page.tsx` — select the new fields, compute `availableShirtSizes`**

Add the import:

```ts
import { getAllowedShirtSizes } from "@/lib/shirt-size-restriction";
import { getSoldOutShirtSizes } from "@/lib/shirt-size-quota";
```

Add `hasShirt: true` to the `ticketBatch` select, and the restriction fields to the `event` select:

```ts
      event: {
        select: {
          title: true, slug: true, startAt: true, kitPickupAt: true,
          venueName: true, addressLine: true, city: true, state: true,
          organizerContact: true, cancellationDeadline: true, cancellationRequiresApproval: true,
          registrationEditDeadline: true,
          shirtSizeRestrictionDate: true, shirtSizeRestrictionSizes: true,
        },
      },
      route: { select: { name: true, distanceKm: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true, priceAmount: true, hasShirt: true } },
```

Right after `if (!registration) notFound();`, compute the available sizes:

```ts
  const soldOutSizes = await getSoldOutShirtSizes(registration.eventId);
  const dateAllowedSizes = getAllowedShirtSizes(
    {
      shirtSizeRestrictionDate: registration.event.shirtSizeRestrictionDate,
      shirtSizeRestrictionSizes: registration.event.shirtSizeRestrictionSizes,
    },
    new Date(),
  );
  const availableShirtSizes = Array.from(
    new Set([
      ...dateAllowedSizes.filter((s) => !soldOutSizes.includes(s)),
      ...(registration.shirtSize ? [registration.shirtSize] : []),
    ]),
  );
```

Pass the two new props to `<EditMyRegistrationButton>`:

```tsx
        <EditMyRegistrationButton
          registrationId={registration.id}
          deadline={registration.event.registrationEditDeadline?.toISOString() ?? null}
          canEdit={registration.athleteUserId === session.user.id}
          participantName={registration.participantName}
          participantPhone={registration.participantPhone}
          participantBirthDate={registration.participantBirthDate?.toISOString() ?? null}
          participantGender={registration.participantGender}
          shirtSize={registration.shirtSize}
          teamName={registration.teamName}
          emergencyContactName={registration.emergencyContactName}
          emergencyContactPhone={registration.emergencyContactPhone}
          hasShirt={registration.ticketBatch.hasShirt}
          availableShirtSizes={availableShirtSizes}
        />
```

- [ ] **Step 7: `EditMyRegistrationButton.tsx` — new props, hide field, client-side required check**

Add the two new props to `EditMyRegistrationButtonProps`:

```ts
interface EditMyRegistrationButtonProps {
  registrationId: string;
  deadline: string | null;
  canEdit: boolean;
  participantName: string;
  participantPhone: string | null;
  participantBirthDate: string | null;
  participantGender: string | null;
  shirtSize: string | null;
  teamName: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  hasShirt: boolean;
  availableShirtSizes: string[];
}
```

Destructure them in the function signature (add `hasShirt` and `availableShirtSizes` to the props list).

Replace the hardcoded `SHIRT_SIZES` constant usage in the `<select>`'s `.map()` with the prop — change:

```tsx
                  {SHIRT_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
```

to:

```tsx
                  {availableShirtSizes.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
```

(`SHIRT_SIZES` becomes unused — delete the `const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XGG"] as const;` line entirely.)

Wrap the "Camiseta" field's outer `<div>` in `{hasShirt && (...)}`.

In `handleSave`, right after the existing `trimmedName` block (before the `optional` diff loop), add the required check:

```ts
    if (hasShirt && form.shirtSize.trim() === "") {
      setInlineError("Selecione o tamanho de camiseta.");
      return;
    }
```

- [ ] **Step 8: Verify typecheck, the full test suite, and the build**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: all clean/PASS.

- [ ] **Step 9: Commit**

```bash
git add app/dashboard/inscricoes/\[id\]/page.tsx components/dashboard/EditMyRegistrationButton.tsx app/api/athlete/registrations/\[id\]/route.ts tests/athlete-registration-participant-route.test.ts
git commit -m "feat(inscricao): edição de inscrição existente respeita hasShirt e quota"
```

---

## Task 7: Verificação final e registro em `PROGRESSO.md`

**Files:**
- Modify: `PROGRESSO.md`

- [ ] **Step 1: Run everything one more time from a clean state**

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: all clean/PASS — this is the final gate before considering the feature done.

- [ ] **Step 2: Update `PROGRESSO.md`**

Append a new section (following the file's existing `## <título> (<data>)` convention) summarizing: the two features shipped (quota por tamanho, lote sem camiseta), the files touched, the decision to use live counts instead of a denormalized counter (and why), and that the edit-existing-registration gap flagged earlier is now also closed. Update the "Próxima tarefa" section to reflect that this work is implemented but not yet deployed (mirroring how prior entries in this file track deploy status separately from implementation).

- [ ] **Step 3: Commit**

```bash
git add PROGRESSO.md
git commit -m "docs: registra a entrega de quota de camiseta e lote sem camiseta"
```
