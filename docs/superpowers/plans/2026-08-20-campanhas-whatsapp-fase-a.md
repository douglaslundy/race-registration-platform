# Campanhas de WhatsApp — Fase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data model + a working CRUD (create/list/view/edit-while-draft/cancel/duplicate)
for WhatsApp campaigns, per event, gated by a new admin-controlled per-organizer toggle — no
recipient population, no message composition polish, no actual sending yet (later fases).

**Architecture:** New `Campaign` model (event-scoped, `DRAFT ⇄ CANCELLED` state machine) plus a new
`OrganizerProfile.campaignsEnabled` flag the admin controls per organizer. API routes mirror
`app/api/events/[id]/sponsors/*` exactly (the bug-fixed template — `EventSocialLink`'s equivalent
routes are missing the `actingAsAdmin` branch on mutations, a known, already-documented bug in this
codebase; do not copy that file). A single shared React client component renders both the
organizer's and the admin's campaign screens, since the API already resolves the role difference
transparently.

**Tech Stack:** Next.js (App Router) + Prisma/Postgres + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-campanhas-whatsapp-fase-a-design.md`

## Global Constraints

- `Campaign.status` uses the full `CampaignStatus` enum (`DRAFT/SCHEDULED/PREPARING/RUNNING/
  PAUSED/COMPLETED/CANCELLED/FAILED`) from the start — only `DRAFT`/`CANCELLED` are reachable via
  this phase's API, the rest exist so no future phase needs a Postgres `ALTER TYPE`.
- Editing (`PATCH`) and cancelling are only allowed when `status === "DRAFT"` — 400 otherwise.
- No hard delete of campaigns — cancel is the only terminal action.
- **Every** campaign API route (not just `GET`) must branch on `scope.actingAsAdmin` — this is a
  bug this codebase already has elsewhere (`app/api/events/[id]/social-links/*`'s mutating routes)
  and already fixed elsewhere (`app/api/events/[id]/sponsors/*`) — this plan follows the fixed
  pattern from the start.
- `hasCampaignsAccess` gates every campaign route in addition to the permission check — an admin
  always passes; an organizer/assistant only passes when their `OrganizerProfile.campaignsEnabled`
  is `true`.
- Assistant permission catalog entries (`campaigns.view/create/edit/cancel`) are added in the same
  task as the API routes that need them — a prior feature (patrocinadores) shipped its API before
  its permissions and that was a real bug (403 for every assistant); this plan avoids repeating it.
- No UI component tests (project convention) — only pure functions and API routes get automated
  tests for the UI-adjacent pieces.

---

### Task 1: Schema — `Campaign`, `CampaignStatus`, `OrganizerProfile.campaignsEnabled`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822000000_add_campaigns/migration.sql`

**Interfaces:**
- Produces: `model Campaign` (fields: `id`, `eventId`, `name`, `description?`, `status`,
  `messageBody`, `scheduledAt?`, `createdByUserId`, `createdAt`, `updatedAt`), `enum
  CampaignStatus`, `OrganizerProfile.campaignsEnabled: boolean`. Used by every later task.

- [ ] **Step 1: Add the enum and model to the Prisma schema**

Add this enum anywhere among the other enums in `prisma/schema.prisma` (e.g. near `ShirtSize` or
`EventStatus`):

```prisma
enum CampaignStatus {
  DRAFT
  SCHEDULED
  PREPARING
  RUNNING
  PAUSED
  COMPLETED
  CANCELLED
  FAILED
}
```

Add this model at the end of the file (after the last model):

```prisma
model Campaign {
  id              String         @id @default(cuid())
  eventId         String
  name            String
  description     String?
  status          CampaignStatus @default(DRAFT)
  messageBody     String         @db.Text
  scheduledAt     DateTime?
  createdByUserId String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  event         Event @relation(fields: [eventId], references: [id])
  createdByUser User  @relation(fields: [createdByUserId], references: [id])

  @@index([eventId, status])
  @@map("campaigns")
}
```

- [ ] **Step 2: Add the two back-relation fields**

In `model Event`, find the line `sponsors      EventSponsor[]` and add right after it:

```prisma
  campaigns     Campaign[]
```

In `model User`, find the line `createdCoupons   Coupon[]          @relation("CouponCreator")` and
add right after it:

```prisma
  campaigns        Campaign[]
```

- [ ] **Step 3: Add the access-gate field to `OrganizerProfile`**

In `model OrganizerProfile`, find the line `verified    Boolean  @default(false)` and add right
after it:

```prisma
  campaignsEnabled Boolean  @default(false)
```

- [ ] **Step 4: Write the migration by hand**

Create `prisma/migrations/20260822000000_add_campaigns/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PREPARING', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "organizer_profiles" ADD COLUMN     "campaignsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "messageBody" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_eventId_status_idx" ON "campaigns"("eventId", "status");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: succeeds without a live DB connection (reads only `schema.prisma`).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260822000000_add_campaigns
git commit -m "feat: adiciona modelo Campaign e OrganizerProfile.campaignsEnabled"
```

---

### Task 2: `lib/campaigns/access.ts` — gate de acesso

**Files:**
- Create: `lib/campaigns/access.ts`
- Test: `tests/campaigns-access.test.ts`

**Interfaces:**
- Consumes: `AssistantScope` (from `lib/auth/rbac.ts`, already exists: `{ actingAsAdmin: boolean;
  organizerId: string | null }`).
- Produces: `hasCampaignsAccess(scope: AssistantScope): Promise<boolean>`. Used by Task 4's API
  routes.

- [ ] **Step 1: Write the failing tests**

Create `tests/campaigns-access.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasCampaignsAccess } from "@/lib/campaigns/access";

const dbMock = db as any;

describe("hasCampaignsAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna true quando actingAsAdmin é true, sem consultar o banco", async () => {
    const result = await hasCampaignsAccess({ actingAsAdmin: true, organizerId: null });

    expect(result).toBe(true);
    expect(dbMock.organizerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("retorna true quando o organizador tem campaignsEnabled=true", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ campaignsEnabled: true });

    const result = await hasCampaignsAccess({ actingAsAdmin: false, organizerId: "org-1" });

    expect(result).toBe(true);
    expect(dbMock.organizerProfile.findUnique).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: { campaignsEnabled: true },
    });
  });

  it("retorna false quando o organizador tem campaignsEnabled=false", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ campaignsEnabled: false });

    const result = await hasCampaignsAccess({ actingAsAdmin: false, organizerId: "org-1" });

    expect(result).toBe(false);
  });

  it("retorna false quando organizerId é null, sem consultar o banco", async () => {
    const result = await hasCampaignsAccess({ actingAsAdmin: false, organizerId: null });

    expect(result).toBe(false);
    expect(dbMock.organizerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("retorna false quando o organizerProfile não é encontrado", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce(null);

    const result = await hasCampaignsAccess({ actingAsAdmin: false, organizerId: "org-1" });

    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/campaigns-access.test.ts`
Expected: FAIL — `lib/campaigns/access.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/campaigns/access.ts`:

```ts
import { db } from "@/lib/db";
import type { AssistantScope } from "@/lib/auth/rbac";

/** Verifica se o escopo efetivo (organizador/admin/assistente já resolvido por
 * resolveActingScope) tem acesso à feature de campanhas de WhatsApp. Admin sempre tem acesso;
 * organizador (e assistentes dele) só quando o admin habilitou explicitamente pra aquele
 * organizador via OrganizerProfile.campaignsEnabled. */
