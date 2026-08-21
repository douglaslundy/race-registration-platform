# Campanhas de WhatsApp — Fase D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a campaign actually send real WhatsApp messages to real recipients, on demand or on
a schedule, at a very conservative pace (the cron interval itself is the rate limiter — no
in-process sleeping), with automatic retries and an automatic circuit breaker on sustained
failure.

**Architecture:** A new cron endpoint (`app/api/cron/send-campaign-messages`) processes AT MOST
one `CampaignRecipient` per invocation — the crontab's own interval (recommended: every 1 minute)
is the entire rate-limiting mechanism, so there is no in-memory pacing state to lose on restart.
Real per-recipient variable values are resolved fresh at send time (`resolveCampaignRecipientVariables`,
new) — Fase C's `SAMPLE_VALUES` were only ever for preview/test-send. A global (not per-campaign)
consecutive-failure counter, persisted in `PlatformSetting`, trips a circuit breaker that pauses
every `RUNNING` campaign after 5 failures in a row, since all campaigns share the same WhatsApp
instance/number. A lightweight guard (checking for any `CampaignRecipient` stuck in `PROCESSING`)
prevents obvious double-processing within one container — true multi-instance concurrency safety
is explicitly Fase F's job, not this one's.

**Tech Stack:** Next.js (App Router) + Prisma/Postgres + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-campanhas-whatsapp-fase-d-design.md`

## Global Constraints

- The cron's own interval is the rate limiter. No `setTimeout`/sleep inside a request. No new
  in-memory pacing state.
- Exactly one `CampaignRecipient` is processed per cron invocation, full stop.
- 3 attempts maximum before a recipient is marked `FAILED`. No special backoff — a retried
  recipient simply stays `PENDING` and is picked up again on a later invocation, naturally paced
  by the same one-per-tick cadence.
- 5 consecutive failures (tracked globally, across all campaigns, in `PlatformSetting`) trips the
  circuit breaker: every `RUNNING` campaign flips to `PAUSED`. A success resets the counter to 0.
  This phase never auto-resumes a paused campaign — that's manual (direct DB/admin action) until
  Fase F ships a real pause/resume control.
- `receivePromotionalMessages` is re-checked at send time, not just trusted from Fase B's
  population snapshot — a long-running campaign (days, at this pace) gives plenty of time for an
  athlete to opt out in between.
- The rendered message is built exactly once (`renderTemplate(...) + buildPreferencesFooterText()`)
  and passed to `sendWhatsAppMessage` WITHOUT also setting `appendPreferencesFooter: true` — that
  option would append the footer a second time.
- `patrocinio` and `redes_sociais` (Evento category) are never usable in a campaign message, in
  either mode — they have side effects (they increment a per-registration send-quota counter) and
  were designed for exactly one alert-send per registration, not a broadcast to many recipients.
- No manual pause/resume UI, no multi-instance concurrency hardening — both explicitly Fase F.
- No delivery-status/webhook handling, no aggregated campaign metrics beyond what the existing
  `recipients/summary` groupBy already surfaces — that's Fase E.

---

### Task 1: Schema — `CampaignRecipient` gains send-tracking fields; exclude 2 side-effecting variables

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822020000_add_campaign_recipient_send_fields/migration.sql`
- Modify: `lib/campaigns/variables.ts`
- Modify: `tests/campaigns-variables.test.ts`

**Interfaces:**
- Produces: `CampaignRecipient.attempts: number`, `.providerMessageId: string | null`,
  `.sentAt: Date | null`. Used by Task 5.
- Modifies: `getAllowedCampaignVariables`/`getAllowedCampaignVariableNames` (existing, Fase C) to
  exclude `patrocinio`/`redes_sociais` even when `eventId !== null`.

- [ ] **Step 1: Add the 3 fields to `CampaignRecipient`**

In `prisma/schema.prisma`, inside `model CampaignRecipient`, change:

```prisma
  normalizedPhone String
  status          CampaignRecipientStatus @default(PENDING)
  failureReason   String?
  createdAt       DateTime                @default(now())
```

to:

```prisma
  normalizedPhone String
  status          CampaignRecipientStatus @default(PENDING)
  failureReason   String?
  attempts        Int                     @default(0)
  providerMessageId String?
  sentAt          DateTime?
  createdAt       DateTime                @default(now())
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20260822020000_add_campaign_recipient_send_fields/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "campaign_recipients" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN "sentAt" TIMESTAMP(3);
```

- [ ] **Step 3: Write the failing test for the variable exclusion**

Add to `tests/campaigns-variables.test.ts`:

```ts
  it("nunca inclui patrocinio/redes_sociais, mesmo em modo evento (efeito colateral de cota)", () => {
    const names = getAllowedCampaignVariableNames("event-1");
    expect(names).not.toContain("patrocinio");
    expect(names).not.toContain("redes_sociais");
  });
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run tests/campaigns-variables.test.ts`
Expected: the new test FAILS (exclusion doesn't exist yet); all other tests still PASS.

- [ ] **Step 5: Implement the exclusion**

In `lib/campaigns/variables.ts`, add a new constant and use it in both exported functions:

```ts
import { ALL_VARIABLES, type VariableDefinition } from "@/lib/templates/variables";

const ALWAYS_CATEGORIES = ["Atleta", "Plataforma"];
const EVENT_ONLY_CATEGORIES = ["Evento", "Organizador", "Inscrição"];

/** patrocinio/redes_sociais têm efeito colateral (incrementam cota de envio por link/patrocinador)
 * e foram desenhadas pra um envio por inscrição (um alerta de confirmação por vez) — nunca fizeram
 * sentido pra uma campanha que renderiza o mesmo texto pra centenas/milhares de destinatários. */
const EXCLUDED_NAMES = new Set(["patrocinio", "redes_sociais"]);

export function getAllowedCampaignVariables(eventId: string | null): VariableDefinition[] {
  const categories = new Set(
    eventId !== null ? [...ALWAYS_CATEGORIES, ...EVENT_ONLY_CATEGORIES] : ALWAYS_CATEGORIES,
  );
  return ALL_VARIABLES.filter((v) => categories.has(v.category) && !EXCLUDED_NAMES.has(v.name));
}

export function getAllowedCampaignVariableNames(eventId: string | null): string[] {
  return getAllowedCampaignVariables(eventId).map((v) => v.name);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run tests/campaigns-variables.test.ts`
Expected: all PASS. (Note: this changes the allowed set for event-scoped campaigns — re-run
`tests/events-campaigns-compose-route.test.ts` and `tests/admin-campaigns-compose-route.test.ts`
too, since Fase C's tests may reference the full variable list; expected: still PASS, since none of
those tests specifically assert `patrocinio`/`redes_sociais` are present.)

- [ ] **Step 7: `npx prisma generate` + typecheck + full suite**

Run: `npx prisma generate && npx tsc --noEmit && npx vitest run`
Expected: schema valid, no type errors, no regressions.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260822020000_add_campaign_recipient_send_fields lib/campaigns/variables.ts tests/campaigns-variables.test.ts
git commit -m "feat: campos de envio em CampaignRecipient + exclui patrocinio/redes_sociais de campanhas"
```

---

### Task 2: `sendWhatsAppMessage` passa a devolver o `providerMessageId`

**Files:**
- Modify: `lib/whatsapp.ts`
- Modify: `tests/whatsapp.test.ts`

**Interfaces:**
- Produces: `sendWhatsAppMessage(...): Promise<{ providerMessageId?: string }>` (was
  `Promise<void>`). Used by Task 5.

This is a backward-compatible signature change — every existing call site ignores the return value
today (`Promise<void>`), so none of them break by the return type gaining a property.

- [ ] **Step 1: Write the failing test**

Add to `tests/whatsapp.test.ts`, in the `describe("sendWhatsAppMessage", ...)` block:

```ts
  it("devolve o providerMessageId em caso de sucesso", async () => {
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ providerMessageId: "wamid.123" });
    const result = await sendWhatsAppMessage("11999999999", "Olá");
    expect(result).toEqual({ providerMessageId: "wamid.123" });
  });
