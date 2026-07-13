# Resumo Diário (Admin + Organizador) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a daily digest (email + WhatsApp) of the previous day's activity to every admin and every organizer, respecting each individual user's own on/off preference per channel.

**Architecture:** Two new boolean columns on `User` back a per-user, per-channel toggle (no new table, no global `PlatformSetting`). A metrics module computes the previous full Brasília calendar day's numbers (admin: platform-wide; organizer: scoped to their own events). A sender module loops recipients by role, checks each recipient's own toggle, dedupes per (day, recipient, channel) via the existing `AlertLog` mechanism, and sends. A new cron route (same `x-cron-secret` pattern as the 3 existing cron routes) triggers both sends once daily.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest, Zod — no new dependencies.

## Global Constraints

- Two new `User` columns: `dailySummaryEmailEnabled Boolean @default(true)`, `dailySummaryWhatsappEnabled Boolean @default(true)` — additive migration, no backfill needed.
- Window = the full previous **Brasília calendar day**. Brazil has observed a fixed UTC-3 offset with no DST since 2019, so this is computed with plain UTC arithmetic (no timezone library): Brasília midnight expressed in UTC is always `03:00 UTC`.
- Cron intended to run at 07:00 Brasília = `10:00 UTC` daily (VPS crontab entry, documented — not code, matching how the 3 existing cron jobs have no crontab-as-code in this repo).
- **Do NOT** make the schedule or window configurable via UI — the user explicitly asked to drop that requirement mid-session. Fixed 07:00 Brasília cron, fixed previous-day window.
- Admin digest content: new users (role `ATHLETE` only — kept disjoint from "new organizers"), new organizers, events created, paid registrations, gross revenue, platform fees retained, payouts generated (count + amount), cancelled-or-refunded count.
- Organizer digest content (scoped to the organizer's own events): paid registrations, gross revenue, coupons used, cancellations requested, sold-out batches.
- Zero-activity day still sends (all-zero digest) — no skip-if-empty logic anywhere.
- Email is the full detailed table; WhatsApp is a condensed 1-line summary + a link back to the dashboard.
- Dedupe via the existing `lib/alerts/dedupe.ts` (`claimAlert`/`unclaimAlert`), `alertType = "DAILY_SUMMARY"`, `entityType = "DailySummary"`, `entityId = "${YYYY-MM-DD}:${userId}"` (date derived from `dayStart`), one claim per channel per recipient per day.
- No new `PlatformSetting`-backed global toggle for this feature (unlike every other existing alert type) — the two `User` columns ARE the toggle, checked per-recipient inside the loop instead of once globally before it.
- The two toggle checkboxes are wired into the **existing** `PUT /api/admin/profile` and `PUT /api/organizer/account` routes (both already update plain `User` fields) and their existing "Meus Dados" pages — no new route, no new page.
- Out of scope (do not build): a "send test now" button, per-metric (as opposed to per-channel) preferences, digests for any role other than `ADMIN`/`ORGANIZER`.

---

### Task 1: Schema — per-user daily-summary toggle columns

**Files:**
- Modify: `prisma/schema.prisma` (`User` model, around line 96-122)
- Create: `prisma/migrations/20260713010000_add_daily_summary_preferences/migration.sql`

**Interfaces:**
- Produces: `User.dailySummaryEmailEnabled: boolean`, `User.dailySummaryWhatsappEnabled: boolean` (both non-null, default `true`) — consumed by every later task's Prisma queries and by the two profile routes/pages in Task 5.

- [ ] **Step 1: Add the two columns to the Prisma schema**

In `prisma/schema.prisma`, inside `model User { ... }`, add the two new fields right after `active`:

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  passwordHash  String?
  name          String
  phone         String?
  cpf           String?
  role          UserRole  @default(ATHLETE)
  active        Boolean   @default(true)
  dailySummaryEmailEnabled    Boolean   @default(true)
  dailySummaryWhatsappEnabled Boolean   @default(true)
  uiDensity     String    @default("comfortable")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
```

(Everything else in the model — relations, `@@index`, `@@map` — stays exactly as-is.)

- [ ] **Step 2: Generate the Prisma client and verify it compiles**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` with no errors.

Run: `npx tsc --noEmit`
Expected: no new type errors (existing `User` consumers are unaffected — these are new optional-to-callers fields with a DB default).

- [ ] **Step 3: Write the migration SQL by hand**

There is no live database connection in this environment, so `prisma migrate dev` cannot be run. Write the migration file directly (matching the exact convention used by `prisma/migrations/20260713000000_add_created_at_indexes/migration.sql` from the previous batch — hand-written additive SQL with a matching directory name).

Create `prisma/migrations/20260713010000_add_daily_summary_preferences/migration.sql`:

```sql
ALTER TABLE "users" ADD COLUMN "dailySummaryEmailEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "dailySummaryWhatsappEnabled" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260713010000_add_daily_summary_preferences/migration.sql
git commit -m "feat: add per-user daily summary email/whatsapp toggle columns"
```

---

### Task 2: Metrics — `lib/alerts/daily-summary-metrics.ts`

**Files:**
- Create: `lib/alerts/daily-summary-metrics.ts`
- Test: `tests/alert-daily-summary-metrics.test.ts`
- Modify: `tests/setup.ts:5` (add `count: vi.fn()` to the `user` mock — it's currently missing)

**Interfaces:**
- Consumes: Prisma models `User`, `Event`, `Registration`, `Payment`, `Order`, `TransferPayout`, `TicketBatch` (all already mocked in `tests/setup.ts` except `user.count`, added in Step 1 below).
- Produces:
  - `interface AdminDailySummary { newUsersCount: number; newOrganizersCount: number; eventsCreatedCount: number; paidRegistrationsCount: number; grossRevenue: number; platformFeesRetained: number; payoutsGeneratedCount: number; payoutsGeneratedAmount: number; cancelledOrRefundedCount: number; }`
  - `interface OrganizerDailySummary { paidRegistrationsCount: number; grossRevenue: number; couponsUsedCount: number; cancellationsRequestedCount: number; soldOutBatchesCount: number; }`
  - `getAdminDailySummary(dayStart: Date, dayEnd: Date): Promise<AdminDailySummary>` — used by Task 3.
  - `getOrganizerDailySummary(organizerId: string, dayStart: Date, dayEnd: Date): Promise<OrganizerDailySummary>` — used by Task 3. `organizerId` is `OrganizerProfile.id` (matching `lib/organizer/report.ts`'s existing convention), not `User.id`.

- [ ] **Step 1: Add the missing `count` mock for `db.user`**

In `tests/setup.ts`, line 5, change:

```ts
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
```

to:

```ts
    user: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
```

- [ ] **Step 2: Write the failing test**

Create `tests/alert-daily-summary-metrics.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

import { getAdminDailySummary, getOrganizerDailySummary } from "@/lib/alerts/daily-summary-metrics";

const dbMock = db as any;

const dayStart = new Date("2026-07-12T03:00:00.000Z");
const dayEnd = new Date("2026-07-13T03:00:00.000Z");

describe("getAdminDailySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.count.mockResolvedValue(0);
    dbMock.event.count.mockResolvedValue(0);
    dbMock.registration.count.mockResolvedValue(0);
    dbMock.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    dbMock.payment.count.mockResolvedValue(0);
    dbMock.order.aggregate.mockResolvedValue({ _sum: { platformFeeAmount: null, paymentFeeAmount: null } });
    dbMock.transferPayout.aggregate.mockResolvedValue({ _count: 0, _sum: { grossAmount: null } });
  });

  it("consulta novos usuários (papel ATHLETE) e novos organizadores (papel ORGANIZER) separadamente", async () => {
    dbMock.user.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(dbMock.user.count).toHaveBeenNthCalledWith(1, { where: { role: "ATHLETE", createdAt: { gte: dayStart, lt: dayEnd } } });
    expect(dbMock.user.count).toHaveBeenNthCalledWith(2, { where: { role: "ORGANIZER", createdAt: { gte: dayStart, lt: dayEnd } } });
    expect(result.newUsersCount).toBe(5);
    expect(result.newOrganizersCount).toBe(2);
  });

  it("soma taxa de plataforma e taxa de pagamento das ordens pagas no período", async () => {
    dbMock.order.aggregate.mockResolvedValueOnce({ _sum: { platformFeeAmount: 1000, paymentFeeAmount: 250 } });

    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(dbMock.order.aggregate).toHaveBeenCalledWith({
      _sum: { platformFeeAmount: true, paymentFeeAmount: true },
      where: { status: "PAID", createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(result.platformFeesRetained).toBe(1250);
  });

  it("usa 0 como padrão quando as agregações retornam null (dia sem atividade)", async () => {
    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(result.grossRevenue).toBe(0);
    expect(result.payoutsGeneratedAmount).toBe(0);
    expect(result.platformFeesRetained).toBe(0);
    expect(result.payoutsGeneratedCount).toBe(0);
  });

  it("soma inscrições com cancelamento solicitado e pagamentos estornados no período", async () => {
    dbMock.registration.count.mockResolvedValueOnce(7); // paidRegistrationsCount (CONFIRMED)
    dbMock.registration.count.mockResolvedValueOnce(3); // cancellationRequestedAt no período
    dbMock.payment.count.mockResolvedValueOnce(2); // REFUNDED/CHARGEBACK no período

    const result = await getAdminDailySummary(dayStart, dayEnd);

    expect(result.paidRegistrationsCount).toBe(7);
    expect(result.cancelledOrRefundedCount).toBe(5);
    expect(dbMock.payment.count).toHaveBeenCalledWith({
      where: { status: { in: ["REFUNDED", "CHARGEBACK"] }, refundedAt: { gte: dayStart, lt: dayEnd } },
    });
  });
});

describe("getOrganizerDailySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.registration.count.mockResolvedValue(0);
    dbMock.order.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });
    dbMock.order.count.mockResolvedValue(0);
    dbMock.ticketBatch.findMany.mockResolvedValue([]);
    dbMock.registration.findMany.mockResolvedValue([]);
  });

  it("escopa inscrições pagas e receita ao organizerId informado", async () => {
    dbMock.registration.count.mockResolvedValueOnce(4);
    dbMock.order.aggregate.mockResolvedValueOnce({ _sum: { totalAmount: 40000 } });

    const result = await getOrganizerDailySummary("org-1", dayStart, dayEnd);

    expect(dbMock.registration.count).toHaveBeenCalledWith({
      where: { event: { organizerId: "org-1" }, status: "CONFIRMED", createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(dbMock.order.aggregate).toHaveBeenCalledWith({
      _sum: { totalAmount: true },
      where: { status: "PAID", event: { organizerId: "org-1" }, createdAt: { gte: dayStart, lt: dayEnd } },
    });
    expect(result.paidRegistrationsCount).toBe(4);
    expect(result.grossRevenue).toBe(40000);
  });

  it("conta lotes cheios (soldCount >= capacity) que tiveram ao menos uma inscrição confirmada no período", async () => {
    dbMock.ticketBatch.findMany.mockResolvedValueOnce([
      { id: "batch-full", capacity: 100, soldCount: 100 },
      { id: "batch-not-full", capacity: 100, soldCount: 40 },
      { id: "batch-zero-capacity", capacity: 0, soldCount: 0 },
    ]);
    dbMock.registration.findMany.mockResolvedValueOnce([{ ticketBatchId: "batch-full" }]);

    const result = await getOrganizerDailySummary("org-1", dayStart, dayEnd);

    expect(dbMock.registration.findMany).toHaveBeenCalledWith({
      where: { ticketBatchId: { in: ["batch-full"] }, status: "CONFIRMED", createdAt: { gte: dayStart, lt: dayEnd } },
      distinct: ["ticketBatchId"],
      select: { ticketBatchId: true },
    });
    expect(result.soldOutBatchesCount).toBe(1);
  });

  it("não consulta inscrições de lotes quando nenhum lote está cheio", async () => {
    dbMock.ticketBatch.findMany.mockResolvedValueOnce([{ id: "batch-not-full", capacity: 100, soldCount: 40 }]);

    const result = await getOrganizerDailySummary("org-1", dayStart, dayEnd);

    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
    expect(result.soldOutBatchesCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/alert-daily-summary-metrics.test.ts`
Expected: FAIL with "Cannot find module '@/lib/alerts/daily-summary-metrics'" (or similar — the file doesn't exist yet).

- [ ] **Step 4: Write the implementation**

Create `lib/alerts/daily-summary-metrics.ts`:

```ts
import { db } from "@/lib/db";

export interface AdminDailySummary {
  newUsersCount: number;
  newOrganizersCount: number;
  eventsCreatedCount: number;
  paidRegistrationsCount: number;
  grossRevenue: number;
  platformFeesRetained: number;
  payoutsGeneratedCount: number;
  payoutsGeneratedAmount: number;
  cancelledOrRefundedCount: number;
}

export interface OrganizerDailySummary {
  paidRegistrationsCount: number;
  grossRevenue: number;
  couponsUsedCount: number;
  cancellationsRequestedCount: number;
  soldOutBatchesCount: number;
}

export async function getAdminDailySummary(dayStart: Date, dayEnd: Date): Promise<AdminDailySummary> {
  const period = { gte: dayStart, lt: dayEnd };

  const [
    newUsersCount,
    newOrganizersCount,
    eventsCreatedCount,
    paidRegistrationsCount,
    grossRevenueAgg,
    feeAgg,
    payoutAgg,
    cancelledRegistrationsCount,
    refundedPaymentsCount,
  ] = await Promise.all([
    db.user.count({ where: { role: "ATHLETE", createdAt: period } }),
    db.user.count({ where: { role: "ORGANIZER", createdAt: period } }),
    db.event.count({ where: { createdAt: period } }),
    db.registration.count({ where: { status: "CONFIRMED", createdAt: period } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { status: "PAID", createdAt: period } }),
    db.order.aggregate({
      _sum: { platformFeeAmount: true, paymentFeeAmount: true },
      where: { status: "PAID", createdAt: period },
    }),
    db.transferPayout.aggregate({ _count: true, _sum: { grossAmount: true }, where: { createdAt: period } }),
    db.registration.count({ where: { cancellationRequestedAt: period } }),
    db.payment.count({ where: { status: { in: ["REFUNDED", "CHARGEBACK"] }, refundedAt: period } }),
  ]);

  return {
    newUsersCount,
    newOrganizersCount,
    eventsCreatedCount,
    paidRegistrationsCount,
    grossRevenue: grossRevenueAgg._sum.amount ?? 0,
    platformFeesRetained: (feeAgg._sum.platformFeeAmount ?? 0) + (feeAgg._sum.paymentFeeAmount ?? 0),
    payoutsGeneratedCount: payoutAgg._count,
    payoutsGeneratedAmount: payoutAgg._sum.grossAmount ?? 0,
    cancelledOrRefundedCount: cancelledRegistrationsCount + refundedPaymentsCount,
  };
}

export async function getOrganizerDailySummary(
  organizerId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<OrganizerDailySummary> {
  const period = { gte: dayStart, lt: dayEnd };

  const [paidRegistrationsCount, revenueAgg, couponsUsedCount, cancellationsRequestedCount, batches] =
    await Promise.all([
      db.registration.count({ where: { event: { organizerId }, status: "CONFIRMED", createdAt: period } }),
      db.order.aggregate({
        _sum: { totalAmount: true },
        where: { status: "PAID", event: { organizerId }, createdAt: period },
      }),
      db.order.count({ where: { event: { organizerId }, couponId: { not: null }, createdAt: period } }),
      db.registration.count({ where: { event: { organizerId }, cancellationRequestedAt: period } }),
      db.ticketBatch.findMany({
        where: { event: { organizerId }, active: true },
        select: { id: true, capacity: true, soldCount: true },
      }),
    ]);

  const soldOutBatchIds = batches.filter((b) => b.capacity > 0 && b.soldCount >= b.capacity).map((b) => b.id);

  // Não há um timestamp de "esgotou em" no schema. Como proxy, contamos lotes hoje
  // cheios que também tiveram ao menos uma inscrição confirmada nesta janela — não é
  // exato (o lote pode já estar cheio há dias), mas é o único sinal disponível sem
  // adicionar um novo campo ao TicketBatch.
  let soldOutBatchesCount = 0;
  if (soldOutBatchIds.length > 0) {
    const rows = await db.registration.findMany({
      where: { ticketBatchId: { in: soldOutBatchIds }, status: "CONFIRMED", createdAt: period },
      distinct: ["ticketBatchId"],
      select: { ticketBatchId: true },
    });
    soldOutBatchesCount = rows.length;
  }

  return {
    paidRegistrationsCount,
    grossRevenue: revenueAgg._sum.totalAmount ?? 0,
    couponsUsedCount,
    cancellationsRequestedCount,
    soldOutBatchesCount,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/alert-daily-summary-metrics.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add tests/setup.ts tests/alert-daily-summary-metrics.test.ts lib/alerts/daily-summary-metrics.ts
git commit -m "feat: add admin and organizer daily summary metrics queries"
```

---

### Task 3: Email template + sender orchestration

**Files:**
- Modify: `lib/email.ts` (add `sendDailySummaryEmail`)
- Create: `lib/alerts/daily-summary.ts`
- Test: `tests/alert-daily-summary.test.ts`

**Interfaces:**
- Consumes: `getAdminDailySummary`/`getOrganizerDailySummary` and `AdminDailySummary`/`OrganizerDailySummary` from Task 2 (`lib/alerts/daily-summary-metrics.ts`); `claimAlert` from `lib/alerts/dedupe.ts`; `sendMail`, `getAppName` (existing, via the new `sendDailySummaryEmail`); `sendWhatsAppMessage` from `lib/whatsapp.ts`; `getSmtpConfig`/`isSmtpReady` from `lib/smtp-settings.ts`; `formatCurrency` from `lib/format.ts`.
- Produces:
  - `sendDailySummaryEmail(params: { to: string; role: "ADMIN" | "ORGANIZER"; dateLabel: string; rows: { label: string; value: string }[] }): Promise<void>` in `lib/email.ts` — a generic label/value table renderer, decoupled from the metrics types (mirrors how `sendReconciliationMismatchEmail` takes plain primitives, not report-module types).
  - `getYesterdayBrasiliaWindow(now?: Date): { dayStart: Date; dayEnd: Date }` — used by Task 4.
  - `sendAdminDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }>` — used by Task 4.
  - `sendOrganizerDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }>` — used by Task 4.

- [ ] **Step 1: Add the email template function**

In `lib/email.ts`, add this function at the end of the file (after `sendPasswordResetEmail`):

```ts
/** E-mail com o resumo diário de atividade (admin ou organizador). */
export async function sendDailySummaryEmail(params: {
  to: string;
  role: "ADMIN" | "ORGANIZER";
  dateLabel: string;
  rows: { label: string; value: string }[];
}): Promise<void> {
  const appName = await getAppName();
  const roleLabel = params.role === "ADMIN" ? "administrador" : "organizador";
  const tableRows = params.rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 8px">${r.label}</td><td style="padding:4px 8px;font-weight:bold">${r.value}</td></tr>`,
    )
    .join("");
  await sendMail({
    to: params.to,
    subject: `Resumo diário — ${params.dateLabel}`,
    html: layout(
      appName,
      `<p>Olá,</p>
       <p>Este é o resumo de atividade do dia <strong>${params.dateLabel}</strong> (visão de ${roleLabel}):</p>
       <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
         <tbody>${tableRows}</tbody>
       </table>`,
    ),
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/alert-daily-summary.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendDailySummaryEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  claimAlert: vi.fn(),
}));
vi.mock("@/lib/alerts/daily-summary-metrics", () => ({
  getAdminDailySummary: vi.fn(),
  getOrganizerDailySummary: vi.fn(),
}));

import {
  getYesterdayBrasiliaWindow,
  sendAdminDailySummaries,
  sendOrganizerDailySummaries,
} from "@/lib/alerts/daily-summary";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendDailySummaryEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { claimAlert } from "@/lib/alerts/dedupe";
import { getAdminDailySummary, getOrganizerDailySummary } from "@/lib/alerts/daily-summary-metrics";

const dbMock = db as any;

const dayStart = new Date("2026-07-12T03:00:00.000Z");
const dayEnd = new Date("2026-07-13T03:00:00.000Z");

const adminMetricsFixture = {
  newUsersCount: 5,
  newOrganizersCount: 1,
  eventsCreatedCount: 2,
  paidRegistrationsCount: 10,
  grossRevenue: 100000,
  platformFeesRetained: 5000,
  payoutsGeneratedCount: 1,
  payoutsGeneratedAmount: 90000,
  cancelledOrRefundedCount: 3,
};

const organizerMetricsFixture = {
  paidRegistrationsCount: 4,
  grossRevenue: 40000,
  couponsUsedCount: 2,
  cancellationsRequestedCount: 1,
  soldOutBatchesCount: 0,
};

describe("getYesterdayBrasiliaWindow", () => {
  it("calcula o dia anterior completo no horário de Brasília (UTC-3 fixo)", () => {
    const { dayStart, dayEnd } = getYesterdayBrasiliaWindow(new Date("2026-07-13T10:00:00.000Z"));
    expect(dayStart).toEqual(new Date("2026-07-12T03:00:00.000Z"));
    expect(dayEnd).toEqual(new Date("2026-07-13T03:00:00.000Z"));
  });
});

describe("sendAdminDailySummaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    vi.mocked(getAdminDailySummary).mockResolvedValue(adminMetricsFixture);
  });

  it("envia e-mail e whatsapp quando o admin tem os dois canais habilitados", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
      },
    ]);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "ADMIN", active: true } }));
    expect(sendDailySummaryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin1@example.com", role: "ADMIN" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("pula os dois canais quando o admin desligou ambos", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: false,
      },
    ]);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("não reenvia quando o dia já foi reivindicado por outra execução (dedupe)", async () => {
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
      },
    ]);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("uma falha em um admin não impede o envio para os demais", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: false },
      { id: "admin-2", email: "admin2@example.com", phone: null, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: false },
    ]);
    vi.mocked(sendDailySummaryEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 1, failed: 1 });
  });
});

