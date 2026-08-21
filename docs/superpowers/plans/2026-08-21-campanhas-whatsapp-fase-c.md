# Campanhas de WhatsApp — Fase C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let organizers/admins compose a campaign's WhatsApp message using the same variable
catalog and template renderer the alert system already uses, preview it with sample data, send a
test to their own phone, and optionally start from an existing alert's current text — all without
touching real sending (that's Fase D).

**Architecture:** Reuse `lib/templates/{variables,render,resolve}.ts` unmodified as the single
source of truth for variables and rendering (no second template engine). Add one new module,
`lib/campaigns/variables.ts`, that decides which variable categories a campaign may use (always
Atleta+Plataforma; Evento+Organizador+Inscrição only when the campaign has an event) — this same
function backs both the save-time validation and the UI's variable catalog, so they can never
diverge. New preview/test-send/variables/alert-options routes mirror the existing event-scoped +
admin-only route-tree split. `CampaignsManager.tsx` gets a compact variable-insert dropdown,
character counter, "start from an alert" picker (create form only), and Visualizar/Enviar teste
buttons (edit modal only) — no layout redesign.

**Tech Stack:** Next.js (App Router) + Prisma/Postgres + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-campanhas-whatsapp-fase-c-design.md`

## Global Constraints

- The variable catalog and the renderer are never duplicated — every piece of this phase reuses
  `lib/templates/variables.ts` (`ALL_VARIABLES`, and the new `SAMPLE_VALUES`),
  `lib/templates/render.ts` (`renderTemplate`, `validateTemplateVariables`), and
  `lib/templates/resolve.ts` (`getEffectiveTemplate`) exactly as they exist today. No `eval`, no
  second regex-based substitution mechanism.
- `getAllowedCampaignVariables(eventId)`/`getAllowedCampaignVariableNames(eventId)` in
  `lib/campaigns/variables.ts` is the ONLY place that decides which variable categories a campaign
  may use — both save-time validation (Task 3) and the UI catalog endpoint (Task 4) call it; never
  duplicate this category list anywhere else.
- Preview and test-send operate on the campaign's **saved** `messageBody`, never an unsaved
  textarea draft — same behavior as the existing `message-templates` preview/test-send.
- Test-send always goes to the calling user's own `User.phone` (via `session.user.id`) — never a
  phone number supplied in the request body. 400 with `"Sua conta não tem telefone cadastrado"` when
  absent.
- Campaign preview and test-send text ALWAYS includes the opt-out footer
  (`buildPreferencesFooterText()`) — unlike `message-templates`' preview/test-send, which never
  include it (that feature covers non-promotional alerts too). Campaigns are always promotional by
  definition, so this is unconditional here.
- Test-send never creates a `CampaignRecipient` row and never touches real campaign metrics — it's
  tagged `messageType: "CAMPAIGN_TEST"` in the message log, completely separate from anything Fase
  B/D read.
- No new Prisma schema/migration in this phase.
- No UI component tests (project convention) — only pure functions and API routes get automated
  tests.
- Never use native `alert()`/`confirm()`/`prompt()` — this phase's new preview/test-send surfaces
  use inline UI state and a small modal, matching the existing pattern in this file.

---

### Task 1: `lib/campaigns/variables.ts` — allowed-variable catalog

**Files:**
- Create: `lib/campaigns/variables.ts`
- Test: `tests/campaigns-variables.test.ts`

**Interfaces:**
- Consumes: `ALL_VARIABLES`, `VariableDefinition` (existing, `lib/templates/variables.ts`).
- Produces: `getAllowedCampaignVariables(eventId: string | null): VariableDefinition[]`,
  `getAllowedCampaignVariableNames(eventId: string | null): string[]`. Used by Tasks 3 and 4.

- [ ] **Step 1: Write the failing tests**

Create `tests/campaigns-variables.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAllowedCampaignVariables, getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";

describe("getAllowedCampaignVariables", () => {
  it("modo plataforma (eventId null) só inclui categorias Atleta e Plataforma", () => {
    const variables = getAllowedCampaignVariables(null);
    const categories = new Set(variables.map((v) => v.category));
    expect(categories).toEqual(new Set(["Atleta", "Plataforma"]));
  });

  it("modo evento (eventId definido) inclui Atleta, Plataforma, Evento, Organizador e Inscrição", () => {
    const variables = getAllowedCampaignVariables("event-1");
    const categories = new Set(variables.map((v) => v.category));
    expect(categories).toEqual(new Set(["Atleta", "Plataforma", "Evento", "Organizador", "Inscrição"]));
  });

  it("nunca inclui categorias fora dessas 5, em nenhum dos dois modos", () => {
    const disallowed = ["Cancelamento", "Pagamento", "Vagas", "Anunciante", "Conciliação"];
    const platformCategories = new Set(getAllowedCampaignVariables(null).map((v) => v.category));
    const eventCategories = new Set(getAllowedCampaignVariables("event-1").map((v) => v.category));
    for (const cat of disallowed) {
      expect(platformCategories.has(cat)).toBe(false);
      expect(eventCategories.has(cat)).toBe(false);
    }
  });

  it("getAllowedCampaignVariableNames retorna só os nomes", () => {
    const names = getAllowedCampaignVariableNames(null);
    expect(names).toContain("nome_atleta");
    expect(names).toContain("nome_plataforma");
    expect(names).not.toContain("nome_evento");
  });

  it("nome_evento aparece quando eventId é fornecido", () => {
    const names = getAllowedCampaignVariableNames("event-1");
    expect(names).toContain("nome_evento");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/campaigns-variables.test.ts`
Expected: FAIL — `lib/campaigns/variables.ts` doesn't exist yet.

- [ ] **Step 3: Implement `lib/campaigns/variables.ts`**

```ts
import { ALL_VARIABLES, type VariableDefinition } from "@/lib/templates/variables";

const ALWAYS_CATEGORIES = ["Atleta", "Plataforma"];
const EVENT_ONLY_CATEGORIES = ["Evento", "Organizador", "Inscrição"];

/** Decide quais categorias de variável uma campanha pode usar: Atleta/Plataforma sempre estão
 * disponíveis; Evento/Organizador/Inscrição só quando a campanha tem um evento associado
 * (eventId não-nulo) — não fazem sentido numa campanha de plataforma inteira, que não tem um
 * único evento/inscrição pra resolver essas variáveis. Única fonte de verdade: tanto a validação
 * no backend quanto o catálogo mostrado na UI consultam esta função. */
export function getAllowedCampaignVariables(eventId: string | null): VariableDefinition[] {
  const categories = new Set(
    eventId !== null ? [...ALWAYS_CATEGORIES, ...EVENT_ONLY_CATEGORIES] : ALWAYS_CATEGORIES,
  );
  return ALL_VARIABLES.filter((v) => categories.has(v.category));
}

export function getAllowedCampaignVariableNames(eventId: string | null): string[] {
  return getAllowedCampaignVariables(eventId).map((v) => v.name);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/campaigns-variables.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`

```bash
git add lib/campaigns/variables.ts tests/campaigns-variables.test.ts
git commit -m "feat: catalogo de variaveis permitidas por campanha (evento vs plataforma)"
```

---

### Task 2: Plumbing compartilhada (rodapé exportado, SAMPLE_VALUES, rótulo de log)

**Files:**
- Modify: `lib/whatsapp.ts`
- Modify: `lib/templates/variables.ts`
- Modify: `app/api/admin/message-templates/[id]/preview/route.ts`
- Modify: `app/api/admin/message-templates/[id]/test-send/route.ts`
- Modify: `lib/message-logs.ts`

**Interfaces:**
- Produces: `export function buildPreferencesFooterText(): string` (`lib/whatsapp.ts`); `export
  const SAMPLE_VALUES: Record<string, string>` (`lib/templates/variables.ts`). Both used by Task 5.

This task is a pure refactor for the 2 `message-templates` route files (no behavior change) plus
2 one-line additions — no new tests needed; the existing test suite is the safety net.

- [ ] **Step 1: Export `buildPreferencesFooterText` from `lib/whatsapp.ts`**

In `lib/whatsapp.ts`, change:

```ts
function buildPreferencesFooterText(): string {
```

to:

```ts
export function buildPreferencesFooterText(): string {
```

No other change to this file.

- [ ] **Step 2: Add `SAMPLE_VALUES` to `lib/templates/variables.ts`**

At the end of `lib/templates/variables.ts`, after the existing `VARIABLE_CATEGORIES` export, add:

```ts

export const SAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  ALL_VARIABLES.map((v) => [v.name, v.sample]),
);
```

- [ ] **Step 3: Refactor `app/api/admin/message-templates/[id]/preview/route.ts` to use it**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { renderTemplate, renderTemplateSubject } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const { id } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const channel = template.channel as "EMAIL" | "WHATSAPP";
  return NextResponse.json({
    subject: template.subject ? renderTemplateSubject(template.subject, SAMPLE_VALUES) : undefined,
    body: renderTemplate(template.body, SAMPLE_VALUES, channel),
  });
}
```

(Only change from the current file: the `ALL_VARIABLES` import + local `SAMPLE_VALUES` constant
are replaced by importing `SAMPLE_VALUES` directly.)

- [ ] **Step 4: Refactor `app/api/admin/message-templates/[id]/test-send/route.ts` to use it**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { renderTemplate, renderTemplateSubject } from "@/lib/templates/render";
import { sendMail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { SAMPLE_VALUES } from "@/lib/templates/variables";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  // Nunca lê destinatário do corpo da requisição — sempre o contato da própria sessão.
  const admin = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true, phone: true, name: true } });
  if (!admin) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const channel = template.channel as "EMAIL" | "WHATSAPP";
  const renderedBody = renderTemplate(template.body, SAMPLE_VALUES, channel);

  if (channel === "EMAIL") {
    const subject = template.subject ? renderTemplateSubject(template.subject, SAMPLE_VALUES) : "Teste de template";
    await sendMail({ to: admin.email, subject: `[TESTE] ${subject}`, html: renderedBody, messageType: template.alertKey });
  } else {
    if (!admin.phone) return NextResponse.json({ error: "Sua conta não tem telefone cadastrado" }, { status: 400 });
    await sendWhatsAppMessage(admin.phone, `[TESTE] ${renderedBody}`, template.alertKey);
  }

  return NextResponse.json({ ok: true });
}
```

(Only change from the current file: same `SAMPLE_VALUES` import swap as Step 3.)

- [ ] **Step 5: Add the message-log label**

In `lib/message-logs.ts`, inside `MESSAGE_TYPE_LABEL`, add a new entry (anywhere in the object, e.g.
right after `SENSITIVE_ACTION_CODE`):

```ts
  CAMPAIGN_TEST: "Teste de campanha de WhatsApp",
```

- [ ] **Step 6: Run the existing message-templates tests to confirm no behavior changed**

Run: `npx vitest run tests/api-admin-message-templates-actions.test.ts tests/api-admin-message-templates.test.ts`
Expected: all PASS, unchanged.

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 8: Commit**

```bash
git add lib/whatsapp.ts lib/templates/variables.ts lib/message-logs.ts "app/api/admin/message-templates/[id]/preview/route.ts" "app/api/admin/message-templates/[id]/test-send/route.ts"
git commit -m "refactor: exporta buildPreferencesFooterText e SAMPLE_VALUES, adiciona rotulo CAMPAIGN_TEST"
```

---

### Task 3: Validação de variáveis nas 4 rotas de criar/editar campanha

**Files:**
- Modify: `app/api/events/[id]/campaigns/route.ts`
- Modify: `app/api/events/[id]/campaigns/[campaignId]/route.ts`
- Modify: `app/api/admin/campaigns/route.ts`
- Modify: `app/api/admin/campaigns/[campaignId]/route.ts`
- Modify: `tests/events-campaigns-route.test.ts`
- Modify: `tests/admin-campaigns-route.test.ts`

**Interfaces:**
- Consumes: `getAllowedCampaignVariableNames` (Task 1), `validateTemplateVariables` (existing,
  `lib/templates/render.ts`).

This task does not change any existing test's behavior — `draftCampaign`/`platformDraftCampaign`
in both test files already use `messageBody: "Olá {{nome_atleta}}!"`, and `nome_atleta` is always
allowed in both modes, so no existing test breaks.

- [ ] **Step 1: Write the new failing tests in `tests/events-campaigns-route.test.ts`**

Add these `it` blocks inside the existing `describe("GET/POST /api/events/[id]/campaigns", ...)`
block (after the `"rejeita corpo inválido (sem messageBody)"` test):

```ts
  it("rejeita mensagem com variável desconhecida", async () => {
    const res = await POST(
      makeRequest("POST", { name: "Campanha de teste", messageBody: "Olá {{variavel_invalida}}!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toEqual(["variavel_invalida"]);
    expect(dbMock.campaign.create).not.toHaveBeenCalled();
  });

  it("aceita variável de categoria Evento, já que a campanha tem um evento associado", async () => {
    dbMock.campaign.create.mockResolvedValueOnce({ ...draftCampaign, messageBody: "Vem pro {{nome_evento}}!" });

    const res = await POST(
      makeRequest("POST", { name: "Campanha de teste", messageBody: "Vem pro {{nome_evento}}!" }),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(res.status).toBe(201);
  });
```

Add this `it` block inside the existing `describe("GET/PATCH /api/events/[id]/campaigns/[campaignId]", ...)`
block (after the `"rejeita editar uma campanha que não está em DRAFT"` test):

```ts
  it("rejeita editar com mensagem contendo variável desconhecida", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { messageBody: "Olá {{variavel_invalida}}!" }),
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toEqual(["variavel_invalida"]);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });

  it("não valida variáveis quando messageBody não está no PATCH", async () => {
    dbMock.campaign.update.mockResolvedValueOnce({ ...draftCampaign, name: "Nome novo" });

    const res = await PATCH(
      makeRequest("PATCH", { name: "Nome novo" }),
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
  });
```

- [ ] **Step 2: Write the new failing tests in `tests/admin-campaigns-route.test.ts`**

Add this `it` block inside the existing `describe("GET/POST /api/admin/campaigns (admin-only)", ...)`
block (any position after the existing ADMIN-role tests, using `role: "ADMIN"`):

```ts
  it("rejeita variável de categoria Evento numa campanha de plataforma", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);

    const res = await POST(makeRequest("POST", { name: "Campanha de plataforma", messageBody: "Vem pro {{nome_evento}}!" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toEqual(["nome_evento"]);
    expect(dbMock.campaign.create).not.toHaveBeenCalled();
  });
```

Add this `it` block inside the existing `describe("GET/PATCH /api/admin/campaigns/[campaignId]", ...)`
block:

```ts
  it("rejeita editar com variável de categoria Evento", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { messageBody: "Vem pro {{nome_evento}}!" }),
      { params: Promise.resolve({ campaignId: "campaign-1" }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.unknownVariables).toEqual(["nome_evento"]);
    expect(dbMock.campaign.update).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npx vitest run tests/events-campaigns-route.test.ts tests/admin-campaigns-route.test.ts`
Expected: the new tests FAIL (no validation exists yet); all pre-existing tests still PASS.

- [ ] **Step 4: Implement — `app/api/events/[id]/campaigns/route.ts`**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";
import { validateTemplateVariables } from "@/lib/templates/render";
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

  const { valid, unknown } = validateTemplateVariables(parsed.data.messageBody, getAllowedCampaignVariableNames(id));
  if (!valid) {
    return NextResponse.json({ error: "Variável desconhecida na mensagem", unknownVariables: unknown }, { status: 400 });
  }

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

- [ ] **Step 5: Implement — `app/api/events/[id]/campaigns/[campaignId]/route.ts`**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";
import { validateTemplateVariables } from "@/lib/templates/render";
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

  if (parsed.data.messageBody !== undefined) {
    const { valid, unknown } = validateTemplateVariables(parsed.data.messageBody, getAllowedCampaignVariableNames(id));
    if (!valid) {
      return NextResponse.json({ error: "Variável desconhecida na mensagem", unknownVariables: unknown }, { status: 400 });
    }
  }

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

- [ ] **Step 6: Implement — `app/api/admin/campaigns/route.ts`**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";
import { validateTemplateVariables } from "@/lib/templates/render";
import { db } from "@/lib/db";
import { z } from "zod";

const campaignSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  messageBody: z.string().trim().min(1),
});

export async function GET(_req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  const campaigns = await db.campaign.findMany({ where: { eventId: null }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  const body = await req.json();
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { valid, unknown } = validateTemplateVariables(parsed.data.messageBody, getAllowedCampaignVariableNames(null));
  if (!valid) {
    return NextResponse.json({ error: "Variável desconhecida na mensagem", unknownVariables: unknown }, { status: 400 });
  }

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

- [ ] **Step 7: Implement — `app/api/admin/campaigns/[campaignId]/route.ts`**

Replace the file entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";
import { validateTemplateVariables } from "@/lib/templates/render";
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
  const check = await checkAdminOnlyApiPermission("campaigns.view");
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
  const check = await checkAdminOnlyApiPermission("campaigns.edit");
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

  if (parsed.data.messageBody !== undefined) {
    const { valid, unknown } = validateTemplateVariables(parsed.data.messageBody, getAllowedCampaignVariableNames(null));
    if (!valid) {
      return NextResponse.json({ error: "Variável desconhecida na mensagem", unknownVariables: unknown }, { status: 400 });
    }
  }

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

- [ ] **Step 8: Run to verify everything passes**

Run: `npx vitest run tests/events-campaigns-route.test.ts tests/admin-campaigns-route.test.ts`
Expected: all PASS (pre-existing + new).

- [ ] **Step 9: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 10: Commit**

```bash
git add app/api/events/\[id\]/campaigns app/api/admin/campaigns tests/events-campaigns-route.test.ts tests/admin-campaigns-route.test.ts
git commit -m "feat: valida variaveis desconhecidas ao criar/editar campanha"
```

---

### Task 4: Rotas de catálogo de variáveis e opções de alerta

**Files:**
- Create: `app/api/events/[id]/campaigns/variables/route.ts`
- Create: `app/api/admin/campaigns/variables/route.ts`
- Create: `app/api/events/[id]/campaigns/alert-options/route.ts`
- Create: `app/api/admin/campaigns/alert-options/route.ts`
- Test: `tests/events-campaigns-compose-route.test.ts` (new — also covers Task 5's routes)
- Test: `tests/admin-campaigns-compose-route.test.ts` (new — also covers Task 5's routes)

**Interfaces:**
- Consumes: `getAllowedCampaignVariables` (Task 1), `ALERT_REGISTRY` (existing,
  `lib/templates/registry.ts`), `getEffectiveTemplate` (existing, `lib/templates/resolve.ts`).
- Produces the 4 GET routes below. The 2 test files created here are extended by Task 5 (same
  files, more describe blocks) rather than duplicated — Task 5's brief will say so.

These 2 new route files live alongside the existing `[campaignId]` dynamic segment in the same
directory — Next.js resolves the static `variables`/`alert-options` segments before the dynamic
one, the same way `campaigns/route.ts` already coexists with `campaigns/[campaignId]/route.ts`.

- [ ] **Step 1: Write the failing tests for the event-scoped routes**

Create `tests/events-campaigns-compose-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET as VARIABLES } from "@/app/api/events/[id]/campaigns/variables/route";
import { GET as ALERT_OPTIONS } from "@/app/api/events/[id]/campaigns/alert-options/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("GET /api/events/[id]/campaigns/variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
  });

  it("inclui variáveis de Evento, já que a campanha tem um evento associado", async () => {
    const res = await VARIABLES(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const names = data.variables.map((v: any) => v.name);
    expect(names).toContain("nome_evento");
    expect(names).toContain("nome_atleta");
  });

  it("bloqueia quando o organizador não tem campaignsEnabled", async () => {
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: false });

    const res = await VARIABLES(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/events/[id]/campaigns/alert-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);
  });

  it("só lista alertas WhatsApp voltados a atleta/comprador", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const keys = data.options.map((o: any) => o.alertKey);
    expect(keys).toContain("ORDER_CONFIRMED");
    expect(keys).toContain("ABANDONED_CART");
    expect(keys).not.toContain("RECONCILIATION_MISMATCH");
    expect(keys).not.toContain("LOW_STOCK");
    expect(keys).not.toContain("DAILY_SUMMARY");
  });

  it("cada opção retorna o texto efetivo (renderizável) do alerta", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any, { params: Promise.resolve({ id: "event-1" }) });
    const data = await res.json();

    const orderConfirmed = data.options.find((o: any) => o.alertKey === "ORDER_CONFIRMED");
    expect(orderConfirmed.body).toContain("{{nome_atleta}}");
  });
});
```

- [ ] **Step 2: Write the failing tests for the admin routes**

Create `tests/admin-campaigns-compose-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET as VARIABLES } from "@/app/api/admin/campaigns/variables/route";
import { GET as ALERT_OPTIONS } from "@/app/api/admin/campaigns/alert-options/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

