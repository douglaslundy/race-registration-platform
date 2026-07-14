# Destinatários Extras do Resumo Diário Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each admin/organizer register extra named recipients (email or WhatsApp) who also receive the daily summary digest.

**Architecture:** A new `DailySummaryRecipient` table owned by `userId`. One role-agnostic CRUD API (list/create, delete-by-id), scoped to the session user. The existing sender functions in `lib/alerts/daily-summary.ts` gain a small loop per primary recipient that also sends to their registered extras, deduped independently. A shared UI component is dropped into both existing "Meus Dados" pages.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest, Zod, React — no new dependencies.

## Global Constraints

- New table `DailySummaryRecipient`: `id`, `userId`, `name`, `type` (`EMAIL` | `WHATSAPP` enum), `value`, `createdAt`. Additive migration only.
- **Registering an item is itself the opt-in** — no per-item enabled/disabled toggle exists or is needed.
- One shared API, not separate admin/organizer routes: `GET`/`POST /api/daily-summary-recipients` (role gate: `ADMIN` or `ORGANIZER` only), `DELETE /api/daily-summary-recipients/[id]` (ownership gate: `recipient.userId === session.user.id`, 404 if not found/not owned — no separate role check needed since only ADMIN/ORGANIZER could ever have created a row).
- Email validation: `z.string().email()` (same rule as every other email field in this codebase).
- WhatsApp validation: value is normalized (strip all non-digit characters) and must be 10 or 11 digits (Brazilian DDD + 8-or-9-digit number, **no country code**). The cleaned digits-only string is what's stored — never store `+55` or any punctuation.
- **Country code at send time only:** when sending to an extra WHATSAPP recipient, prepend `"55"` to the stored value before calling `sendWhatsAppMessage`. The existing primary admin/organizer phone fields (`User.phone`, `OrganizerProfile.phone`) are NOT touched by this plan — they keep their current unvalidated, no-country-code-prepend behavior, because changing that is out of scope and risks regressing a function already in production.
- Extra-recipient sends reuse the exact same email `rows`/WhatsApp text already built for the primary recipient (admin or organizer) — no separate content.
- Dedupe: same `AlertLog` mechanism, `alertType = "DAILY_SUMMARY"`, `entityType = "DailySummary"`, but `entityId = "${dateKey}:recipient:${recipient.id}"` (distinct from the primary recipient's `"${dateKey}:${userId}"` key) so an extra recipient's dedupe is independent of the primary recipient's.
- A failure sending to one extra recipient must not block the primary recipient's sends or any other extra recipient's sends (same per-unit try/catch isolation already used for the primary recipient).
- No editing of an existing recipient (create + delete only). No limit on how many a user can register.
- UI: uses `components/ui/ConfirmModal.tsx` for delete confirmation (never native `confirm()`, per `CLAUDE.md`) and `components/ui/ErrorModal.tsx` for errors (never native `alert()`).

---

### Task 1: Schema — `DailySummaryRecipient` table

**Files:**
- Modify: `prisma/schema.prisma` (add enum + model, add relation to `User`)
- Create: `prisma/migrations/20260714000000_add_daily_summary_recipients/migration.sql`

**Interfaces:**
- Produces: Prisma model `DailySummaryRecipient { id, userId, name, type: DailySummaryRecipientType, value, createdAt }` — consumed by Task 2 (routes) and Task 3 (sender).

- [ ] **Step 1: Add the enum and model to the Prisma schema**

In `prisma/schema.prisma`, add this new enum near the other enums (after `enum ShirtSize { ... }`, before the `// ─── Users ───` comment, around line 92):

```prisma
enum DailySummaryRecipientType {
  EMAIL
  WHATSAPP
}
```

Then add the relation to `User` — in `model User { ... }`, add one line right after the `refundsInitiated Refund[]` relation line (around line 118):

```prisma
  refundsInitiated Refund[]
  dailySummaryRecipients DailySummaryRecipient[]
```

Then add the new model at the end of the file (after the last model, `model AlertLog { ... }`):

```prisma
model DailySummaryRecipient {
  id        String                     @id @default(cuid())
  userId    String
  name      String
  type      DailySummaryRecipientType
  value     String
  createdAt DateTime                   @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("daily_summary_recipients")
}
```

- [ ] **Step 2: Generate the Prisma client and verify it compiles**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` with no errors.

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Write the migration SQL by hand**

No live database connection exists in this environment, so write the migration file directly, matching Prisma's standard generated format (same style as the existing hand-written migrations in `prisma/migrations/`).

Create `prisma/migrations/20260714000000_add_daily_summary_recipients/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "DailySummaryRecipientType" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateTable
CREATE TABLE "daily_summary_recipients" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DailySummaryRecipientType" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_summary_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_summary_recipients_userId_idx" ON "daily_summary_recipients"("userId");

-- AddForeignKey
ALTER TABLE "daily_summary_recipients" ADD CONSTRAINT "daily_summary_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260714000000_add_daily_summary_recipients/migration.sql
git commit -m "feat: add DailySummaryRecipient table for extra daily-summary recipients"
```

---

### Task 2: API — list/create + delete routes

**Files:**
- Create: `app/api/daily-summary-recipients/route.ts`
- Create: `app/api/daily-summary-recipients/[id]/route.ts`
- Test: `tests/daily-summary-recipients-route.test.ts`
- Test: `tests/daily-summary-recipients-id-route.test.ts`
- Modify: `tests/setup.ts` (add `dailySummaryRecipient` mock to the `db` mock object)

**Interfaces:**
- Consumes: `DailySummaryRecipient` Prisma model from Task 1.
- Produces:
  - `GET /api/daily-summary-recipients` → `{ recipients: { id, name, type, value }[] }`
  - `POST /api/daily-summary-recipients` (body `{name, type, value}`) → `201 { recipient: {id,name,type,value} }` on success, `400` on validation failure, `401`/`403` on auth failure.
  - `DELETE /api/daily-summary-recipients/[id]` → `200 { success: true }` on success, `401`/`404`.
  - Used by Task 3 only as a Prisma model (the sender queries the table directly, not via HTTP).
  - Used by Task 4's UI component via `fetch`.

- [ ] **Step 1: Add the `dailySummaryRecipient` mock**

In `tests/setup.ts`, add this line inside the `db` mock object (anywhere among the other model mocks, e.g. right after the `alertLog` line):

```ts
    dailySummaryRecipient: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
```

- [ ] **Step 2: Write the failing tests — list/create route**

Create `tests/daily-summary-recipients-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/daily-summary-recipients/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/daily-summary-recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("daily summary recipients api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("retorna 401 sem sessão", async () => {
      authMock.mockResolvedValue(null as any);
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("retorna 403 para papel que não é admin nem organizador", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("lista os destinatários do usuário autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
        { id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
      ]);

      const res = await GET();
      const body = await res.json();

      expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith({
        where: { userId: "admin-1" },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, type: true, value: true },
      });
      expect(body).toEqual({ recipients: [{ id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" }] });
    });
  });

  describe("POST", () => {
    it("retorna 401 sem sessão", async () => {
      authMock.mockResolvedValue(null as any);
      const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "maria@example.com" }));
      expect(res.status).toBe(401);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("retorna 403 para papel que não é admin nem organizador", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "maria@example.com" }));
      expect(res.status).toBe(403);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o nome está vazio", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await POST(makeRequest({ name: "", type: "EMAIL", value: "maria@example.com" }));
      expect(res.status).toBe(400);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o e-mail é inválido", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "não-é-email" }));
      expect(res.status).toBe(400);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o telefone tem menos de 10 dígitos", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await POST(makeRequest({ name: "João", type: "WHATSAPP", value: "119999" }));
      expect(res.status).toBe(400);
      expect(dbMock.dailySummaryRecipient.create).not.toHaveBeenCalled();
    });

    it("cria um destinatário de e-mail com sucesso", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.dailySummaryRecipient.create.mockResolvedValueOnce({
        id: "r1",
        name: "Maria",
        type: "EMAIL",
        value: "maria@example.com",
      });

      const res = await POST(makeRequest({ name: "Maria", type: "EMAIL", value: "maria@example.com" }));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(dbMock.dailySummaryRecipient.create).toHaveBeenCalledWith({
        data: { userId: "admin-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
        select: { id: true, name: true, type: true, value: true },
      });
      expect(body).toEqual({ recipient: { id: "r1", name: "Maria", type: "EMAIL", value: "maria@example.com" } });
    });

    it("cria um destinatário de whatsapp removendo formatação e salvando só os dígitos, sem +55", async () => {
      authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
      dbMock.dailySummaryRecipient.create.mockResolvedValueOnce({
        id: "r2",
        name: "João",
        type: "WHATSAPP",
        value: "11999999999",
      });

      const res = await POST(makeRequest({ name: "João", type: "WHATSAPP", value: "(11) 99999-9999" }));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(dbMock.dailySummaryRecipient.create).toHaveBeenCalledWith({
        data: { userId: "org-1", name: "João", type: "WHATSAPP", value: "11999999999" },
        select: { id: true, name: true, type: true, value: true },
      });
      expect(body).toEqual({ recipient: { id: "r2", name: "João", type: "WHATSAPP", value: "11999999999" } });
    });
  });
});
```

- [ ] **Step 3: Write the failing tests — delete route**

Create `tests/daily-summary-recipients-id-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { DELETE } from "@/app/api/daily-summary-recipients/[id]/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/daily-summary-recipients/r1", { method: "DELETE" }) as any;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/daily-summary-recipients/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna 401 sem sessão", async () => {
    authMock.mockResolvedValue(null as any);
    const res = await DELETE(makeRequest(), makeContext("r1"));
    expect(res.status).toBe(401);
    expect(dbMock.dailySummaryRecipient.delete).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o destinatário não existe ou não pertence ao usuário", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.dailySummaryRecipient.findFirst.mockResolvedValueOnce(null);

    const res = await DELETE(makeRequest(), makeContext("r1"));

    expect(dbMock.dailySummaryRecipient.findFirst).toHaveBeenCalledWith({ where: { id: "r1", userId: "admin-1" } });
    expect(res.status).toBe(404);
    expect(dbMock.dailySummaryRecipient.delete).not.toHaveBeenCalled();
  });

  it("remove o destinatário quando pertence ao usuário autenticado", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.dailySummaryRecipient.findFirst.mockResolvedValueOnce({ id: "r1", userId: "admin-1" });

    const res = await DELETE(makeRequest(), makeContext("r1"));
    const body = await res.json();

    expect(dbMock.dailySummaryRecipient.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(body).toEqual({ success: true });
  });
});
```

- [ ] **Step 4: Run both test files to verify they fail**

Run: `npx vitest run tests/daily-summary-recipients-route.test.ts tests/daily-summary-recipients-id-route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/daily-summary-recipients/route'" (and the `[id]` equivalent).