describe("sendOrganizerDailySummaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    vi.mocked(getOrganizerDailySummary).mockResolvedValue(organizerMetricsFixture);
  });

  it("busca apenas organizadores ativos com organizerProfile existente", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([]);

    await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ORGANIZER", active: true, organizerProfile: { isNot: null } } }),
    );
  });

  it("usa o organizerProfile.id para escopar as métricas e o telefone do perfil de organizador para o whatsapp", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { id: "org-1", phone: "5511988888888" },
      },
    ]);

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(getOrganizerDailySummary).toHaveBeenCalledWith("org-1", dayStart, dayEnd);
    expect(sendDailySummaryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "organizador@example.com", role: "ORGANIZER" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511988888888", expect.any(String));
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("pula o whatsapp quando o perfil de organizador não tem telefone", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { id: "org-1", phone: null },
      },
    ]);

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/alert-daily-summary.test.ts`
Expected: FAIL with "Cannot find module '@/lib/alerts/daily-summary'".

- [ ] **Step 4: Write the implementation**

Create `lib/alerts/daily-summary.ts`:

```ts
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendDailySummaryEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { formatCurrency } from "@/lib/format";
import { claimAlert } from "./dedupe";
import {
  getAdminDailySummary,
  getOrganizerDailySummary,
  type AdminDailySummary,
  type OrganizerDailySummary,
} from "./daily-summary-metrics";