describe("GET /api/admin/campaigns/variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("não inclui variáveis de Evento numa campanha de plataforma", async () => {
    const res = await VARIABLES(new Request("http://localhost") as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    const names = data.variables.map((v: any) => v.name);
    expect(names).not.toContain("nome_evento");
    expect(names).toContain("nome_atleta");
  });

  it("rejeita ORGANIZER", async () => {
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });

    const res = await VARIABLES(new Request("http://localhost") as any);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/campaigns/alert-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.messageTemplate.findFirst.mockResolvedValue(null);
  });

  it("só lista alertas WhatsApp voltados a atleta/comprador", async () => {
    const res = await ALERT_OPTIONS(new Request("http://localhost") as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    const keys = data.options.map((o: any) => o.alertKey);
    expect(keys).toContain("ORDER_CONFIRMED");
    expect(keys).not.toContain("RECONCILIATION_MISMATCH");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts`
Expected: FAIL — none of the 4 route files exist yet.

- [ ] **Step 4: Implement `app/api/events/[id]/campaigns/variables/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariables } from "@/lib/campaigns/variables";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const context = await resolveCampaignListContext({ session, eventId: id });
  if (!context.ok) return context.response;

  return NextResponse.json({ variables: getAllowedCampaignVariables(id) });
}
```

- [ ] **Step 5: Implement `app/api/admin/campaigns/variables/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { getAllowedCampaignVariables } from "@/lib/campaigns/variables";

export async function GET(_req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  return NextResponse.json({ variables: getAllowedCampaignVariables(null) });
}
```

- [ ] **Step 6: Implement `app/api/events/[id]/campaigns/alert-options/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { ALERT_REGISTRY } from "@/lib/templates/registry";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

function pickRecipientRole(recipientRoles: string[]): "ATHLETE" | "BUYER" | null {
  if (recipientRoles.includes("ATHLETE")) return "ATHLETE";
  if (recipientRoles.includes("BUYER")) return "BUYER";
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const context = await resolveCampaignListContext({ session, eventId: id });
  if (!context.ok) return context.response;

  const options: { alertKey: string; description: string; body: string }[] = [];
  for (const def of Object.values(ALERT_REGISTRY)) {
    if (!def.channels.includes("WHATSAPP")) continue;
    const role = pickRecipientRole(def.recipientRoles);
    if (!role) continue;
    const effective = await getEffectiveTemplate(def.alertKey, "WHATSAPP", role, id);
    options.push({ alertKey: def.alertKey, description: def.description, body: effective.body });
  }

  return NextResponse.json({ options });
}
```

- [ ] **Step 7: Implement `app/api/admin/campaigns/alert-options/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignListContext } from "@/lib/campaigns/service";
import { ALERT_REGISTRY } from "@/lib/templates/registry";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