export async function hasCampaignsAccess(scope: AssistantScope): Promise<boolean> {
  if (scope.actingAsAdmin) return true;
  if (!scope.organizerId) return false;

  const profile = await db.organizerProfile.findUnique({
    where: { id: scope.organizerId },
    select: { campaignsEnabled: true },
  });

  return profile?.campaignsEnabled ?? false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/campaigns-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/access.ts tests/campaigns-access.test.ts
git commit -m "feat: adiciona hasCampaignsAccess (gate de acesso a campanhas por organizador)"
```

---

### Task 3: Admin habilita campanhas por organizador

**Files:**
- Modify: `app/api/admin/users/[id]/route.ts`
- Modify: `components/admin/UserForm.tsx`
- Modify: `app/admin/usuarios/[id]/editar/page.tsx`
- Test: `tests/admin-users-route.test.ts`

**Interfaces:**
- Consumes: `OrganizerProfile.campaignsEnabled` (Task 1).
- Produces: `PATCH /api/admin/users/[id]` accepts `campaignsEnabled: boolean` in the body when
  editing an organizer. Used later by Task 4's tests (as the mechanism to grant access), and by
  the actual admin UI flow.

- [ ] **Step 1: Write the failing tests**

This file mocks `dbMock.$transaction.mockImplementationOnce(async (fn) => fn({ user: {...},
athleteProfile: {...}, auditLog: {...} }))` — the transaction callback receives its OWN `tx` mock
object (not `dbMock` directly), so a new model used inside the transaction needs its own `tx.
organizerProfile` mock passed into that same object. Add these 2 tests inside the `describe` block
that covers `PATCH` (mirroring the existing "corrige CPF e data de nascimento de um atleta" test's
structure exactly):

```ts
  it("habilita campaignsEnabled num organizador via upsert em organizerProfile", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "org-user-1", email: "organizador@exemplo.com" });
    const txUserUpdate = vi.fn().mockResolvedValueOnce({
      id: "org-user-1",
      name: "Organizador",
      email: "organizador@exemplo.com",
      role: "ORGANIZER",
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const txOrganizerProfileUpsert = vi.fn().mockResolvedValueOnce({});
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        user: { update: txUserUpdate },
        athleteProfile: { upsert: vi.fn() },
        organizerProfile: { upsert: txOrganizerProfileUpsert },
        auditLog: { create: vi.fn() },
      }),
    );

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/org-user-1", {
        method: "PATCH",
        body: JSON.stringify({ campaignsEnabled: true }),
      }) as any,
      { params: Promise.resolve({ id: "org-user-1" }) },
    );

    expect(res.status).toBe(200);
    expect(txOrganizerProfileUpsert).toHaveBeenCalledWith({
      where: { userId: "org-user-1" },
      create: { userId: "org-user-1", campaignsEnabled: true },
      update: { campaignsEnabled: true },
    });
  });

  it("não toca em organizerProfile quando campaignsEnabled não é enviado", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "org-user-1", email: "organizador@exemplo.com" });
    const txUserUpdate = vi.fn().mockResolvedValueOnce({
      id: "org-user-1",
      name: "Novo Nome",
      email: "organizador@exemplo.com",
      role: "ORGANIZER",
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const txOrganizerProfileUpsert = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        user: { update: txUserUpdate },
        athleteProfile: { upsert: vi.fn() },
        organizerProfile: { upsert: txOrganizerProfileUpsert },
        auditLog: { create: vi.fn() },
      }),
    );

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/org-user-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Novo Nome" }),
      }) as any,
      { params: Promise.resolve({ id: "org-user-1" }) },
    );

    expect(res.status).toBe(200);
    expect(txOrganizerProfileUpsert).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/admin-users-route.test.ts`
Expected: the 2 new tests FAIL (the route doesn't handle `campaignsEnabled` yet); every
pre-existing test in the file must still PASS.

- [ ] **Step 3: Implement the backend**

In `app/api/admin/users/[id]/route.ts`, add to `patchSchema` (right after the `preferredShirtSize`
line):

```ts
  campaignsEnabled: z.boolean().optional(),
