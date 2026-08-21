# Campanhas de WhatsApp — Fase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate campaign recipients from event registrations (or, for admin-only platform-wide
campaigns, from the entire athlete base), applying the promotional-consent filter, phone
validation, and phone-based deduplication — synchronously, in batches, with a summary the UI can
show. Also extends Fase A's foundation so a campaign can target the whole platform instead of one
event, restricted to admin.

**Architecture:** `Campaign.eventId` becomes nullable (`null` = platform-wide). A new shared
`lib/campaigns/service.ts` centralizes the access-gate + event/campaign lookup preamble that was
duplicated across Fase A's 4 route files (per that phase's final-review recommendation) — both the
existing per-event routes and this phase's new admin-only platform routes call into it. A new
`CampaignRecipient` model (full 12-state enum defined upfront, only 4 states reachable this phase)
is populated by `lib/campaigns/recipients.ts`, which pages through candidates in batches, applies
the `receivePromotionalMessages` filter (always, never optional), validates/normalizes phone
numbers, and deduplicates by phone within the campaign.

**Tech Stack:** Next.js (App Router) + Prisma/Postgres + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-campanhas-whatsapp-fase-b-design.md`

## Global Constraints

- `receivePromotionalMessages` filtering is **never** optional/toggleable by organizer or admin —
  it is always applied during population.
- Recipient population is **synchronous** within the request, batched (~500 rows/page) to avoid
  loading everything into memory — no background/async processing, no `PREPARING` state, in this
  phase (explicit user decision).
- Population only runs when `campaign.status === "DRAFT"` — 400 otherwise. Re-running it deletes
  and rebuilds the campaign's recipients from scratch (idempotent from the caller's perspective).
- Platform-wide campaigns (`eventId: null`) are reachable **only** through `/api/admin/campaigns/*`
  and require `scope.actingAsAdmin` — no organizer, however configured, ever reaches this path.
- `CampaignRecipientStatus`'s full 12-value enum is defined now; only `PENDING`, `OPTED_OUT`,
  `INVALID_PHONE`, `SKIPPED` are produced by this phase's code.
- Fields related to actually sending (attempts, `providerMessageId`, queued/sent/delivered/read/
  failed timestamps) are **not** added to `CampaignRecipient` in this phase — they arrive in Fase D
  with the code that uses them, mirroring how Fase A didn't create `CampaignRecipient` before this
  phase needed it.
- No UI component tests (project convention) — only pure functions and API routes get automated
  tests for the UI-adjacent pieces.

---

### Task 1: Schema — `Campaign.eventId` nullable, `CampaignRecipient`, back-relations

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822010000_add_campaign_recipients/migration.sql`

**Interfaces:**
- Produces: `Campaign.eventId: string | null`, `model CampaignRecipient` (fields: `id`,
  `campaignId`, `athleteUserId`, `registrationId?`, `normalizedPhone`, `status`, `failureReason?`,
  `createdAt`, `updatedAt`), `enum CampaignRecipientStatus`. Used by every later task.

- [ ] **Step 1: Make `Campaign.eventId` optional**

In `prisma/schema.prisma`, inside `model Campaign`, change:

```prisma
  eventId         String
```

to:

```prisma
  eventId         String?
```

and change:

```prisma
  event         Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
```

to:

```prisma
  event         Event? @relation(fields: [eventId], references: [id], onDelete: Cascade)
```

Right after that `event`/`createdByUser` pair, add a new back-relation field:

```prisma
  recipients    CampaignRecipient[]
```

- [ ] **Step 2: Add the `CampaignRecipientStatus` enum**

Add this enum anywhere among the other enums in `prisma/schema.prisma` (e.g. near
`CampaignStatus`):

```prisma
enum CampaignRecipientStatus {
  PENDING
  QUEUED
  PROCESSING
  SENT
  DELIVERED
  READ
  FAILED
  SKIPPED
  INVALID_PHONE
  WHATSAPP_NOT_FOUND
  OPTED_OUT
  CANCELLED
}
```

- [ ] **Step 3: Add the `CampaignRecipient` model**

Add this model at the end of the file:

```prisma
model CampaignRecipient {
  id              String                  @id @default(cuid())
  campaignId      String
  athleteUserId   String
  registrationId  String?
  normalizedPhone String
  status          CampaignRecipientStatus @default(PENDING)
  failureReason   String?
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt

  campaign     Campaign      @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  athlete      User          @relation(fields: [athleteUserId], references: [id])
  registration Registration? @relation(fields: [registrationId], references: [id])

  @@index([campaignId, status])
  @@map("campaign_recipients")
}
```

- [ ] **Step 4: Add the two remaining back-relation fields**

In `model User`, find the line `campaigns        Campaign[]` (added in Fase A) and add right after
it:

```prisma
  campaignRecipients CampaignRecipient[]
```

In `model Registration`, find the line `kitDelivery  KitDelivery?` (the last relation field before
the `@@index`/`@@map` lines) and add right after it:

```prisma
  campaignRecipients CampaignRecipient[]
```

- [ ] **Step 5: Write the migration by hand**

Create `prisma/migrations/20260822010000_add_campaign_recipients/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "campaigns" ALTER COLUMN "eventId" DROP NOT NULL;

-- CreateEnum
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'INVALID_PHONE', 'WHATSAPP_NOT_FOUND', 'OPTED_OUT', 'CANCELLED');

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "athleteUserId" TEXT NOT NULL,
    "registrationId" TEXT,
    "normalizedPhone" TEXT NOT NULL,
    "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_recipients_campaignId_status_idx" ON "campaign_recipients"("campaignId", "status");

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_athleteUserId_fkey" FOREIGN KEY ("athleteUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 6: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: succeeds without a live DB connection.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. Note: this WILL surface type errors in the 4 existing campaign route
files that assumed `eventId`/`event` were non-nullable in places — that's expected and is exactly
what Task 2 fixes; do not attempt to fix those files in this task.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260822010000_add_campaign_recipients
git commit -m "feat: eventId opcional em Campaign + modelo CampaignRecipient"
```

---

### Task 2: `lib/campaigns/service.ts` + refatoração das rotas existentes

**Files:**
- Create: `lib/campaigns/service.ts`
- Modify: `app/api/events/[id]/campaigns/route.ts`
- Modify: `app/api/events/[id]/campaigns/[campaignId]/route.ts`
- Modify: `app/api/events/[id]/campaigns/[campaignId]/cancel/route.ts`
- Modify: `app/api/events/[id]/campaigns/[campaignId]/duplicate/route.ts`

**Interfaces:**
- Consumes: `resolveActingScope`/`AssistantScope` (existing), `hasCampaignsAccess` (existing,
  Fase A).
- Produces: `resolveCampaignListContext({ session, eventId }): Promise<{ ok: true; scope;
  event: Event | null } | { ok: false; response }>` and `resolveCampaignDetailContext({ session,
  eventId, campaignId }): Promise<{ ok: true; scope; event: Event | null; campaign: Campaign } |
  { ok: false; response }>`. Used by every later task's new routes (Tasks 4 and 5) AND by this
  task's refactor of the 4 existing routes.

**This is a refactor, not a behavior change** — the existing test file
`tests/events-campaigns-route.test.ts` must pass **unchanged** after this task (do not edit that
test file in this task).

- [ ] **Step 1: Create `lib/campaigns/service.ts`**

```ts
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { resolveActingScope, type AssistantScope } from "@/lib/auth/rbac";
import { hasCampaignsAccess } from "@/lib/campaigns/access";
import { db } from "@/lib/db";
import type { Campaign, Event } from "@prisma/client";

type ListContextResult =
  | { ok: true; scope: AssistantScope; event: Event | null }
  | { ok: false; response: NextResponse };

type DetailContextResult =
  | { ok: true; scope: AssistantScope; event: Event | null; campaign: Campaign }
  | { ok: false; response: NextResponse };

/** Resolve o contexto comum de toda rota de campanha: escopo efetivo (admin/organizador/
 * assistente via resolveActingScope), gate de acesso, e o lookup do evento quando a campanha é de
 * um evento específico (eventId não-nulo). Passe `eventId: null` pras rotas admin-only de
 * plataforma (`/api/admin/campaigns/*`) — nesse caso exige `scope.actingAsAdmin` diretamente, sem
 * checar `hasCampaignsAccess` (que não se aplica a uma capacidade que só admin tem). Centraliza o
 * preâmbulo que se repetia em 6 handlers de 4 arquivos na Fase A — a revisão final daquela fase
 * recomendou extrair antes desta, já que o mesmo padrão de código duplicado foi a causa raiz de
 * um bug real em outra feature deste projeto (social-links esqueceu o branch actingAsAdmin numa
 * rota). */