function pickRecipientRole(recipientRoles: string[]): "ATHLETE" | "BUYER" | null {
  if (recipientRoles.includes("ATHLETE")) return "ATHLETE";
  if (recipientRoles.includes("BUYER")) return "BUYER";
  return null;
}

export async function GET(_req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const context = await resolveCampaignListContext({ session, eventId: null });
  if (!context.ok) return context.response;

  const options: { alertKey: string; description: string; body: string }[] = [];
  for (const def of Object.values(ALERT_REGISTRY)) {
    if (!def.channels.includes("WHATSAPP")) continue;
    const role = pickRecipientRole(def.recipientRoles);
    if (!role) continue;
    const effective = await getEffectiveTemplate(def.alertKey, "WHATSAPP", role);
    options.push({ alertKey: def.alertKey, description: def.description, body: effective.body });
  }

  return NextResponse.json({ options });
}
```

- [ ] **Step 8: Run to verify everything passes**

Run: `npx vitest run tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts`
Expected: all PASS.

- [ ] **Step 9: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 10: Commit**

```bash
git add app/api/events/\[id\]/campaigns/variables app/api/admin/campaigns/variables app/api/events/\[id\]/campaigns/alert-options app/api/admin/campaigns/alert-options tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts
git commit -m "feat: rotas de catalogo de variaveis e opcoes de alerta pra campanhas"
```

---

### Task 5: Rotas de preview e envio de teste

**Files:**
- Create: `app/api/events/[id]/campaigns/[campaignId]/preview/route.ts`
- Create: `app/api/events/[id]/campaigns/[campaignId]/test-send/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/preview/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/test-send/route.ts`
- Modify: `tests/events-campaigns-compose-route.test.ts` (append 2 describe blocks)
- Modify: `tests/admin-campaigns-compose-route.test.ts` (append 2 describe blocks)

**Interfaces:**
- Consumes: `resolveCampaignDetailContext` (existing, `lib/campaigns/service.ts`),
  `renderTemplate` + `SAMPLE_VALUES` (Task 2), `buildPreferencesFooterText` (Task 2),
  `sendWhatsAppMessage` (existing, `lib/whatsapp.ts`).

- [ ] **Step 1: Append the failing tests to `tests/events-campaigns-compose-route.test.ts`**

Add these imports near the top of the file, alongside the existing ones:

```ts
import { POST as PREVIEW } from "@/app/api/events/[id]/campaigns/[campaignId]/preview/route";
import { POST as TEST_SEND } from "@/app/api/events/[id]/campaigns/[campaignId]/test-send/route";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
```

Add this mock near the top, alongside the existing `vi.mock("@/lib/auth", ...)`:

```ts
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
  buildPreferencesFooterText: () => "\n\nRODAPE_TESTE",
}));

