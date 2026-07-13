# Robustecer importação/publicação de resultados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing results CSV import/publish route: swap the fragile hand-rolled CSV
parser for `papaparse`, add automated tests for the import/publish route, and let visitors filter
the public results page by category via a UI control (not just an unreachable query param).

**Architecture:** Same route (`app/api/events/[id]/results/route.ts`), same DB models
(`ResultImport`, `RaceResult`), same public page. No schema changes, no new endpoints. `papaparse`
replaces the internal `parseCSV` implementation only — the function's signature and every caller
stay the same. The public page gains one additional read-only query (distinct categories for the
latest published import) and one `<select>` in the existing search form.

**Tech Stack:** Next.js App Router route handlers, Prisma, `papaparse` (already an installed
dependency, `^5.4.1`, with `@types/papaparse` `^5.3.14`), Vitest for tests.

## Global Constraints

- CSV column format must not change: `bib_number`, `athlete_name` required; `route`, `category`,
  `gender`, `gross_time`, `net_time`, `placement_general`, `placement_category`,
  `placement_gender` optional.
- Do not touch `app/organizador/eventos/[id]/resultados/page.tsx` (upload UI) — out of scope.
- Do not add tests for either page (upload page or public results page) — no page in this project
  has a dedicated test today, and this project doesn't change that convention.
- Do not validate CSV `category`/`route` against `EventCategory`/`EventRoute` — the CSV is
  intentionally free text.

---

### Task 1: Add missing Prisma mocks and write the route test suite

**Files:**
- Modify: `tests/setup.ts:15-16`
- Test: `tests/event-results-route.test.ts` (new)

**Interfaces:**
- Consumes: `POST`/`PATCH` from `@/app/api/events/[id]/results/route` (existing exports, signatures
  unchanged: `(req: NextRequest, { params }: { params: Promise<{ id: string }> })`).
- Produces: nothing consumed by later tasks — this is the leaf test file.

- [ ] **Step 1: Extend the Prisma mocks in `tests/setup.ts`**

Current lines 15-16:

```ts
    resultImport: { count: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    raceResult: { findMany: vi.fn() },
```

Replace with:

```ts
    resultImport: { count: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    raceResult: { findMany: vi.fn(), createMany: vi.fn() },
```

