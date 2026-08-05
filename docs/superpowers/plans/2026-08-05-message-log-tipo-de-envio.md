# messageType no MessageLog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every email/WhatsApp send in the system records which alert or transactional flow generated it, so `/admin/mensagens` and `/organizador/mensagens` can be filtered by type instead of guessing from the subject text.

**Architecture:** `MessageLog` gains a nullable `messageType` column. `sendMail()` and `sendWhatsAppMessage()` — the two functions that actually call `recordMessageLog()` — gain a `messageType` parameter that they forward straight through. Every specific send function (the ~17 `send*Email` functions in `lib/email.ts`, plus the ~12 direct `sendWhatsAppMessage` call sites in `lib/alerts/*.ts`/`lib/notifications.ts`) already knows which alert/flow it belongs to (most already pass that exact string to `getEffectiveTemplate(alertKey, ...)` one line earlier) — this plan threads that same value one level deeper, into the log.

**Tech Stack:** Next.js 16 App Router, Prisma 5 + PostgreSQL, Vitest, TypeScript.

## Global Constraints

- Zero change to send *behavior* — text, recipient, retry, template resolution all stay exactly as today. This is metadata-only.
- `messageType` starts as an **optional** parameter on `sendMail`/`sendWhatsAppMessage`/`recordMessageLog` (Task 1), then is tightened to **required** on `sendMail`/`sendWhatsAppMessage` only, as the very last step (Task 6) — the required flag is a deliberate safety net: TypeScript refuses to compile any call site this plan missed.
- `sendTestEmail()` (SMTP connectivity test in Admin → Configurações) is out of scope — it never calls `sendMail()`, never logs.
- `sendWhatsAppDocument()` (used only by the ad-report send route) is out of scope — it never calls `recordMessageLog()` today (pre-existing gap, unrelated to this plan) and this plan does not add logging where none exists.
- `sendPaymentErrorEmail` in `lib/email.ts` always resolves the `"PAYMENT_ERROR"` email template regardless of caller (pre-existing behavior, `notifyOrderCancelledWithoutPayment` triggers it too) — its `messageType` must be the fixed literal `"PAYMENT_ERROR"` to match what it actually sends, **not** threaded from a caller-supplied `alertKey`. Changing that template-resolution behavior is out of scope.
- Every new label string is Portuguese, matching the existing `MessageLogList`/filter form copy style (see `CHANNEL_INFO`/`STATUS_ICON` in `components/messages/MessageLogList.tsx`).

## Master Reference Table

The single source of truth for which `messageType` string belongs to which call site. Every task below draws its exact values from this table — use it to resolve any test-fallout ambiguity in Task 6.