const sendMock = vi.mocked(sendWhatsAppMessage);
```

Append these describe blocks at the end of the file:

```ts
const draftCampaign = {
  id: "campaign-1",
  eventId: "event-1",
  name: "Campanha de teste",
  description: null,
  status: "DRAFT",
  messageBody: "Olá {{nome_atleta}}, {{nome_evento}} te espera!",
  createdByUserId: "organizer-1",
};

describe("POST /api/events/[id]/campaigns/[campaignId]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ ...draftCampaign });
  });

  it("renderiza com dados de exemplo e inclui o rodapé de opt-out, sem enviar nada", async () => {
    const res = await PREVIEW(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.body).not.toContain("{{");
    expect(data.body).toContain("RODAPE_TESTE");
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/[id]/campaigns/[campaignId]/test-send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ ...draftCampaign });
  });

  it("envia pro telefone da própria conta, prefixado [TESTE], marcado como CAMPAIGN_TEST", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ phone: "5511999999999" });

    const res = await TEST_SEND(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("5511999999999", expect.stringContaining("[TESTE]"), "CAMPAIGN_TEST");
  });

  it("400 quando a conta não tem telefone cadastrado", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ phone: null });

    const res = await TEST_SEND(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Append the failing tests to `tests/admin-campaigns-compose-route.test.ts`**

Add these imports near the top:

```ts
import { POST as PREVIEW } from "@/app/api/admin/campaigns/[campaignId]/preview/route";
import { POST as TEST_SEND } from "@/app/api/admin/campaigns/[campaignId]/test-send/route";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
```

Add this mock near the top, alongside the existing `vi.mock("@/lib/auth", ...)`:

```ts
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
  buildPreferencesFooterText: () => "\n\nRODAPE_TESTE",
}));

const sendMock = vi.mocked(sendWhatsAppMessage);
```

Append these describe blocks at the end of the file:

```ts
const platformDraftCampaign = {
  id: "campaign-1",
  eventId: null,
  name: "Campanha de plataforma",
  description: null,
  status: "DRAFT",
  messageBody: "Olá {{nome_atleta}}!",
  createdByUserId: "admin-1",
};

describe("POST /api/admin/campaigns/[campaignId]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  it("renderiza com dados de exemplo e inclui o rodapé de opt-out", async () => {
    const res = await PREVIEW(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.body).not.toContain("{{");
    expect(data.body).toContain("RODAPE_TESTE");
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/campaigns/[campaignId]/test-send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.campaign.findFirst.mockResolvedValue({ ...platformDraftCampaign });
  });

  it("envia pro telefone da própria conta admin, prefixado [TESTE]", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ phone: "5511988888888" });

    const res = await TEST_SEND(new Request("http://localhost", { method: "POST" }) as any, {
      params: Promise.resolve({ campaignId: "campaign-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("5511988888888", expect.stringContaining("[TESTE]"), "CAMPAIGN_TEST");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts`
Expected: the 5 new tests FAIL (route files don't exist yet); the Task 4 tests still PASS.

- [ ] **Step 4: Implement `app/api/events/[id]/campaigns/[campaignId]/preview/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
import { buildPreferencesFooterText } from "@/lib/whatsapp";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; campaignId: string }> },
) {
  const check = await checkApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: id, campaignId });
  if (!context.ok) return context.response;

  const body = renderTemplate(context.campaign.messageBody, SAMPLE_VALUES, "WHATSAPP") + buildPreferencesFooterText();
  return NextResponse.json({ body });
}
```

- [ ] **Step 5: Implement `app/api/events/[id]/campaigns/[campaignId]/test-send/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
import { sendWhatsAppMessage, buildPreferencesFooterText } from "@/lib/whatsapp";
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

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { phone: true } });
  if (!user?.phone) {
    return NextResponse.json({ error: "Sua conta não tem telefone cadastrado" }, { status: 400 });
  }

  const body = renderTemplate(context.campaign.messageBody, SAMPLE_VALUES, "WHATSAPP") + buildPreferencesFooterText();
  await sendWhatsAppMessage(user.phone, `[TESTE] ${body}`, "CAMPAIGN_TEST");

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Implement `app/api/admin/campaigns/[campaignId]/preview/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
import { buildPreferencesFooterText } from "@/lib/whatsapp";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  const body = renderTemplate(context.campaign.messageBody, SAMPLE_VALUES, "WHATSAPP") + buildPreferencesFooterText();
  return NextResponse.json({ body });
}
```

- [ ] **Step 7: Implement `app/api/admin/campaigns/[campaignId]/test-send/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { renderTemplate } from "@/lib/templates/render";
import { SAMPLE_VALUES } from "@/lib/templates/variables";
import { sendWhatsAppMessage, buildPreferencesFooterText } from "@/lib/whatsapp";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const check = await checkAdminOnlyApiPermission("campaigns.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { campaignId } = await params;
  const context = await resolveCampaignDetailContext({ session, eventId: null, campaignId });
  if (!context.ok) return context.response;

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { phone: true } });
  if (!user?.phone) {
    return NextResponse.json({ error: "Sua conta não tem telefone cadastrado" }, { status: 400 });
  }

  const body = renderTemplate(context.campaign.messageBody, SAMPLE_VALUES, "WHATSAPP") + buildPreferencesFooterText();
  await sendWhatsAppMessage(user.phone, `[TESTE] ${body}`, "CAMPAIGN_TEST");

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Run to verify everything passes**