export async function resolveCampaignListContext(params: {
  session: Session;
  eventId: string | null;
}): Promise<ListContextResult> {
  const scope = await resolveActingScope(params.session);

  if (params.eventId === null) {
    if (!scope.actingAsAdmin) {
      return { ok: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
    }
    return { ok: true, scope, event: null };
  }

  if (!(await hasCampaignsAccess(scope))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Campanhas de WhatsApp não estão habilitadas para este organizador" },
        { status: 403 },
      ),
    };
  }

  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: params.eventId } })
    : await db.event.findFirst({ where: { id: params.eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) {
    return { ok: false, response: NextResponse.json({ error: "Evento não encontrado" }, { status: 404 }) };
  }

  return { ok: true, scope, event };
}

/** Como resolveCampaignListContext, mas também busca a campanha (escopada por `eventId` —
 * inclusive quando `null`, o que impede uma campanha de plataforma vazar por uma rota de evento
 * específico e vice-versa) e garante que ela exista, retornando 404 caso contrário. */
export async function resolveCampaignDetailContext(params: {
  session: Session;
  eventId: string | null;
  campaignId: string;
}): Promise<DetailContextResult> {
  const listContext = await resolveCampaignListContext({ session: params.session, eventId: params.eventId });
  if (!listContext.ok) return listContext;

  const campaign = await db.campaign.findFirst({
    where: { id: params.campaignId, eventId: params.eventId },
  });
  if (!campaign) {
    return { ok: false, response: NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 }) };
  }

  return { ok: true, scope: listContext.scope, event: listContext.event, campaign };
}
```

- [ ] **Step 2: Refactor `app/api/events/[id]/campaigns/route.ts`**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
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
  const context = await resolveCampaignListContext({ session, eventId: id });
  if (!context.ok) return context.response;

  const campaigns = await db.campaign.findMany({ where: { eventId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const context = await resolveCampaignListContext({ session, eventId: id });
  if (!context.ok) return context.response;

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

- [ ] **Step 3: Refactor `app/api/events/[id]/campaigns/[campaignId]/route.ts`**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullable().optional(),
    messageBody: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nenhum campo para atualizar" });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  return NextResponse.json({ campaign: context.campaign });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT") {
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

- [ ] **Step 4: Refactor `app/api/events/[id]/campaigns/[campaignId]/cancel/route.ts`**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.cancel");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT") {
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

- [ ] **Step 5: Refactor `app/api/events/[id]/campaigns/[campaignId]/duplicate/route.ts`**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  const duplicate = await db.campaign.create({
    data: {
      eventId: id,
      createdByUserId: session.user.id,
      name: `Cópia de ${context.campaign.name}`,
      description: context.campaign.description,
      messageBody: context.campaign.messageBody,
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

- [ ] **Step 6: Run the existing test suite to verify no behavior changed**

Run: `npx vitest run tests/events-campaigns-route.test.ts`
Expected: all pre-existing tests PASS, unchanged (12/12, same as at the end of Fase A) — if any
test fails, the refactor introduced a behavior difference; fix the route code (not the test) to
match the pre-refactor behavior exactly.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (this also confirms the `Campaign.eventId` nullability from Task 1 is now
correctly handled everywhere it's read in these 4 files).

- [ ] **Step 8: Full suite**

Run: `npx vitest run`
Expected: no regressions.

- [ ] **Step 9: Commit**

```bash
git add lib/campaigns/service.ts app/api/events/\[id\]/campaigns
git commit -m "refactor: extrai lib/campaigns/service.ts, elimina duplicacao do preambulo de acesso"
```

---

### Task 3: Validação de telefone + população de destinatários

**Files:**
- Modify: `lib/whatsapp.ts`
- Create: `lib/campaigns/recipients.ts`
- Modify: `tests/setup.ts`
- Test: `tests/whatsapp.test.ts` (append)
- Test: `tests/campaigns-recipients.test.ts` (new)

**Interfaces:**
- Consumes: `normalizePhoneForWhatsApp` (existing, `lib/whatsapp.ts`).
- Produces: `isValidWhatsAppPhone(normalized: string): boolean` (`lib/whatsapp.ts`);
  `prepareCampaignRecipients(campaignId: string, eventId: string | null):
  Promise<PrepareRecipientsResult>` where `PrepareRecipientsResult = { total: number; pending:
  number; optedOut: number; invalidPhone: number; duplicate: number }`. Used by Tasks 4 and 5.

- [ ] **Step 1: Add the `campaignRecipient` model mock to the global test DB mock**

In `tests/setup.ts`, inside the `db` mock object, add (alongside the `campaign` entry added in
Fase A):

```ts
    campaignRecipient: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), groupBy: vi.fn() },