- [ ] **Step 2: Write `tests/event-results-route.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST, PATCH } from "@/app/api/events/[id]/results/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeImportRequest(csvText: string) {
  const formData = new FormData();
  formData.append("file", new File([csvText], "results.csv", { type: "text/csv" }));
  return new Request("http://localhost/api/events/event-1/results", {
    method: "POST",
    body: formData,
  }) as any;
}

function makeEmptyImportRequest() {
  return new Request("http://localhost/api/events/event-1/results", {
    method: "POST",
    body: new FormData(),
  }) as any;
}

function makePublishRequest(importId: string) {
  return new Request("http://localhost/api/events/event-1/results", {
    method: "PATCH",
    body: JSON.stringify({ importId }),
    headers: { "Content-Type": "application/json" },
  }) as any;
}

const ctx = { params: Promise.resolve({ id: "event-1" }) };

describe("event results import/publish api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1", userId: "user-1" });
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1", organizerId: "org-1" });
    dbMock.resultImport.create.mockResolvedValue({ id: "import-1" });
    dbMock.raceResult.createMany.mockResolvedValue({ count: 1 });
    dbMock.auditLog.create.mockResolvedValue({ id: "log-1" });
    dbMock.resultImport.update.mockResolvedValue({ id: "import-1", published: true });
  });

  describe("POST (import)", () => {
    it("rejects when there is no session", async () => {
      authMock.mockResolvedValueOnce(null as any);
      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);
      expect(res.status).toBe(403);
    });

    it("rejects when the caller role is not organizer or admin", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "user-1", role: "ATHLETE" } } as any);
      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);
      expect(res.status).toBe(403);
    });

    it("rejects when no file is sent", async () => {
      const res = await POST(makeEmptyImportRequest(), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/não enviado/i);
    });

    it("rejects an empty CSV", async () => {
      const res = await POST(makeImportRequest("bib_number,athlete_name\n"), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/vazio/i);
    });

    it("rejects a CSV missing a required column", async () => {
      const res = await POST(makeImportRequest("bib_number,route\n1,10km\n"), ctx);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/obrigatórias/i);
      expect(data.error).toMatch(/athlete_name/);
    });

    it("returns 404 when the event does not exist or is outside the organizer's scope", async () => {
      dbMock.event.findFirst.mockResolvedValueOnce(null);
      const res = await POST(makeImportRequest("bib_number,athlete_name\n1,Ana\n"), ctx);
      expect(res.status).toBe(404);
    });

    it("parses athlete names containing a quoted comma correctly", async () => {
      const csv = 'bib_number,athlete_name,route\n101,"Silva, João",10km\n';
      const res = await POST(makeImportRequest(csv), ctx);

      expect(res.status).toBe(200);
      expect(dbMock.raceResult.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            bibNumber: "101",
            athleteName: "Silva, João",
            route: "10km",
          }),
        ],
      });
    });

    it("creates a ResultImport, RaceResult rows, and an audit log entry on success", async () => {
      const csv =
        "bib_number,athlete_name,route,category,gender,gross_time,net_time,placement_general,placement_category,placement_gender\n" +
        "101,Ana Silva,10km,Geral,F,00:45:00,00:44:30,1,1,1\n" +
        "102,Bruno Costa,10km,Geral,M,00:46:00,00:45:10,2,1,1\n";

      const res = await POST(makeImportRequest(csv), ctx);

      expect(res.status).toBe(200);
      expect(dbMock.resultImport.create).toHaveBeenCalledWith({
        data: {
          eventId: "event-1",
          importedBy: "user-1",
          fileName: "results.csv",
          rowCount: 2,
        },
      });
      expect(dbMock.raceResult.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            importId: "import-1",
            eventId: "event-1",
            bibNumber: "101",
            athleteName: "Ana Silva",
            route: "10km",
            category: "Geral",
            gender: "F",
            grossTime: "00:45:00",
            netTime: "00:44:30",
            placementGeneral: 1,
            placementCategory: 1,
            placementGender: 1,
          }),
          expect.objectContaining({
            bibNumber: "102",
            athleteName: "Bruno Costa",
            placementGeneral: 2,
          }),
        ],
      });
      expect(dbMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          action: "RESULTS_IMPORTED",
          entityType: "ResultImport",
          entityId: "import-1",
          metadata: { rowCount: 2, fileName: "results.csv" },
        }),
      });

      const data = await res.json();
      expect(data).toEqual({ importId: "import-1", rowCount: 2 });
    });
  });

  describe("PATCH (publish)", () => {
    it("rejects when there is no session or an invalid role", async () => {
      authMock.mockResolvedValueOnce(null as any);
      const res = await PATCH(makePublishRequest("import-1"), ctx);
      expect(res.status).toBe(403);
    });

    it("marks the import as published", async () => {
      const res = await PATCH(makePublishRequest("import-1"), ctx);

      expect(res.status).toBe(200);
      expect(dbMock.resultImport.update).toHaveBeenCalledWith({
        where: { id: "import-1", eventId: "event-1" },
        data: { published: true, publishedAt: expect.any(Date) },
      });
      expect(await res.json()).toEqual({ ok: true });
    });
  });
});
```

- [ ] **Step 3: Run the new test file and confirm the expected mix of pass/fail**

Run: `npx vitest run tests/event-results-route.test.ts`

Expected: every test passes **except** `"parses athlete names containing a quoted comma
correctly"`, which fails — the current hand-rolled `parseCSV` splits `"Silva, João"` on the comma
inside the quotes, so `athleteName` comes back as `"Silva"` instead of `"Silva, João"`. This
failure is expected at this point in the plan; Task 2 fixes it.

- [ ] **Step 4: Commit**

```bash
git add tests/setup.ts tests/event-results-route.test.ts
git commit -m "test: add coverage for results import/publish route"
```

---

### Task 2: Swap the hand-rolled CSV parser for `papaparse`