Run: `npx vitest run tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts`
Expected: all PASS.

- [ ] **Step 9: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 10: Commit**

```bash
git add "app/api/events/[id]/campaigns/[campaignId]/preview" "app/api/events/[id]/campaigns/[campaignId]/test-send" "app/api/admin/campaigns/[campaignId]/preview" "app/api/admin/campaigns/[campaignId]/test-send" tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts
git commit -m "feat: rotas de preview e envio de teste pra campanhas"
```

---

### Task 6: UI — catálogo de variáveis, atalho de alerta, preview e teste

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:**
- Consumes: `GET {apiBase}/variables`, `GET {apiBase}/alert-options`, `POST
  {apiBase}/{campaignId}/preview`, `POST {apiBase}/{campaignId}/test-send` (Tasks 4 and 5).

**Before editing, read the current full content of `components/campaigns/CampaignsManager.tsx`
yourself** — this file has been through 2 fix rounds and a full fix wave since it was first
written, so treat this brief as a description of the change, not a guaranteed byte-for-byte
starting point. If the live file's structure meaningfully differs from what's described below (not
line numbers — actual different logic/props/state), stop and report NEEDS_CONTEXT.

No automated test for this task (project convention — no UI component tests). Verify manually if a
browser session is available; otherwise `tsc --noEmit` + the full suite are the safety net.