const ALERT_TYPE = "DAILY_SUMMARY";
const ENTITY_TYPE = "DailySummary";

/**
 * "Ontem" no horário de Brasília, expresso como uma janela UTC. O Brasil não observa
 * horário de verão desde 2019, então o deslocamento UTC-3 é fixo e essa aritmética não
 * sofre do bug de DST que já foi encontrado e corrigido nos gráficos do dashboard.
 */
export function getYesterdayBrasiliaWindow(now: Date = new Date()): { dayStart: Date; dayEnd: Date } {
  const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0, 0));
  const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

function dateKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function formatDateLabel(day: Date): string {
  const dd = String(day.getUTCDate()).padStart(2, "0");
  const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${day.getUTCFullYear()}`;
}

function buildAdminEmailRows(m: AdminDailySummary): { label: string; value: string }[] {
  return [
    { label: "Novos usuários", value: String(m.newUsersCount) },
    { label: "Novos organizadores", value: String(m.newOrganizersCount) },
    { label: "Eventos criados", value: String(m.eventsCreatedCount) },
    { label: "Inscrições pagas", value: String(m.paidRegistrationsCount) },
    { label: "Receita bruta", value: formatCurrency(m.grossRevenue) },
    { label: "Taxas retidas pela plataforma", value: formatCurrency(m.platformFeesRetained) },
    { label: "Repasses gerados", value: `${m.payoutsGeneratedCount} (${formatCurrency(m.payoutsGeneratedAmount)})` },
    { label: "Cancelamentos/estornos", value: String(m.cancelledOrRefundedCount) },
  ];
}

function buildOrganizerEmailRows(m: OrganizerDailySummary): { label: string; value: string }[] {
  return [
    { label: "Inscrições pagas", value: String(m.paidRegistrationsCount) },
    { label: "Receita bruta", value: formatCurrency(m.grossRevenue) },
    { label: "Cupons usados", value: String(m.couponsUsedCount) },
    { label: "Cancelamentos solicitados", value: String(m.cancellationsRequestedCount) },
    { label: "Lotes esgotados", value: String(m.soldOutBatchesCount) },
  ];
}

function buildAdminWhatsAppText(m: AdminDailySummary): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `Resumo de ontem: ${m.paidRegistrationsCount} inscrições pagas, ${formatCurrency(m.grossRevenue)} em receita bruta, ${m.newUsersCount} novos usuários, ${m.eventsCreatedCount} eventos criados. Veja mais em ${baseUrl}/admin.`;
}

function buildOrganizerWhatsAppText(m: OrganizerDailySummary): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `Resumo de ontem: ${m.paidRegistrationsCount} inscrições pagas, ${formatCurrency(m.grossRevenue)} em receita bruta, ${m.couponsUsedCount} cupons usados. Veja mais em ${baseUrl}/organizador.`;
}

export async function sendAdminDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const metrics = await getAdminDailySummary(dayStart, dayEnd);
    const admins = await db.user.findMany({
      where: { role: "ADMIN", active: true },
      select: { id: true, email: true, phone: true, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: true },
    });

    const cfg = await getSmtpConfig();
    const smtpReady = isSmtpReady(cfg);
    const key = dateKey(dayStart);
    const dateLabel = formatDateLabel(dayStart);

    for (const admin of admins) {
      try {
        if (admin.dailySummaryEmailEnabled && smtpReady) {
          if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, `${key}:${admin.id}`, "EMAIL")) {
            await sendDailySummaryEmail({ to: admin.email, role: "ADMIN", dateLabel, rows: buildAdminEmailRows(metrics) });
            sent++;
          }
        }
        if (admin.dailySummaryWhatsappEnabled && admin.phone) {
          if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, `${key}:${admin.id}`, "WHATSAPP")) {
            await sendWhatsAppMessage(admin.phone, buildAdminWhatsAppText(metrics));
            sent++;
          }
        }
      } catch (err) {
        failed++;
        console.error("[sendAdminDailySummaries] failed for", admin.email, err);
      }
    }
  } catch (err) {
    console.error("[sendAdminDailySummaries] failed:", err);
  }
  return { sent, failed };
}

export async function sendOrganizerDailySummaries(dayStart: Date, dayEnd: Date): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const organizers = await db.user.findMany({
      where: { role: "ORGANIZER", active: true, organizerProfile: { isNot: null } },
      select: {
        id: true,
        email: true,
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { select: { id: true, phone: true } },
      },
    });

    const cfg = await getSmtpConfig();
    const smtpReady = isSmtpReady(cfg);
    const key = dateKey(dayStart);
    const dateLabel = formatDateLabel(dayStart);

    for (const organizer of organizers) {
      const organizerId = organizer.organizerProfile!.id;
      try {
        const metrics = await getOrganizerDailySummary(organizerId, dayStart, dayEnd);

        if (organizer.dailySummaryEmailEnabled && smtpReady) {
          if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, `${key}:${organizer.id}`, "EMAIL")) {
            await sendDailySummaryEmail({
              to: organizer.email,
              role: "ORGANIZER",
              dateLabel,
              rows: buildOrganizerEmailRows(metrics),
            });
            sent++;
          }
        }
        if (organizer.dailySummaryWhatsappEnabled && organizer.organizerProfile!.phone) {
          if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, `${key}:${organizer.id}`, "WHATSAPP")) {
            await sendWhatsAppMessage(organizer.organizerProfile!.phone, buildOrganizerWhatsAppText(metrics));
            sent++;
          }
        }
      } catch (err) {
        failed++;
        console.error("[sendOrganizerDailySummaries] failed for", organizer.email, err);
      }
    }
  } catch (err) {
    console.error("[sendOrganizerDailySummaries] failed:", err);
  }
  return { sent, failed };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/alert-daily-summary.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts lib/alerts/daily-summary.ts tests/alert-daily-summary.test.ts
git commit -m "feat: send daily summary digest emails and whatsapp messages to admins and organizers"
```

---

### Task 4: Cron route — `app/api/cron/daily-summary/route.ts`

**Files:**
- Create: `app/api/cron/daily-summary/route.ts`
- Test: `tests/cron-daily-summary-route.test.ts`

**Interfaces:**
- Consumes: `getYesterdayBrasiliaWindow`, `sendAdminDailySummaries`, `sendOrganizerDailySummaries` from `lib/alerts/daily-summary.ts` (Task 3).
- Produces: `POST /api/cron/daily-summary` — same `x-cron-secret` auth pattern as `app/api/cron/reconciliation/route.ts`, returns `{ adminsSent, adminsFailed, organizersSent, organizersFailed }`.

- [ ] **Step 1: Write the failing test**

Create `tests/cron-daily-summary-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alerts/daily-summary", () => ({
  getYesterdayBrasiliaWindow: vi.fn(),
  sendAdminDailySummaries: vi.fn(),
  sendOrganizerDailySummaries: vi.fn(),
}));

import { POST } from "@/app/api/cron/daily-summary/route";
import {
  getYesterdayBrasiliaWindow,
  sendAdminDailySummaries,
  sendOrganizerDailySummaries,
} from "@/lib/alerts/daily-summary";

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const dayStart = new Date("2026-07-12T03:00:00.000Z");
const dayEnd = new Date("2026-07-13T03:00:00.000Z");

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/daily-summary", { method: "POST", headers }) as any;
}

describe("POST /api/cron/daily-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    vi.mocked(getYesterdayBrasiliaWindow).mockReturnValue({ dayStart, dayEnd });
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("retorna 401 quando o segredo não bate", async () => {
    const res = await POST(makeRequest({ "x-cron-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(sendAdminDailySummaries).not.toHaveBeenCalled();
  });

  it("chama os dois envios com a janela do dia anterior e retorna os totais", async () => {
    vi.mocked(sendAdminDailySummaries).mockResolvedValueOnce({ sent: 3, failed: 0 });
    vi.mocked(sendOrganizerDailySummaries).mockResolvedValueOnce({ sent: 5, failed: 1 });

    const res = await POST(makeRequest({ "x-cron-secret": "test-secret" }));
    const body = await res.json();

    expect(sendAdminDailySummaries).toHaveBeenCalledWith(dayStart, dayEnd);
    expect(sendOrganizerDailySummaries).toHaveBeenCalledWith(dayStart, dayEnd);
    expect(body).toEqual({ adminsSent: 3, adminsFailed: 0, organizersSent: 5, organizersFailed: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cron-daily-summary-route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/cron/daily-summary/route'".

- [ ] **Step 3: Write the implementation**

Create `app/api/cron/daily-summary/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  getYesterdayBrasiliaWindow,
  sendAdminDailySummaries,
  sendOrganizerDailySummaries,
} from "@/lib/alerts/daily-summary";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { dayStart, dayEnd } = getYesterdayBrasiliaWindow();
  const [admins, organizers] = await Promise.all([
    sendAdminDailySummaries(dayStart, dayEnd),
    sendOrganizerDailySummaries(dayStart, dayEnd),
  ]);

  return NextResponse.json({
    adminsSent: admins.sent,
    adminsFailed: admins.failed,
    organizersSent: organizers.sent,
    organizersFailed: organizers.failed,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cron-daily-summary-route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/daily-summary/route.ts tests/cron-daily-summary-route.test.ts
git commit -m "feat: add /api/cron/daily-summary route"
```

---

### Task 5: Per-user toggle — profile routes + "Meus Dados" UI

**Files:**
- Modify: `app/api/admin/profile/route.ts`
- Modify: `app/api/organizer/account/route.ts`
- Modify: `app/admin/perfil/page.tsx`
- Modify: `app/organizador/perfil/page.tsx`
- Test: `tests/admin-profile-route.test.ts` (extend)
- Test: `tests/organizer-account-route.test.ts` (extend)

**Interfaces:**
- Consumes: `User.dailySummaryEmailEnabled`/`dailySummaryWhatsappEnabled` from Task 1.
- Produces: no new exports — this task only extends existing routes/pages.

- [ ] **Step 1: Write the failing tests — admin profile route**

Replace `tests/admin-profile-route.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/admin/profile/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const validBody = {
  name: "Admin",
  phone: "5511999999999",
  cpf: "123.456.789-00",
  dailySummaryEmailEnabled: true,
  dailySummaryWhatsappEnabled: false,
};

describe("admin profile api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("retorna nome, telefone, cpf e preferências de resumo diário do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.findUnique.mockResolvedValueOnce({
        name: "Admin",
        phone: "5511999999999",
        cpf: "123.456.789-00",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
      });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({
        profile: {
          name: "Admin",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: true,
        },
      });
    });
  });

  describe("PUT", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await PUT(makeRequest(validBody));
      expect(res.status).toBe(403);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o nome está vazio", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await PUT(makeRequest({ ...validBody, name: "" }));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando as preferências de resumo diário estão ausentes", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const { dailySummaryEmailEnabled: _omit, ...bodyWithoutToggle } = validBody;
      const res = await PUT(makeRequest(bodyWithoutToggle));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("atualiza nome, telefone, cpf e preferências de resumo diário do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.update.mockResolvedValueOnce({
        name: "Admin",
        phone: "5511999999999",
        cpf: "123.456.789-00",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: false,
      });

      const res = await PUT(makeRequest(validBody));
      const body = await res.json();

      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: "admin-1" },
        data: {
          name: "Admin",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: false,
        },
        select: {
          name: true,
          phone: true,
          cpf: true,
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: true,
        },
      });
      expect(body).toEqual({
        profile: {
          name: "Admin",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: false,
        },
      });
    });
  });
});
```

- [ ] **Step 2: Write the failing tests — organizer account route**

Replace `tests/organizer-account-route.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/organizer/account/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/account", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const validBody = {
  name: "Organizador",
  phone: "5511999999999",
  cpf: "123.456.789-00",
  dailySummaryEmailEnabled: true,
  dailySummaryWhatsappEnabled: false,
};