| messageType | Label (pt-BR) | Source |
|---|---|---|
| `LOW_STOCK` | Vagas se esgotando | `lib/email.ts::sendLowStockEmail`, `lib/alerts/low-stock.ts:76` |
| `ABANDONED_CART` | Carrinho abandonado | `lib/email.ts::sendAbandonedCartEmail`, `lib/alerts/abandoned-cart.ts:63` |
| `PAYMENT_ERROR` | Erro de pagamento | `lib/email.ts::sendPaymentErrorEmail` (always, see Global Constraints), `lib/alerts/payment-error.ts:60` (when `params.alertKey === "PAYMENT_ERROR"`) |
| `PAYMENT_ERROR_ORDER_CANCELLED` | Erro de pagamento (pedido cancelado) | `lib/alerts/payment-error.ts:60` (when `params.alertKey === "PAYMENT_ERROR_ORDER_CANCELLED"`) |
| `RECONCILIATION_MISMATCH` | Divergência de conciliação | `lib/email.ts::sendReconciliationMismatchEmail`, `lib/alerts/reconciliation.ts:108` |
| `CANCELLATION_REQUESTED` | Solicitação de cancelamento | `lib/email.ts::sendCancellationRequestedEmail`, `lib/alerts/cancellation-requested.ts:100` |
| `DAILY_SUMMARY` | Resumo diário | `lib/email.ts::sendDailySummaryEmail`, `lib/alerts/daily-summary.ts:138,172,248,287` |
| `DAILY_SUMMARY_EVENT` | Resumo diário do evento | `lib/email.ts::sendEventDailySummaryEmail`, `lib/alerts/daily-summary.ts:380` |
| `ADVERTISER_REQUEST_PENDING` | Solicitação de anunciante pendente | `lib/email.ts::sendAdvertiserRequestPendingEmail`, `lib/alerts/advertiser-request-pending.ts:71` |
| `ORDER_CONFIRMED` | Confirmação de inscrição | `lib/email.ts::sendRegistrationConfirmationEmail` (`params.alertKey`), `lib/notifications.ts` (`sendWhatsAppIfActive`'s `alertKey` param) |
| `ORDER_CONFIRMED_PROXY_BUYER` | Confirmação de inscrição (procuração — comprador) | `lib/notifications.ts` (`sendWhatsAppIfActive`'s `alertKey` param) — WhatsApp-only, no email variant |
| `ORDER_CONFIRMED_PROXY_ATHLETE` | Confirmação de inscrição (procuração — atleta) | `lib/email.ts::sendRegistrationConfirmationEmail` (`params.alertKey`), `lib/notifications.ts` (`sendWhatsAppIfActive`'s `alertKey` param) |
| `PASSWORD_RESET` | Redefinição de senha | `lib/email.ts::sendPasswordResetEmail` |
| `ASSISTANT_INVITE` | Convite de assistente | `lib/email.ts::sendAssistantInviteEmail` |
| `PROXY_REGISTRATION_INVITE` | Convite de inscrição por procuração | `lib/email.ts::sendProxyRegistrationInviteEmail` |
| `AD_PURCHASE_CONFIRMATION` | Confirmação de compra de anúncio | `lib/email.ts::sendAdPurchaseConfirmationEmail` |
| `ADVERTISER_PROMOTION` | Promoção a anunciante | `lib/email.ts::sendAdvertiserPromotionEmail` |
| `ADVERTISER_REQUEST_APPROVED` | Solicitação de anunciante aprovada | `lib/email.ts::sendAdvertiserRequestApprovedEmail` |
| `ADVERTISER_REQUEST_REJECTED` | Solicitação de anunciante rejeitada | `lib/email.ts::sendAdvertiserRequestRejectedEmail` |
| `AD_REPORT` | Relatório de anúncio | `app/api/admin/ads/private/[id]/send-report/route.ts:37` (email branch only — the WhatsApp branch there uses `sendWhatsAppDocument`, out of scope) |

That's 12 alert-derived values + 7 transactional = 19 distinct `messageType` values.

---

### Task 1: Schema + core plumbing (optional `messageType`)

**Files:**
- Modify: `prisma/schema.prisma` (the `MessageLog` model)
- Modify: `lib/message-logs.ts`
- Modify: `lib/email.ts:18-63` (`sendMail`)
- Modify: `lib/whatsapp.ts:26-64` (`sendWhatsAppMessage`)
- Test: `tests/lib-message-logs.test.ts`

**Interfaces:**
- Produces: `RecordMessageLogParams.messageType?: string`. `sendMail(opts: { ...; messageType?: string })`. `sendWhatsAppMessage(phone: string, text: string, messageType?: string, options?: { relatedEntityType?: string; relatedEntityId?: string })` — note `messageType` is now the 3rd positional parameter, `options` shifts to 4th. `MESSAGE_TYPE_LABEL: Record<string, string>` (all 19 entries from the Master Reference Table above). `MessageLogFilters.messageType?: string`.
- Consumes: nothing from other tasks (this is the foundation).

- [ ] **Step 1: Add the column to the schema**

In `prisma/schema.prisma`, find the `MessageLog` model:

```prisma
model MessageLog {
  id                String    @id @default(cuid())
  channel           String
  subject           String
  recipientAddress  String
  recipientUserId   String?
  relatedEntityType String?
  relatedEntityId   String?
  status            String
  providerMessageId String?
  errorMessage      String?
  sentAt            DateTime?
  deliveredAt       DateTime?
  readAt            DateTime?
  createdAt         DateTime  @default(now())

  recipientUser User? @relation(fields: [recipientUserId], references: [id])

  @@index([channel, createdAt])
  @@index([recipientUserId, channel, createdAt])
  @@index([providerMessageId])
  @@map("message_logs")
}
```

Replace it with (adds `messageType` after `channel`, and a new index):

```prisma
model MessageLog {
  id                String    @id @default(cuid())
  channel           String
  messageType       String?
  subject           String
  recipientAddress  String
  recipientUserId   String?
  relatedEntityType String?
  relatedEntityId   String?
  status            String
  providerMessageId String?
  errorMessage      String?
  sentAt            DateTime?
  deliveredAt       DateTime?
  readAt            DateTime?
  createdAt         DateTime  @default(now())

  recipientUser User? @relation(fields: [recipientUserId], references: [id])

  @@index([channel, createdAt])
  @@index([messageType, createdAt])
  @@index([recipientUserId, channel, createdAt])
  @@index([providerMessageId])
  @@map("message_logs")
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" success message, no errors. (This does **not** touch the local/production database — that happens at deploy time via `prisma db push`, same as every other schema change this session. Local dev has no DB connection, per this project's established limitation.)

- [ ] **Step 3: Write the failing test for `recordMessageLog` persisting `messageType`**

In `tests/lib-message-logs.test.ts`, add this test inside the existing `describe("recordMessageLog", ...)` block (after the last `it(...)` in that block, before its closing `});`):

```ts
  it("grava messageType quando informado, e null quando omitido", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    await recordMessageLog({
      channel: "EMAIL",
      subject: "Assunto",
      recipientAddress: "atleta@example.com",
      status: "SENT",
      messageType: "LOW_STOCK",
    });

    expect(dbMock.messageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ messageType: "LOW_STOCK" }) }),
    );

    dbMock.user.findUnique.mockResolvedValueOnce(null);
    await recordMessageLog({
      channel: "EMAIL",
      subject: "Assunto",
      recipientAddress: "atleta@example.com",
      status: "SENT",
    });

    expect(dbMock.messageLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ messageType: null }) }),
    );
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/lib-message-logs.test.ts`
Expected: FAIL — `messageType` is `undefined` in the created payload (the field doesn't exist on `RecordMessageLogParams` yet, or `recordMessageLog` doesn't pass it to `db.messageLog.create`).

- [ ] **Step 5: Implement `messageType` in `recordMessageLog`**

In `lib/message-logs.ts`, update `RecordMessageLogParams`:

```ts
export interface RecordMessageLogParams {
  channel: MessageChannel;
  messageType?: string;
  subject: string;
  recipientAddress: string;
  status: "SENT" | "FAILED";
  errorMessage?: string;
  providerMessageId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}