- [ ] **Step 1: Add new types, imports, and state**

Add `useRef` to the existing React import:

```tsx
import { useEffect, useRef, useState } from "react";
```

Add these two types near the top, alongside the existing `Campaign`/`PrepareSummary` types:

```tsx
type VariableDef = { name: string; label: string; category: string; description: string; sample: string };
type AlertOption = { alertKey: string; description: string; body: string };
```

Add this new state, alongside the existing state declarations in the component body:

```tsx
  const [variables, setVariables] = useState<VariableDef[]>([]);
  const [alertOptions, setAlertOptions] = useState<AlertOption[]>([]);
  const [selectedAlertKey, setSelectedAlertKey] = useState("");
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testSendLoading, setTestSendLoading] = useState(false);
  const [testSendMessage, setTestSendMessage] = useState<string | null>(null);
  const createBodyRef = useRef<HTMLTextAreaElement>(null);
  const editBodyRef = useRef<HTMLTextAreaElement>(null);
```

- [ ] **Step 2: Fetch the variable catalog and alert options once on mount**

Add a new `useEffect`, alongside the existing one that calls `reload()`:

```tsx
  useEffect(() => {
    void (async () => {
      const [variablesRes, alertOptionsRes] = await Promise.all([
        fetch(`${apiBase}/variables`),
        fetch(`${apiBase}/alert-options`),
      ]);
      if (variablesRes.ok) {
        const data = await variablesRes.json();
        setVariables(data.variables ?? []);
      }
      if (alertOptionsRes.ok) {
        const data = await alertOptionsRes.json();
        setAlertOptions(data.options ?? []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);
```