describe("organizer account api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
  });

  describe("GET", () => {
    it("retorna 401 para quem não está autenticado", async () => {
      authMock.mockResolvedValue(null as any);
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("retorna nome, telefone, cpf e preferências de resumo diário do organizador autenticado", async () => {
      dbMock.user.findUnique.mockResolvedValueOnce({
        name: "Organizador",
        phone: "5511999999999",
        cpf: "123.456.789-00",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
      });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({
        profile: {
          name: "Organizador",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: true,
        },
      });
    });
  });

  describe("PUT", () => {
    it("retorna 401 para quem não está autenticado", async () => {
      authMock.mockResolvedValue(null as any);
      const res = await PUT(makeRequest(validBody));
      expect(res.status).toBe(401);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o nome está vazio", async () => {
      const res = await PUT(makeRequest({ ...validBody, name: "" }));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando as preferências de resumo diário estão ausentes", async () => {
      const { dailySummaryEmailEnabled: _omit, ...bodyWithoutToggle } = validBody;
      const res = await PUT(makeRequest(bodyWithoutToggle));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("atualiza nome, telefone, cpf e preferências de resumo diário do organizador autenticado", async () => {
      dbMock.user.update.mockResolvedValueOnce({
        name: "Organizador",
        phone: "5511999999999",
        cpf: "123.456.789-00",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: false,
      });

      const res = await PUT(makeRequest(validBody));
      const body = await res.json();

      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: "org-1" },
        data: {
          name: "Organizador",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: false,
        },
        select: {
          name: true,
          phone: true,
          cpf: true,
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: true,
        },
      });
      expect(body).toEqual({
        profile: {
          name: "Organizador",
          phone: "5511999999999",
          cpf: "123.456.789-00",
          dailySummaryEmailEnabled: true,
          dailySummaryWhatsappEnabled: false,
        },
      });
    });
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run tests/admin-profile-route.test.ts tests/organizer-account-route.test.ts`
Expected: FAIL — the "ausentes" test fails because the current Zod schemas don't require the two new fields (so it currently returns 200, not 400), and the other tests fail on the missing fields in `select`/`data`/response.

- [ ] **Step 4: Update the admin profile route**

Replace `app/api/admin/profile/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional().nullable(),
  cpf: z.string().max(14).optional().nullable(),
  dailySummaryEmailEnabled: z.boolean(),
  dailySummaryWhatsappEnabled: z.boolean(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      phone: true,
      cpf: true,
      dailySummaryEmailEnabled: true,
      dailySummaryWhatsappEnabled: true,
    },
  });

  return NextResponse.json({ profile: user });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await db.user.update({
    where: { id: session.user.id },
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      cpf: parsed.data.cpf || null,
      dailySummaryEmailEnabled: parsed.data.dailySummaryEmailEnabled,
      dailySummaryWhatsappEnabled: parsed.data.dailySummaryWhatsappEnabled,
    },
    select: {
      name: true,
      phone: true,
      cpf: true,
      dailySummaryEmailEnabled: true,
      dailySummaryWhatsappEnabled: true,
    },
  });

  return NextResponse.json({ profile: user });
}
```

- [ ] **Step 5: Update the organizer account route**

Replace `app/api/organizer/account/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional().nullable(),
  cpf: z.string().max(14).optional().nullable(),
  dailySummaryEmailEnabled: z.boolean(),
  dailySummaryWhatsappEnabled: z.boolean(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      phone: true,
      cpf: true,
      dailySummaryEmailEnabled: true,
      dailySummaryWhatsappEnabled: true,
    },
  });

  return NextResponse.json({ profile: user });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await db.user.update({
    where: { id: session.user.id },
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      cpf: parsed.data.cpf || null,
      dailySummaryEmailEnabled: parsed.data.dailySummaryEmailEnabled,
      dailySummaryWhatsappEnabled: parsed.data.dailySummaryWhatsappEnabled,
    },
    select: {
      name: true,
      phone: true,
      cpf: true,
      dailySummaryEmailEnabled: true,
      dailySummaryWhatsappEnabled: true,
    },
  });

  return NextResponse.json({ profile: user });
}
```

- [ ] **Step 6: Run both route tests to verify they pass**

Run: `npx vitest run tests/admin-profile-route.test.ts tests/organizer-account-route.test.ts`
Expected: PASS (6 tests in each file — both green).

- [ ] **Step 7: Add the toggle checkboxes to the admin "Meus Dados" page**

Replace `app/admin/perfil/page.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";