```

- [ ] **Step 2: Write the failing test for `isValidWhatsAppPhone`**

Append to `tests/whatsapp.test.ts` (after the existing `normalizePhoneForWhatsApp` describe block,
before `describe("sendWhatsAppMessage", ...)`):

```ts
describe("isValidWhatsAppPhone", () => {
  it("aceita um celular normalizado (DDI 55 + 11 dígitos)", () => {
    expect(isValidWhatsAppPhone("5511999999999")).toBe(true);
  });

  it("aceita um fixo normalizado (DDI 55 + 10 dígitos)", () => {
    expect(isValidWhatsAppPhone("551133334444")).toBe(true);
  });

  it("rejeita string vazia", () => {
    expect(isValidWhatsAppPhone("")).toBe(false);
  });

  it("rejeita telefone sem DDI 55", () => {
    expect(isValidWhatsAppPhone("11999999999")).toBe(false);
  });

  it("rejeita telefone claramente curto demais", () => {
    expect(isValidWhatsAppPhone("5511999")).toBe(false);
  });

  it("rejeita telefone longo demais", () => {
    expect(isValidWhatsAppPhone("551199999999999")).toBe(false);
  });
});
```

Add the import at the top of the test file: change the existing
`import { sendWhatsAppMessage, sendWhatsAppDocument, normalizePhoneForWhatsApp } from "@/lib/whatsapp";`
line to also import `isValidWhatsAppPhone`:

```ts
import { sendWhatsAppMessage, sendWhatsAppDocument, normalizePhoneForWhatsApp, isValidWhatsAppPhone } from "@/lib/whatsapp";
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: the new `isValidWhatsAppPhone` tests FAIL (function doesn't exist yet); all other tests
in the file still PASS.

- [ ] **Step 4: Implement `isValidWhatsAppPhone`**

In `lib/whatsapp.ts`, add right after the `normalizePhoneForWhatsApp` function:

```ts
/** Verifica se um telefone já normalizado (via normalizePhoneForWhatsApp) tem formato válido pra
 * WhatsApp: DDI 55 (Brasil) + 10 ou 11 dígitos locais (fixo ou celular). */
export function isValidWhatsAppPhone(normalized: string): boolean {
  return /^55\d{10,11}$/.test(normalized);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: all PASS.

- [ ] **Step 6: Write the failing tests for `prepareCampaignRecipients`**

Create `tests/campaigns-recipients.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";

const dbMock = db as any;

describe("prepareCampaignRecipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("apaga destinatários existentes antes de repopular", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await prepareCampaignRecipients("campaign-1", "event-1");

    expect(dbMock.campaignRecipient.deleteMany).toHaveBeenCalledWith({ where: { campaignId: "campaign-1" } });
  });

  it("marca como PENDING um destinatário elegível com telefone válido", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(dbMock.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [
        {
          campaignId: "campaign-1",
          athleteUserId: "athlete-1",
          registrationId: "reg-1",
          normalizedPhone: "5511999999999",
          status: "PENDING",
        },
      ],
    });
    expect(result).toEqual({ total: 1, pending: 1, optedOut: 0, invalidPhone: 0, duplicate: 0 });
  });

  it("marca como OPTED_OUT quando receivePromotionalMessages é false", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: false, athleteProfile: { phone: "11999999999" } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(result.optedOut).toBe(1);
    expect(result.pending).toBe(0);
  });

  it("marca como INVALID_PHONE quando o telefone está ausente", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: null } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(result.invalidPhone).toBe(1);
    expect(result.pending).toBe(0);
  });

  it("marca como INVALID_PHONE quando o telefone tem formato inválido", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: "123" } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(result.invalidPhone).toBe(1);
  });

  it("marca como SKIPPED (duplicado) a segunda ocorrência do mesmo telefone, mantendo a primeira como PENDING", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        id: "reg-1",
        athleteUserId: "athlete-1",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
      },
      {
        id: "reg-2",
        athleteUserId: "athlete-2",
        athlete: { receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
      },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(result).toEqual({ total: 2, pending: 1, optedOut: 0, invalidPhone: 0, duplicate: 1 });
    const rows = dbMock.campaignRecipient.createMany.mock.calls[0][0].data;
    expect(rows[0].status).toBe("PENDING");
    expect(rows[1].status).toBe("SKIPPED");
    expect(rows[1].failureReason).toBe("Telefone duplicado nesta campanha");
  });

  it("processa em múltiplos lotes quando há mais candidatos que o tamanho do lote (500)", async () => {
    const batch1 = Array.from({ length: 500 }, (_, i) => ({
      id: `reg-${i}`,
      athleteUserId: `athlete-${i}`,
      athlete: {
        receivePromotionalMessages: true,
        athleteProfile: { phone: `119${String(10000000 + i).slice(-8)}` },
      },
    }));
    dbMock.registration.findMany.mockResolvedValueOnce(batch1).mockResolvedValueOnce([]);

    const result = await prepareCampaignRecipients("campaign-1", "event-1");

    expect(dbMock.registration.findMany).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(500);
  });

  it("usa User (role ATHLETE, active) em vez de Registration quando eventId é null (modo plataforma)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "athlete-1", receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } },
    ]);

    const result = await prepareCampaignRecipients("campaign-1", null);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ATHLETE", active: true } }),
    );
    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
    expect(result.pending).toBe(1);
    expect(dbMock.campaignRecipient.createMany).toHaveBeenCalledWith({
      data: [
        {
          campaignId: "campaign-1",
          athleteUserId: "athlete-1",
          registrationId: null,
          normalizedPhone: "5511999999999",
          status: "PENDING",
        },
      ],
    });
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run tests/campaigns-recipients.test.ts`
Expected: FAIL — `lib/campaigns/recipients.ts` doesn't exist yet.

- [ ] **Step 8: Implement `lib/campaigns/recipients.ts`**

```ts
import { db } from "@/lib/db";
import { normalizePhoneForWhatsApp, isValidWhatsAppPhone } from "@/lib/whatsapp";