- [ ] **Step 3: Add the cursor-aware variable-insert helper**

Add this function near the other helper functions (e.g. near `openEdit`):

```tsx
  function insertVariable(
    variableName: string,
    ref: React.RefObject<HTMLTextAreaElement>,
    value: string,
    setValue: (next: string) => void,
  ) {
    const el = ref.current;
    const token = `{{${variableName}}}`;
    if (!el) {
      setValue(`${value}${token}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }
```

- [ ] **Step 4: Add preview/test-send handlers**

Add these two functions near `doPrepareRecipients`:

```tsx
  async function doPreview() {
    if (!editId) return;
    setPreviewLoading(true);
    setActionError(null);
    const res = await fetch(`${apiBase}/${editId}/preview`, { method: "POST" });
    setPreviewLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Erro ao gerar pré-visualização");
      return;
    }
    setPreviewResult(data.body);
  }

  async function doTestSend() {
    if (!editId) return;
    setTestSendLoading(true);
    setActionError(null);
    setTestSendMessage(null);
    const res = await fetch(`${apiBase}/${editId}/test-send`, { method: "POST" });
    setTestSendLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Erro ao enviar teste");
      return;
    }
    setTestSendMessage("Teste enviado para o seu telefone cadastrado.");
  }
```

- [ ] **Step 5: Parse `unknownVariables` in the existing create/edit error handling**

In `handleCreate`, change the `setFormError(...)` call from:

```tsx
      setFormError(
        data.error?.formErrors?.[0] ??
          (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
          (typeof data.error === "string" ? data.error : undefined) ??
          "Erro ao criar campanha",
      );
```

to:

```tsx
      setFormError(
        data.error?.formErrors?.[0] ??
          (fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined) ??
          (data.unknownVariables?.length
            ? `Variáveis desconhecidas: ${data.unknownVariables.map((v: string) => `{{${v}}}`).join(", ")}`
            : undefined) ??
          (typeof data.error === "string" ? data.error : undefined) ??
          "Erro ao criar campanha",
      );
```

Apply the identical change to `saveEdit`'s `setActionError(...)` call (same fallback chain, same
`data.unknownVariables` check inserted in the same position, generic message stays "Erro ao salvar
campanha").

- [ ] **Step 6: Reset compose-related state when opening/closing the edit modal**

In `openEdit`, add at the end of the function body:

```tsx
    setPreviewResult(null);
    setTestSendMessage(null);
```

Everywhere the edit modal is closed by setting `editId(null)` directly (the backdrop `onClick` and
the "Cancelar" button's `onClick` inside the edit modal — NOT inside `saveEdit`, which already sets
`editId(null)` on success), also clear the same two pieces of state right before or after. The
backdrop `onClick={() => setEditId(null)}` becomes
`onClick={() => { setEditId(null); setPreviewResult(null); setTestSendMessage(null); }}`, and the
"Cancelar" button's `onClick={() => setEditId(null)}` becomes the same pattern.

- [ ] **Step 7: Add the variable dropdown + counter to the create form**

In the create form (`{showForm && (...)}`), right after the "Mensagem *" `<textarea>` block, add:

```tsx
          <div className="flex items-center justify-between gap-2">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  insertVariable(e.target.value, createBodyRef, form.messageBody, (v) => setForm({ ...form, messageBody: v }));
                }
                e.target.value = "";
              }}
              className="input text-sm"
            >
              <option value="">+ Inserir variável...</option>
              {[...new Set(variables.map((v) => v.category))].map((cat) => (
                <optgroup key={cat} label={cat}>
                  {variables
                    .filter((v) => v.category === cat)
                    .map((v) => (
                      <option key={v.name} value={v.name}>{`{{${v.name}}} — ${v.label}`}</option>
                    ))}
                </optgroup>
              ))}
            </select>
            <span className="text-xs text-gray-400">{form.messageBody.length} caracteres</span>
          </div>
