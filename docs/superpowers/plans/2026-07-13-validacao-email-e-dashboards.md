# Validação de e-mail + melhorias de dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject registration emails whose domain has no real MX record (catches typos like
"gmail.coml"); rename the admin home page to "Dashboard" to match the organizer's existing
naming; replace the hand-rolled SVG line chart with Recharts; make both dashboards' date/event
filters lay out inline (justified, wrapping only when the viewport requires it) and stack their
charts one per row instead of a multi-column grid.

**Architecture:** A new standalone `lib/validate-email-domain.ts` module (DNS MX lookup with a
4-second fail-open timeout) wired into the existing registration route. `components/ui/LineChart.tsx`
keeps its exact prop signature (`data`, `color`, `height`) but its internals switch from a plain
SVG polyline to Recharts' `<LineChart>`/`<Line>` — every call site in `app/admin/page.tsx` and
`app/organizador/page.tsx` stays unchanged. Those same two page files also get their filter
`<form>` and chart-container `<div>` restructured (three-group justified layout; vertical stack
instead of a grid).

**Tech Stack:** Next.js App Router, Prisma, Zod, Vitest, Node's built-in `dns` module, Recharts
(new dependency, `^3.9.0`, confirmed React 19-compatible).

## Global Constraints

- MX lookup fail-open: any DNS error other than the domain genuinely not existing
  (`ENOTFOUND`/`ENODATA`), and any timeout (~4s), must let registration proceed — only a
  confirmed non-existent domain blocks it.
- `LineChart`'s public prop signature (`data: {label, value}[]`, `color?`, `height?`) does not
  change — no call site in either dashboard page needs editing for the Recharts swap itself.
- No test files for `app/admin/page.tsx`, `app/organizador/page.tsx`, or `components/ui/LineChart.tsx`
  — matches this project's established convention (no page/presentational-component has a
  dedicated test).
- Layout changes apply identically to both `app/admin/page.tsx` and `app/organizador/page.tsx`
  (user confirmed both, not admin-only).
- No manual browser verification is possible from this environment (no DB access) — say so
  explicitly rather than claiming it.

---

### Task 1: Email domain validation (MX lookup)

**Files:**
- Create: `lib/validate-email-domain.ts`
- Test: `tests/validate-email-domain.test.ts` (new)
- Modify: `app/api/auth/register/route.ts`
- Modify: `tests/register-route.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `hasValidMxRecord(email: string): Promise<boolean>` — consumed only within this task
  (the register route). No other task in this plan touches registration.

- [ ] **Step 1: Write the failing tests for `hasValidMxRecord`**

Create `tests/validate-email-domain.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns";

vi.mock("node:dns", () => ({ default: { resolveMx: vi.fn() } }));

import { hasValidMxRecord } from "@/lib/validate-email-domain";

const resolveMxMock = vi.mocked(dns.resolveMx);

describe("hasValidMxRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna false quando o e-mail não tem domínio", async () => {
    const result = await hasValidMxRecord("sem-arroba");
    expect(result).toBe(false);
    expect(resolveMxMock).not.toHaveBeenCalled();
  });

  it("retorna true quando o domínio tem registro MX", async () => {
    resolveMxMock.mockImplementationOnce((_domain: any, cb: any) => {
      cb(null, [{ exchange: "mx.example.com", priority: 10 }]);
    });

    const result = await hasValidMxRecord("user@example.com");
    expect(result).toBe(true);
  });

  it("retorna false quando o domínio não existe (ENOTFOUND)", async () => {
    resolveMxMock.mockImplementationOnce((_domain: any, cb: any) => {
      const err = Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      cb(err, undefined);
    });

    const result = await hasValidMxRecord("user@gmail.coml");
    expect(result).toBe(false);
  });

  it("retorna false quando o domínio não tem nenhum registro (ENODATA)", async () => {
    resolveMxMock.mockImplementationOnce((_domain: any, cb: any) => {
      const err = Object.assign(new Error("no data"), { code: "ENODATA" });
      cb(err, undefined);
    });

    const result = await hasValidMxRecord("user@example.com");
    expect(result).toBe(false);
  });

  it("deixa passar (true) em qualquer outro erro de DNS", async () => {
    resolveMxMock.mockImplementationOnce((_domain: any, cb: any) => {
      const err = Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
      cb(err, undefined);
    });

    const result = await hasValidMxRecord("user@example.com");
    expect(result).toBe(true);
  });

  it("deixa passar (true) quando a consulta trava além do timeout", async () => {
    vi.useFakeTimers();
    resolveMxMock.mockImplementationOnce(() => {
      // nunca chama o callback -- simula travamento
    });

    const promise = hasValidMxRecord("user@example.com");
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;

    expect(result).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/validate-email-domain.test.ts`

Expected: FAIL — `@/lib/validate-email-domain` doesn't exist yet.

- [ ] **Step 3: Write `lib/validate-email-domain.ts`**

```ts
import dns from "node:dns";

const MX_LOOKUP_TIMEOUT_MS = 4000;

export async function hasValidMxRecord(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  if (!domain) return false;

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(true);
      }
    }, MX_LOOKUP_TIMEOUT_MS);

    dns.resolveMx(domain, (err, addresses) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        resolve(err.code === "ENOTFOUND" || err.code === "ENODATA" ? false : true);
      } else {
        resolve(addresses.length > 0);
      }
    });
  });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/validate-email-domain.test.ts`

Expected: PASS, all 6 tests.

- [ ] **Step 5: Wire into the register route — write the failing test first**

In `tests/register-route.test.ts`, replace the current top of the file:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "hashed-password") },
}));

import { POST } from "@/app/api/auth/register/route";

const dbMock = db as any;
```