export interface PrepareRecipientsResult {
  total: number;
  pending: number;
  optedOut: number;
  invalidPhone: number;
  duplicate: number;
}

const BATCH_SIZE = 500;

interface CandidateRow {
  athleteUserId: string;
  registrationId: string | null;
  receivePromotionalMessages: boolean;
  phone: string | null;
}

async function fetchCandidateBatch(
  eventId: string | null,
  skip: number,
): Promise<CandidateRow[]> {
  if (eventId !== null) {
    const registrations = await db.registration.findMany({
      where: { eventId },
      select: {
        id: true,
        athleteUserId: true,
        athlete: {
          select: {
            receivePromotionalMessages: true,
            athleteProfile: { select: { phone: true } },
          },
        },
      },
      skip,
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    return registrations.map((r) => ({
      athleteUserId: r.athleteUserId,
      registrationId: r.id,
      receivePromotionalMessages: r.athlete.receivePromotionalMessages,
      phone: r.athlete.athleteProfile?.phone ?? null,
    }));
  }

  const users = await db.user.findMany({
    where: { role: "ATHLETE", active: true },
    select: {
      id: true,
      receivePromotionalMessages: true,
      athleteProfile: { select: { phone: true } },
    },
    skip,
    take: BATCH_SIZE,
    orderBy: { id: "asc" },
  });

  return users.map((u) => ({
    athleteUserId: u.id,
    registrationId: null,
    receivePromotionalMessages: u.receivePromotionalMessages,
    phone: u.athleteProfile?.phone ?? null,
  }));
}

/** Repopula os destinatários de uma campanha: apaga os existentes e busca candidatos de novo — do
 * evento (qualquer status de inscrição), se `eventId` não for nulo, ou de toda a base de atletas
 * ativos, se for — em lotes, sem carregar tudo em memória de uma vez. Aplica, nesta ordem, o
 * filtro de receivePromotionalMessages (sempre, nunca opcional), validação/normalização de
 * telefone, e deduplicação por telefone dentro da campanha (a 1ª ocorrência permanece PENDING, as
 * demais viram SKIPPED). Idempotente — pode ser chamada de novo a qualquer momento; a rota que
 * chama garante que a campanha ainda está em DRAFT, esta função não checa `status` de novo. */
export async function prepareCampaignRecipients(
  campaignId: string,
  eventId: string | null,
): Promise<PrepareRecipientsResult> {
  await db.campaignRecipient.deleteMany({ where: { campaignId } });

  const result: PrepareRecipientsResult = { total: 0, pending: 0, optedOut: 0, invalidPhone: 0, duplicate: 0 };
  const seenPhones = new Set<string>();
  let skip = 0;

  while (true) {
    const candidates = await fetchCandidateBatch(eventId, skip);
    if (candidates.length === 0) break;
    skip += candidates.length;

    const rows = candidates.map((candidate) => {
      result.total += 1;
      const normalized = candidate.phone ? normalizePhoneForWhatsApp(candidate.phone) : "";

      if (!candidate.receivePromotionalMessages) {
        result.optedOut += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: normalized,
          status: "OPTED_OUT" as const,
        };
      }

      if (!candidate.phone || !isValidWhatsAppPhone(normalized)) {
        result.invalidPhone += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: normalized,
          status: "INVALID_PHONE" as const,
        };
      }

      if (seenPhones.has(normalized)) {
        result.duplicate += 1;
        return {
          campaignId,
          athleteUserId: candidate.athleteUserId,
          registrationId: candidate.registrationId,
          normalizedPhone: normalized,
          status: "SKIPPED" as const,
          failureReason: "Telefone duplicado nesta campanha",
        };
      }

      seenPhones.add(normalized);
      result.pending += 1;
      return {
        campaignId,
        athleteUserId: candidate.athleteUserId,
        registrationId: candidate.registrationId,
        normalizedPhone: normalized,
        status: "PENDING" as const,
      };
    });

    await db.campaignRecipient.createMany({ data: rows });

    if (candidates.length < BATCH_SIZE) break;
  }

  return result;
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run tests/campaigns-recipients.test.ts`
Expected: all PASS.

- [ ] **Step 10: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 11: Commit**

```bash
git add lib/whatsapp.ts lib/campaigns/recipients.ts tests/setup.ts tests/whatsapp.test.ts tests/campaigns-recipients.test.ts
git commit -m "feat: validacao de telefone + populacao de destinatarios de campanha"
```

---

### Task 4: Rotas de preparar destinatários (evento específico)

**Files:**
- Create: `app/api/events/[id]/campaigns/[campaignId]/prepare-recipients/route.ts`
- Create: `app/api/events/[id]/campaigns/[campaignId]/recipients/summary/route.ts`
- Test: `tests/events-campaigns-recipients-route.test.ts`

**Interfaces:**
- Consumes: `resolveCampaignDetailContext` (Task 2), `prepareCampaignRecipients` (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `tests/events-campaigns-recipients-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/campaigns/recipients", () => ({ prepareCampaignRecipients: vi.fn() }));

import { POST } from "@/app/api/events/[id]/campaigns/[campaignId]/prepare-recipients/route";
import { GET } from "@/app/api/events/[id]/campaigns/[campaignId]/recipients/summary/route";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const prepareMock = vi.mocked(prepareCampaignRecipients);

const draftCampaign = { id: "campaign-1", eventId: "event-1", status: "DRAFT" };

describe("POST /api/events/[id]/campaigns/[campaignId]/prepare-recipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("prepara os destinatários de uma campanha em DRAFT e retorna o resumo", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign });
    prepareMock.mockResolvedValueOnce({ total: 10, pending: 8, optedOut: 1, invalidPhone: 1, duplicate: 0 });

    const res = await POST(
      new Request("http://localhost", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith("campaign-1", "event-1");
    expect(data.summary).toEqual({ total: 10, pending: 8, optedOut: 1, invalidPhone: 1, duplicate: 0 });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CAMPAIGN_RECIPIENTS_PREPARED" }) }),
    );
  });

  it("rejeita preparar destinatários de uma campanha que não está em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...draftCampaign, status: "CANCELLED" });

    const res = await POST(
      new Request("http://localhost", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it("bloqueia quando o organizador não tem campaignsEnabled", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: false });

    const res = await POST(
      new Request("http://localhost", { method: "POST" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(403);
    expect(prepareMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/events/[id]/campaigns/[campaignId]/recipients/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ ...draftCampaign });
  });

  it("retorna a contagem de destinatários agrupada por status", async () => {
    dbMock.campaignRecipient.groupBy.mockResolvedValueOnce([
      { status: "PENDING", _count: { _all: 8 } },
      { status: "OPTED_OUT", _count: { _all: 1 } },
    ]);

    const res = await GET(
      new Request("http://localhost", { method: "GET" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summary).toEqual({ PENDING: 8, OPTED_OUT: 1 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/events-campaigns-recipients-route.test.ts`
Expected: FAIL — neither route file exists yet.

- [ ] **Step 3: Implement `app/api/events/[id]/campaigns/[campaignId]/prepare-recipients/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Só é possível preparar destinatários de campanhas em rascunho" },
      { status: 400 },
    );
  }

  const summary = await prepareCampaignRecipients(campaignId, id);

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_RECIPIENTS_PREPARED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: summary,
    },
  });

  return NextResponse.json({ summary });
}
```

- [ ] **Step 4: Implement `app/api/events/[id]/campaigns/[campaignId]/recipients/summary/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  const grouped = await db.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });

  const summary = grouped.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  return NextResponse.json({ summary });
}
```

- [ ] **Step 5: Run to verify everything passes**

Run: `npx vitest run tests/events-campaigns-recipients-route.test.ts`
Expected: all PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add app/api/events/\[id\]/campaigns/\[campaignId\]/prepare-recipients app/api/events/\[id\]/campaigns/\[campaignId\]/recipients tests/events-campaigns-recipients-route.test.ts
git commit -m "feat: rotas de preparar destinatarios e resumo (evento especifico)"
```