- [ ] **Step 5: Write the list/create route**

Create `app/api/daily-summary-recipients/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z
  .object({
    name: z.string().min(1, "Nome é obrigatório"),
    type: z.enum(["EMAIL", "WHATSAPP"]),
    value: z.string().min(1, "Valor é obrigatório"),
  })
  .superRefine((data, ctx) => {
    if (data.type === "EMAIL") {
      if (!z.string().email().safeParse(data.value).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "E-mail inválido" });
      }
    } else {
      const digits = data.value.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 11) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "Informe DDD + número (10 ou 11 dígitos, sem +55)",
        });
      }
    }
  });

function canManageRecipients(role?: string): boolean {
  return role === "ADMIN" || role === "ORGANIZER";
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!canManageRecipients(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const recipients = await db.dailySummaryRecipient.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, type: true, value: true },
  });

  return NextResponse.json({ recipients });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!canManageRecipients(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const value = parsed.data.type === "WHATSAPP" ? parsed.data.value.replace(/\D/g, "") : parsed.data.value;

  const recipient = await db.dailySummaryRecipient.create({
    data: { userId: session.user.id, name: parsed.data.name, type: parsed.data.type, value },
    select: { id: true, name: true, type: true, value: true },
  });

  return NextResponse.json({ recipient }, { status: 201 });
}
```

