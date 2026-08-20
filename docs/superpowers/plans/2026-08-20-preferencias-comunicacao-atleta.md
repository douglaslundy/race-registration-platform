# Preferências de Comunicação do Atleta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every athlete/buyer two independent, immediately-effective preferences —
`receivePromotionalMessages` and `receiveEventMessages` (both default `true`) — that gate every
existing e-mail/WhatsApp send to `BUYER`/`ATHLETE` recipients, reachable via a `/preferencias` page
linked from a WhatsApp footer, including a real login redirect fix so the link works when the user
isn't authenticated yet.

**Architecture:** Two new `Boolean @default(true)` columns on `User`. No new query paths — the 3
existing alert files (`lib/notifications.ts`, `lib/alerts/abandoned-cart.ts`,
`lib/alerts/payment-error.ts`) add `receiveEventMessages` to their existing `buyer`/`athlete`
Prisma `select`s and gate their existing send guards on it (fresh read every execution, so the
"revalidate right before sending" requirement is automatic). `sendWhatsAppMessage` gains an
`appendPreferencesFooter` option that appends a static, tokenless `/preferencias` link. A new
dedicated top-level page reads/writes the two booleans through an extended
`PATCH /api/me/preferences`. `LoginForm` starts honoring (and validating) `callbackUrl`.

**Tech Stack:** Next.js (App Router) + Prisma/Postgres + Vitest. No queue/Redis in this project —
irrelevant here since this sub-project has no async processing.

**Spec:** `docs/superpowers/specs/2026-08-20-preferencias-comunicacao-atleta-design.md`

## Global Constraints

- Both preference fields default `true` and live on `User` (not `AthleteProfile`).
- They gate **both** e-mail and WhatsApp, as one preference per message type — never split by channel.
- The WhatsApp opt-out footer text is centralized in code (one function), never pasted into
  message templates, and appears **only** on WhatsApp (not e-mail) sends of the 6 gated alertKeys.
- The footer link is a **static** `/preferencias` URL — no token, no user id, no PII in the URL.
- The guard must be a **fresh read every send**, never a cached/snapshotted value from when a
  message was queued.
- Treat the preference as **blocked only when explicitly `false`** (`=== false`), never
  `!value` — real DB rows always have the boolean (`NOT NULL DEFAULT true`), but this keeps every
  existing test fixture that doesn't set the field passing without modification.
- No native `alert()`/`confirm()`/`prompt()` — this plan doesn't need any (inline error text only,
  per `CLAUDE.md`).
- No UI component tests (project convention) — only pure functions/API routes get automated tests
  for the UI-adjacent pieces (`isSafeRedirectPath`, `PATCH /api/me/preferences`).

---

### Task 1: Schema — `User.receivePromotionalMessages` / `User.receiveEventMessages`

**Files:**
- Modify: `prisma/schema.prisma:103-141` (`model User`)
- Create: `prisma/migrations/20260820000000_add_user_communication_preferences/migration.sql`

**Interfaces:**
- Produces: `User.receivePromotionalMessages: boolean`, `User.receiveEventMessages: boolean` (both
  `@default(true)`), used by every later task.

- [ ] **Step 1: Add the two fields to the Prisma schema**

In `prisma/schema.prisma`, inside `model User`, right after the existing `dailySummaryWhatsappEnabled`
line (currently line 114) and before `uiDensity` (currently line 115), add:

```prisma
  receivePromotionalMessages  Boolean   @default(true)
  receiveEventMessages        Boolean   @default(true)
```

- [ ] **Step 2: Write the migration by hand**

Create `prisma/migrations/20260820000000_add_user_communication_preferences/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "receivePromotionalMessages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receiveEventMessages" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: succeeds without needing a live DB connection (reads only `schema.prisma`); the
generated client now has `receivePromotionalMessages`/`receiveEventMessages` on `User`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (nothing references the new fields yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260820000000_add_user_communication_preferences
git commit -m "feat: adiciona receivePromotionalMessages/receiveEventMessages em User"
```

---

### Task 2: `sendWhatsAppMessage` — opção `appendPreferencesFooter`

**Files:**
- Modify: `lib/whatsapp.ts:1-67`
- Test: `tests/whatsapp.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `sendWhatsAppMessage(phone, text, messageType?, options?)` where `options` now also
  accepts `appendPreferencesFooter?: boolean`. Used by Tasks 6/7/8.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("sendWhatsAppMessage", ...)` in `tests/whatsapp.test.ts` (after the last
`it(...)` in that block, before its closing `});`):