```

And inside `recordMessageLog`, add `messageType` to the `db.messageLog.create` call's `data`:

```ts
    await db.messageLog.create({
      data: {
        channel: params.channel,
        messageType: params.messageType ?? null,
        subject: params.subject,
        recipientAddress: params.recipientAddress,
        recipientUserId,
        status: params.status,
        errorMessage: params.errorMessage ?? null,
        providerMessageId: params.providerMessageId ?? null,
        relatedEntityType: params.relatedEntityType ?? null,
        relatedEntityId: params.relatedEntityId ?? null,
        sentAt: params.status === "SENT" ? new Date() : null,
      },
    });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/lib-message-logs.test.ts`
Expected: PASS, all tests in the file green (the new one plus the pre-existing ones — check none of the pre-existing `toHaveBeenCalledWith` assertions with a literal `data: {...}` object, not `expect.objectContaining`, now fail because they don't list `messageType`. Two tests in the file — "resolve recipientUserId por e-mail exato..." and "resolve recipientUserId por telefone..." — use a literal full-object match; add `messageType: null,` to both their expected `data: {...}` blocks so they still match exactly).

- [ ] **Step 7: Add `MESSAGE_TYPE_LABEL` and the `messageType` filter to `listMessageLogs`**

Still in `lib/message-logs.ts`, add this export near the top of the file (after the `STATUS_RANK` constant):

```ts
export const MESSAGE_TYPE_LABEL: Record<string, string> = {
  LOW_STOCK: "Vagas se esgotando",
  ABANDONED_CART: "Carrinho abandonado",
  PAYMENT_ERROR: "Erro de pagamento",
  PAYMENT_ERROR_ORDER_CANCELLED: "Erro de pagamento (pedido cancelado)",
  RECONCILIATION_MISMATCH: "Divergência de conciliação",
  CANCELLATION_REQUESTED: "Solicitação de cancelamento",
  DAILY_SUMMARY: "Resumo diário",
  DAILY_SUMMARY_EVENT: "Resumo diário do evento",
  ADVERTISER_REQUEST_PENDING: "Solicitação de anunciante pendente",
  ORDER_CONFIRMED: "Confirmação de inscrição",
  ORDER_CONFIRMED_PROXY_BUYER: "Confirmação de inscrição (procuração — comprador)",
  ORDER_CONFIRMED_PROXY_ATHLETE: "Confirmação de inscrição (procuração — atleta)",
  PASSWORD_RESET: "Redefinição de senha",
  ASSISTANT_INVITE: "Convite de assistente",
  PROXY_REGISTRATION_INVITE: "Convite de inscrição por procuração",
  AD_PURCHASE_CONFIRMATION: "Confirmação de compra de anúncio",
  ADVERTISER_PROMOTION: "Promoção a anunciante",
  ADVERTISER_REQUEST_APPROVED: "Solicitação de anunciante aprovada",
  ADVERTISER_REQUEST_REJECTED: "Solicitação de anunciante rejeitada",
  AD_REPORT: "Relatório de anúncio",
};
```

Add `messageType?: string;` to `MessageLogFilters`:

```ts
export interface MessageLogFilters {
  channel?: MessageChannel;
  messageType?: string;
  recipientUserId?: string;
  eventIds?: string[];
  status?: MessageLogStatus;
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}
```

In `listMessageLogs`, destructure it and add it to `baseWhere` — change:

```ts
  const { channel, recipientUserId, eventIds, status, q, from, to, page = 1, pageSize = 20 } = filters;
```

to:

```ts
  const { channel, messageType, recipientUserId, eventIds, status, q, from, to, page = 1, pageSize = 20 } = filters;
```

and change:

```ts
  const baseWhere = {
    ...(channel ? { channel } : {}),
    ...(status ? { status } : {}),
```

to:

```ts
  const baseWhere = {
    ...(channel ? { channel } : {}),
    ...(messageType ? { messageType } : {}),
    ...(status ? { status } : {}),
```

- [ ] **Step 8: Write the failing test for the `messageType` filter**

Add this test inside the existing `describe("listMessageLogs", ...)` block in `tests/lib-message-logs.test.ts`:

```ts
  it("filtra por messageType", async () => {
    await listMessageLogs({ messageType: "LOW_STOCK" });

    expect(dbMock.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { messageType: "LOW_STOCK" } }),
    );
  });
```

- [ ] **Step 9: Run the test to verify it fails, then implement, then verify it passes**

Run: `npx vitest run tests/lib-message-logs.test.ts`
Expected first: FAIL (`messageType` not applied to `where` yet — this should already be fixed by Step 7, so if you did Step 7 before this step, it should already PASS; if so, that's fine, just confirm the assertion holds and move on. If you're following the steps in strict TDD order and wrote Step 8 before Step 7, run it now to see it fail, then apply Step 7's changes, then re-run to see it pass).

Run again after Step 7's changes are in place: `npx vitest run tests/lib-message-logs.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 10: Make `messageType` an optional parameter on `sendMail`**

In `lib/email.ts`, change the `sendMail` signature:

```ts
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  messageType?: string;
  attachments?: { filename: string; content: Buffer }[];
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Promise<void> {
```

(only the `messageType?: string;` line is new — insert it after `html: string;`)

Then update both `recordMessageLog` calls inside `sendMail` to pass it through. The failure-path one:

```ts
  } catch (err) {
    await recordMessageLog({
      channel: "EMAIL",
      messageType: opts.messageType,
      subject: opts.subject,
      recipientAddress: opts.to,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
      ...relatedEntity,
    });
    throw err;
  }
```

And the success-path one:

```ts
  await recordMessageLog({
    channel: "EMAIL",
    messageType: opts.messageType,
    subject: opts.subject,
    recipientAddress: opts.to,
    status: "SENT",
    ...relatedEntity,
  });
```

- [ ] **Step 11: Make `messageType` an optional 3rd parameter on `sendWhatsAppMessage`**

In `lib/whatsapp.ts`, change the `sendWhatsAppMessage` signature (note `options` shifts from 2nd to 3rd param position. Exactly one call site in the whole codebase currently passes an `options` object as the 2nd argument — `lib/notifications.ts` — and Step 12 below fixes it immediately; every other call site only passes `phone, text` today, so this signature change is otherwise safe):

```ts
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  messageType?: string,
  options?: { relatedEntityType?: string; relatedEntityId?: string },
): Promise<void> {
```

Update both `recordMessageLog` calls inside it. The success path:

```ts
  try {
    const { providerMessageId } = await sendTextMessage(config, normalizedPhone, text);
    await recordMessageLog({
      channel: "WHATSAPP",
      messageType,
      subject,
      recipientAddress: normalizedPhone,
      status: "SENT",
      ...(providerMessageId ? { providerMessageId } : {}),
      ...relatedEntity,
    });
  } catch (err) {
    await recordMessageLog({
      channel: "WHATSAPP",
      messageType,
      subject,
      recipientAddress: normalizedPhone,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
      ...relatedEntity,
    });
    throw err;
  }
```

- [ ] **Step 12: Fix the one production call site that already passes a 3rd argument**

`lib/notifications.ts` is the **only** existing call site in the whole codebase that already passes a 3rd positional argument to `sendWhatsAppMessage` — an `options` object. After Step 11's signature change, that object would now bind to the new `messageType?: string` parameter (a type mismatch: object where a string was expected), breaking `npx tsc --noEmit` on this production file immediately — before Task 3 (which handles the rest of the WhatsApp call sites) gets a chance to run. Fix it now, in this task, so Task 1 leaves the codebase compiling.

In `lib/notifications.ts`, inside `sendWhatsAppIfActive`, find:

```ts
    await sendWhatsAppMessage(
      phone,
      text,
      eventId ? { relatedEntityType: "Event", relatedEntityId: eventId } : undefined,
    );
```