---

### Task 5: Árvore de rotas admin-only (campanhas de plataforma)

**Files:**
- Create: `app/api/admin/campaigns/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/cancel/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/duplicate/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/prepare-recipients/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/recipients/summary/route.ts`
- Test: `tests/admin-campaigns-route.test.ts`

**Interfaces:**
- Consumes: `resolveCampaignListContext`/`resolveCampaignDetailContext` (Task 2),
  `prepareCampaignRecipients` (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-campaigns-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/campaigns/recipients", () => ({ prepareCampaignRecipients: vi.fn() }));

import { GET, POST } from "@/app/api/admin/campaigns/route";
import { GET as GET_ONE, PATCH } from "@/app/api/admin/campaigns/[campaignId]/route";
import { POST as CANCEL } from "@/app/api/admin/campaigns/[campaignId]/cancel/route";
import { POST as DUPLICATE } from "@/app/api/admin/campaigns/[campaignId]/duplicate/route";
import { POST as PREPARE } from "@/app/api/admin/campaigns/[campaignId]/prepare-recipients/route";
import { GET as SUMMARY } from "@/app/api/admin/campaigns/[campaignId]/recipients/summary/route";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const prepareMock = vi.mocked(prepareCampaignRecipients);

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/campaigns", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as any;
}

const platformDraftCampaign = {
  id: "campaign-1",
  eventId: null,
  name: "Campanha de plataforma",
  description: null,
  status: "DRAFT",
  messageBody: "Olá {{nome_atleta}}!",
  createdByUserId: "admin-1",
};