**Files:**
- Modify: `app/api/events/[id]/results/route.ts:1-15`

**Interfaces:**
- Consumes: `tests/event-results-route.test.ts` (Task 1) as the verification harness — no code
  interface consumed.
- Produces: `parseCSV(text: string): Record<string, string>[]` — same signature as before, same
  throw-on-empty behavior, same lowercased/trimmed headers. Nothing downstream changes shape.

- [ ] **Step 1: Replace the parser**

Current `app/api/events/[id]/results/route.ts:1-15`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const REQUIRED_COLUMNS = ["bib_number", "athlete_name"];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("CSV vazio ou sem dados");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}
```

Replace with:

```ts
import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const REQUIRED_COLUMNS = ["bib_number", "athlete_name"];

function parseCSV(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
    transform: (v) => v.trim(),
  });
  if (result.data.length === 0) throw new Error("CSV vazio ou sem dados");
  return result.data;
}
```

The rest of the file (`POST`, `PATCH`) is unchanged.

- [ ] **Step 2: Run the full test file and confirm every test now passes**

Run: `npx vitest run tests/event-results-route.test.ts`

Expected: all tests pass, including `"parses athlete names containing a quoted comma correctly"`.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass (same total count as before plus the new file's tests).

- [ ] **Step 4: Commit**

```bash
git add app/api/events/[id]/results/route.ts
git commit -m "fix: parse results CSV with papaparse instead of naive comma-split"
```

---

### Task 3: Add a category filter control to the public results page

**Files:**
- Modify: `app/(public)/eventos/[slug]/resultados/page.tsx`

**Interfaces:**
- Consumes: `db.raceResult.findMany` (Prisma client, already used elsewhere in this file).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add the `availableCategories` query and the `<select>` control**

In `app/(public)/eventos/[slug]/resultados/page.tsx`, after the existing `latestImport` query
(currently ending at line 29) and before the `results` query (currently starting at line 31), add:

```ts
  const availableCategories = latestImport
    ? await db.raceResult.findMany({
        where: { importId: latestImport.id, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
      })
    : [];
```

Then, in the search form (currently `app/(public)/eventos/[slug]/resultados/page.tsx:58-66`):

```tsx
          <form className="flex gap-3 mb-6">
            <input name="q" defaultValue={sp.q} className="input-field flex-1" placeholder="Buscar por nome ou número..." />
            <select name="genero" defaultValue={sp.genero} className="input-field w-32">
              <option value="">Gênero</option>
              <option value="M">Masculino</option>
              <option value="F">Feminino</option>
            </select>
            <button type="submit" className="btn-primary px-6">Buscar</button>
          </form>
```

Replace with:

```tsx
          <form className="flex gap-3 mb-6">
            <input name="q" defaultValue={sp.q} className="input-field flex-1" placeholder="Buscar por nome ou número..." />
            <select name="categoria" defaultValue={sp.categoria} className="input-field w-40">
              <option value="">Todas as categorias</option>
              {availableCategories.map((c) => (
                <option key={c.category} value={c.category ?? ""}>
                  {c.category}
                </option>
              ))}
            </select>
            <select name="genero" defaultValue={sp.genero} className="input-field w-32">
              <option value="">Gênero</option>
              <option value="M">Masculino</option>
              <option value="F">Feminino</option>
            </select>
            <button type="submit" className="btn-primary px-6">Buscar</button>
          </form>
```

- [ ] **Step 2: Manually verify in the dev server**

Run: `npm run dev`

1. As an organizer, import a CSV with at least two distinct `category` values and publish it
   (existing upload page at `/organizador/eventos/[id]/resultados`).
2. Visit the public page `/eventos/[slug]/resultados`.
3. Confirm the new "Todas as categorias" select is populated with exactly the distinct category
   values from the published import, and that selecting one and clicking "Buscar" filters the
   table to only that category (URL should show `?categoria=<value>`).

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npx vitest run`

Expected: all tests pass (this task adds no automated tests, per the Global Constraints — page
verification here is manual).

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/eventos/[slug]/resultados/page.tsx"
git commit -m "feat: let visitors filter public results by category"
```