```ts
  it("quando appendPreferencesFooter é true, acrescenta o rodapé de preferências ao texto enviado e ao log", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ providerMessageId: "wamid.abc" });
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const expectedText =
      `Sua inscrição foi confirmada!\n\nPara alterar ou cancelar o recebimento de mensagens, acesse suas preferências de comunicação: ${baseUrl}/preferencias`;

    await sendWhatsAppMessage("5511999999999", "Sua inscrição foi confirmada!", "ORDER_CONFIRMED", {
      appendPreferencesFooter: true,
    });

    expect(sendTextMessage).toHaveBeenCalledWith(config, "5511999999999", expectedText);
    expect(recordMessageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expectedText.length > 80 ? `${expectedText.slice(0, 77)}...` : expectedText,
      }),
    );
  });

  it("sem appendPreferencesFooter (ausente ou false), não altera o texto enviado", async () => {
    const config = { apiUrl: "https://evo.example.com", apiKey: "key", instanceName: "corridas-app" };
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ providerMessageId: "wamid.abc" });

    await sendWhatsAppMessage("5511999999999", "Olá!", "TEST", { appendPreferencesFooter: false });

    expect(sendTextMessage).toHaveBeenCalledWith(config, "5511999999999", "Olá!");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: the 2 new tests FAIL (`appendPreferencesFooter` doesn't exist yet — text sent is
unchanged from input).

- [ ] **Step 3: Implement**

In `lib/whatsapp.ts`, add a helper right after `truncateForSubject` (currently lines 5-7):

```ts
function buildPreferencesFooterText(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `\n\nPara alterar ou cancelar o recebimento de mensagens, acesse suas preferências de comunicação: ${baseUrl}/preferencias`;
}
```

Replace the `sendWhatsAppMessage` function (currently lines 25-67) with:

```ts
/** Envia uma mensagem de WhatsApp usando a configuração salva (Evolution API). */
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  messageType?: string,
  options?: {
    relatedEntityType?: string;
    relatedEntityId?: string;
    logSubject?: string;
    /** Acrescenta o rodapé de opt-out (link estático pra /preferencias) ao final do texto — usar
     * só nas mensagens de evento/promocionais que respeitam receiveEventMessages/
     * receivePromotionalMessages, nunca em código de verificação ou mensagem de sistema. */
    appendPreferencesFooter?: boolean;
  },
): Promise<void> {
  const config = await getWhatsAppConfig();
  if (!isWhatsAppConfigured(config)) {
    throw new Error("WhatsApp não configurado. Configure em Admin → WhatsApp.");
  }

  const finalText = options?.appendPreferencesFooter ? `${text}${buildPreferencesFooterText()}` : text;
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  const subject = options?.logSubject ?? truncateForSubject(finalText);
  const relatedEntity =
    options?.relatedEntityType && options?.relatedEntityId
      ? { relatedEntityType: options.relatedEntityType, relatedEntityId: options.relatedEntityId }
      : {};

  try {
    const { providerMessageId } = await sendTextMessage(config, normalizedPhone, finalText);
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
}
```

(`sendWhatsAppDocument` below it is unchanged — the footer is only for text messages.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/whatsapp.test.ts`
Expected: all tests PASS, including the 2 new ones and every pre-existing one (none of them pass
`appendPreferencesFooter`, so `finalText === text` for all of them — zero behavior change).

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp.ts tests/whatsapp.test.ts
git commit -m "feat: sendWhatsAppMessage ganha opcao appendPreferencesFooter"
```

---

### Task 3: Redirect seguro pós-login (`callbackUrl`)

**Files:**
- Create: `lib/auth/safe-redirect.ts`
- Test: `tests/safe-redirect.test.ts`
- Modify: `components/auth/LoginForm.tsx`

**Interfaces:**
- Produces: `isSafeRedirectPath(path: string | null | undefined): path is string`. Used by
  `LoginForm.tsx` in this task; the `/preferencias` page (Task 5) relies on this fix being in place
  for its own login redirect to actually return the user to `/preferencias`.

- [ ] **Step 1: Write the failing test**

Create `tests/safe-redirect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSafeRedirectPath } from "@/lib/auth/safe-redirect";