type ProfileData = {
  name?: string;
  phone?: string | null;
  cpf?: string | null;
  dailySummaryEmailEnabled?: boolean;
  dailySummaryWhatsappEnabled?: boolean;
};

export default function AdminPerfilPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<ProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/profile")
      .then((res) => {
        if (!res.ok) throw new Error("Erro ao carregar perfil");
        return res.json();
      })
      .then(({ profile }) => { if (profile) setForm(profile); })
      .catch(() => setLoadError("Erro ao carregar perfil."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name?.trim() ?? "",
          phone: form.phone?.trim() || null,
          cpf: form.cpf?.trim() || null,
          dailySummaryEmailEnabled: form.dailySummaryEmailEnabled ?? true,
          dailySummaryWhatsappEnabled: form.dailySummaryWhatsappEnabled ?? true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (typeof data.error === "string") {
          setSaveError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setSaveError((fieldMessage as string) ?? formMessage ?? "Erro ao salvar perfil.");
        }
        setSaving(false);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  function set(field: keyof ProfileData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (loadError) return <div className="text-sm text-red-600">{loadError}</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <div className="card">
        <p className="text-sm text-gray-600 dark:text-gray-400">{session?.user?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dados pessoais</h2>
        {saveError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
          <input
            type="text"
            value={form.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone (WhatsApp)</label>
          <input
            type="tel"
            value={form.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            className="input-field w-full"
            placeholder="(11) 99999-9999"
          />
          <p className="text-xs text-gray-500 mt-1">Usado para receber alertas de conciliação de pagamentos por WhatsApp.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF</label>
          <input
            type="text"
            value={form.cpf ?? ""}
            onChange={(e) => set("cpf", e.target.value)}
            className="input-field w-full"
            placeholder="000.000.000-00"
          />
        </div>

        <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notificações</h3>
          <p className="text-xs text-gray-500">Resumo diário de atividade da plataforma, enviado toda manhã.</p>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.dailySummaryEmailEnabled ?? true}
              onChange={(e) => setForm((prev) => ({ ...prev, dailySummaryEmailEnabled: e.target.checked }))}
            />
            Receber resumo diário por e-mail
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.dailySummaryWhatsappEnabled ?? true}
              onChange={(e) => setForm((prev) => ({ ...prev, dailySummaryWhatsappEnabled: e.target.checked }))}
            />
            Receber resumo diário por WhatsApp
          </label>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
        </button>
      </form>

      <ChangePasswordForm />
    </div>
  );
}
```

- [ ] **Step 8: Add the toggle checkboxes to the organizer "Meus Dados" page**

Replace `app/organizador/perfil/page.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";

type OrgProfileData = {
  companyName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  website?: string | null;
  bio?: string | null;
};

type AccountData = {
  name?: string;
  phone?: string | null;
  cpf?: string | null;
  dailySummaryEmailEnabled?: boolean;
  dailySummaryWhatsappEnabled?: boolean;
};

export default function OrganizerPerfilPage() {
  const { data: session } = useSession();
  const [orgForm, setOrgForm] = useState<OrgProfileData>({});
  const [accountForm, setAccountForm] = useState<AccountData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/organizer/profile").then((r) => r.json()),
      fetch("/api/organizer/account").then((r) => r.json()),
    ])
      .then(([{ profile }, { profile: account }]) => {
        if (profile) setOrgForm(profile);
        if (account) setAccountForm(account);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/organizer/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orgForm),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAccountSaving(true);
    setAccountError(null);
    try {
      const res = await fetch("/api/organizer/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: accountForm.name?.trim() ?? "",
          phone: accountForm.phone?.trim() || null,
          cpf: accountForm.cpf?.trim() || null,
          dailySummaryEmailEnabled: accountForm.dailySummaryEmailEnabled ?? true,
          dailySummaryWhatsappEnabled: accountForm.dailySummaryWhatsappEnabled ?? true,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (typeof data.error === "string") {
          setAccountError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setAccountError((fieldMessage as string) ?? formMessage ?? "Erro ao salvar perfil.");
        }
        setAccountSaving(false);
        return;
      }
      setAccountSaved(true);
      setTimeout(() => setAccountSaved(false), 3000);
    } finally {
      setAccountSaving(false);
    }
  }

  function set(field: keyof OrgProfileData, value: string) {
    setOrgForm((prev) => ({ ...prev, [field]: value || null }));
  }

  function setAccount(field: keyof AccountData, value: string) {
    setAccountForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <form onSubmit={handleAccountSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dados pessoais</h2>
        {accountError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{accountError}</div>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-400">{session?.user?.email}</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input type="text" value={accountForm.name ?? ""} onChange={(e) => setAccount("name", e.target.value)} className="input w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone pessoal</label>
            <input type="tel" value={accountForm.phone ?? ""} onChange={(e) => setAccount("phone", e.target.value)} className="input w-full" placeholder="(11) 99999-9999" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF</label>
            <input type="text" value={accountForm.cpf ?? ""} onChange={(e) => setAccount("cpf", e.target.value)} className="input w-full" placeholder="000.000.000-00" />
          </div>
        </div>

        <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notificações</h3>
          <p className="text-xs text-gray-500">Resumo diário dos seus eventos, enviado toda manhã.</p>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={accountForm.dailySummaryEmailEnabled ?? true}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, dailySummaryEmailEnabled: e.target.checked }))}
            />
            Receber resumo diário por e-mail
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={accountForm.dailySummaryWhatsappEnabled ?? true}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, dailySummaryWhatsappEnabled: e.target.checked }))}
            />
            Receber resumo diário por WhatsApp
          </label>
        </div>

        <button type="submit" disabled={accountSaving} className="btn-primary w-full">
          {accountSaving ? "Salvando..." : accountSaved ? "Salvo!" : "Salvar dados pessoais"}
        </button>
      </form>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900">Dados da organização</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome da empresa / organização</label>
            <input type="text" value={orgForm.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
            <input type="text" value={orgForm.cnpj ?? ""} onChange={(e) => set("cnpj", e.target.value)} className="input w-full" placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone comercial</label>
            <input type="tel" value={orgForm.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className="input w-full" placeholder="(11) 99999-9999" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Site</label>
            <input type="url" value={orgForm.website ?? ""} onChange={(e) => set("website", e.target.value)} className="input w-full" placeholder="https://..." />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Bio / Apresentação</label>
            <textarea rows={4} value={orgForm.bio ?? ""} onChange={(e) => set("bio", e.target.value)} className="input w-full resize-none" placeholder="Conte sobre sua organização..." />
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar perfil"}
        </button>
      </form>

      <ChangePasswordForm />
    </div>
  );
}
```

- [ ] **Step 9: Run the full test suite and typecheck**

Run: `npx vitest run`
Expected: all tests pass (previous total + 29 new: 7 metrics + 8 sender + 2 cron route + 12 profile-route across both files).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add app/api/admin/profile/route.ts app/api/organizer/account/route.ts app/admin/perfil/page.tsx app/organizador/perfil/page.tsx tests/admin-profile-route.test.ts tests/organizer-account-route.test.ts
git commit -m "feat: add per-user daily summary toggle to admin and organizer profile pages"
```

---

## Post-plan manual steps (not code, do not skip)

- Add a VPS crontab line calling `POST https://circuitodascorridas.com.br/api/cron/daily-summary` with header `x-cron-secret: <CRON_SECRET>` once daily at `10:00 UTC` (07:00 Brasília) — same mechanism as the 3 existing cron routes, none of which have crontab-as-code in this repo.
- Deploy requires `prisma db push` (new columns) — same as every schema-changing deploy this session.