with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "hashed-password") },
}));
vi.mock("@/lib/validate-email-domain", () => ({ hasValidMxRecord: vi.fn() }));

import { POST } from "@/app/api/auth/register/route";
import { hasValidMxRecord } from "@/lib/validate-email-domain";

const dbMock = db as any;
```

Then, in the existing `beforeEach(() => { ... })` block, right after `vi.clearAllMocks();`, add:

```ts
    vi.mocked(hasValidMxRecord).mockResolvedValue(true);
```

(This makes every pre-existing test in this file keep passing unchanged — they get a default
`true` and never exercise the new check.)

Then add a new test at the end of the `describe("POST /api/auth/register", ...)` block, right
before its closing `});`:

```ts
  it("rejeita e-mail cujo domínio não tem registro MX", async () => {
    vi.mocked(hasValidMxRecord).mockResolvedValueOnce(false);

    const res = await POST(makeRequest(validAthleteBody));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `npx vitest run tests/register-route.test.ts`

Expected: FAIL on the new test only (the route doesn't call `hasValidMxRecord` yet, so a `false`
mock has no effect and registration still succeeds with 201, not 400).

- [ ] **Step 7: Wire the check into the route**

In `app/api/auth/register/route.ts`, add the import (alongside the existing ones near the top):

```ts
import { isValidCpf, normalizeCpf } from "@/lib/cpf";
import { hasValidMxRecord } from "@/lib/validate-email-domain";
```

Then, insert the check right after the existing destructuring line and before the existing
duplicate-email lookup:

```ts
    const { name, email, password, role, birthDate, cpf } = parsed.data;

    if (!(await hasValidMxRecord(email))) {
      return NextResponse.json({ error: "Domínio de e-mail inválido ou inexistente" }, { status: 400 });
    }

    const exists = await db.user.findUnique({ where: { email } });
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npx vitest run tests/register-route.test.ts tests/validate-email-domain.test.ts`

Expected: PASS, all tests (pre-existing + new).

- [ ] **Step 9: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/validate-email-domain.ts tests/validate-email-domain.test.ts app/api/auth/register/route.ts tests/register-route.test.ts
git commit -m "feat: reject registration emails whose domain has no MX record"
```

---

### Task 2: Rename the admin home page to "Dashboard"

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks (Task 4 edits the same `app/admin/page.tsx` file
  later, but only the filter-form/chart-grid sections, not the `<h1>` this task touches — no
  conflict).

- [ ] **Step 1: Rename the page title**

In `app/admin/page.tsx`, change:

```tsx
      <h1 className="text-2xl font-bold">Painel Administrativo</h1>
```

to:

```tsx
      <h1 className="text-2xl font-bold">Dashboard</h1>
```

- [ ] **Step 2: Rename the nav home link**

In `components/admin/AdminNav.tsx`, change:

```tsx
          <Link href="/admin" className="font-bold text-yellow-400">Admin</Link>
```

to:

```tsx
          <Link href="/admin" className="font-bold text-yellow-400">Dashboard</Link>
```

- [ ] **Step 3: Run the type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 4: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass (this is a plain-text copy change with no test coverage expectation).

- [ ] **Step 5: Commit**

```bash
git add app/admin/page.tsx components/admin/AdminNav.tsx
git commit -m "feat: rename admin home page to Dashboard, matching the organizer's naming"
```

---

### Task 3: Swap the hand-rolled SVG chart for Recharts

**Files:**
- Modify: `package.json` (new dependency, via `npm install`)
- Modify: `components/ui/LineChart.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `LineChart({ data: {label, value}[], color?, height? })` — same signature as before.
  Task 4 does not need to change any `<LineChart .../>` call site.

- [ ] **Step 1: Install Recharts**

Run: `npm install recharts`

Expected: adds `recharts` (`^3.9.0` or later 3.x) to `package.json` dependencies and updates
`package-lock.json`. Confirm no peer-dependency warnings are printed (Recharts 3.x lists React 19
in its `peerDependencies`).

- [ ] **Step 2: Replace the component**

Replace the full content of `components/ui/LineChart.tsx` (currently a plain-SVG implementation)
with:

```tsx
"use client";

import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface LineChartPoint {
  label: string;
  value: number;
}

export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 260,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
}) {
  if (data.every((d) => d.value === 0)) {
    return <p className="text-sm text-gray-400 text-center py-8">Sem dados no período</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Run the type-check**

Run: `npx tsc --noEmit`

Expected: clean — confirms `data`/`color`/`height` are still accepted the same way at every call
site in `app/admin/page.tsx` and `app/organizador/page.tsx` (neither file is touched by this task).

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`

Expected: all tests pass (no test exercises this component directly).

- [ ] **Step 5: Manual verification note**

This component cannot be visually verified from this environment (no DB access to render a
dashboard with real data). Note this explicitly in the task report rather than claiming visual
verification happened.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/ui/LineChart.tsx
git commit -m "feat: render dashboard line charts with Recharts instead of hand-rolled SVG"
```

---

### Task 4: Inline justified filters + one chart per row (admin + organizer)

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `app/organizador/page.tsx`

**Interfaces:**
- Consumes: `LineChart` (Task 3, same signature, no call-site change needed). Assumes Task 2's
  `<h1>Dashboard</h1>` rename already landed in `app/admin/page.tsx` (this task's "before" snippet
  for the filter form is unaffected by that rename — they're different, non-overlapping regions
  of the file — but both tasks touch the same file, so Task 2 must run first, per this plan's
  order).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Admin — restructure the filter form**

In `app/admin/page.tsx`, replace:

```tsx
      <form method="GET" className="flex items-center gap-2 text-sm flex-wrap">
        <label className="text-gray-600">De</label>
        <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        <label className="text-gray-600">Até</label>
        <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        <label className="text-gray-600">Evento (inscrições)</label>
        <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
          <option value="">Todos os eventos</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>
```

with:

```tsx
      <form method="GET" className="flex items-center justify-between flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <label className="text-gray-600">De</label>
          <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
          <label className="text-gray-600">Até</label>
          <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-600">Evento (inscrições)</label>
          <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
            <option value="">Todos os eventos</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>
```

- [ ] **Step 2: Admin — stack the charts one per row**

In `app/admin/page.tsx`, replace:

```tsx
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Novos cadastros</h2>
          <LineChart data={signupsData} color="#7c3aed" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons utilizados</h2>
          <LineChart data={couponUsageData} color="#f59e0b" />
        </div>
      </div>
```

with:

```tsx
      <div className="space-y-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Novos cadastros</h2>
          <LineChart data={signupsData} color="#7c3aed" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons utilizados</h2>
          <LineChart data={couponUsageData} color="#f59e0b" />
        </div>
      </div>
```

- [ ] **Step 3: Organizer — restructure the filter form**

In `app/organizador/page.tsx`, replace:

```tsx
      <form method="GET" className="flex items-center gap-2 text-sm flex-wrap">
        <label className="text-gray-600">De</label>
        <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        <label className="text-gray-600">Até</label>
        <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        <label className="text-gray-600">Evento (inscrições)</label>
        <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
          <option value="">Todos os eventos</option>
          {chartEvents.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>
```

with:

```tsx
      <form method="GET" className="flex items-center justify-between flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <label className="text-gray-600">De</label>
          <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
          <label className="text-gray-600">Até</label>
          <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-600">Evento (inscrições)</label>
          <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
            <option value="">Todos os eventos</option>
            {chartEvents.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
      </form>
```

- [ ] **Step 4: Organizer — stack the charts one per row**

In `app/organizador/page.tsx`, replace:

```tsx
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons utilizados</h2>
          <LineChart data={couponUsageData} color="#f59e0b" />
        </div>
      </div>
```

with:

```tsx
      <div className="space-y-6">
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Inscrições</h2>
          <LineChart data={registrationsData} color="#0ea5e9" />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Cupons utilizados</h2>
          <LineChart data={couponUsageData} color="#f59e0b" />
        </div>
      </div>
```

- [ ] **Step 5: Run the type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 7: Manual verification note**

Layout cannot be visually verified from this environment (no DB access to render either
dashboard). Note this explicitly in the task report.

- [ ] **Step 8: Commit**

```bash
git add app/admin/page.tsx app/organizador/page.tsx
git commit -m "feat: lay out dashboard filters inline and stack charts one per row"
```