Replace with (the function's own `alertKey` parameter — already typed as `"ORDER_CONFIRMED" | "ORDER_CONFIRMED_PROXY_BUYER" | "ORDER_CONFIRMED_PROXY_ATHLETE"` — moves into the new 3rd position; `options` shifts to 4th):

```ts
    await sendWhatsAppMessage(
      phone,
      text,
      alertKey,
      eventId ? { relatedEntityType: "Event", relatedEntityId: eventId } : undefined,
    );
```

This is the same edit Task 3 would otherwise make to this file — Task 3 does **not** touch `lib/notifications.ts` (removed from its file list) since it's fully handled here.

- [ ] **Step 13: Run the full test suite**

Run: `npx tsc --noEmit`
Expected: no errors in any non-test `lib/`/`app/` file (Step 12 was the one production file that needed it). Test-file errors are expected here (see below).

Run: `npm test`
Expected: some pre-existing tests in `tests/whatsapp.test.ts`, `tests/lib-email.test.ts`, and `tests/notifications.test.ts` may now fail if they assert the exact positional arguments of `sendWhatsAppMessage` (e.g. a test asserting `sendWhatsAppMessage("5511...", "text", { relatedEntityType: ... })` — the object that used to be the 2nd optional positional arg is now shifted to 4th position behind `messageType`). Fix any such failures now: find the call in the test, insert the correct 3rd argument (for `tests/notifications.test.ts`, this is one of `"ORDER_CONFIRMED"` / `"ORDER_CONFIRMED_PROXY_BUYER"` / `"ORDER_CONFIRMED_PROXY_ATHLETE"` depending on which scenario the test covers — cross-reference the Master Reference Table; for `tests/whatsapp.test.ts`/`tests/lib-email.test.ts`, which test `sendWhatsAppMessage`/`sendMail` directly rather than through an alert, any placeholder string like `"TEST"` is fine since these test the plumbing, not a real alert's value) before the old `options` argument. Do not fix failures outside `tests/whatsapp.test.ts`/`tests/lib-email.test.ts`/`tests/notifications.test.ts` yet — those belong to Tasks 2-6.

- [ ] **Step 14: Commit**

```bash
git add prisma/schema.prisma lib/message-logs.ts lib/email.ts lib/whatsapp.ts lib/notifications.ts tests/lib-message-logs.test.ts tests/whatsapp.test.ts tests/lib-email.test.ts tests/notifications.test.ts
git commit -m "feat: MessageLog ganha messageType (opcional por enquanto) + MESSAGE_TYPE_LABEL"
```

(only add `tests/whatsapp.test.ts`/`tests/lib-email.test.ts`/`tests/notifications.test.ts` if Step 13 actually required changes to them)

---

### Task 2: `lib/email.ts` — thread `messageType` through all 17 `send*Email` functions

**Files:**
- Modify: `lib/email.ts`

**Interfaces:**
- Consumes: `sendMail(opts: { ...; messageType?: string })` from Task 1.
- Produces: nothing new — every `send*Email` function's own signature is unchanged; only their internal `sendMail(...)` call gains `messageType: "<value>"`.

This task is 17 one-line insertions, each adding a `messageType: "<value>"` (or `messageType: params.alertKey`) line to an existing `sendMail({...})` call. No test changes are needed here in isolation — `lib/email.ts` has no dedicated test file for these wrapper functions' internals (only `tests/lib-email.test.ts`, which tests `sendMail`/`sendTestEmail` directly, already covered in Task 1). The full-suite fallout (tests in `lib/alerts/*.test.ts` etc. that mock `sendMail` and assert its call shape) is fixed in Task 6, using the Master Reference Table.

- [ ] **Step 1: `sendRegistrationConfirmationEmail`**

Find (inside the function body, the `sendMail` call at the end):

```ts
  await sendMail({
    to: params.to,
    subject,
    html: layout(appName, body),
    ...(params.eventId ? { relatedEntityType: "Event", relatedEntityId: params.eventId } : {}),
  });
```

Replace with:

```ts
  await sendMail({
    to: params.to,
    subject,
    html: layout(appName, body),
    messageType: params.alertKey,
    ...(params.eventId ? { relatedEntityType: "Event", relatedEntityId: params.eventId } : {}),
  });
```

- [ ] **Step 2: `sendAdPurchaseConfirmationEmail`**

Find:

```ts
  await sendMail({
    to: params.to,
    subject: `Plano de anúncio confirmado — ${params.planName}`,
    html: layout(
```

Change the `subject:` line's block to add `messageType` right after `to: params.to,`:

```ts
  await sendMail({
    to: params.to,
    messageType: "AD_PURCHASE_CONFIRMATION",
    subject: `Plano de anúncio confirmado — ${params.planName}`,
    html: layout(
```

- [ ] **Step 3: `sendCancellationRequestedEmail`**

Find:

```ts
  await sendMail({ to: params.to, subject, html: layout(appName, body) });
```

(this exact one-liner appears in `sendCancellationRequestedEmail`, `sendLowStockEmail`, `sendAbandonedCartEmail`, `sendPaymentErrorEmail`, `sendAdvertiserRequestPendingEmail`, `sendDailySummaryEmail`, `sendEventDailySummaryEmail` — 7 occurrences total, each needs its own distinct `messageType`. Edit them one at a time, in function order, using each function's surrounding context to identify which occurrence you're on.)

In `sendCancellationRequestedEmail`, replace with:

```ts
  await sendMail({ to: params.to, messageType: "CANCELLATION_REQUESTED", subject, html: layout(appName, body) });
```

- [ ] **Step 4: `sendLowStockEmail`**

In `sendLowStockEmail`, find its `await sendMail({ to: params.to, subject, html: layout(appName, body) });` and replace with:

```ts
  await sendMail({ to: params.to, messageType: "LOW_STOCK", subject, html: layout(appName, body) });
```

- [ ] **Step 5: `sendAbandonedCartEmail`**

In `sendAbandonedCartEmail`, find its `await sendMail({ to: params.to, subject, html: layout(appName, body) });` and replace with:

```ts
  await sendMail({ to: params.to, messageType: "ABANDONED_CART", subject, html: layout(appName, body) });
```

- [ ] **Step 6: `sendPaymentErrorEmail`**

In `sendPaymentErrorEmail`, find its `await sendMail({ to: params.to, subject, html: layout(appName, body) });` and replace with (fixed literal — see Global Constraints, this function always uses the `PAYMENT_ERROR` template regardless of caller):

```ts
  await sendMail({ to: params.to, messageType: "PAYMENT_ERROR", subject, html: layout(appName, body) });
```

- [ ] **Step 7: `sendReconciliationMismatchEmail`**

Find:

```ts
  await sendMail({
    to: params.to,
    subject,
    html: layout(appName, `${introHead}\n${table}\n${introTail}`),
  });
```

Replace with:

```ts
  await sendMail({
    to: params.to,
    messageType: "RECONCILIATION_MISMATCH",
    subject,
    html: layout(appName, `${introHead}\n${table}\n${introTail}`),
  });
```

- [ ] **Step 8: `sendPasswordResetEmail`**

Find:

```ts
  await sendMail({
    to: params.to,
    subject: `Redefinição de senha — ${appName}`,
    html: layout(
```

Replace with:

```ts
  await sendMail({
    to: params.to,
    messageType: "PASSWORD_RESET",
    subject: `Redefinição de senha — ${appName}`,
    html: layout(
```

- [ ] **Step 9: `sendAssistantInviteEmail`**

Find:

```ts
  await sendMail({
    to: params.to,
    subject: `Você foi convidado como assistente — ${appName}`,
    html: layout(
```

Replace with:

```ts
  await sendMail({
    to: params.to,
    messageType: "ASSISTANT_INVITE",
    subject: `Você foi convidado como assistente — ${appName}`,
    html: layout(
```

- [ ] **Step 10: `sendProxyRegistrationInviteEmail`**

Find:

```ts
  await sendMail({
    to: params.to,
    subject: `Você tem uma inscrição em ${appName}`,
    html: layout(
```

Replace with:

```ts
  await sendMail({
    to: params.to,
    messageType: "PROXY_REGISTRATION_INVITE",
    subject: `Você tem uma inscrição em ${appName}`,
    html: layout(
```

- [ ] **Step 11: `sendAdvertiserPromotionEmail`**

Find:

```ts
  await sendMail({
    to: params.to,
    subject: `Sua conta agora é de anunciante — ${appName}`,
    html: layout(
```

Replace with:

```ts
  await sendMail({
    to: params.to,
    messageType: "ADVERTISER_PROMOTION",
    subject: `Sua conta agora é de anunciante — ${appName}`,
    html: layout(
```

- [ ] **Step 12: `sendAdvertiserRequestPendingEmail`**

In `sendAdvertiserRequestPendingEmail`, find its `await sendMail({ to: params.to, subject, html: layout(appName, body) });` and replace with:

```ts
  await sendMail({ to: params.to, messageType: "ADVERTISER_REQUEST_PENDING", subject, html: layout(appName, body) });
```

- [ ] **Step 13: `sendAdvertiserRequestApprovedEmail`**

Find:

```ts
  await sendMail({
    to: params.to,
    subject: `Sua solicitação de anunciante foi aprovada — ${appName}`,
    html: layout(
```

Replace with:

```ts
  await sendMail({
    to: params.to,
    messageType: "ADVERTISER_REQUEST_APPROVED",
    subject: `Sua solicitação de anunciante foi aprovada — ${appName}`,
    html: layout(
```

- [ ] **Step 14: `sendAdvertiserRequestRejectedEmail`**

Find:

```ts
  await sendMail({
    to: params.to,
    subject: `Sua solicitação de anunciante não foi aprovada — ${appName}`,
    html: layout(
```

Replace with:

```ts
  await sendMail({
    to: params.to,
    messageType: "ADVERTISER_REQUEST_REJECTED",
    subject: `Sua solicitação de anunciante não foi aprovada — ${appName}`,
    html: layout(
```

- [ ] **Step 15: `sendDailySummaryEmail`**

In `sendDailySummaryEmail`, find its `await sendMail({ to: params.to, subject, html: layout(appName, body) });` and replace with:

```ts
  await sendMail({ to: params.to, messageType: "DAILY_SUMMARY", subject, html: layout(appName, body) });
```

- [ ] **Step 16: `sendEventDailySummaryEmail`**

In `sendEventDailySummaryEmail`, find its `await sendMail({ to: params.to, subject, html: layout(appName, body) });` and replace with:

```ts
  await sendMail({ to: params.to, messageType: "DAILY_SUMMARY_EVENT", subject, html: layout(appName, body) });
```

- [ ] **Step 17: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file (pre-existing errors from other in-progress tasks, if any, are not this task's concern).

- [ ] **Step 18: Commit**

```bash
git add lib/email.ts
git commit -m "feat: lib/email.ts passa messageType em todo envio (17 funcoes)"
```

---

### Task 3: WhatsApp call sites — thread `messageType` through 7 files, 11 call sites

**Files:**
- Modify: `lib/alerts/abandoned-cart.ts:63`
- Modify: `lib/alerts/advertiser-request-pending.ts:71`
- Modify: `lib/alerts/cancellation-requested.ts:100`
- Modify: `lib/alerts/daily-summary.ts:138,172,248,287,380`
- Modify: `lib/alerts/low-stock.ts:76`
- Modify: `lib/alerts/payment-error.ts:60`
- Modify: `lib/alerts/reconciliation.ts:108`

**Interfaces:**
- Consumes: `sendWhatsAppMessage(phone, text, messageType?, options?)` from Task 1. `lib/notifications.ts` is **not** part of this task — Task 1 already fixed its one call site (it was the only production call site passing a 3rd positional argument before this plan, so it had to be fixed immediately for Task 1 to leave the codebase compiling).

- [ ] **Step 1: `lib/alerts/abandoned-cart.ts`**

Find (line 63):

```ts
          await sendWhatsAppMessage(order.buyer.athleteProfile.phone, text);
```

Replace with:

```ts
          await sendWhatsAppMessage(order.buyer.athleteProfile.phone, text, "ABANDONED_CART");
```

- [ ] **Step 2: `lib/alerts/advertiser-request-pending.ts`**

Find (line 71):

```ts
          await sendWhatsAppMessage(admin.phone, text);
```

Replace with:

```ts
          await sendWhatsAppMessage(admin.phone, text, "ADVERTISER_REQUEST_PENDING");
```

- [ ] **Step 3: `lib/alerts/cancellation-requested.ts`**

Find (line 100):

```ts
          await sendWhatsAppMessage(recipient.phone, text);
```

Replace with:

```ts
          await sendWhatsAppMessage(recipient.phone, text, "CANCELLATION_REQUESTED");
```

- [ ] **Step 4: `lib/alerts/daily-summary.ts` — 5 call sites**

Find (line 138):

```ts
            await sendWhatsAppMessage(admin.phone, await buildAdminWhatsAppText(metrics, dateLabel));
```

Replace with:

```ts
            await sendWhatsAppMessage(admin.phone, await buildAdminWhatsAppText(metrics, dateLabel), "DAILY_SUMMARY");
```

Find (line 172):

```ts
              await sendWhatsAppMessage(recipient.value, await buildAdminWhatsAppText(metrics, dateLabel));
```

Replace with:

```ts
              await sendWhatsAppMessage(recipient.value, await buildAdminWhatsAppText(metrics, dateLabel), "DAILY_SUMMARY");
```

Find (line 248):

```ts
            await sendWhatsAppMessage(organizer.organizerProfile!.phone, await buildOrganizerWhatsAppText(metrics, dateLabel));
```

Replace with:

```ts
            await sendWhatsAppMessage(organizer.organizerProfile!.phone, await buildOrganizerWhatsAppText(metrics, dateLabel), "DAILY_SUMMARY");
```

Find (line 287):

```ts
              await sendWhatsAppMessage(recipient.value, await buildOrganizerWhatsAppText(metrics, dateLabel));
```

Replace with:

```ts
              await sendWhatsAppMessage(recipient.value, await buildOrganizerWhatsAppText(metrics, dateLabel), "DAILY_SUMMARY");
```

Find (line 380):

```ts
            await sendWhatsAppMessage(recipient.value, await buildEventWhatsAppText(values, eventId));
```

Replace with:

```ts
            await sendWhatsAppMessage(recipient.value, await buildEventWhatsAppText(values, eventId), "DAILY_SUMMARY_EVENT");
```

- [ ] **Step 5: `lib/alerts/low-stock.ts`**

Find (line 76):

```ts
          await sendWhatsAppMessage(organizer.phone, text);
```

Replace with:

```ts
          await sendWhatsAppMessage(organizer.phone, text, "LOW_STOCK");
```

- [ ] **Step 6: `lib/alerts/payment-error.ts`**

Find (line 60):

```ts
        await sendWhatsAppMessage(params.buyer.athleteProfile.phone, text);
```

Replace with (uses `params.alertKey`, which is already correctly either `"PAYMENT_ERROR"` or `"PAYMENT_ERROR_ORDER_CANCELLED"` depending on the real caller — see the `CancellationNotificationTarget` interface and the two callers `notifyPaymentError`/`notifyOrderCancelledWithoutPayment` above in the same file):

```ts
        await sendWhatsAppMessage(params.buyer.athleteProfile.phone, text, params.alertKey);
```

- [ ] **Step 7: `lib/alerts/reconciliation.ts`**

Find (line 108):

```ts
          await sendWhatsAppMessage(admin.phone, text);
```

Replace with:

```ts
          await sendWhatsAppMessage(admin.phone, text, "RECONCILIATION_MISMATCH");
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from these 7 files.

- [ ] **Step 9: Commit**

```bash
git add lib/alerts/abandoned-cart.ts lib/alerts/advertiser-request-pending.ts lib/alerts/cancellation-requested.ts lib/alerts/daily-summary.ts lib/alerts/low-stock.ts lib/alerts/payment-error.ts lib/alerts/reconciliation.ts
git commit -m "feat: alertas passam messageType em todo envio de WhatsApp (7 arquivos, 11 pontos)"
```

---

### Task 4: `send-report` route — `AD_REPORT` messageType

**Files:**
- Modify: `app/api/admin/ads/private/[id]/send-report/route.ts:37-42`

**Interfaces:**
- Consumes: `sendMail(opts: { ...; messageType?: string })` from Task 1.

- [ ] **Step 1: Add `messageType` to the email branch**

Find:

```ts
  if (parsed.data.channel === "email") {
    await sendMail({
      to: data.contactEmail,
      subject: "Relatório do seu anúncio",
      html: `<p>Olá,</p><p>Segue em anexo o relatório de desempenho do seu anúncio <strong>${data.adLabel}</strong>.</p>`,
      attachments: [{ filename: "relatorio.pdf", content: pdfBuffer }],
    });
```

Replace with:

```ts
  if (parsed.data.channel === "email") {
    await sendMail({
      to: data.contactEmail,
      messageType: "AD_REPORT",
      subject: "Relatório do seu anúncio",
      html: `<p>Olá,</p><p>Segue em anexo o relatório de desempenho do seu anúncio <strong>${data.adLabel}</strong>.</p>`,
      attachments: [{ filename: "relatorio.pdf", content: pdfBuffer }],
    });
```

(The `else` branch, `sendWhatsAppDocument(...)`, is untouched — out of scope per Global Constraints.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/ads/private/[id]/send-report/route.ts"
git commit -m "feat: rota de relatorio de anuncio passa messageType AD_REPORT no envio por e-mail"
```

---

### Task 5: UI — filtro e coluna "Tipo" em /admin/mensagens e /organizador/mensagens

**Files:**
- Modify: `app/admin/mensagens/page.tsx`
- Modify: `app/organizador/mensagens/page.tsx`
- Modify: `components/messages/MessageLogList.tsx`

**Interfaces:**
- Consumes: `MESSAGE_TYPE_LABEL` and `MessageLogFilters.messageType` from Task 1.
- Produces: nothing new for later tasks.

- [ ] **Step 1: `MessageLogList.tsx` — add the "Tipo" column**

In `components/messages/MessageLogList.tsx`, import `MESSAGE_TYPE_LABEL` and add `messageType` to the row type:

```ts
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MESSAGE_TYPE_LABEL } from "@/lib/message-logs";

export interface MessageLogRow {
  id: string;
  channel: "EMAIL" | "WHATSAPP";
  messageType: string | null;
  subject: string;
  recipientAddress: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  sentAt: Date | null;
  createdAt: Date;
  recipientUser: { name: string } | null;
}
```

Add a "Tipo" header cell right after "Canal":

```tsx
          <tr className="text-left text-gray-500 border-b dark:border-gray-700 text-xs uppercase">
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Canal</th>
            <th className="pb-2 pr-4">Tipo</th>
            <th className="pb-2 pr-4">Destinatário</th>
            <th className="pb-2 pr-4">Assunto</th>
            <th className="pb-2">Quando</th>
          </tr>
```

Add the matching data cell right after the "Canal" cell in the row body:

```tsx
                <td className="py-2 pr-4">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${channelInfo.color}`}>
                    {channelInfo.icon} {channelInfo.label}
                  </span>
                </td>
                <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">
                  {row.messageType ? MESSAGE_TYPE_LABEL[row.messageType] ?? row.messageType : "Desconhecido"}
                </td>
```

- [ ] **Step 2: `app/admin/mensagens/page.tsx` — add the "Tipo" filter**

Import `MESSAGE_TYPE_LABEL`:

```ts
import { listMessageLogs, MESSAGE_TYPE_LABEL, type MessageLogStatus } from "@/lib/message-logs";
```

Add `type` to `SearchParams`:

```ts
interface SearchParams {
  channel?: string;
  type?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
}
```

Parse it (right after the `channel` line):

```ts
  const channel = params.channel === "EMAIL" || params.channel === "WHATSAPP" ? params.channel : undefined;
  const messageType = params.type?.trim() || undefined;
  const status = params.status?.trim() || undefined;
```

Pass it to `listMessageLogs`:

```ts
  const { rows, total, totalPages } = await listMessageLogs({
    channel,
    messageType,
    status: status as MessageLogStatus | undefined,
    q,
    from: dateFrom ? new Date(dateFrom) : undefined,
    to: dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined,
    page,
  });
```

Include it in `buildFilterQuery`'s `merged` object and query params:

```ts
  const buildFilterQuery = (overrides: Partial<SearchParams> = {}) => {
    const query = new URLSearchParams();
    const merged = { channel, type: messageType, status, q, dateFrom, dateTo, ...overrides };
    if (merged.channel) query.set("channel", merged.channel);
    if (merged.type) query.set("type", merged.type);
    if (merged.status) query.set("status", merged.status);
    if (merged.q) query.set("q", merged.q);
    if (merged.dateFrom) query.set("dateFrom", merged.dateFrom);
    if (merged.dateTo) query.set("dateTo", merged.dateTo);
    return query;
  };
```

Add the `<select>` to the filter form, right after the "Canal" field, and widen the grid from 6 to 7 columns:

```tsx
      <form method="GET" className="card grid gap-4 md:grid-cols-7">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input name="q" defaultValue={q ?? ""} placeholder="Nome, e-mail ou telefone" className="input-field text-sm py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Canal</label>
          <select name="channel" defaultValue={channel ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            <option value="EMAIL">E-mail</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tipo</label>
          <select name="type" defaultValue={messageType ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(MESSAGE_TYPE_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
```

(the rest of the form — "Status", "De", "Até", buttons — is unchanged, just now a 7th grid cell instead of 6th)

- [ ] **Step 3: `app/organizador/mensagens/page.tsx` — mirror the same change**

Apply the exact same edits as Step 2 to this file: import `MESSAGE_TYPE_LABEL`, add `type` to `SearchParams`, parse `messageType`, pass it to `listMessageLogs` (alongside the existing `recipientUserId`/`eventIds` params, unchanged), include it in `buildFilterQuery`, add the `<select>` after "Canal", widen the grid to `md:grid-cols-7`.

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean build, both `/admin/mensagens` and `/organizador/mensagens` compile.

- [ ] **Step 5: Commit**

```bash
git add app/admin/mensagens/page.tsx app/organizador/mensagens/page.tsx components/messages/MessageLogList.tsx
git commit -m "feat: filtro e coluna Tipo em /admin/mensagens e /organizador/mensagens"
```

---

### Task 6: Tighten `messageType` to required + fix all test fallout

**Files:**
- Modify: `lib/email.ts:18-25` (`sendMail` signature)
- Modify: `lib/whatsapp.ts:26-30` (`sendWhatsAppMessage` signature)
- Test: any file under `tests/` whose mocked/asserted call to `sendMail`/`sendWhatsAppMessage` (or any of the `send*Email` wrapper functions) breaks as a result — expected candidates, found via `grep -rl "sendWhatsAppMessage\|sendMail(" tests/`: `tests/admin-ad-send-report-route.test.ts`, `tests/admin-anunciantes-approve-route.test.ts`, `tests/admin-anunciantes-reject-route.test.ts`, `tests/admin-whatsapp-routes.test.ts`, `tests/alert-abandoned-cart.test.ts`, `tests/alert-cancellation-requested.test.ts`, `tests/alert-daily-summary.test.ts`, `tests/alert-low-stock.test.ts`, `tests/alert-payment-error.test.ts`, `tests/alert-reconciliation.test.ts`, `tests/api-admin-message-templates-actions.test.ts`, `tests/assistants-create-or-promote.test.ts`, `tests/lib-advertiser-request-pending.test.ts`, `tests/lib-email-advertiser-request.test.ts`, `tests/lib-email.test.ts`, `tests/lib-promote-advertiser.test.ts`, `tests/notifications.test.ts`, `tests/payment-webhook-ad-purchase.test.ts`, `tests/proxy-athlete-invite.test.ts`, `tests/whatsapp.test.ts`.

**Interfaces:**
- Consumes: everything from Tasks 1-5. This is the final integration/safety-net task — it proves no call site was missed.

This task has no new production behavior — it flips two `?` to required and then makes the build green again. Use the **Master Reference Table** at the top of this plan as the single source of truth for what value belongs where; do not invent new values.

- [ ] **Step 1: Tighten `sendMail`'s signature**

In `lib/email.ts`, change:

```ts
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  messageType?: string;
  attachments?: { filename: string; content: Buffer }[];
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Promise<void> {
```

to (drop the `?`):

```ts
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  messageType: string;
  attachments?: { filename: string; content: Buffer }[];
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Promise<void> {
```

- [ ] **Step 2: Tighten `sendWhatsAppMessage`'s signature**

In `lib/whatsapp.ts`, change:

```ts
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  messageType?: string,
  options?: { relatedEntityType?: string; relatedEntityId?: string },
): Promise<void> {
```

to (drop the `?`):

```ts
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  messageType: string,
  options?: { relatedEntityType?: string; relatedEntityId?: string },
): Promise<void> {
```

- [ ] **Step 3: Type-check to find every missed or now-mistyped call site**

Run: `npx tsc --noEmit`
Expected: this may report errors in test files that construct a mock or call `sendMail`/`sendWhatsAppMessage` directly without a `messageType`. It should report **zero** errors in any non-test `lib/`, `app/` file — Tasks 2-4 already covered every real call site. If a non-test file errors here, that means a call site was missed in Tasks 2-4: go back and add the correct `messageType` from the Master Reference Table, following the same pattern as the task that covers that file.

For every test-file error, open the file, find the call/mock in question, and add the `messageType` string that matches what the corresponding production code actually sends (cross-reference the Master Reference Table — e.g. a test in `tests/alert-low-stock.test.ts` asserting on `lib/alerts/low-stock.ts`'s WhatsApp call needs `"LOW_STOCK"`).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: additional failures beyond pure type errors — tests using `expect(...).toHaveBeenCalledWith(exactPhone, exactText)` (without a wildcard) on `sendWhatsAppMessage`, or an exact `{to, subject, html}` object (without a wildcard) on `sendMail`, now fail because the real call includes one more argument/field they didn't list. Fix each by adding the `messageType` matching the Master Reference Table to the expected call — e.g.:

```ts
// before
expect(sendWhatsAppMessage).toHaveBeenCalledWith("11999999999", expect.any(String));
// after
expect(sendWhatsAppMessage).toHaveBeenCalledWith("11999999999", expect.any(String), "ABANDONED_CART");
```

```ts
// before
expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@x.com" }));
// after (objectContaining already tolerates the new field with no change needed — only add
// messageType to the expectation if the test specifically asserts on it)
```

Repeat until `npm test` is fully green.

- [ ] **Step 5: Full clean build**

Run: `rm -rf .next && npm run build`
Expected: clean build, no errors, no warnings from the touched files.

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts lib/whatsapp.ts tests/
git commit -m "feat: messageType passa a ser obrigatorio em sendMail/sendWhatsAppMessage (rede de seguranca final)"
```

---

## Deploy note (for whoever runs the next production deploy)

Schema change: `messageType String?` column + index on `MessageLog`. Run `docker compose run --rm app sh -c "npx prisma db push --skip-generate"` **before** restarting the app container, same order as every other schema-changing deploy this session. No data backfill possible or needed — existing rows show "Desconhecido" in the UI, by design.