describe("GET/POST /api/admin/campaigns (admin-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita ORGANIZER, mesmo com campaignsEnabled", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(403);
    expect(dbMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("lista as campanhas de plataforma (eventId null) como ADMIN", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findMany.mockResolvedValueOnce([platformDraftCampaign]);

    const res = await GET(makeRequest("GET"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(dbMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: null } }),
    );
    expect(data.campaigns).toHaveLength(1);
  });

  it("cria uma campanha de plataforma (eventId null) como ADMIN", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.create.mockResolvedValueOnce({ ...platformDraftCampaign });

    const res = await POST(makeRequest("POST", { name: "Campanha de plataforma", messageBody: "Olá!" }));

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: null, createdByUserId: "admin-1" }) }),
    );
  });
});

describe("GET/PATCH /api/admin/campaigns/[campaignId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  it("retorna a campanha de plataforma", async () => {
    const res = await GET_ONE(makeRequest("GET"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.findFirst).toHaveBeenCalledWith({ where: { id: "campaign-1", eventId: null } });
  });

  it("edita uma campanha de plataforma em DRAFT", async () => {
    dbMock.campaign.update.mockResolvedValueOnce({ ...platformDraftCampaign, name: "Nome novo" });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Nome novo" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/campaigns/[campaignId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("cancela uma campanha de plataforma em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    dbMock.campaign.update.mockResolvedValueOnce({ ...platformDraftCampaign, status: "CANCELLED" });

    const res = await CANCEL(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "CANCELLED" } });
  });
});

describe("POST /api/admin/campaigns/[campaignId]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("duplica uma campanha de plataforma numa DRAFT nova, ainda sem evento", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign, status: "CANCELLED" });
    dbMock.campaign.create.mockResolvedValueOnce({ ...platformDraftCampaign, id: "campaign-2", name: "Cópia de Campanha de plataforma" });

    const res = await DUPLICATE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });

    expect(res.status).toBe(201);
    expect(dbMock.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: null, status: "DRAFT" }) }),
    );
  });
});