```

(Check the file's existing mocks for `sendTextMessage` — this test should follow the exact same
mocking pattern already used by the neighboring success-case test in the same describe block; if
`sendTextMessage` isn't already imported/mocked at the top of the file, add it consistent with how
the file mocks `./whatsapp/evolution-client` elsewhere.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: FAIL — current return type is `void`.

- [ ] **Step 3: Implement**

In `lib/whatsapp.ts`, change the function signature and its two `return`/end-of-try paths:

```ts
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  messageType?: string,
  options?: {
    relatedEntityType?: string;
    relatedEntityId?: string;
    logSubject?: string;
    appendPreferencesFooter?: boolean;
  },
): Promise<{ providerMessageId?: string }> {
```

Inside the `try` block, after the existing `await recordMessageLog({...})` call for the success
path, add a `return { providerMessageId };` (the destructured `providerMessageId` from
`sendTextMessage`'s result is already in scope there). The `catch` block keeps `throw err;`
unchanged (failure still throws, as before — callers already handle this via try/catch).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: all PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions — every existing caller of `sendWhatsAppMessage` ignores the return value,
so none should need changes.

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp.ts tests/whatsapp.test.ts
git commit -m "feat: sendWhatsAppMessage devolve providerMessageId no sucesso"
```

---

### Task 3: `resolveCampaignRecipientVariables` — valores reais por destinatário

**Files:**
- Create: `lib/campaigns/resolve-recipient-variables.ts`
- Test: `tests/campaigns-resolve-recipient-variables.test.ts`

**Interfaces:**
- Consumes: `getAllowedCampaignVariableNames` (Task 1's updated version), `formatDate`/
  `formatCurrency` (existing, `lib/format.ts`), `REGISTRATION_STATUS` (existing,
  `lib/registration-status.ts`), `getAppName`/`getSetting` (existing, `lib/settings.ts`).
- Produces: `resolveCampaignRecipientVariables(recipient: { athleteUserId: string; registrationId:
  string | null }): Promise<Record<string, string>>`. Used by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `tests/campaigns-resolve-recipient-variables.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";

const dbMock = db as any;

const athleteUser = {
  id: "athlete-1",
  name: "Maria Exemplo",
  email: "maria@exemplo.com",
  athleteProfile: {
    phone: "11988888888",
    cpf: "12345678900",
    birthDate: new Date("1990-03-15T00:00:00Z"),
    teamName: "Equipe Exemplo",
  },
};

describe("resolveCampaignRecipientVariables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("modo plataforma (registrationId null): só resolve Atleta + Plataforma, sem consultar Registration", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: null });

    expect(values.nome_atleta).toBe("Maria Exemplo");
    expect(values.primeiro_nome_atleta).toBe("Maria");
    expect(values.email_atleta).toBe("maria@exemplo.com");
    expect(values.telefone_atleta).toBe("11988888888");
    expect(values.equipe_atleta).toBe("Equipe Exemplo");
    expect(values.nome_plataforma).toBeTruthy();
    expect(values.nome_evento).toBeUndefined();
    expect(dbMock.registration.findUnique).not.toHaveBeenCalled();
  });

  it("modo evento (registrationId presente): resolve também Evento/Organizador/Inscrição", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      route: { name: "5km" },
      event: {
        title: "Corrida Exemplo",
        description: "Descrição",
        startAt: new Date("2026-09-20T10:00:00Z"),
        venueName: "Parque Exemplo",
        city: "São Paulo",
        state: "SP",
        addressLine: "Av. Exemplo, 1000",
        slug: "corrida-exemplo",
        organizer: { companyName: "Organização Exemplo", phone: "1197777777", user: { name: "João Organizador", email: "joao@org.com" } },
      },
      order: { id: "order-1", totalAmount: 9000 },
    });

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "reg-1" });

    expect(values.nome_evento).toBe("Corrida Exemplo");
    expect(values.cidade_evento).toBe("São Paulo");
    expect(values.nome_modalidade).toBe("5km");
    expect(values.nome_organizador).toBe("João Organizador");
    expect(values.empresa_organizador).toBe("Organização Exemplo");
    expect(values.status_inscricao).toBe("Confirmada");
    expect(values.valor_inscricao).toContain("90,00");
    expect(values.codigo_confirmacao).toBe("order-1");
  });

  it("nunca resolve patrocinio/redes_sociais (excluídas de getAllowedCampaignVariableNames)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1", status: "CONFIRMED", createdAt: new Date(), route: null,
      event: { title: "E", description: null, startAt: new Date(), venueName: null, city: "C", state: "S", addressLine: null, slug: "e", organizer: { companyName: null, phone: null, user: { name: "Org", email: "o@o.com" } } },
      order: { id: "order-1", totalAmount: 100 },
    });

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "reg-1" });

    expect(values.patrocinio).toBeUndefined();
    expect(values.redes_sociais).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/campaigns-resolve-recipient-variables.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `lib/campaigns/resolve-recipient-variables.ts`**

```ts
import { db } from "@/lib/db";
import { formatDate, formatCurrency } from "@/lib/format";
import { REGISTRATION_STATUS } from "@/lib/registration-status";
import { getAppName, getSetting } from "@/lib/settings";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Resolve os valores REAIS (não mais amostra) das variáveis permitidas pra um destinatário de
 * campanha. Sempre resolve Atleta + Plataforma; quando `registrationId` não é nulo (campanha de
 * evento), resolve também Evento + Organizador + Inscrição — nesse caso as variáveis de Evento
 * `patrocinio`/`redes_sociais` NUNCA são incluídas aqui, porque já foram excluídas na origem
 * (`getAllowedCampaignVariableNames`) por terem efeito colateral de cota — uma campanha nunca
 * deveria ter chegado a validar um texto que as usa, então este resolver nem tenta resolvê-las. */
export async function resolveCampaignRecipientVariables(recipient: {
  athleteUserId: string;
  registrationId: string | null;
}): Promise<Record<string, string>> {
  const user = await db.user.findUnique({
    where: { id: recipient.athleteUserId },
    select: {
      name: true,
      email: true,
      athleteProfile: { select: { phone: true, cpf: true, birthDate: true, teamName: true } },
    },
  });

  const values: Record<string, string> = {
    nome_atleta: user?.name ?? "",
    primeiro_nome_atleta: user?.name ? firstName(user.name) : "",
    email_atleta: user?.email ?? "",
    telefone_atleta: user?.athleteProfile?.phone ?? "",
    documento_atleta: user?.athleteProfile?.cpf ?? "",
    data_nascimento_atleta: user?.athleteProfile?.birthDate ? formatDate(user.athleteProfile.birthDate) : "",
    equipe_atleta: user?.athleteProfile?.teamName ?? "",
    nome_plataforma: await getAppName(),
    email_suporte: (await getSetting("support_email")) ?? "",
    telefone_suporte: (await getSetting("support_phone")) ?? "",
    link_plataforma: process.env.NEXT_PUBLIC_APP_URL ?? "",
    ano_atual: String(new Date().getFullYear()),
  };

  if (recipient.registrationId === null) {
    return values;
  }

  const registration = await db.registration.findUnique({
    where: { id: recipient.registrationId },
    select: {
      status: true,
      createdAt: true,
      route: { select: { name: true } },
      event: {
        select: {
          title: true,
          description: true,
          startAt: true,
          venueName: true,
          city: true,
          state: true,
          addressLine: true,
          slug: true,
          organizer: { select: { companyName: true, phone: true, user: { select: { name: true, email: true } } } },
        },
      },
      order: { select: { id: true, totalAmount: true } },
    },
  });

  if (!registration) return values;

  values.categoria_inscricao = "";
  values.nome_modalidade = registration.route?.name ?? "";
  values.nome_evento = registration.event.title;
  values.descricao_evento = registration.event.description ?? "";
  values.data_evento = formatDate(registration.event.startAt);
  values.hora_evento = formatDate(registration.event.startAt, "HH:mm");
  values.local_evento = registration.event.venueName ?? "";
  values.cidade_evento = registration.event.city;
  values.estado_evento = registration.event.state;
  values.endereco_evento = registration.event.addressLine ?? "";
  values.link_evento = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/eventos/${registration.event.slug}`;
  values.nome_organizador = registration.event.organizer.user.name;
  values.email_organizador = registration.event.organizer.user.email;
  values.telefone_organizador = registration.event.organizer.phone ?? "";
  values.empresa_organizador = registration.event.organizer.companyName ?? "";
  values.numero_inscricao = recipient.registrationId;
  values.status_inscricao = REGISTRATION_STATUS[registration.status]?.label ?? registration.status;
  values.data_inscricao = formatDate(registration.createdAt);
  values.valor_inscricao = registration.order ? formatCurrency(registration.order.totalAmount) : "";
  values.codigo_confirmacao = registration.order?.id ?? "";

  return values;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/campaigns-resolve-recipient-variables.test.ts`
Expected: all PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/resolve-recipient-variables.ts tests/campaigns-resolve-recipient-variables.test.ts
git commit -m "feat: resolve valores reais de variavel por destinatario de campanha"
```

---

### Task 4: Contador global de falhas consecutivas (circuit breaker)

**Files:**
- Create: `lib/campaigns/circuit-breaker.ts`
- Test: `tests/campaigns-circuit-breaker.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`upsertSetting` (existing, `lib/settings.ts`).
- Produces: `recordCampaignSendFailure(): Promise<{ tripped: boolean; count: number }>`,
  `recordCampaignSendSuccess(): Promise<void>`, `isCircuitBreakerTripped(): Promise<boolean>`. Used
  by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `tests/campaigns-circuit-breaker.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  recordCampaignSendFailure,
  recordCampaignSendSuccess,
  isCircuitBreakerTripped,
} from "@/lib/campaigns/circuit-breaker";

const dbMock = db as any;

describe("circuit breaker de envio de campanhas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não dispara antes de 5 falhas seguidas", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "3" });
    const result = await recordCampaignSendFailure();
    expect(result).toEqual({ tripped: false, count: 4 });
    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "campaign_consecutive_failures" }, create: expect.objectContaining({ value: "4" }), update: { value: "4" } }),
    );
  });

  it("dispara exatamente na 5ª falha seguida", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "4" });
    const result = await recordCampaignSendFailure();
    expect(result).toEqual({ tripped: true, count: 5 });
  });

  it("sucesso zera o contador", async () => {
    await recordCampaignSendSuccess();
    expect(dbMock.platformSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "campaign_consecutive_failures" }, update: { value: "0" } }),
    );
  });

  it("isCircuitBreakerTripped reflete o contador atual", async () => {
    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "5" });
    expect(await isCircuitBreakerTripped()).toBe(true);

    dbMock.platformSetting.findUnique.mockResolvedValueOnce({ value: "2" });
    expect(await isCircuitBreakerTripped()).toBe(false);

    dbMock.platformSetting.findUnique.mockResolvedValueOnce(null);
    expect(await isCircuitBreakerTripped()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/campaigns-circuit-breaker.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `lib/campaigns/circuit-breaker.ts`**

```ts
import { db } from "@/lib/db";

const SETTING_KEY = "campaign_consecutive_failures";
const TRIP_THRESHOLD = 5;

async function readCount(): Promise<number> {
  const row = await db.platformSetting.findUnique({ where: { key: SETTING_KEY } });
  return row ? parseInt(row.value, 10) || 0 : 0;
}

async function writeCount(count: number): Promise<void> {
  await db.platformSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: String(count) },
    update: { value: String(count) },
  });
}