```

Inside the `PATCH` function's transaction, right after the existing `athleteData` block (after the
`if (Object.keys(athleteData).length > 0) { await tx.athleteProfile.upsert(...) }` block), add:

```ts
      const organizerData: Record<string, unknown> = {};
      if (parsed.data.campaignsEnabled !== undefined) organizerData.campaignsEnabled = parsed.data.campaignsEnabled;

      if (Object.keys(organizerData).length > 0) {
        await tx.organizerProfile.upsert({
          where: { userId: id },
          create: { userId: id, ...organizerData },
          update: organizerData,
        });
      }
```

Update the `auditLog.create` call's `metadata` to also spread `organizerData`:

```ts
          metadata: {
            ...data,
            ...athleteData,
            ...organizerData,
            passwordHash: parsed.data.password ? "[redacted]" : undefined,
          },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/admin-users-route.test.ts`
Expected: all PASS.

- [ ] **Step 5: Implement the frontend**

In `components/admin/UserForm.tsx`:

Change the `InitialUser` type to add:

```ts
  organizerProfile?: { campaignsEnabled: boolean } | null;
```

Add a new state right after the existing `birthDate` state:

```tsx
  const [campaignsEnabled, setCampaignsEnabled] = useState(
    initialUser?.organizerProfile?.campaignsEnabled ?? false,
  );