describe("POST /api/admin/campaigns/[campaignId]/prepare-recipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("prepara os destinatários de uma campanha de plataforma em DRAFT", async () => {
    dbMock.campaign.findFirst.mockResolvedValueOnce({ ...platformDraftCampaign });
    prepareMock.mockResolvedValueOnce({ total: 1000, pending: 950, optedOut: 30, invalidPhone: 20, duplicate: 0 });

    const res = await PREPARE(makeRequest("POST"), { params: Promise.resolve({ campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith("campaign-1", null);
    expect(data.summary.total).toBe(1000);
  });
});

describe("GET /api/admin/campaigns/[campaignId]/recipients/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  it("retorna a contagem de destinatários agrupada por status", async () => {
    dbMock.campaignRecipient.groupBy.mockResolvedValueOnce([{ status: "PENDING", _count: { _all: 950 } }]);

    const res = await SUMMARY(makeRequest("GET"), { params: Promise.resolve({ campaignId: "campaign-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summary).toEqual({ PENDING: 950 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/admin-campaigns-route.test.ts`
Expected: FAIL — none of the 6 route files exist yet.

- [ ] **Step 3: Implement `app/api/admin/campaigns/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";
import { z } from "zod";

const campaignSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  messageBody: z.string().trim().min(1),
});

export async function GET(_req: NextRequest) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  const campaigns = await db.campaign.findMany({ where: { eventId: null }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const check = await checkApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  const body = await req.json();
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const campaign = await db.campaign.create({
    data: { eventId: null, createdByUserId: session.user.id, ...parsed.data },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_CREATED",
      entityType: "Campaign",
      entityId: campaign.id,
      metadata: { eventId: null, name: campaign.name },
    },
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
```

- [ ] **Step 4: Implement `app/api/admin/campaigns/[campaignId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullable().optional(),
    messageBody: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nenhum campo para atualizar" });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  return NextResponse.json({ campaign: context.campaign });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT") {
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

- [ ] **Step 5: Implement `app/api/admin/campaigns/[campaignId]/cancel/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.cancel");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT") {
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

- [ ] **Step 6: Implement `app/api/admin/campaigns/[campaignId]/duplicate/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  const duplicate = await db.campaign.create({
    data: {
      eventId: null,
      createdByUserId: session.user.id,
      name: `Cópia de ${context.campaign.name}`,
      description: context.campaign.description,
      messageBody: context.campaign.messageBody,
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

- [ ] **Step 7: Implement `app/api/admin/campaigns/[campaignId]/prepare-recipients/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { prepareCampaignRecipients } from "@/lib/campaigns/recipients";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  if (context.campaign.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Só é possível preparar destinatários de campanhas em rascunho" },
      { status: 400 },
    );
  }

  const summary = await prepareCampaignRecipients(campaignId, null);

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CAMPAIGN_RECIPIENTS_PREPARED",
      entityType: "Campaign",
      entityId: campaignId,
      metadata: summary,
    },
  });

  return NextResponse.json({ summary });
}
```

- [ ] **Step 8: Implement `app/api/admin/campaigns/[campaignId]/recipients/summary/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  const grouped = await db.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });

  const summary = grouped.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  return NextResponse.json({ summary });
}
```

- [ ] **Step 9: Run to verify everything passes**

Run: `npx vitest run tests/admin-campaigns-route.test.ts`
Expected: all PASS.

- [ ] **Step 10: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 11: Commit**

```bash
git add app/api/admin/campaigns tests/admin-campaigns-route.test.ts
git commit -m "feat: arvore de rotas admin-only para campanhas de plataforma inteira"
```

---

### Task 6: UI — preparar destinatários + tela de campanhas de plataforma

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`
- Modify: `app/organizador/eventos/[id]/campanhas/page.tsx`
- Modify: `app/admin/eventos/[id]/campanhas/page.tsx`
- Create: `app/admin/campanhas/page.tsx`
- Modify: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: `POST .../prepare-recipients` (Tasks 4 and 5).

**Before editing `CampaignsManager.tsx`, read its current full content yourself** — this file
went through 2 fix rounds during Fase A's implementation, so treat this brief's version of it as a
reference for WHAT to change, not a guaranteed byte-for-byte starting point. If the current file's
structure meaningfully differs from what's described below (not just line numbers — actual
different logic/props), stop and report NEEDS_CONTEXT rather than forcing these edits in.

- [ ] **Step 1: Generalize `CampaignsManager` to take an API base instead of an event ID**

Change the component's prop signature from:

```tsx
export default function CampaignsManager({ eventId, backHref }: { eventId: string; backHref: string }) {
```

to:

```tsx
export default function CampaignsManager({
  apiBase,
  backHref,
  scopeLabel,
}: {
  apiBase: string;
  backHref: string;
  scopeLabel: string;
}) {
```

Replace every occurrence of the URL template literal `` `/api/events/${eventId}/campaigns` `` with
just `apiBase`, and every occurrence of `` `/api/events/${eventId}/campaigns/${X}` `` with
`` `${apiBase}/${X}` `` (there are 5: the `reload` fetch, `handleCreate`'s fetch, `saveEdit`'s
fetch, `doCancel`'s fetch, `doDuplicate`'s fetch). Change the `useEffect`'s dependency array from
`[eventId]` to `[apiBase]`.

Change the header paragraph:

```tsx
<p className="text-sm text-gray-500">Mensagens promocionais em massa pros inscritos deste evento.</p>
```

to:

```tsx
<p className="text-sm text-gray-500">Mensagens promocionais em massa {scopeLabel}.</p>
```