- [ ] **Step 6: Write the delete route**

Create `app/api/daily-summary-recipients/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const recipient = await db.dailySummaryRecipient.findFirst({ where: { id, userId: session.user.id } });
  if (!recipient) return NextResponse.json({ error: "Destinatário não encontrado" }, { status: 404 });

  await db.dailySummaryRecipient.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/daily-summary-recipients-route.test.ts tests/daily-summary-recipients-id-route.test.ts`
Expected: PASS (9 tests in the first file, 3 in the second).

- [ ] **Step 8: Commit**

```bash
git add tests/setup.ts tests/daily-summary-recipients-route.test.ts tests/daily-summary-recipients-id-route.test.ts app/api/daily-summary-recipients
git commit -m "feat: add CRUD API for extra daily-summary recipients"
```

---

### Task 3: Sender — extend `lib/alerts/daily-summary.ts`

**Files:**
- Modify: `lib/alerts/daily-summary.ts`
- Modify: `tests/alert-daily-summary.test.ts`

**Interfaces:**
- Consumes: `DailySummaryRecipient` Prisma model (Task 1), `db.dailySummaryRecipient.findMany` (mocked in Task 2's `tests/setup.ts` change).
- Produces: no new exports — `sendAdminDailySummaries`/`sendOrganizerDailySummaries` keep their existing `(dayStart, dayEnd) => Promise<{sent, failed}>` signature; this task only extends their internal behavior.

- [ ] **Step 1: Add the default empty-list mock and write the new failing tests**

In `tests/alert-daily-summary.test.ts`, add one line to the `beforeEach` of the `describe("sendAdminDailySummaries", ...)` block (after the existing `vi.mocked(getAdminDailySummary).mockResolvedValue(adminMetricsFixture);` line):

```ts
    dbMock.dailySummaryRecipient.findMany.mockResolvedValue([]);
```

Add the identical line to the `beforeEach` of `describe("sendOrganizerDailySummaries", ...)` (after `vi.mocked(getOrganizerDailySummary).mockResolvedValue(organizerMetricsFixture);`).

This default keeps every existing test passing unchanged (no extra recipients unless a test overrides it with `mockResolvedValueOnce`).

Then add these three tests inside `describe("sendAdminDailySummaries", ...)`, right before its closing `});`:

```ts
  it("envia para destinatários extras cadastrados (e-mail e whatsapp)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: false, dailySummaryWhatsappEnabled: false },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "recipient-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
      { id: "recipient-2", name: "João", type: "WHATSAPP", value: "11999999999" },
    ]);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "admin-1" } }),
    );
    expect(sendDailySummaryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "maria@example.com", role: "ADMIN" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("não reenvia pra um destinatário extra quando o dia já foi reivindicado (dedupe independente)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: false, dailySummaryWhatsappEnabled: false },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "recipient-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
    ]);
    vi.mocked(claimAlert).mockResolvedValue(false);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("falha em um destinatário extra não impede os demais nem o destinatário principal", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: false },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "recipient-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
      { id: "recipient-2", name: "João", type: "WHATSAPP", value: "11999999999" },
    ]);
    vi.mocked(sendDailySummaryEmail)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    expect(unclaimAlert).toHaveBeenCalledWith("DAILY_SUMMARY", "2026-07-12:recipient:recipient-1", "EMAIL");
    expect(result).toEqual({ sent: 2, failed: 1 });
  });
```

Then add this test inside `describe("sendOrganizerDailySummaries", ...)`, right before its closing `});`:

```ts
  it("envia para destinatários extras cadastrados pelo organizador, adicionando o código do país no whatsapp", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: false,
        organizerProfile: { id: "org-1", phone: null },
      },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "recipient-3", name: "Pedro", type: "WHATSAPP", value: "21988887777" },
    ]);

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "org-user-1" } }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5521988887777", expect.any(String));
    expect(result).toEqual({ sent: 1, failed: 0 });
  });
```

- [ ] **Step 2: Run the test file to verify the new tests fail**

Run: `npx vitest run tests/alert-daily-summary.test.ts`
Expected: the 4 new tests FAIL (extra-recipient sends never happen yet); the pre-existing tests still PASS (the `mockResolvedValue([])` default keeps them unaffected).

- [ ] **Step 3: Add the extra-recipient loop to `sendAdminDailySummaries`**

In `lib/alerts/daily-summary.ts`, add this helper function near the top, after `formatDateLabel` (around line 36):

```ts
function toWhatsAppDestination(localDigits: string): string {
  return `55${localDigits}`;
}
```

Then, inside `sendAdminDailySummaries`'s `for (const admin of admins) { ... }` loop, add this block right after the existing WhatsApp block and right before `if (hadFailure) failed++;` (i.e. right after the closing `}` of the `if (admin.dailySummaryWhatsappEnabled && admin.phone) { ... }` block at line 114):

```ts
      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: admin.id },
        select: { id: true, name: true, type: true, value: true },
      });

      for (const recipient of extraRecipients) {
        const recipientEntityId = `${key}:recipient:${recipient.id}`;

        if (recipient.type === "EMAIL" && smtpReady) {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "EMAIL")) {
              await sendDailySummaryEmail({ to: recipient.value, role: "ADMIN", dateLabel, rows: buildAdminEmailRows(metrics) });
              sent++;
            }
          } catch (err) {
            hadFailure = true;
            await unclaimAlert(ALERT_TYPE, recipientEntityId, "EMAIL");
            console.error("[sendAdminDailySummaries] failed for extra recipient", recipient.name, err);
          }
        }

        if (recipient.type === "WHATSAPP") {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "WHATSAPP")) {
              await sendWhatsAppMessage(toWhatsAppDestination(recipient.value), buildAdminWhatsAppText(metrics));
              sent++;
            }
          } catch (err) {
            hadFailure = true;
            await unclaimAlert(ALERT_TYPE, recipientEntityId, "WHATSAPP");
            console.error("[sendAdminDailySummaries] failed for extra recipient", recipient.name, err);
          }
        }
      }
```

- [ ] **Step 4: Add the identical extra-recipient loop to `sendOrganizerDailySummaries`**

Inside `sendOrganizerDailySummaries`'s `for (const organizer of organizers) { ... }` loop, add this block right after the existing WhatsApp block and right before `if (hadFailure) failed++;`:

```ts
      const extraRecipients = await db.dailySummaryRecipient.findMany({
        where: { userId: organizer.id },
        select: { id: true, name: true, type: true, value: true },
      });

      for (const recipient of extraRecipients) {
        const recipientEntityId = `${key}:recipient:${recipient.id}`;

        if (recipient.type === "EMAIL" && smtpReady) {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "EMAIL")) {
              await sendDailySummaryEmail({
                to: recipient.value,
                role: "ORGANIZER",
                dateLabel,
                rows: buildOrganizerEmailRows(metrics),
              });
              sent++;
            }
          } catch (err) {
            hadFailure = true;
            await unclaimAlert(ALERT_TYPE, recipientEntityId, "EMAIL");
            console.error("[sendOrganizerDailySummaries] failed for extra recipient", recipient.name, err);
          }
        }

        if (recipient.type === "WHATSAPP") {
          try {
            if (await claimAlert(ALERT_TYPE, ENTITY_TYPE, recipientEntityId, "WHATSAPP")) {
              await sendWhatsAppMessage(toWhatsAppDestination(recipient.value), buildOrganizerWhatsAppText(metrics));
              sent++;
            }
          } catch (err) {
            hadFailure = true;
            await unclaimAlert(ALERT_TYPE, recipientEntityId, "WHATSAPP");
            console.error("[sendOrganizerDailySummaries] failed for extra recipient", recipient.name, err);
          }
        }
      }
```

- [ ] **Step 5: Run the test file to verify it passes**

Run: `npx vitest run tests/alert-daily-summary.test.ts`
Expected: PASS (18 tests — the 14 pre-existing plus 4 new).

- [ ] **Step 6: Commit**

```bash
git add lib/alerts/daily-summary.ts tests/alert-daily-summary.test.ts
git commit -m "feat: send daily summary to registered extra recipients"
```

---

### Task 4: UI — recipients manager component + wiring

**Files:**
- Create: `components/profile/DailySummaryRecipientsManager.tsx`
- Modify: `app/admin/perfil/page.tsx`
- Modify: `app/organizador/perfil/page.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/daily-summary-recipients`, `DELETE /api/daily-summary-recipients/[id]` (Task 2); `components/ui/ConfirmModal.tsx`, `components/ui/ErrorModal.tsx` (existing).
- Produces: `<DailySummaryRecipientsManager />` — a self-contained client component with no props, placed as a page-level sibling (it renders its own `<form>`, so it must NOT be nested inside another `<form>`).

This task has no automated tests (matches this repo's existing convention — the two perfil pages themselves have no test files, since they're plain client components with no business logic beyond `fetch` wiring already covered by the route tests in Task 2). Verify manually via the steps below.

- [ ] **Step 1: Create the recipients manager component**

Create `components/profile/DailySummaryRecipientsManager.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

type RecipientType = "EMAIL" | "WHATSAPP";

type Recipient = {
  id: string;
  name: string;
  type: RecipientType;
  value: string;
};

export default function DailySummaryRecipientsManager() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState<RecipientType>("EMAIL");
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/daily-summary-recipients")
      .then((res) => res.json())
      .then(({ recipients }) => setRecipients(recipients ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/daily-summary-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type, value: value.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.error === "string") {
          setError(data.error);
        } else {
          const fieldMessage = Object.values(data.error?.fieldErrors ?? {}).flat()[0];
          const formMessage = data.error?.formErrors?.[0];
          setError((fieldMessage as string) ?? formMessage ?? "Erro ao adicionar destinatário.");
        }
        return;
      }
      const { recipient } = await res.json();
      setRecipients((prev) => [...prev, recipient]);
      setName("");
      setValue("");
    } finally {
      setAdding(false);
    }
  }

  async function doDelete() {
    if (!deletingId) return;
    setDeleting(true);
    try {
      await fetch(`/api/daily-summary-recipients/${deletingId}`, { method: "DELETE" });
      setRecipients((prev) => prev.filter((r) => r.id !== deletingId));
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  }

  if (loading) return null;

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Destinatários extras do resumo diário</h2>
      <p className="text-xs text-gray-500">
        Cadastre outras pessoas, por nome, para também receberem o resumo diário por e-mail ou WhatsApp.
      </p>

      {recipients.length > 0 && (
        <ul className="space-y-1">
          {recipients.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-800 rounded px-3 py-2"
            >
              <span>
                <strong>{r.name}</strong> — {r.type === "EMAIL" ? "E-mail" : "WhatsApp"}: {r.value}
              </span>
              <button type="button" onClick={() => setDeletingId(r.id)} className="text-red-600 text-xs hover:underline">
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field text-sm"
            placeholder="Ex: Maria (financeiro)"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as RecipientType)} className="input-field text-sm">
            <option value="EMAIL">E-mail</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {type === "EMAIL" ? "E-mail" : "Telefone (DDD + número)"}
          </label>
          <input
            type={type === "EMAIL" ? "email" : "tel"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input-field text-sm"
            placeholder={type === "EMAIL" ? "nome@exemplo.com" : "11999999999"}
            required
          />
        </div>
        <div className="sm:col-span-4">
          {type === "WHATSAPP" && (
            <p className="text-xs text-gray-500 mb-2">
              Informe só DDD + número, sem o +55 — o código do país é adicionado automaticamente no envio.
            </p>
          )}
          <button type="submit" disabled={adding} className="btn-secondary text-sm">
            {adding ? "Adicionando..." : "Adicionar destinatário"}
          </button>
        </div>
      </form>

      <ConfirmModal
        open={!!deletingId}
        title="Remover destinatário"
        message="Tem certeza que deseja remover este destinatário do resumo diário?"
        tone="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setDeletingId(null)}
      />
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the admin "Meus Dados" page**

In `app/admin/perfil/page.tsx`, add the import at the top (after the existing `ChangePasswordForm` import):

```tsx
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";
import DailySummaryRecipientsManager from "@/components/profile/DailySummaryRecipientsManager";
```

Then add `<DailySummaryRecipientsManager />` right after the closing `</form>` of the "Dados pessoais" form and before `<ChangePasswordForm />`:

```tsx
      </form>

      <DailySummaryRecipientsManager />

      <ChangePasswordForm />
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the organizer "Meus Dados" page**

In `app/organizador/perfil/page.tsx`, add the import at the top:

```tsx
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";
import DailySummaryRecipientsManager from "@/components/profile/DailySummaryRecipientsManager";
```

Then add `<DailySummaryRecipientsManager />` right after the closing `</form>` of the account (`handleAccountSubmit`) form — i.e. right before the `<form onSubmit={handleSubmit} className="card space-y-4">` that renders "Dados da organização":

```tsx
      </form>

      <DailySummaryRecipientsManager />

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900">Dados da organização</h2>
```

- [ ] **Step 4: Verify with typecheck and the full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass (no test touches this component directly, so the count only reflects Tasks 1-3's additions).

- [ ] **Step 5: Commit**

```bash
git add components/profile/DailySummaryRecipientsManager.tsx app/admin/perfil/page.tsx app/organizador/perfil/page.tsx
git commit -m "feat: add extra daily-summary recipients manager to admin and organizer profile pages"
```

---

## Post-plan manual steps (not code, do not skip)

- Deploy requires `prisma db push` (new table + new enum) — same as every schema-changing deploy this session.
- No crontab change needed — the existing `daily-summary` cron job already calls the updated sender functions.