```

In `handleSubmit`, right after the existing `if (isEdit && role === "ATHLETE") { ... }` block, add:

```tsx
    if (isEdit && role === "ORGANIZER") {
      payload.campaignsEnabled = campaignsEnabled;
    }
```

In the JSX, right after the existing `{isEdit && role === "ATHLETE" && (...)}` block, add:

```tsx
      {isEdit && role === "ORGANIZER" && (
        <div className="space-y-1">
          <label className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-3">
            <input
              type="checkbox"
              checked={campaignsEnabled}
              onChange={(e) => setCampaignsEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Habilitar campanhas de WhatsApp pra este organizador
            </span>
          </label>
        </div>
      )}
```

In `app/admin/usuarios/[id]/editar/page.tsx`, add `organizerProfile: { select: { campaignsEnabled:
true } },` to the `select` object, right after the existing `athleteProfile: { select: { cpf:
true, birthDate: true } },` line.

No automated test for the 2 `.tsx` files (project convention — no UI component tests); the
contract they rely on (`PATCH` accepting `campaignsEnabled`) is covered by Step 1-4.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/users/\[id\]/route.ts components/admin/UserForm.tsx app/admin/usuarios/\[id\]/editar/page.tsx tests/admin-users-route.test.ts
git commit -m "feat: admin habilita campanhas de WhatsApp individualmente por organizador"
```

---

### Task 4: API de campanhas + permissões de assistente

**Files:**
- Create: `app/api/events/[id]/campaigns/route.ts`
- Create: `app/api/events/[id]/campaigns/[campaignId]/route.ts`
- Create: `app/api/events/[id]/campaigns/[campaignId]/cancel/route.ts`
- Create: `app/api/events/[id]/campaigns/[campaignId]/duplicate/route.ts`
- Modify: `app/organizador/assistentes/page.tsx`
- Modify: `app/admin/assistentes/page.tsx`
- Modify: `tests/setup.ts`
- Test: `tests/events-campaigns-route.test.ts`

**Interfaces:**
- Consumes: `hasCampaignsAccess` (Task 2), `checkApiPermission`/`resolveActingScope` (existing,
  `lib/auth/rbac.ts`).
- Produces: the 4 routes below. Used by Task 5's UI.

- [ ] **Step 1: Add the `campaign` model to the global test DB mock**

In `tests/setup.ts`, inside the `db` mock object, add (alongside the other model entries, e.g.
right after the `advertiserProfile` line or wherever fits alphabetically/thematically with the
rest of the file's existing entries):

```ts
    campaign: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
```

- [ ] **Step 2: Write the failing tests**

Create `tests/events-campaigns-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, POST } from "@/app/api/events/[id]/campaigns/route";
import { GET as GET_ONE, PATCH } from "@/app/api/events/[id]/campaigns/[campaignId]/route";
import { POST as CANCEL } from "@/app/api/events/[id]/campaigns/[campaignId]/cancel/route";
import { POST as DUPLICATE } from "@/app/api/events/[id]/campaigns/[campaignId]/duplicate/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/events/event-1/campaigns", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

const draftCampaign = {
  id: "campaign-1",
  eventId: "event-1",
  name: "Campanha de teste",
  description: null,
  status: "DRAFT",
  messageBody: "Olá {{nome_atleta}}!",
  createdByUserId: "organizer-1",
};

describe("GET/POST /api/events/[id]/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ campaignsEnabled: true });
  });

  it("lista as campanhas do evento", async () => {
    dbMock.campaign.findMany.mockResolvedValueOnce([draftCampaign]);

    const res = await GET(makeRequest("GET"), { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.campaigns).toHaveLength(1);
  });

  it("bloqueia quando o organizador não tem campaignsEnabled", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValueOnce({ campaignsEnabled: false });

    const res = await GET(makeRequest("GET"), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("cria uma campanha nova em DRAFT", async () => {
    dbMock.campaign.create.mockResolvedValueOnce({ ...draftCampaign });

    const res = await POST(
      makeRequest("POST", { name: "Campanha de teste", messageBody: "Olá {{nome_atleta}}!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: "event-1", createdByUserId: "organizer-1", name: "Campanha de teste" }),
      }),
    );
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_CREATED" }) }),
    );
  });

  it("rejeita corpo inválido (sem messageBody)", async () => {
    const res = await POST(
      makeRequest("POST", { name: "Campanha de teste" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("cria uma campanha como ADMIN, mesmo sem ser o organizador do evento", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-1" });
    dbMock.campaign.create.mockResolvedValueOnce({ ...draftCampaign, createdByUserId: "admin-1" });

    const res = await POST(
      makeRequest("POST", { name: "Campanha de teste", messageBody: "Olá!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-1" } });
  });
});

describe("GET/PATCH /api/events/[id]/campaigns/[campaignId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ ...draftCampaign });
  });

  it("retorna a campanha", async () => {
    const res = await GET_ONE(makeRequest("GET"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });
    expect(res.status).toBe(200);
  });

  it("retorna 404 quando a campanha não pertence ao evento", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce(null);
    const res = await GET_ONE(makeRequest("GET"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-999" }) });
    expect(res.status).toBe(404);
  });

  it("edita uma campanha em DRAFT", async () => {
    dbMock.campaign.update.mockResolvedValueOnce({ ...draftCampaign, name: "Nome novo" });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Nome novo" }),
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "campaign-1" }, data: expect.objectContaining({ name: "Nome novo" }) }),
    );
  });

  it("rejeita editar uma campanha que não está em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Nome novo" }),
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[id]/campaigns/[campaignId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ campaignsEnabled: true });
  });

  it("cancela uma campanha em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign });
    dbMock.campaign.update.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "CANCELLED" } });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_CANCELLED" }) }),
    );
  });

  it("rejeita cancelar uma campanha já cancelada", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[id]/campaigns/[campaignId]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ campaignsEnabled: true });
  });

  it("duplica uma campanha existente numa DRAFT nova", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });
    dbMock.campaign.create.mockResolvedValueOnce({ ...draftCampaign, id: "campaign-2", name: "Cópia de Campanha de teste" });

    const res = await DUPLICATE(makeRequest("POST"), { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "event-1",
          name: "Cópia de Campanha de teste",
          messageBody: draftCampaign.messageBody,
          status: "DRAFT",
        }),
      }),
    );
    expect(data.campaign.name).toBe("Cópia de Campanha de teste");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/events-campaigns-route.test.ts`
Expected: FAIL — none of the 4 route files exist yet.

- [ ] **Step 4: Implement `app/api/events/[id]/campaigns/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { hasCampaignsAccess } from "@/lib/campaigns/access";
import { db } from "@/lib/db";
import { z } from "zod";

const campaignSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  messageBody: z.string().trim().min(1),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  if (!(await hasCampaignsAccess(scope))) {
    return NextResponse.json(
      { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
      { status: 403 },
    );
  }

  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const campaigns = await db.campaign.findMany({ where: { eventId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);
  if (!(await hasCampaignsAccess(scope))) {
    return NextResponse.json(
      { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
      { status: 403 },
    );
  }

  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const campaign = await db.campaign.create({
    data: { eventId: id, createdByUserId: session.user.id, ...parsed.data },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_CREATED",
      entityType: "Campaign",
      entityId: campaign.id,
      metadata: { eventId: id, name: campaign.name },
    },
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
```

- [ ] **Step 5: Implement `app/api/events/[id]/campaigns/[campaignId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope, type AssistantScope } from "@/lib/auth/rbac";
import { hasCampaignsAccess } from "@/lib/campaigns/access";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  messageBody: z.string().trim().min(1).optional(),
});

async function loadEventAndCampaign(scope: AssistantScope, eventId: string, campaignId: string) {
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return { event: null, campaign: null };

  const campaign = await db.campaign.findFirst({ where: { id: campaignId, eventId } });
  return { event, campaign };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const scope = await resolveActingScope(session);
  if (!(await hasCampaignsAccess(scope))) {
    return NextResponse.json(
      { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
      { status: 403 },
    );
  }

  const { event, campaign } = await loadEventAndCampaign(scope, id, campaignId);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  return NextResponse.json({ campaign });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const scope = await resolveActingScope(session);
  if (!(await hasCampaignsAccess(scope))) {
    return NextResponse.json(
      { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
      { status: 403 },
    );
  }

  const { event, campaign } = await loadEventAndCampaign(scope, id, campaignId);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (campaign.status !== "DRAFT") {
    return NextResponse.json({ error: "Só é possível editar campanhas em rascunho" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await db.campaign.update({ where: { id: campaignId }, data: parsed.data });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_UPDATED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: parsed.data,
    },
  });

  return NextResponse.json({ campaign: updated });
}
```

- [ ] **Step 6: Implement `app/api/events/[id]/campaigns/[campaignId]/cancel/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { hasCampaignsAccess } from "@/lib/campaigns/access";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.cancel");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const scope = await resolveActingScope(session);
  if (!(await hasCampaignsAccess(scope))) {
    return NextResponse.json(
      { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
      { status: 403 },
    );
  }

  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const campaign = await db.campaign.findFirst({ where: { id: campaignId, eventId: id } });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (campaign.status !== "DRAFT") {
    return NextResponse.json({ error: "Só é possível cancelar campanhas em rascunho" }, { status: 400 });
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "CANCELLED" } });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_CANCELLED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: {},
    },
  });

  return NextResponse.json({ campaign: updated });
}
```

- [ ] **Step 7: Implement `app/api/events/[id]/campaigns/[campaignId]/duplicate/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { hasCampaignsAccess } from "@/lib/campaigns/access";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const scope = await resolveActingScope(session);
  if (!(await hasCampaignsAccess(scope))) {
    return NextResponse.json(
      { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
      { status: 403 },
    );
  }

  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const original = await db.campaign.findFirst({ where: { id: campaignId, eventId: id } });
  if (!original) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  const duplicate = await db.campaign.create({
    data: {
      eventId: id,
      createdByUserId: session.user.id,
      name: `Cópia de ${original.name}`,
      description: original.description,
      messageBody: original.messageBody,
      status: "DRAFT",
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_DUPLICATED",
      entityType: "Campaign",
      entityId: duplicate.id,
      metadata: { originalCampaignId: campaignId },
    },
  });

  return NextResponse.json({ campaign: duplicate }, { status: 201 });
}
```

- [ ] **Step 8: Add the assistant permission catalog entries**

In `app/organizador/assistentes/page.tsx`, find the 4 `sponsors.*` entries (`{ key:
"sponsors.view", ... }` through `{ key: "sponsors.delete", ... }`) and add right after them:

```ts
  { key: "campaigns.view", label: "Ver campanhas de WhatsApp de um evento" },
  { key: "campaigns.create", label: "Criar campanha de WhatsApp" },
  { key: "campaigns.edit", label: "Editar campanha de WhatsApp" },
  { key: "campaigns.cancel", label: "Cancelar campanha de WhatsApp" },
```

Apply the identical addition to `app/admin/assistentes/page.tsx`, in the same relative position
(right after its own 4 `sponsors.*` entries).

- [ ] **Step 9: Run to verify everything passes**

Run: `npx vitest run tests/events-campaigns-route.test.ts`
Expected: all PASS.

- [ ] **Step 10: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions anywhere else in the suite.

- [ ] **Step 11: Commit**

```bash
git add app/api/events/\[id\]/campaigns tests/events-campaigns-route.test.ts tests/setup.ts app/organizador/assistentes/page.tsx app/admin/assistentes/page.tsx
git commit -m "feat: API de campanhas de WhatsApp (CRUD basico) + permissoes de assistente"
```

---

### Task 5: UI — telas de organizador e admin

**Files:**
- Create: `components/campaigns/CampaignsManager.tsx`
- Create: `app/organizador/eventos/[id]/campanhas/page.tsx`
- Create: `app/admin/eventos/[id]/campanhas/page.tsx`
- Modify: `app/organizador/eventos/[id]/page.tsx`
- Modify: `app/admin/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/events/[id]/campaigns`, `GET/PATCH /api/events/[id]/campaigns/
  [campaignId]`, `POST .../cancel`, `POST .../duplicate` (Task 4).

- [ ] **Step 1: Create the shared client component**

Create `components/campaigns/CampaignsManager.tsx` — a single component rendered by both the
organizer and the admin pages (the API already resolves the role difference transparently, so no
prop is needed to distinguish them beyond the navigation "back" link):

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorModal from "@/components/ui/ErrorModal";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  messageBody: string;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  PREPARING: "Preparando",
  RUNNING: "Em andamento",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
  FAILED: "Falhou",
};

export default function CampaignsManager({ eventId, backHref }: { eventId: string; backHref: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", messageBody: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", messageBody: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch(`/api/events/${eventId}/campaigns`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPageError(data.error ?? "Erro ao carregar campanhas");
      return;
    }
    setPageError(null);
    setCampaigns(data.campaigns ?? []);
  }

  useEffect(() => {
    void (async () => {
      await reload();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const res = await fetch(`/api/events/${eventId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        ...(form.description ? { description: form.description } : {}),
        messageBody: form.messageBody,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
      setFormError(
        data.error?.formErrors?.[0] ??
          (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
          "Erro ao criar campanha",
      );
    } else {
      setShowForm(false);
      setForm({ name: "", description: "", messageBody: "" });
      await reload();
    }
    setSaving(false);
  }

  function openEdit(campaign: Campaign) {
    setEditId(campaign.id);
    setEditForm({
      name: campaign.name,
      description: campaign.description ?? "",
      messageBody: campaign.messageBody,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    setEditSaving(true);
    const res = await fetch(`/api/events/${eventId}/campaigns/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        description: editForm.description,
        messageBody: editForm.messageBody,
      }),
    });
    setEditSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao salvar campanha");
      return;
    }
    setEditId(null);
    await reload();
  }

  async function doCancel() {
    if (!cancelingId) return;
    setCanceling(true);
    const res = await fetch(`/api/events/${eventId}/campaigns/${cancelingId}/cancel`, { method: "POST" });
    setCanceling(false);
    setCancelingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao cancelar campanha");
      return;
    }
    await reload();
  }

  async function doDuplicate(campaignId: string) {
    const res = await fetch(`/api/events/${eventId}/campaigns/${campaignId}/duplicate`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao duplicar campanha");
      return;
    }
    await reload();
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfirmModal
        open={!!cancelingId}
        title="Cancelar campanha"
        message="Deseja cancelar esta campanha? Essa ação não pode ser desfeita."
        tone="danger"
        loading={canceling}
        onConfirm={doCancel}
        onCancel={() => setCancelingId(null)}
      />

      <ErrorModal message={actionError} onClose={() => setActionError(null)} />

      {editId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setEditId(null)}
        >
          <form
            onSubmit={saveEdit}
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar campanha</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
              <input
                required
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
              <input
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem</label>
              <textarea
                required
                value={editForm.messageBody}
                onChange={(e) => setEditForm({ ...editForm, messageBody: e.target.value })}
                className="input w-full"
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="px-4 py-2 text-sm rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-medium"
              >
                {editSaving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <Link href={backHref} className="text-sm text-gray-500 hover:text-primary-600">
            ← Voltar
          </Link>
          <h1 className="text-xl font-bold mt-1">Campanhas de WhatsApp</h1>
          <p className="text-sm text-gray-500">Mensagens promocionais em massa pros inscritos deste evento.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
          + Nova campanha
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2 className="font-semibold">Nova campanha</h2>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded px-3 py-2">
              {formError}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input w-full"
              placeholder="Ex: Últimas vagas — Corrida de Verão"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem *</label>
            <textarea
              required
              value={form.messageBody}
              onChange={(e) => setForm({ ...form, messageBody: e.target.value })}
              className="input w-full"
              rows={4}
              placeholder="Escreva a mensagem que será enviada..."
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Criando..." : "Criar"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {pageError ? (
        <div className="card text-center py-8 text-red-600 dark:text-red-400">{pageError}</div>
      ) : campaigns.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhuma campanha cadastrada.</div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {campaign.name}{" "}
                    <span className="text-xs text-gray-400">({STATUS_LABEL[campaign.status] ?? campaign.status})</span>
                  </p>
                  {campaign.description && <p className="text-sm text-gray-500">{campaign.description}</p>}
                  <p className="text-sm text-gray-400 truncate max-w-md">{campaign.messageBody}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {campaign.status === "DRAFT" && (
                    <>
                      <button onClick={() => openEdit(campaign)} className="text-blue-600 hover:text-blue-800 text-sm">
                        Editar
                      </button>
                      <button onClick={() => setCancelingId(campaign.id)} className="text-red-500 hover:text-red-700 text-sm">
                        Cancelar
                      </button>
                    </>
                  )}
                  <button onClick={() => void doDuplicate(campaign.id)} className="text-gray-600 hover:text-gray-800 text-sm">
                    Duplicar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the organizer page**

Create `app/organizador/eventos/[id]/campanhas/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import CampaignsManager from "@/components/campaigns/CampaignsManager";

export default function OrganizerCampaignsPage() {
  const { id } = useParams<{ id: string }>();
  return <CampaignsManager eventId={id} backHref={`/organizador/eventos/${id}`} />;
}
```

- [ ] **Step 3: Create the admin page**

Create `app/admin/eventos/[id]/campanhas/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import CampaignsManager from "@/components/campaigns/CampaignsManager";

export default function AdminCampaignsPage() {
  const { id } = useParams<{ id: string }>();
  return <CampaignsManager eventId={id} backHref={`/admin/eventos/${id}`} />;
}
```

- [ ] **Step 4: Link from the organizer event page, gated on `campaignsEnabled`**

In `app/organizador/eventos/[id]/page.tsx`, add `organizer: { select: { campaignsEnabled: true }
},` to the `include` object of the `db.event.findFirst` call, right after the existing `coupons: {
orderBy: { createdAt: "asc" } },` line.

Then, right after the existing `<Link href={`/organizador/eventos/${id}/patrocinio`} ...>` block in
the action-links row, add:

```tsx
        {event.organizer.campaignsEnabled && (
          <Link href={`/organizador/eventos/${id}/campanhas`} className="btn-secondary text-center">
            Campanhas de WhatsApp
          </Link>
        )}
```

- [ ] **Step 5: Link from the admin event page (always visible — admin bypasses the gate)**

In `app/admin/eventos/[id]/page.tsx`, right after the existing `<Link
href={`/admin/eventos/${event.id}/entrega-kits`} ...>` block in the action-links row, add:

```tsx
        <Link href={`/admin/eventos/${event.id}/campanhas`} className="btn-secondary text-sm">
          Campanhas de WhatsApp
        </Link>
```

No automated test for any of these 5 files (project convention — no UI component tests; the
underlying API contract is already covered by Task 4's tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Full suite**

Run: `npx vitest run`
Expected: no regressions anywhere in the project.

- [ ] **Step 8: Commit**

```bash
git add components/campaigns app/organizador/eventos/\[id\]/campanhas app/admin/eventos/\[id\]/campanhas app/organizador/eventos/\[id\]/page.tsx app/admin/eventos/\[id\]/page.tsx
git commit -m "feat: telas de organizador e admin para campanhas de WhatsApp (Fase A)"
```

---

## Final check (after all 5 tasks)

- [ ] Run the full suite once more: `npx vitest run`
- [ ] Run `npx tsc --noEmit`
- [ ] Confirm the deploy note: this feature needs a schema migration
  (`prisma/migrations/20260822000000_add_campaigns`) — on the VPS, apply it manually via `psql`
  (or `prisma migrate deploy`) **before** `prisma db push` in the existing 4-step deploy sequence,
  same pattern as every other schema change in this project. Do not deploy without explicit user
  authorization.
- [ ] Manual verification recommended once there's DB access: admin enables `campaignsEnabled` for
  a test organizer, organizer sees the "Campanhas de WhatsApp" link appear, creates/edits/
  duplicates/cancels a campaign; an organizer WITHOUT `campaignsEnabled` does not see the link and
  gets 403 if hitting the API directly; admin manages a campaign for an event they don't organize.
- [ ] This is Fase A of 6 for the "Campanhas de WhatsApp em massa" sub-project — no recipient
  population, message composition polish, scheduling, sending, delivery status, or pause/resume
  exist yet. Next: Fase B (população de destinatários).
