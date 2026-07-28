# Alerts fix round 2 — report

Starting HEAD: `477ce57` (confirmed via `git log --oneline -1`).

## Summary

All 4 fixes from the review were applied. Full test suite (scoped to `tests/`, excluding the two
stale `.claude/worktrees/*` copies) passes: **200 files / 1296 tests, all green**. `npx tsc
--noEmit` clean. `npm run build` clean (exit 0).

---

## Fix A (Critical) — `lib/notifications.ts`

Replaced the single top-of-function claim (`claimAlert("ORDER_CONFIRMED", "Order", orderId,
"EMAIL")`, never released) with four independent, correctly-scoped claims — one per actual send
attempt, each placed inside its channel's readiness check, mirroring `lib/alerts/payment-error.ts`:

| Send | Claim key (alertType, entityType, entityId, channel) |
|---|---|
| Buyer email | `ORDER_CONFIRMED`, `Order`, `orderId`, `EMAIL` |
| Buyer WhatsApp | `ORDER_CONFIRMED`, `Order`, `` `${orderId}:buyer` ``, `WHATSAPP` |
| Athlete email (proxy only) | `ORDER_CONFIRMED`, `Order`, `` `${orderId}:athlete` ``, `EMAIL` |
| Athlete WhatsApp (proxy only) | `ORDER_CONFIRMED`, `Order`, `` `${orderId}:athlete` ``, `WHATSAPP` |

All four `(entityId, channel)` pairs are distinct, so none can collide under the AlertLog unique
constraint `@@unique([alertType, entityId, channel])` (confirmed in `prisma/schema.prisma`).