/** Contador global (não por campanha) — todas as campanhas competem pelo mesmo número/instância de
 * WhatsApp, então uma falha sistêmica (instância caída, etc.) afeta todas igualmente. */
export async function recordCampaignSendFailure(): Promise<{ tripped: boolean; count: number }> {
  const count = (await readCount()) + 1;
  await writeCount(count);
  return { tripped: count >= TRIP_THRESHOLD, count };
}

export async function recordCampaignSendSuccess(): Promise<void> {
  await writeCount(0);
}

export async function isCircuitBreakerTripped(): Promise<boolean> {
  return (await readCount()) >= TRIP_THRESHOLD;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/campaigns-circuit-breaker.test.ts`
Expected: all PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/circuit-breaker.ts tests/campaigns-circuit-breaker.test.ts
git commit -m "feat: contador global de falhas consecutivas (circuit breaker de campanhas)"
```

---

### Task 5: `POST /api/cron/send-campaign-messages` — o worker

**Files:**
- Create: `app/api/cron/send-campaign-messages/route.ts`
- Test: `tests/cron-send-campaign-messages-route.test.ts`

**Interfaces:**
- Consumes: `resolveCampaignRecipientVariables` (Task 3), `recordCampaignSendFailure`/
  `recordCampaignSendSuccess`/`isCircuitBreakerTripped` (Task 4), `sendWhatsAppMessage` (Task 2's
  updated return type), `renderTemplate`/`buildPreferencesFooterText` (existing, Fase C).

- [ ] **Step 1: Write the failing tests**

Create `tests/cron-send-campaign-messages-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
  buildPreferencesFooterText: () => "\n\nRODAPE",
}));
vi.mock("@/lib/campaigns/resolve-recipient-variables", () => ({
  resolveCampaignRecipientVariables: vi.fn().mockResolvedValue({ nome_atleta: "Maria" }),
}));
vi.mock("@/lib/campaigns/circuit-breaker", () => ({
  recordCampaignSendFailure: vi.fn().mockResolvedValue({ tripped: false, count: 1 }),
  recordCampaignSendSuccess: vi.fn(),
  isCircuitBreakerTripped: vi.fn().mockResolvedValue(false),
}));

import { POST } from "@/app/api/cron/send-campaign-messages/route";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { recordCampaignSendFailure, recordCampaignSendSuccess, isCircuitBreakerTripped } from "@/lib/campaigns/circuit-breaker";

const dbMock = db as any;
const sendMock = vi.mocked(sendWhatsAppMessage);

function makeRequest() {
  return new Request("http://localhost", { method: "POST", headers: { "x-cron-secret": "test-secret" } }) as any;
}

describe("POST /api/cron/send-campaign-messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    dbMock.campaignRecipient.findFirst.mockResolvedValue(null);
    dbMock.campaign.updateMany.mockResolvedValue({ count: 0 });
    dbMock.campaign.findMany.mockResolvedValue([]);
  });

  it("401 sem o segredo correto", async () => {
    const res = await POST(new Request("http://localhost", { method: "POST" }) as any);
    expect(res.status).toBe(401);
  });

  it("promove campanhas SCHEDULED vencidas pra RUNNING", async () => {
    await POST(makeRequest());
    expect(dbMock.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "SCHEDULED" }), data: { status: "RUNNING" } }),
    );
  });

  it("não processa nada se algum destinatário já está PROCESSING (guarda contra tick sobreposto)", async () => {
    dbMock.campaignRecipient.findFirst.mockImplementation(({ where }: any) =>
      where.status === "PROCESSING" ? Promise.resolve({ id: "stuck" }) : Promise.resolve(null),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("não processa nada se o circuit breaker já disparou", async () => {
    vi.mocked(isCircuitBreakerTripped).mockResolvedValueOnce(true);

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("envia com sucesso: marca SENT, grava sentAt/providerMessageId, zera contador de falhas", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null) // guarda PROCESSING
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1" }); // próximo PENDING
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });
    dbMock.user.findUnique.mockResolvedValueOnce({ phone: null }); // não usado neste teste, evita quebra se código consultar
    dbMock.campaignRecipient.update.mockResolvedValueOnce({});
    dbMock.athleteProfile ??= {};
    dbMock.campaignRecipient.findFirst.mockImplementation; // no-op guard against accidental overwrite above
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PROCESSING" }),
      }),
    );
    expect(sendMock).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("RODAPE"), "CAMPAIGN_MESSAGE");
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "SENT", providerMessageId: "wamid.1" }),
      }),
    );
    expect(recordCampaignSendSuccess).toHaveBeenCalled();
  });

  it("falha com attempts < 3: volta pra PENDING, incrementa attempts e o contador de falhas", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0 });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha de rede"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "PENDING", attempts: 1 }) }),
    );
    expect(recordCampaignSendFailure).toHaveBeenCalled();
  });

  it("3ª falha: marca FAILED com failureReason", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 2 });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha de novo"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "FAILED", attempts: 3 }) }),
    );
  });

  it("5ª falha consecutiva pausa TODAS as campanhas RUNNING", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0 });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha"));
    vi.mocked(recordCampaignSendFailure).mockResolvedValueOnce({ tripped: true, count: 5 });

    await POST(makeRequest());

    expect(dbMock.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "RUNNING" }, data: { status: "PAUSED" } }),
    );
  });

  it("re-checa receivePromotionalMessages no momento do envio — revogado vira OPTED_OUT sem enviar", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1" });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: false });

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "OPTED_OUT" }) }),
    );
  });

  it("campanha sem mais PENDING vira COMPLETED", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    dbMock.campaign.findMany.mockResolvedValueOnce([{ id: "campaign-1" }]);
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    await POST(makeRequest());

    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "COMPLETED" } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cron-send-campaign-messages-route.test.ts`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement `app/api/cron/send-campaign-messages/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendWhatsAppMessage, buildPreferencesFooterText } from "@/lib/whatsapp";
import { renderTemplate } from "@/lib/templates/render";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";
import {
  recordCampaignSendFailure,
  recordCampaignSendSuccess,
  isCircuitBreakerTripped,
} from "@/lib/campaigns/circuit-breaker";

const MAX_ATTEMPTS = 3;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // 1. Promove campanhas agendadas cujo horário já passou.
  await db.campaign.updateMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    data: { status: "RUNNING" },
  });

  // 2. Guarda contra tick sobreposto — não é uma trava distribuída (Fase F cuida disso), só evita
  // duplo-processamento óbvio dentro de UM container.
  const stuck = await db.campaignRecipient.findFirst({ where: { status: "PROCESSING" } });
  if (stuck) {
    return NextResponse.json({ processed: false, reason: "processing_in_progress" });
  }

  // 3. Circuit breaker já disparado — não processa nada.
  if (await isCircuitBreakerTripped()) {
    return NextResponse.json({ processed: false, reason: "circuit_breaker_tripped" });
  }

  // 4. Escolhe o próximo destinatário: campanha RUNNING mais antiga com algo PENDING, dentro dela
  // o CampaignRecipient PENDING mais antigo.
  const recipient = await db.campaignRecipient.findFirst({
    where: { status: "PENDING", campaign: { status: "RUNNING" } },
    orderBy: [{ campaign: { createdAt: "asc" } }, { createdAt: "asc" }],
  });

  if (!recipient) {
    // Nenhum PENDING em nenhuma campanha RUNNING — completa as que não têm mais nada pendente.
    const runningCampaigns = await db.campaign.findMany({ where: { status: "RUNNING" }, select: { id: true } });
    for (const c of runningCampaigns) {
      const remaining = await db.campaignRecipient.count({ where: { campaignId: c.id, status: "PENDING" } });
      if (remaining === 0) {
        await db.campaign.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
      }
    }
    return NextResponse.json({ processed: false, reason: "nothing_pending" });
  }

  await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "PROCESSING" } });

  // 5. Re-checa consentimento AGORA — uma campanha longa dá tempo de sobra pro atleta mudar de
  // ideia em /preferencias depois que a Fase B já preparou a lista.
  const athlete = await db.user.findUnique({
    where: { id: recipient.athleteUserId },
    select: { receivePromotionalMessages: true, athleteProfile: { select: { phone: true } } },
  });

  if (!athlete?.receivePromotionalMessages) {
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "OPTED_OUT" } });
    return NextResponse.json({ processed: true, result: "opted_out" });
  }

  const campaign = await db.campaign.findFirst({ where: { id: recipient.campaignId } });
  if (!campaign) {
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", failureReason: "Campanha não encontrada" } });
    return NextResponse.json({ processed: true, result: "campaign_not_found" });
  }

  const values = await resolveCampaignRecipientVariables({
    athleteUserId: recipient.athleteUserId,
    registrationId: recipient.registrationId,
  });
  const body = renderTemplate(campaign.messageBody, values, "WHATSAPP") + buildPreferencesFooterText();

  try {
    const { providerMessageId } = await sendWhatsAppMessage(recipient.normalizedPhone, body, "CAMPAIGN_MESSAGE");
    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId },
    });
    await recordCampaignSendSuccess();
    return NextResponse.json({ processed: true, result: "sent" });
  } catch (err) {
    const attempts = (recipient.attempts ?? 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await db.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: failed ? "FAILED" : "PENDING",
        attempts,
        failureReason: err instanceof Error ? err.message : String(err),
      },
    });

    const { tripped } = await recordCampaignSendFailure();
    if (tripped) {
      await db.campaign.updateMany({ where: { status: "RUNNING" }, data: { status: "PAUSED" } });
    }

    return NextResponse.json({ processed: true, result: failed ? "failed" : "retry_scheduled" });
  }
}
```

- [ ] **Step 4: Run to verify everything passes**

Run: `npx vitest run tests/cron-send-campaign-messages-route.test.ts`
Expected: all PASS. (If a test's mock chaining needs adjustment to match the exact call order the
implementation above makes, fix the TEST to match the real call sequence — don't change the
implementation's logic to fit a mock that assumed a different order without first confirming which
one is actually correct per this task's Global Constraints.)

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/send-campaign-messages tests/cron-send-campaign-messages-route.test.ts
git commit -m "feat: worker de envio real de campanhas (cron, 1 destinatario por execucao)"
```

---

### Task 6: Rotas de agendar/disparar campanha

**Files:**
- Create: `app/api/events/[id]/campaigns/[campaignId]/schedule/route.ts`
- Create: `app/api/admin/campaigns/[campaignId]/schedule/route.ts`
- Test: append to `tests/events-campaigns-compose-route.test.ts` and
  `tests/admin-campaigns-compose-route.test.ts`

**Interfaces:**
- Consumes: `resolveCampaignDetailContext` (existing, `lib/campaigns/service.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/events-campaigns-compose-route.test.ts`:

```ts
import { POST as SCHEDULE } from "@/app/api/events/[id]/campaigns/[campaignId]/schedule/route";

describe("POST /api/events/[id]/campaigns/[campaignId]/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "organizer-profile-1", campaignsEnabled: true });
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", eventId: "event-1", status: "DRAFT" });
  });

  it("400 quando a campanha não tem destinatários preparados", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: "{}" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
  });

  it("sem scheduledAt: vira RUNNING agora", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    dbMock.campaign.update.mockResolvedValueOnce({ id: "campaign-1", status: "RUNNING" });

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: "{}" }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "RUNNING", scheduledAt: null } });
  });

  it("com scheduledAt no futuro: vira SCHEDULED", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    const future = new Date(Date.now() + 3600_000).toISOString();
    dbMock.campaign.update.mockResolvedValueOnce({ id: "campaign-1", status: "SCHEDULED" });

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ scheduledAt: future }) }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "SCHEDULED", scheduledAt: new Date(future) } });
  });

  it("400 com scheduledAt no passado", async () => {
    dbMock.campaignRecipient.count.mockResolvedValueOnce(5);
    const past = new Date(Date.now() - 3600_000).toISOString();

    const res = await SCHEDULE(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ scheduledAt: past }) }) as any,
      { params: Promise.resolve({ id: "event-1", campaignId: "campaign-1" }) },
    );

    expect(res.status).toBe(400);
  });
});
```

Append the equivalent 4 tests to `tests/admin-campaigns-compose-route.test.ts` (import
`POST as SCHEDULE` from `@/app/api/admin/campaigns/[campaignId]/schedule/route`, ADMIN role, no
`id`/event param — mirror the existing admin describe blocks' style in that file).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts`
Expected: the new tests FAIL (routes don't exist yet); pre-existing tests in both files still PASS.

- [ ] **Step 3: Implement `app/api/events/[id]/campaigns/[campaignId]/schedule/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";
import { z } from "zod";

const scheduleSchema = z.object({ scheduledAt: z.string().datetime().optional() });

export async function POST(
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
    return NextResponse.json({ error: "Só é possível agendar/disparar campanhas em rascunho" }, { status: 400 });
  }

  const recipientCount = await db.campaignRecipient.count({ where: { campaignId } });
  if (recipientCount === 0) {
    return NextResponse.json({ error: "Prepare os destinatários antes de agendar ou disparar" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.scheduledAt) {
    const scheduledAt = new Date(parsed.data.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "A data de agendamento precisa ser no futuro" }, { status: 400 });
    }
    const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "SCHEDULED", scheduledAt } });
    return NextResponse.json({ campaign: updated });
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING", scheduledAt: null } });
  return NextResponse.json({ campaign: updated });
}
```

- [ ] **Step 4: Implement `app/api/admin/campaigns/[campaignId]/schedule/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { resolveCampaignDetailContext } from "@/lib/campaigns/service";
import { db } from "@/lib/db";
import { z } from "zod";

const scheduleSchema = z.object({ scheduledAt: z.string().datetime().optional() });

export async function POST(
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
    return NextResponse.json({ error: "Só é possível agendar/disparar campanhas em rascunho" }, { status: 400 });
  }

  const recipientCount = await db.campaignRecipient.count({ where: { campaignId } });
  if (recipientCount === 0) {
    return NextResponse.json({ error: "Prepare os destinatários antes de agendar ou disparar" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.scheduledAt) {
    const scheduledAt = new Date(parsed.data.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "A data de agendamento precisa ser no futuro" }, { status: 400 });
    }
    const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "SCHEDULED", scheduledAt } });
    return NextResponse.json({ campaign: updated });
  }

  const updated = await db.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING", scheduledAt: null } });
  return NextResponse.json({ campaign: updated });
}
```

- [ ] **Step 5: Run to verify everything passes**

Run: `npx vitest run tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts`
Expected: all PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add "app/api/events/[id]/campaigns/[campaignId]/schedule" "app/api/admin/campaigns/[campaignId]/schedule" tests/events-campaigns-compose-route.test.ts tests/admin-campaigns-compose-route.test.ts
git commit -m "feat: rotas de agendar/disparar campanha"
```

---

### Task 7: UI — botões "Agendar envio" / "Disparar agora"

**Files:**
- Modify: `components/campaigns/CampaignsManager.tsx`

**Interfaces:**
- Consumes: `POST {apiBase}/{campaignId}/schedule` (Task 6).

**Before editing, read the current full content of `components/campaigns/CampaignsManager.tsx`
yourself** — this file was extended twice already (Fase B, Fase C); treat this brief as a
description of the change, not a guaranteed byte-for-byte starting point. If the live file's
structure meaningfully differs from what's described below, stop and report NEEDS_CONTEXT.

No automated test for this task (project convention — no UI component tests).

- [ ] **Step 1: Add state for the scheduling UI**

Add near the other edit-modal-related state:

```tsx
  const [schedulingLoading, setSchedulingLoading] = useState(false);
  const [scheduledAtInput, setScheduledAtInput] = useState("");
```

- [ ] **Step 2: Add the handler**

```tsx
  async function doSchedule(sendNow: boolean) {
    if (!editId) return;
    setSchedulingLoading(true);
    setActionError(null);
    const res = await fetch(`${apiBase}/${editId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendNow ? {} : { scheduledAt: new Date(scheduledAtInput).toISOString() }),
    });
    setSchedulingLoading(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(typeof data.error === "string" ? data.error : "Erro ao agendar/disparar campanha");
      return;
    }
    setEditId(null);
    await reload();
  }
```

- [ ] **Step 3: Add the UI controls to the edit modal**

Right after the Visualizar/Enviar teste button row (added in Fase C), add:

```tsx
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
              <input
                type="datetime-local"
                value={scheduledAtInput}
                onChange={(e) => setScheduledAtInput(e.target.value)}
                className="input text-sm"
              />
              <button
                type="button"
                onClick={() => void doSchedule(false)}
                disabled={schedulingLoading || !scheduledAtInput}
                className="btn-secondary text-sm px-3 disabled:opacity-50"
              >
                Agendar envio
              </button>
              <button
                type="button"
                onClick={() => void doSchedule(true)}
                disabled={schedulingLoading}
                className="text-sm px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
              >
                {schedulingLoading ? "Enviando..." : "Disparar agora"}
              </button>
            </div>
```

(`datetime-local` inputs are interpreted by the browser in the user's local time; this project's
target audience operates in `America/Sao_Paulo`, consistent with the rest of the app's date
handling — no explicit timezone conversion needed here since `new Date(scheduledAtInput)` already
parses it as local time in the browser.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Full suite**

Run: `npx vitest run`
Expected: no regressions anywhere in the project.

- [ ] **Step 6: Commit**

```bash
git add components/campaigns/CampaignsManager.tsx
git commit -m "feat: UI de agendar/disparar campanha"
```

---

## Final check (after all 7 tasks)

- [ ] Run the full suite once more: `npx vitest run`
- [ ] Run `npx tsc --noEmit`
- [ ] Deploy note: 1 new migration this phase
  (`prisma/migrations/20260822020000_add_campaign_recipient_send_fields`) — additive only (3
  nullable/defaulted columns), no data loss expected via `prisma db push`.
- [ ] **New crontab entry needed on the VPS**: `POST /api/cron/send-campaign-messages` with header
  `x-cron-secret: $CRON_SECRET`, recommended every 1 minute — mirror the existing
  `expire-payments`/`abandoned-carts` cron entries' exact `curl` invocation style already in
  `cron-jobs.sh`/the VPS crontab. Do not deploy or add the crontab entry without explicit user
  authorization — a live cron means real WhatsApp messages will actually go out.
- [ ] Manual verification recommended once there's DB/WhatsApp access: schedule a small test
  campaign (a handful of recipients, ideally your own test accounts), confirm messages actually
  arrive with real (not sample) variable values and the opt-out footer, confirm a deliberately
  broken phone/instance triggers the retry→FAILED path, confirm 5 induced failures in a row pause
  every RUNNING campaign.
- [ ] This is Fase D of 6 for "Campanhas de WhatsApp em massa" — delivery-status webhook handling
  and aggregated metrics (Fase E), and manual pause/resume + real multi-instance concurrency safety
  (Fase F), still don't exist. Next: Fase E.