- [ ] **Step 2: Add the "Preparar destinatários" action + summary display**

Add new state, alongside the existing state declarations:

```tsx
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [recipientSummaries, setRecipientSummaries] = useState<Record<string, PrepareSummary>>({});
```

Add this type near the top of the file, alongside the existing `Campaign` type:

```tsx
type PrepareSummary = { total: number; pending: number; optedOut: number; invalidPhone: number; duplicate: number };
```

Add this function alongside `doCancel`/`doDuplicate`:

```tsx
  async function doPrepareRecipients(campaignId: string) {
    setPreparingId(campaignId);
    const res = await fetch(`${apiBase}/${campaignId}/prepare-recipients`, { method: "POST" });
    setPreparingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Erro ao preparar destinatários");
      return;
    }
    const data = await res.json();
    setRecipientSummaries((prev) => ({ ...prev, [campaignId]: data.summary }));
  }
```

In the campaign card's action-button row (inside the `{campaign.status === "DRAFT" && (<>...</>)}`
block, alongside the existing "Editar"/"Cancelar" buttons), add:

```tsx
                      <button
                        onClick={() => void doPrepareRecipients(campaign.id)}
                        disabled={preparingId === campaign.id}
                        className="text-green-700 hover:text-green-900 text-sm"
                      >
                        {preparingId === campaign.id ? "Preparando..." : "Preparar destinatários"}
                      </button>
```

Right after the campaign card's title/description/message block (still inside the same outer
`<div key={campaign.id} className="card space-y-2">`, as a sibling of the `flex items-center
justify-between` row), add:

```tsx
              {recipientSummaries[campaign.id] && (
                <p className="text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-2">
                  Total: {recipientSummaries[campaign.id].total} · Elegíveis:{" "}
                  {recipientSummaries[campaign.id].pending} · Opt-out:{" "}
                  {recipientSummaries[campaign.id].optedOut} · Telefone inválido:{" "}
                  {recipientSummaries[campaign.id].invalidPhone} · Duplicados:{" "}
                  {recipientSummaries[campaign.id].duplicate}
                </p>
              )}
```

- [ ] **Step 3: Update the 2 existing per-event page wrappers**

In `app/organizador/eventos/[id]/campanhas/page.tsx`, change:

```tsx
  return <CampaignsManager eventId={id} backHref={`/organizador/eventos/${id}`} />;
```

to:

```tsx
  return (
    <CampaignsManager
      apiBase={`/api/events/${id}/campaigns`}
      backHref={`/organizador/eventos/${id}`}
      scopeLabel="pros inscritos deste evento"
    />
  );
```

Apply the identical change to `app/admin/eventos/[id]/campanhas/page.tsx` (same replacement, same
`backHref` pattern already using `/admin/eventos/${id}` in that file).

- [ ] **Step 4: Create the platform-wide admin page**

Create `app/admin/campanhas/page.tsx`:

```tsx
"use client";

import CampaignsManager from "@/components/campaigns/CampaignsManager";

export default function AdminPlatformCampaignsPage() {
  return (
    <CampaignsManager
      apiBase="/api/admin/campaigns"
      backHref="/admin"
      scopeLabel="pra toda a base de atletas da plataforma"
    />
  );
}
```

- [ ] **Step 5: Add the nav link**

In `components/admin/AdminNav.tsx`, right after the existing `<Link href="/admin/mensagens" ...>`
line, add:

```tsx
          <Link href="/admin/campanhas" className="hover:text-gray-300">Campanhas</Link>
```

No automated test for any of these 5 files (project convention — no UI component tests; the
underlying API contracts are covered by Tasks 4 and 5).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Full suite**

Run: `npx vitest run`
Expected: no regressions anywhere in the project.

- [ ] **Step 8: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx app/organizador/eventos/\[id\]/campanhas/page.tsx app/admin/eventos/\[id\]/campanhas/page.tsx app/admin/campanhas components/admin/AdminNav.tsx
git commit -m "feat: UI de preparar destinatarios + tela de campanhas de plataforma (admin)"
```

---

## Final check (after all 6 tasks)

- [ ] Run the full suite once more: `npx vitest run`
- [ ] Run `npx tsc --noEmit`
- [ ] Confirm the deploy note: this feature needs a schema migration
  (`prisma/migrations/20260822010000_add_campaign_recipients`) — on the VPS, apply it manually via
  `psql` (or `prisma migrate deploy`) **before** `prisma db push`, same pattern as every other
  schema change in this project (now 4 migrations in the queue: preferências, endereço, campanhas
  Fase A, campanhas Fase B). Do not deploy without explicit user authorization.
- [ ] Manual verification recommended once there's DB access: prepare recipients for a real event
  with a mix of opted-out/invalid-phone/duplicate-phone athletes and confirm the summary counts add
  up; as admin, create a platform-wide campaign and confirm no organizer route ever surfaces it;
  confirm the refactored Fase A routes (Task 2) still behave identically for organizer/admin/
  IDOR-safety scenarios that were manually verified at the end of Fase A.
- [ ] This is Fase B of 6 for "Campanhas de WhatsApp em massa" — message composition (variable
  catalog, template reuse, preview, test send), scheduling, actual sending, delivery status, and
  pause/resume still don't exist. Next: Fase C (composição de mensagem).