describe("isSafeRedirectPath", () => {
  it("aceita paths relativos simples", () => {
    expect(isSafeRedirectPath("/dashboard")).toBe(true);
    expect(isSafeRedirectPath("/preferencias")).toBe(true);
    expect(isSafeRedirectPath("/inscricao/corrida-abc")).toBe(true);
  });

  it("rejeita ausente/vazio", () => {
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
    expect(isSafeRedirectPath("")).toBe(false);
  });

  it("rejeita protocol-relative (//host)", () => {
    expect(isSafeRedirectPath("//evil.com")).toBe(false);
  });

  it("rejeita URL absoluta com outro host", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
    expect(isSafeRedirectPath("http://evil.com/dashboard")).toBe(false);
  });

  it("rejeita esquema javascript:", () => {
    expect(isSafeRedirectPath("javascript:alert(1)")).toBe(false);
  });

  it("rejeita path que não começa com barra", () => {
    expect(isSafeRedirectPath("dashboard")).toBe(false);
  });

  it("rejeita tentativa de host via barra invertida (/\\\\host)", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/safe-redirect.test.ts`
Expected: FAIL — `lib/auth/safe-redirect.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/auth/safe-redirect.ts`:

```ts
/** Verifica se um caminho de destino pós-login é seguro para redirecionar via router.push: precisa
 * ser um path relativo começando com uma única barra, nunca um protocolo, host externo, ou o
 * truque "//host"/"/\host" que alguns navegadores tratam como protocol-relative. Proteção contra
 * open redirect no fluxo de callbackUrl (login → volta pra página de origem). */
export function isSafeRedirectPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.startsWith("/\\")) return false;
  if (path.includes("://")) return false;
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/safe-redirect.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `LoginForm.tsx`**

In `components/auth/LoginForm.tsx`:

Change the import line `import { useRouter } from "next/navigation";` (line 7) to:

```tsx
import { useRouter, useSearchParams } from "next/navigation";
```

Add an import below the existing imports:

```tsx
import { isSafeRedirectPath } from "@/lib/auth/safe-redirect";
```

Inside the component, add right after `const router = useRouter();` (line 19):

```tsx
  const searchParams = useSearchParams();
```

Replace the body of `onSubmit` (currently lines 27-36):

```tsx
  async function onSubmit(data: FormData) {
    setError(null);
    const res = await signIn("credentials", { ...data, redirect: false });
    if (res?.error) {
      setError("E-mail ou senha incorretos");
      return;
    }
    const callbackUrl = searchParams.get("callbackUrl");
    router.push(isSafeRedirectPath(callbackUrl) ? callbackUrl : "/dashboard");
    router.refresh();
  }
```

No automated test for this wiring (project convention — no UI component tests; the pure logic is
already covered by Step 1-4 above). Manual verification: log out, visit
`/inscricao/<slug-de-um-evento>` while logged out, confirm it lands on `/auth/login?callbackUrl=...`,
log in, and confirm it returns to the registration page instead of `/dashboard` (this was broken
before this task).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/safe-redirect.ts tests/safe-redirect.test.ts components/auth/LoginForm.tsx
git commit -m "fix: LoginForm honra callbackUrl com protecao contra open redirect"
```

---

### Task 4: `PATCH /api/me/preferences` — aceitar os 2 campos novos

**Files:**
- Modify: `app/api/me/preferences/route.ts`
- Test: `tests/me-preferences-route.test.ts` (new)

**Interfaces:**
- Consumes: `User.receivePromotionalMessages`/`receiveEventMessages` (Task 1).
- Produces: `PATCH /api/me/preferences` body may now include `receivePromotionalMessages` and/or
  `receiveEventMessages` (booleans), in addition to (or instead of) `uiDensity`. Used by Task 5's
  form.

- [ ] **Step 1: Write the failing tests**

Create `tests/me-preferences-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PATCH } from "@/app/api/me/preferences/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const dbMock = db as any;
const authMock = vi.mocked(auth);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/me/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/me/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ATHLETE" } } as any);
  });

  it("retorna 403 quando não autenticado", async () => {
    authMock.mockResolvedValueOnce(null);

    const res = await PATCH(makeRequest({ uiDensity: "compact" }));

    expect(res.status).toBe(403);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("atualiza só uiDensity quando é o único campo enviado (comportamento existente preservado)", async () => {
    const res = await PATCH(makeRequest({ uiDensity: "compact" }));

    expect(res.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { uiDensity: "compact" },
    });
  });

  it("atualiza receiveEventMessages isoladamente", async () => {
    const res = await PATCH(makeRequest({ receiveEventMessages: false }));

    expect(res.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { receiveEventMessages: false },
    });
  });

  it("atualiza receivePromotionalMessages isoladamente", async () => {
    const res = await PATCH(makeRequest({ receivePromotionalMessages: false }));

    expect(res.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { receivePromotionalMessages: false },
    });
  });

  it("aceita os três campos juntos", async () => {
    const res = await PATCH(
      makeRequest({ uiDensity: "compact", receiveEventMessages: true, receivePromotionalMessages: false }),
    );

    expect(res.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { uiDensity: "compact", receiveEventMessages: true, receivePromotionalMessages: false },
    });
  });

  it("retorna 400 quando nenhum campo é enviado", async () => {
    const res = await PATCH(makeRequest({}));

    expect(res.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("retorna 400 quando um campo não é do tipo esperado", async () => {
    const res = await PATCH(makeRequest({ receiveEventMessages: "sim" }));

    expect(res.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/me-preferences-route.test.ts`
Expected: several FAIL — the route today requires `uiDensity` and ignores/rejects the new fields.

- [ ] **Step 3: Implement**

Replace `app/api/me/preferences/route.ts` entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z
  .object({
    uiDensity: z.enum(["comfortable", "compact"]).optional(),
    receivePromotionalMessages: z.boolean().optional(),
    receiveEventMessages: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Nenhum campo informado" });

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await db.user.update({
      where: { id: session.user.id },
      data: {
        ...(parsed.data.uiDensity !== undefined ? { uiDensity: parsed.data.uiDensity } : {}),
        ...(parsed.data.receivePromotionalMessages !== undefined
          ? { receivePromotionalMessages: parsed.data.receivePromotionalMessages }
          : {}),
        ...(parsed.data.receiveEventMessages !== undefined
          ? { receiveEventMessages: parsed.data.receiveEventMessages }
          : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[me/preferences] update error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/me-preferences-route.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/me/preferences/route.ts tests/me-preferences-route.test.ts
git commit -m "feat: PATCH /api/me/preferences aceita receivePromotionalMessages/receiveEventMessages"
```

---

### Task 5: Página `/preferencias`

**Files:**
- Create: `app/preferencias/page.tsx`
- Create: `app/preferencias/PreferenciasForm.tsx`

**Interfaces:**
- Consumes: `PATCH /api/me/preferences` (Task 4), `isSafeRedirectPath`/`LoginForm` fix (Task 3) for
  the unauthenticated round-trip.
- Produces: nothing consumed by later tasks — this is the last piece of the user-facing surface.

- [ ] **Step 1: Create the server page**

Create `app/preferencias/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import PreferenciasForm from "./PreferenciasForm";

export default async function PreferenciasPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login?callbackUrl=/preferencias");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { receivePromotionalMessages: true, receiveEventMessages: true },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-lg">
        <div className="card space-y-4">
          <h1 className="text-xl font-bold">Preferências de comunicação</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Escolha quais mensagens você quer receber por e-mail e WhatsApp. A alteração vale
            imediatamente.
          </p>
          <PreferenciasForm
            initialReceiveEventMessages={user?.receiveEventMessages ?? true}
            initialReceivePromotionalMessages={user?.receivePromotionalMessages ?? true}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the client form**

Create `app/preferencias/PreferenciasForm.tsx`:

```tsx
"use client";

import { useState } from "react";

type Field = "receiveEventMessages" | "receivePromotionalMessages";

export default function PreferenciasForm({
  initialReceiveEventMessages,
  initialReceivePromotionalMessages,
}: {
  initialReceiveEventMessages: boolean;
  initialReceivePromotionalMessages: boolean;
}) {
  const [receiveEventMessages, setReceiveEventMessages] = useState(initialReceiveEventMessages);
  const [receivePromotionalMessages, setReceivePromotionalMessages] = useState(
    initialReceivePromotionalMessages,
  );
  const [savingField, setSavingField] = useState<Field | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(field: Field, value: boolean) {
    setError(null);
    setSavingField(field);
    const res = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });

    if (!res.ok) {
      setError("Não foi possível salvar. Tente novamente.");
      if (field === "receiveEventMessages") setReceiveEventMessages(!value);
      else setReceivePromotionalMessages(!value);
    }
    setSavingField(null);
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={receiveEventMessages}
          disabled={savingField === "receiveEventMessages"}
          onChange={(e) => {
            setReceiveEventMessages(e.target.checked);
            save("receiveEventMessages", e.target.checked);
          }}
          className="mt-1"
        />
        <span>
          <span className="block font-medium text-gray-900 dark:text-gray-100">
            Mensagens sobre minhas inscrições e eventos
          </span>
          <span className="block text-sm text-gray-600 dark:text-gray-400">
            Confirmação de inscrição, pagamento pendente/confirmado e outros avisos operacionais.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={receivePromotionalMessages}
          disabled={savingField === "receivePromotionalMessages"}
          onChange={(e) => {
            setReceivePromotionalMessages(e.target.checked);
            save("receivePromotionalMessages", e.target.checked);
          }}
          className="mt-1"
        />
        <span>
          <span className="block font-medium text-gray-900 dark:text-gray-100">
            Mensagens promocionais
          </span>
          <span className="block text-sm text-gray-600 dark:text-gray-400">
            Campanhas e novidades enviadas pelos organizadores.
          </span>
        </span>
      </label>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
```

No automated test (project convention: no UI component tests). Manual verification: load
`/preferencias` logged in, toggle each checkbox independently, reload the page and confirm the
state persisted; log out and hit the same URL to confirm the login round-trip (Task 3) lands back
on `/preferencias`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/preferencias
git commit -m "feat: pagina /preferencias de comunicacao do atleta"
```

---

### Task 6: Guard + rodapé em `lib/notifications.ts` (ORDER_CONFIRMED + 2 variantes)

**Files:**
- Modify: `lib/notifications.ts`
- Test: `tests/notifications.test.ts`

**Interfaces:**
- Consumes: `User.receiveEventMessages` (Task 1), `sendWhatsAppMessage(..., { appendPreferencesFooter })` (Task 2).

- [ ] **Step 1: Update existing exact-match test assertions (they will need the new option)**

In `tests/notifications.test.ts`, the following 5 `sendWhatsAppMessage` assertions currently check
an exact 4th-argument object literal without `appendPreferencesFooter` — add
`appendPreferencesFooter: true` as the first key of each of these 5 objects (do not change any
other part of these tests):

1. In the test `"envia WhatsApp quando há conexão ativa e a inscrição tem telefone"`:
```ts
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      expect.stringContaining("Corrida Teste"),
      "ORDER_CONFIRMED",
      { appendPreferencesFooter: true, relatedEntityType: "Event", relatedEntityId: "event-1" },
    );
```

2. In `"comprador confirmando a própria inscrição (ORDER_CONFIRMED/BUYER)"`:
```ts
      expect(sendWhatsAppMessage).toHaveBeenCalledWith(
        "5511999999999",
        `Sua inscrição em Corrida Teste foi confirmada! Pedido order-1. Detalhes: ${detailsUrl}`,
        "ORDER_CONFIRMED",
        { appendPreferencesFooter: true, relatedEntityType: "Event", relatedEntityId: "event-1" },
      );
```

3. In `"comprador que inscreveu outra pessoa por procuração (ORDER_CONFIRMED_PROXY_BUYER/BUYER)"`:
```ts
      expect(sendWhatsAppMessage).toHaveBeenCalledWith(
        "5511777777777",
        `Você inscreveu Nome Digitado Pelo Comprador em Corrida Teste! Pedido order-1. Detalhes: ${detailsUrl}`,
        "ORDER_CONFIRMED_PROXY_BUYER",
        { appendPreferencesFooter: true, relatedEntityType: "Event", relatedEntityId: "event-1" },
      );
```

4. In `"atleta convidado por procuração (ORDER_CONFIRMED_PROXY_ATHLETE/ATHLETE)"`:
```ts
      expect(sendWhatsAppMessage).toHaveBeenCalledWith(
        "5511888888888",
        `Comprador Teste criou uma inscrição pra você em Corrida Teste! Pedido order-1. Detalhes: ${detailsUrl}`,
        "ORDER_CONFIRMED_PROXY_ATHLETE",
        { appendPreferencesFooter: true, relatedEntityType: "Event", relatedEntityId: "event-1" },
      );
```

5. In `"preenche nome_atleta quando um template customizado da procuração usa essa variável..."`:
```ts
      expect(sendWhatsAppMessage).toHaveBeenCalledWith(
        "5511888888888",
        "Oi Nome Digitado Pelo Comprador, Comprador Teste te inscreveu!",
        "ORDER_CONFIRMED_PROXY_ATHLETE",
        { appendPreferencesFooter: true, relatedEntityType: "Event", relatedEntityId: "event-1" },
      );
```

- [ ] **Step 2: Write the new failing tests**

Add these two tests right before the final `});` that closes `describe("notifyOrderConfirmed", ...)`
(i.e. after the last existing `it(...)` in the file):

```ts
  it("não envia e-mail nem WhatsApp pro comprador quando ele desativou receiveEventMessages", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...orderFixture,
      buyer: { ...orderFixture.buyer, receiveEventMessages: false },
    });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("procuração: não envia e-mail nem WhatsApp pro atleta convidado quando ele desativou receiveEventMessages, mas o comprador continua recebendo normalmente", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...proxyOrderFixture,
      registrations: [
        {
          ...proxyOrderFixture.registrations[0],
          athlete: { ...proxyOrderFixture.registrations[0].athlete, receiveEventMessages: false },
        },
      ],
    });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValue("open");

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "comprador@example.com" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511777777777",
      expect.any(String),
      "ORDER_CONFIRMED_PROXY_BUYER",
      expect.anything(),
    );
  });
```

- [ ] **Step 3: Run to verify failures**

Run: `npx vitest run tests/notifications.test.ts`
Expected: the 5 updated assertions FAIL (real call doesn't pass `appendPreferencesFooter` yet) and
the 2 new tests FAIL (guard doesn't exist yet, so email/WhatsApp are sent regardless).

- [ ] **Step 4: Implement — add `receiveEventMessages` to the query select**

In `lib/notifications.ts`, replace the `db.order.findUnique` call (currently lines 96-113) with:

```ts
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        buyerUserId: true,
        buyer: {
          select: {
            name: true,
            email: true,
            receiveEventMessages: true,
            athleteProfile: { select: { phone: true } },
          },
        },
        event: { select: { id: true, title: true } },
        registrations: {
          select: {
            id: true,
            notes: true,
            athleteUserId: true,
            proxyAthleteDisplayName: true,
            athlete: {
              select: {
                name: true,
                email: true,
                receiveEventMessages: true,
                athleteProfile: { select: { phone: true, cpf: true } },
              },
            },
          },
          take: 1,
        },
      },
    });
```

- [ ] **Step 5: Implement — guard the buyer e-mail block**

Change the condition `if (isSmtpReady(cfg)) {` inside the buyer e-mail `try` block (the first
occurrence, guarding `buyerEmailClaimed`) to:

```ts
        if (isSmtpReady(cfg) && order.buyer.receiveEventMessages !== false) {
```

- [ ] **Step 6: Implement — guard the athlete e-mail block**

Change the condition `if (isSmtpReady(cfg)) {` inside the athlete e-mail `try` block (the second
occurrence, guarding `athleteEmailClaimed`, only reached when `isProxyRegistration`) to:

```ts
        if (isSmtpReady(cfg) && registration.athlete.receiveEventMessages !== false) {
```

- [ ] **Step 7: Implement — guard `sendWhatsAppIfActive` and pass the footer option**

Replace the `sendWhatsAppIfActive` function (currently lines 27-78) with:

```ts
async function sendWhatsAppIfActive(
  phone: string | null | undefined,
  alertKey: "ORDER_CONFIRMED" | "ORDER_CONFIRMED_PROXY_BUYER" | "ORDER_CONFIRMED_PROXY_ATHLETE",
  recipientRole: "BUYER" | "ATHLETE",
  recipientReceivesEventMessages: boolean,
  values: Record<string, string | undefined>,
  eventId: string | undefined,
  claimEntityId: string,
  bypassDedupe: boolean,
  resolveSocialPromo: () => Promise<string>,
  kitQrCodeBase64: string,
  kitQrCaption: string,
): Promise<void> {
  if (!phone) return;
  // Revalidado a cada chamada (não é um valor cacheado do momento em que o pedido foi criado): o
  // destinatário pode ter desativado "mensagens de eventos" entre a criação do pedido e este envio.
  if (recipientReceivesEventMessages === false) return;
  let claimed = false;
  try {
    if (!(await isWhatsAppConnectionActive())) return;
    claimed = bypassDedupe ? true : await claimAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");
    if (!claimed) return;
    const template = await getEffectiveTemplate(alertKey, "WHATSAPP", recipientRole, eventId);
    // resolveSocialPromo só é chamada aqui, depois de todas as guardas acima (telefone presente,
    // conexão de WhatsApp ativa, claim de dedupe bem sucedido) — é o ponto em que o envio de fato
    // vai acontecer, então é seguro "gastar" a cota do link social agora.
    const text = renderTemplate(template.body, { ...values, redes_sociais: await resolveSocialPromo() }, "WHATSAPP");
    await sendWhatsAppMessage(phone, text, alertKey, {
      appendPreferencesFooter: true,
      ...(eventId ? { relatedEntityType: "Event", relatedEntityId: eventId } : {}),
    });
    if (bypassDedupe) await recordAlert(ALERT_TYPE, "Order", claimEntityId, "WHATSAPP");

    try {
      await sendWhatsAppDocument(
        phone,
        kitQrCodeBase64,
        "qrcode-retirada-kit.png",
        kitQrCaption,
        eventId
          ? { messageType: alertKey, relatedEntityType: "Event", relatedEntityId: eventId, mediatype: "image" }
          : { messageType: alertKey, mediatype: "image" },
      );
    } catch (err) {
      console.error("[notifyOrderConfirmed] whatsapp kit QR attachment failed:", err);
    }
  } catch (err) {
    // Só desfaz a reivindicação se ESTA chamada realmente a tomou — caso contrário, uma falha
    // antes do claim (ex.: getWhatsAppConfig lançando) apagaria a reivindicação de um envio
    // anterior bem-sucedido, reabrindo a janela de duplicidade que esta trava existe pra fechar.
    if (claimed && !bypassDedupe) await unclaimAlert(ALERT_TYPE, claimEntityId, "WHATSAPP");
    console.error("[notifyOrderConfirmed] whatsapp failed:", err);
  }
}
```

- [ ] **Step 8: Implement — pass the preference at both call sites**

In the buyer call site (currently lines 184-201), add `order.buyer.receiveEventMessages,` right
after the `"BUYER",` argument:

```ts
    await sendWhatsAppIfActive(
      buyerWhatsappPhone,
      buyerWhatsappAlertKey,
      "BUYER",
      order.buyer.receiveEventMessages,
      {
        nome_atleta: registration.proxyAthleteDisplayName ?? registration.athlete.name,
        nome_evento: order.event?.title ?? "",
        codigo_confirmacao: orderId,
        link_evento: detailsUrl,
        patrocinio: sponsorPromo,
      },
      order.event?.id,
      `${orderId}:buyer`,
      bypassDedupe,
      resolveSocialPromo,
      kitQrCodeBase64,
      kitQrCaption,
    );
```

In the athlete call site (currently lines 237-255, only reached when `isProxyRegistration`), add
`registration.athlete.receiveEventMessages,` right after the `"ATHLETE",` argument:

```ts
    await sendWhatsAppIfActive(
      registration.athlete.athleteProfile?.phone,
      "ORDER_CONFIRMED_PROXY_ATHLETE",
      "ATHLETE",
      registration.athlete.receiveEventMessages,
      {
        nome_atleta: registration.proxyAthleteDisplayName ?? registration.athlete.name,
        nome_comprador: order.buyer.name,
        nome_evento: order.event?.title ?? "",
        codigo_confirmacao: orderId,
        link_evento: detailsUrl,
        patrocinio: sponsorPromo,
      },
      order.event?.id,
      `${orderId}:athlete`,
      bypassDedupe,
      resolveSocialPromo,
      kitQrCodeBase64,
      kitQrCaption,
    );
```

- [ ] **Step 9: Run to verify everything passes**

Run: `npx vitest run tests/notifications.test.ts`
Expected: all tests PASS (updated assertions, new blocking tests, and every pre-existing test that
doesn't touch `receiveEventMessages` at all — those fixtures leave it `undefined`, and
`undefined !== false` is `true`, so nothing is blocked for them).

- [ ] **Step 10: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions anywhere else in the suite.

- [ ] **Step 11: Commit**

```bash
git add lib/notifications.ts tests/notifications.test.ts
git commit -m "feat: notifyOrderConfirmed respeita receiveEventMessages e inclui rodape de preferencias"
```

---

### Task 7: Guard + rodapé em `lib/alerts/abandoned-cart.ts`

**Files:**
- Modify: `lib/alerts/abandoned-cart.ts`
- Modify: `app/api/organizer/abandoned-carts/notify/route.ts:8-13` (`ORDER_SELECT`)
- Modify: `app/api/admin/abandoned-carts/notify/route.ts:8-13` (`ORDER_SELECT`)
- Test: `tests/alert-abandoned-cart.test.ts`

**Interfaces:**
- Consumes: `User.receiveEventMessages` (Task 1), `sendWhatsAppMessage(..., { appendPreferencesFooter })` (Task 2).

- [ ] **Step 1: Update existing exact-match test assertions**

In `tests/alert-abandoned-cart.test.ts`, these 2 `sendWhatsAppMessage` assertions currently pass
only 3 arguments — add a 4th argument `{ appendPreferencesFooter: true }`:

1. In `"com o banco sem nenhum template salvo (fallback de fábrica)..."`:
```ts
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Sua inscrição em "Corrida Teste" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
      "ABANDONED_CART",
      { appendPreferencesFooter: true },
    );
```

2. In `"preenche link_finalizar_pagamento também no WhatsApp..."`:
```ts
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Link: ${baseUrl}/dashboard/inscricoes`,
      "ABANDONED_CART",
      { appendPreferencesFooter: true },
    );
```

- [ ] **Step 2: Write the new failing test**

Add inside `describe("checkAbandonedCarts", ...)`, after the last existing `it(...)` and before its
closing `});`:

```ts
  it("não envia e-mail nem WhatsApp quando o comprador desativou receiveEventMessages", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, buyer: { ...orderFixture.buyer, receiveEventMessages: false } },
    ]);

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });
```

- [ ] **Step 3: Run to verify failures**

Run: `npx vitest run tests/alert-abandoned-cart.test.ts`
Expected: the 2 updated assertions FAIL and the new test FAILS.

- [ ] **Step 4: Implement — interface + select + guards + footer**

In `lib/alerts/abandoned-cart.ts`, replace the `AbandonedOrder` interface (currently lines 13-18)
with:

```ts
export interface AbandonedOrder {
  id: string;
  buyerUserId: string;
  event: { id: string; title: string };
  buyer: {
    name: string;
    email: string;
    receiveEventMessages?: boolean;
    athleteProfile: { phone: string | null } | null;
  };
}
```

Inside `sendAbandonedCartAlert`, change `if (settings.emailEnabled) {` (currently line 41) to:

```ts
    if (settings.emailEnabled && order.buyer.receiveEventMessages !== false) {
```

Change `if (settings.whatsappEnabled && order.buyer.athleteProfile?.phone) {` (currently line 62) to:

```ts
    if (settings.whatsappEnabled && order.buyer.receiveEventMessages !== false && order.buyer.athleteProfile?.phone) {
```

Change the `sendWhatsAppMessage` call (currently line 77) to pass the footer option:

```ts
          await sendWhatsAppMessage(order.buyer.athleteProfile.phone, text, "ABANDONED_CART", {
            appendPreferencesFooter: true,
          });
```

In `checkAbandonedCarts`, add `receiveEventMessages: true` to the `buyer` select (currently line
120):

```ts
      buyer: { select: { name: true, email: true, receiveEventMessages: true, athleteProfile: { select: { phone: true } } } },
```

- [ ] **Step 5: Implement — update the two manual-resend routes' selects**

In `app/api/organizer/abandoned-carts/notify/route.ts`, change `ORDER_SELECT` (currently lines
8-13) to:

```ts
const ORDER_SELECT = {
  id: true,
  buyerUserId: true,
  event: { select: { id: true, title: true } },
  buyer: { select: { name: true, email: true, receiveEventMessages: true, athleteProfile: { select: { phone: true } } } },
} as const;
```

Apply the identical change to `ORDER_SELECT` in `app/api/admin/abandoned-carts/notify/route.ts`
(currently lines 8-13) — same replacement.

- [ ] **Step 6: Run to verify everything passes**

Run: `npx vitest run tests/alert-abandoned-cart.test.ts tests/organizer-abandoned-carts-notify-route.test.ts tests/admin-abandoned-carts-notify-route.test.ts`
Expected: all PASS (the 2 route test files assert `select: expect.any(Object)`, so the widened
select doesn't break them).

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions.

- [ ] **Step 8: Commit**

```bash
git add lib/alerts/abandoned-cart.ts app/api/organizer/abandoned-carts/notify/route.ts app/api/admin/abandoned-carts/notify/route.ts tests/alert-abandoned-cart.test.ts
git commit -m "feat: alerta de carrinho abandonado respeita receiveEventMessages e inclui rodape de preferencias"
```

---

### Task 8: Guard + rodapé em `lib/alerts/payment-error.ts`

**Files:**
- Modify: `lib/alerts/payment-error.ts`
- Test: `tests/alert-payment-error.test.ts`

**Interfaces:**
- Consumes: `User.receiveEventMessages` (Task 1), `sendWhatsAppMessage(..., { appendPreferencesFooter })` (Task 2).

- [ ] **Step 1: Update existing exact-match test assertions**

In `tests/alert-payment-error.test.ts`, these 4 `sendWhatsAppMessage` assertions currently pass
only 3 arguments — add a 4th argument `{ appendPreferencesFooter: true }` to each:

1. (around line 187-191):
```ts
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Sua inscrição em "Corrida Teste" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${baseUrl}/eventos/corrida-teste`,
      "PAYMENT_ERROR",
      { appendPreferencesFooter: true },
    );
```

2. (around line 205-209):
```ts
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      "Olá Atleta, sua inscrição em Corrida Teste foi cancelada.",
      "PAYMENT_ERROR",
      { appendPreferencesFooter: true },
    );
```

3. (around line 263-267):
```ts
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      expect.stringContaining("Corrida Teste"),
      "PAYMENT_ERROR_ORDER_CANCELLED",
      { appendPreferencesFooter: true },
    );
```

4. (around line 328-332):
```ts
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Sua inscrição em "Corrida Teste" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${baseUrl}/eventos/corrida-teste`,
      "PAYMENT_ERROR_ORDER_CANCELLED",
      { appendPreferencesFooter: true },
    );
```

- [ ] **Step 2: Write the new failing test**

Add inside `describe("notifyPaymentError", ...)`, after the last existing `it(...)` and before its
closing `});`:

```ts
  it("não envia e-mail nem WhatsApp quando o comprador desativou receiveEventMessages", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true });
    dbMock.payment.findUnique.mockResolvedValueOnce({
      order: {
        ...paymentFixture.order,
        buyer: { ...paymentFixture.order.buyer, receiveEventMessages: false },
      },
    });

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run to verify failures**

Run: `npx vitest run tests/alert-payment-error.test.ts`
Expected: the 4 updated assertions FAIL and the new test FAILS.

- [ ] **Step 4: Implement — interface + guards + footer**

Replace the `CancellationNotificationTarget` interface (currently lines 13-21) with:

```ts
interface CancellationNotificationTarget {
  entityId: string;
  entityType: "Payment" | "Order";
  alertKey: "PAYMENT_ERROR" | "PAYMENT_ERROR_ORDER_CANCELLED";
  buyerUserId: string;
  buyer: {
    name: string;
    email: string;
    receiveEventMessages?: boolean;
    athleteProfile: { phone: string | null } | null;
  };
  event: { id: string; title: string; slug: string };
  bypassDedupe?: boolean;
}
```

Change `if (settings.emailEnabled) {` (currently line 41) to:

```ts
  if (settings.emailEnabled && params.buyer.receiveEventMessages !== false) {
```

Change `if (settings.whatsappEnabled && params.buyer.athleteProfile?.phone) {` (currently line 64) to:

```ts
  if (settings.whatsappEnabled && params.buyer.receiveEventMessages !== false && params.buyer.athleteProfile?.phone) {
```

Change the `sendWhatsAppMessage` call (currently line 75) to:

```ts
        await sendWhatsAppMessage(params.buyer.athleteProfile.phone, text, params.alertKey, {
          appendPreferencesFooter: true,
        });
```

- [ ] **Step 5: Implement — add `receiveEventMessages` to both queries' buyer select**

In `notifyPaymentError`, change the `db.payment.findUnique` select's `buyer` (currently line 100)
to:

```ts
            buyer: { select: { name: true, email: true, receiveEventMessages: true, athleteProfile: { select: { phone: true } } } },
```

In `notifyOrderCancelledWithoutPayment`, change the `db.order.findUnique` select's `buyer`
(currently line 140) to the same:

```ts
        buyer: { select: { name: true, email: true, receiveEventMessages: true, athleteProfile: { select: { phone: true } } } },
```

- [ ] **Step 6: Run to verify everything passes**

Run: `npx vitest run tests/alert-payment-error.test.ts`
Expected: all PASS.

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no regressions anywhere in the project.

- [ ] **Step 8: Commit**

```bash
git add lib/alerts/payment-error.ts tests/alert-payment-error.test.ts
git commit -m "feat: alertas de erro de pagamento respeitam receiveEventMessages e incluem rodape de preferencias"
```

---

## Final check (after all 8 tasks)

- [ ] Run the full suite once more: `npx vitest run`
- [ ] Run `npx tsc --noEmit`
- [ ] Confirm the deploy note: this feature needs a schema migration
  (`prisma/migrations/20260820000000_add_user_communication_preferences`) — on the VPS, apply it
  manually via `psql` (or `prisma migrate deploy`) **before** `prisma db push` in the existing
  4-step deploy sequence, same pattern as every other schema change in this project. Do not deploy
  without explicit user authorization.