- `sendWhatsAppIfActive` signature extended to
  `(phone, text, eventId, claimEntityId, bypassDedupe)`. Claim/unclaim logic moved inside it,
  `if (!phone) return;` kept first exactly as before. On failure it calls
  `unclaimAlert(...)` only when `!bypassDedupe`, and still does **not** rethrow (fire-and-forget
  contract preserved — the two call sites don't wrap it in their own try/catch).
- Both email sends (buyer, athlete) keep their existing single try/catch block; the claim was
  inserted inside the `if (isSmtpReady(cfg))` branch, and `if (!bypassDedupe) await
  unclaimAlert(...)` was added inside the existing catch, before the existing `console.error(...)`
  — no `throw` added, matching the pre-existing non-rethrowing behavior of this function (unlike
  `payment-error.ts`, which has a different caller contract and does rethrow).
- New signature: `notifyOrderConfirmed(orderId: string, options?: { bypassDedupe?: boolean })`.
- **Minor #3**: wrapped the entire function body in a top-level `try { ... } catch (err) {
  console.error("[notifyOrderConfirmed] failed:", err); }`, since `claimAlert` can rethrow a
  non-`P2002` DB error and all 5 call sites (`app/api/checkout/route.ts`,
  `app/api/webhooks/payment/route.ts`, `app/api/orders/[id]/status/route.ts`, and the two in
  `lib/payment/reconciliation.ts`) call it via `void notifyOrderConfirmed(...)` expecting it never
  to throw an unhandled rejection. (Note: I found 5 call sites total, not 4 — `checkout/route.ts`
  is a 5th, invoked at the moment of free/immediate order confirmation. All 5 are protected the
  same way by this top-level try/catch, so this doesn't change anything about the fix, just noting
  the actual count for the record.)

### Tests (`tests/notifications.test.ts`)

Replaced the brittle `mockResolvedValueOnce(...).mockRejectedValueOnce(...)` sequencing in the
existing dedupe test with a `mockPerKeyAlertLog()` helper that simulates the real AlertLog unique
constraint per `(alertType, entityId, channel)` key — this is both more correct (distinguishes the
now-4 separate claim keys) and more robust to call-count changes. Added a new test proving Fix A:
calling `notifyOrderConfirmed(orderId, { bypassDedupe: true })` after a prior successful (non-bypass)
call still sends again, while a second non-bypass call in between remains blocked. This test would
have failed against the previous round's code (no bypass option existed at all).

---

## Fix B — bypassDedupe wired into resend/manual-confirm routes

Changed the call in all 3 routes to pass `{ bypassDedupe: true }`:

1. `app/api/admin/registrations/[id]/resend-confirmation-email/route.ts`
2. `app/api/organizer/registrations/[id]/resend-confirmation-email/route.ts`
3. `app/api/organizer/registrations/[id]/manual-confirm/route.ts`

### Tests

Updated the existing `expect(notifyOrderConfirmed).toHaveBeenCalledWith("order-1")` assertions in
`tests/admin-resend-confirmation-email-route.test.ts`,
`tests/organizer-resend-confirmation-email-route.test.ts`, and
`tests/organizer-manual-confirm-route.test.ts` to
`toHaveBeenCalledWith("order-1", { bypassDedupe: true })` — these assertions already existed (no
new test needed), so updating them in place *is* the regression test: they'd have failed against
the pre-Fix-B code (which called `notifyOrderConfirmed` with only one argument).

---

## Fix C (Important) — `lib/alerts/reconciliation.ts`

Changed the dedupe key at both call sites (email loop and WhatsApp loop) from
`` `${mismatch.paymentId}:${admin.email}` ``  /  `` `${mismatch.paymentId}:${admin.phone}` `` to
include the specific divergence:

```
`${mismatch.paymentId}:${mismatch.localStatus}->${mismatch.gatewayStatus}:${admin.email}`
`${mismatch.paymentId}:${mismatch.localStatus}->${mismatch.gatewayStatus}:${admin.phone}`
```

mirroring exactly how `lib/alerts/cancellation-requested.ts` folds `cancellationRequestedAt` into
its key for the identical class of bug. Confirmed `PaymentMismatch` (in
`lib/payment/reconciliation.ts`) has both `localStatus: string` and `gatewayStatus: string` fields
before making the change.

### Tests (`tests/alert-reconciliation.test.ts`)

Existing tests use sequential `mockResolvedValueOnce`/`mockRejectedValueOnce` on
`dbMock.alertLog.create` rather than asserting on the literal key string, so none needed updating —
they still pass unchanged. Added a new test: the same `paymentId` with two different
`localStatus`/`gatewayStatus` pairs (simulating an earlier PENDING→PAID correction followed weeks
later by a PAID→REFUNDED chargeback) both get alerted. This is the regression test proving Fix C —
it would have failed (2nd alert silently swallowed) against the previous round's key scheme.

---

## Fix D (Minor) — `lib/alerts/abandoned-cart.ts`

Wrapped the two `if (settings.emailEnabled) {...}` / `if (settings.whatsappEnabled && ...) {...}`
blocks in `sendAbandonedCartAlert` in a `try { ... } finally { if (sentSomething) { await
db.auditLog.create({...}); } }`, then `return { sent: sentSomething };` after the try/finally. No
other change to the existing throw/unclaim behavior inside either block — the original throw still
propagates normally after the finally runs.

### Tests (`tests/alert-abandoned-cart.test.ts`)

Added a new test: email succeeds (channel enabled, athlete has phone for WhatsApp too), WhatsApp
then throws → `sendAbandonedCartAlert` still rejects with the WhatsApp error (existing behavior
preserved), but `dbMock.auditLog.create` **was** called with `CART_ABANDONED` / `entityId:
"order-1"`. This would NOT have been called against the previous round's code, since the throw
would have skipped the (then unconditionally-last) audit-log line entirely.

---

## Verification run details

- `npx vitest run tests/ --exclude "**/.claude/**"` → 200 files, 1296 tests, all passed. (The
  `--exclude` flag was needed because a bare `tests/` path still matches file basenames inside the
  two known stale `.claude/worktrees/agent-*` copies; without it they get collected too, though in
  this case they happened to still pass since they're untouched snapshots of an earlier state.)
- `npx tsc --noEmit` → no output, clean.
- `npm run build` → exit 0, full route manifest printed, no errors.

## Judgment calls / things flagged for the requester to double-check

1. **WhatsApp claim ordering inside `sendWhatsAppIfActive`.** Per the instructions, the claim is
   taken right after the `if (!phone) return;` guard, *before* the `isWhatsAppConnectionActive()`
   check inside the try block. This means: if the WhatsApp connection happens to be down
   (`isWhatsAppConnectionActive()` returns false) at the moment of a genuine, non-bypass call, the
   WHATSAPP claim is still consumed even though no message was actually sent (or attempted) — a
   later legitimate trigger for the same order would find that channel already "claimed" and
   silently skip it forever (short of a manual bypass resend). This mirrors the *pre-existing*
   behavior class (the old single top-of-function claim was likewise taken regardless of whether
   WhatsApp ultimately fired), so it's not a new regression, but it's now more visible/isolated to
   the WhatsApp channel specifically since each channel has its own claim. I followed the spec's
   explicit ordering instructions literally rather than moving the claim after the connection
   check, since that reordering wasn't part of what was asked and touching it would be improvising
   beyond the brief. Flagging in case you want the claim moved to after
   `isWhatsAppConnectionActive()` in a follow-up.
2. **Claim-key collision check.** Verified by reading `prisma/schema.prisma`'s `AlertLog` model:
   the unique constraint is `@@unique([alertType, entityId, channel])` — `entityType` is not part
   of it, purely descriptive. All 4 new `(entityId, channel)` pairs in Fix A
   (`orderId`+EMAIL, `${orderId}:buyer`+WHATSAPP, `${orderId}:athlete`+EMAIL,
   `${orderId}:athlete`+WHATSAPP) are pairwise distinct — no collision risk. Same check applied to
   Fix C's new reconciliation key shape (paymentId+transition+recipient) — distinct per
   admin/channel/transition combination as intended.
3. Found a 5th `notifyOrderConfirmed` call site not mentioned in the brief
   (`app/api/checkout/route.ts`, line ~224) alongside the 4 named ones (webhook, poller, 2×
   reconciliation). It's covered by the same top-level try/catch from Minor #3, so no separate
   action was needed, just noting the actual count differs from "four" in the brief.

## Files changed

- `lib/notifications.ts`
- `app/api/admin/registrations/[id]/resend-confirmation-email/route.ts`
- `app/api/organizer/registrations/[id]/resend-confirmation-email/route.ts`
- `app/api/organizer/registrations/[id]/manual-confirm/route.ts`
- `lib/alerts/reconciliation.ts`
- `lib/alerts/abandoned-cart.ts`
- `tests/notifications.test.ts`
- `tests/admin-resend-confirmation-email-route.test.ts`
- `tests/organizer-resend-confirmation-email-route.test.ts`
- `tests/organizer-manual-confirm-route.test.ts`
- `tests/alert-reconciliation.test.ts`
- `tests/alert-abandoned-cart.test.ts`