```

Then add the `ref={createBodyRef}` prop to the create form's `<textarea>` (the one bound to
`form.messageBody`).

Right before the "Mensagem *" field (so it appears above the message textarea), add the
"start from an alert" block:

```tsx
          {alertOptions.length > 0 && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Começar a partir de um alerta existente (opcional)
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedAlertKey}
                  onChange={(e) => setSelectedAlertKey(e.target.value)}
                  className="input flex-1 text-sm"
                >
                  <option value="">Selecione um alerta...</option>
                  {alertOptions.map((opt) => (
                    <option key={opt.alertKey} value={opt.alertKey}>{opt.description}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const opt = alertOptions.find((o) => o.alertKey === selectedAlertKey);
                    if (opt) setForm({ ...form, messageBody: opt.body });
                  }}
                  disabled={!selectedAlertKey}
                  className="btn-secondary text-sm px-3 disabled:opacity-50"
                >
                  Usar este texto
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 8: Add the variable dropdown + counter to the edit modal**

Apply the same pattern as Step 7 (dropdown + counter, no "start from alert" block — that stays
create-only per the design) right after the edit modal's "Mensagem" `<textarea>` block:

```tsx
            <div className="flex items-center justify-between gap-2">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    insertVariable(e.target.value, editBodyRef, editForm.messageBody, (v) => setEditForm({ ...editForm, messageBody: v }));
                  }
                  e.target.value = "";
                }}
                className="input text-sm"
              >
                <option value="">+ Inserir variável...</option>
                {[...new Set(variables.map((v) => v.category))].map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {variables
                      .filter((v) => v.category === cat)
                      .map((v) => (
                        <option key={v.name} value={v.name}>{`{{${v.name}}} — ${v.label}`}</option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <span className="text-xs text-gray-400">{editForm.messageBody.length} caracteres</span>
            </div>
```

Add the `ref={editBodyRef}` prop to the edit modal's `<textarea>` (bound to `editForm.messageBody`).

- [ ] **Step 9: Add Visualizar/Enviar teste buttons to the edit modal**

In the edit modal's form, right before the closing `<div className="flex justify-end gap-3">`
(Cancelar/Salvar row), add a sibling row above it:

```tsx
            {testSendMessage && <p className="text-sm text-green-700 dark:text-green-400">{testSendMessage}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void doPreview()}
                disabled={previewLoading}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {previewLoading ? "Gerando..." : "Visualizar"}
              </button>
              <button
                type="button"
                onClick={() => void doTestSend()}
                disabled={testSendLoading}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {testSendLoading ? "Enviando..." : "Enviar teste"}
              </button>
            </div>
```

- [ ] **Step 10: Render the preview result in a small modal**

Near the end of the component's JSX (e.g. right after the `<ErrorModal ... />` element, so it's a
sibling at the top level of the returned tree), add:

```tsx
      {previewResult !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPreviewResult(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Pré-visualização</h2>
            <p className="whitespace-pre-wrap text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3">{previewResult}</p>
            <div className="flex justify-end">
              <button type="button" onClick={() => setPreviewResult(null)} className="btn-secondary text-sm px-4">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 12: Full suite**

Run: `npx vitest run`
Expected: no regressions anywhere in the project.

- [ ] **Step 13: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "feat: UI de catalogo de variaveis, atalho de alerta, preview e teste de campanha"
```

---

## Final check (after all 6 tasks)

- [ ] Run the full suite once more: `npx vitest run`
- [ ] Run `npx tsc --noEmit`
- [ ] No schema/migration change this phase — nothing new to add to the pending-migration deploy
  queue.
- [ ] Manual verification recommended once there's DB access/browser session: create a campaign,
  use the variable dropdown, try the "start from alert" shortcut, save, then Visualizar (confirm
  sample values + footer render) and Enviar teste (confirm it lands on the tester's own WhatsApp,
  prefixed `[TESTE]`, and shows up in `/admin/mensagens` labeled "Teste de campanha de WhatsApp").
  Confirm a platform-wide campaign's variable dropdown never offers Evento/Organizador/Inscrição
  variables, and that typing one manually (e.g. `{{nome_evento}}`) is rejected on save with a clear
  error.
- [ ] This is Fase C of 6 for "Campanhas de WhatsApp em massa" — scheduling, actual sending (with
  real per-recipient variable resolution), delivery status, and pause/resume still don't exist.
  Next: Fase D (agendamento + worker + rate limiting + retries).
