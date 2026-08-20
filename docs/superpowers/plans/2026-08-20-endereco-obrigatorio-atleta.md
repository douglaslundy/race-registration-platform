# Endereço Obrigatório do Atleta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every athlete must have a complete structured address (CEP, rua, número, complemento
opcional, bairro, cidade, UF) — required at signup for new accounts, retroactively enforced via the
existing incomplete-profile gate for accounts created before this change, with ViaCEP autocomplete
and no external dependency beyond a public, keyless API.

**Architecture:** 5 new nullable columns on `AthleteProfile` (`city`/`state` already exist and get
promoted from "suggested" to "required"). The existing gate (`lib/auth/profile-completion.ts` +
`/completar-cadastro` + the 2 redirect call-sites) grows its field list — no new gate mechanism.
`PUT /api/athlete/profile` (the single route both the gate and "Meus Dados" use) grows its schema.
`RegisterForm.tsx` + `POST /api/auth/register` grow their validation the same way CPF/birthDate/
phone were added before. A new `lib/cep.ts` centralizes CEP normalization/validation and the
ViaCEP fetch — called independently by each of the 3 forms (no shared JSX component: `RegisterForm`
uses `react-hook-form`, the other two use plain `useState`, and forcing one component across both
paradigms would fight the existing code more than it would save).

**Tech Stack:** Next.js (App Router) + Prisma/Postgres + Vitest + react-hook-form (RegisterForm
only) + ViaCEP public API (`https://viacep.com.br`, no auth, CORS-enabled, called directly from the
browser).

**Spec:** `docs/superpowers/specs/2026-08-20-endereco-obrigatorio-atleta-design.md`

## Global Constraints

- New `AthleteProfile` columns are nullable at the DB level — obligatoriness is enforced only in
  application code (the gate), never via `NOT NULL`, since existing accounts have no address data.
- Visual/field order everywhere, always: CEP → Rua/Logradouro → Número → Complemento → Bairro →
  Cidade → Estado/UF.
- `complement` is the only address field that is NEVER required — it never appears in
  `MissingAthleteField`, never blocks the gate, never has a `*` in any form.
- "Sem número" checkbox writes the literal string `"S/N"` into the `number` field — no new DB
  column for this.
- CEP is normalized and stored as `"00000-000"` (with hyphen) — a deliberate difference from CPF's
  plain-digit storage, because CEP needs no checksum algorithm and benefits from being
  human-readable wherever it's displayed later.
- `fetchAddressByCep` never throws — network errors, timeouts, malformed CEP, and ViaCEP's
  `{ erro: true }` response (CEP doesn't exist) all resolve to `null`. Callers treat `null` as
  "autocomplete unavailable, fall back to manual entry" — never as a blocking error.
- No admin-side address correction is added (unlike CPF) — address has no uniqueness constraint
  and is never locked after saving, so the athlete can always self-correct via "Meus Dados".
- No UI component tests (project convention) — only pure functions and API routes get automated
  tests for the UI-adjacent pieces.

---

### Task 1: Schema — 5 new `AthleteProfile` columns

**Files:**
- Modify: `prisma/schema.prisma` (`model AthleteProfile`)
- Create: `prisma/migrations/20260821000000_add_athlete_address/migration.sql`

**Interfaces:**
- Produces: `AthleteProfile.postalCode`, `.street`, `.number`, `.complement`, `.neighborhood`, all
  `String?`. Used by every later task.

- [ ] **Step 1: Add the 5 fields to the Prisma schema**

In `prisma/schema.prisma`, inside `model AthleteProfile`, insert right after the `phone` field and
right before `gender` (so the field order visually groups: `phone`, then the address block in the
required visual order, then `gender`, `city`, `state` unchanged just below):

```prisma
  postalCode         String?
  street             String?
  number             String?
  complement         String?
  neighborhood       String?
```

(the existing `city`/`state` fields immediately below stay exactly as they are — no change to
those two lines, they just gain application-level obligatoriness in Task 3)

- [ ] **Step 2: Write the migration by hand**

Create `prisma/migrations/20260821000000_add_athlete_address/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "athlete_profiles" ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "neighborhood" TEXT;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: succeeds without a live DB connection (reads only `schema.prisma`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (nothing references the new fields yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260821000000_add_athlete_address
git commit -m "feat: adiciona campos de endereco em AthleteProfile"
```

---

### Task 2: `lib/cep.ts` — normalização, validação e busca via ViaCEP

**Files:**
- Create: `lib/cep.ts`
- Test: `tests/cep.test.ts`

**Interfaces:**
- Produces: `normalizeCep(raw: string): string`, `isValidCep(cep: string): boolean`,
  `fetchAddressByCep(cep: string): Promise<CepAddress | null>`, and the exported `CepAddress`
  interface (`{ street, neighborhood, city, state }`, all `string`). Used by Tasks 4, 5, 6, 7.

- [ ] **Step 1: Write the failing tests**

Create `tests/cep.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCep, isValidCep, fetchAddressByCep } from "@/lib/cep";

describe("normalizeCep", () => {
  it("formata 8 dígitos como 00000-000", () => {
    expect(normalizeCep("01310100")).toBe("01310-100");
  });

  it("remove pontuação/máscara antes de formatar", () => {
    expect(normalizeCep("01310-100")).toBe("01310-100");
  });

  it("devolve só os dígitos quando o tamanho não é 8 (entrada parcial)", () => {
    expect(normalizeCep("0131")).toBe("0131");
  });
});

describe("isValidCep", () => {
  it("aceita 8 dígitos, com ou sem máscara", () => {
    expect(isValidCep("01310-100")).toBe(true);
    expect(isValidCep("01310100")).toBe(true);
  });

  it("rejeita tamanho errado", () => {
    expect(isValidCep("0131")).toBe(false);
    expect(isValidCep("013101000")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(isValidCep("")).toBe(false);
  });
});

describe("fetchAddressByCep", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retorna o endereço quando o ViaCEP responde com sucesso", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logradouro: "Praça da Sé",
        bairro: "Sé",
        localidade: "São Paulo",
        uf: "SP",
      }),
    } as Response);

    const result = await fetchAddressByCep("01001-000");

    expect(global.fetch).toHaveBeenCalledWith("https://viacep.com.br/ws/01001000/json/");
    expect(result).toEqual({ street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", state: "SP" });
  });

  it("retorna null quando o ViaCEP responde { erro: true } (CEP inexistente)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ erro: true }),
    } as Response);

    const result = await fetchAddressByCep("00000-000");

    expect(result).toBeNull();
  });

  it("retorna null quando a resposta HTTP não é ok", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false } as Response);

    const result = await fetchAddressByCep("01001-000");

    expect(result).toBeNull();
  });

  it("retorna null quando o fetch lança (erro de rede/timeout), sem propagar o erro", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("network error"));

    const result = await fetchAddressByCep("01001-000");

    expect(result).toBeNull();
  });

  it("retorna null sem chamar fetch quando o CEP não tem 8 dígitos", async () => {
    const result = await fetchAddressByCep("123");

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cep.test.ts`
Expected: FAIL — `lib/cep.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/cep.ts`:

```ts
export function normalizeCep(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function isValidCep(cep: string): boolean {
  const digits = cep.replace(/\D/g, "");
  return digits.length === 8;
}

export interface CepAddress {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

interface ViaCepResponse {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

/** Busca endereço via ViaCEP (API pública, sem autenticação, chamada direto do cliente). Nunca
 * lança — erro de rede, timeout, CEP mal formado ou resposta { erro: true } (CEP inexistente)
 * todos retornam null; o chamador trata null como "autocomplete indisponível, preencher manual". */
export async function fetchAddressByCep(cep: string): Promise<CepAddress | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) return null;

    const data = (await res.json()) as ViaCepResponse;
    if (data.erro) return null;

    return {
      street: data.logradouro ?? "",
      neighborhood: data.bairro ?? "",
      city: data.localidade ?? "",
      state: data.uf ?? "",
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/cep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/cep.ts tests/cep.test.ts
git commit -m "feat: adiciona lib/cep.ts (normalizacao, validacao e busca via ViaCEP)"
```

---

### Task 3: Gate de cadastro incompleto — estender pra endereço

**Files:**
- Modify: `lib/auth/profile-completion.ts`
- Test: `tests/profile-completion.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `AthleteProfile.postalCode/street/number/neighborhood/city/state` (Task 1).
- Produces: `MissingAthleteField` grows to include `"postalCode" | "street" | "number" |
  "neighborhood" | "city" | "state"`. `SuggestedAthleteField` shrinks to `"gender" |
  "preferredShirtSize"` only. Used by Task 6 (`CompletarCadastroForm.tsx`) and unchanged by the 3
  existing enforcement call-sites (`app/dashboard/layout.tsx`, `app/(public)/inscricao/[slug]/
  page.tsx`, `app/completar-cadastro/page.tsx` — none of them need to change, they just react to a
  longer list).

- [ ] **Step 1: Write the failing tests**

Replace `tests/profile-completion.test.ts` entirely with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getMissingAthleteProfileFields, getSuggestedAthleteProfileFields } from "@/lib/auth/profile-completion";

const dbMock = db as any;

const completeProfile = {
  birthDate: new Date("1990-01-01"),
  cpf: "11144477735",
  phone: "5511999999999",
  postalCode: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe("getMissingAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando todos os campos obrigatórios estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(completeProfile);

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([]);
  });

  it("retorna todos os 9 campos quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([
      "birthDate", "cpf", "phone", "postalCode", "street", "number", "neighborhood", "city", "state",
    ]);
  });

  it("retorna só cpf quando os demais campos já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, cpf: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["cpf"]);
  });

  it("retorna só birthDate quando os demais campos já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, birthDate: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["birthDate"]);
  });

  it("retorna só phone quando os demais campos já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, phone: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["phone"]);
  });

  it("retorna só postalCode quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, postalCode: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["postalCode"]);
  });

  it("retorna só street quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, street: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["street"]);
  });

  it("retorna só number quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, number: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["number"]);
  });

  it("retorna só neighborhood quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, neighborhood: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["neighborhood"]);
  });

  it("retorna só city quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, city: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["city"]);
  });

  it("retorna só state quando os demais campos de endereço já estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, state: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["state"]);
  });

  it("nunca inclui complement na lista (campo opcional, fora do tipo MissingAthleteField)", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ ...completeProfile, complement: null });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([]);
  });
});

describe("getSuggestedAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando gender e preferredShirtSize estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      gender: "M",
      preferredShirtSize: "M",
    });

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual([]);
  });

  it("retorna os 2 campos quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual(["gender", "preferredShirtSize"]);
  });

  it("retorna só o campo vazio quando o perfil está parcialmente preenchido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      gender: "F",
      preferredShirtSize: null,
    });

    const suggested = await getSuggestedAthleteProfileFields("user-1");

    expect(suggested).toEqual(["preferredShirtSize"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/profile-completion.test.ts`
Expected: FAIL — the current implementation doesn't check the new fields and still includes
`city`/`state` in `getSuggestedAthleteProfileFields`.

- [ ] **Step 3: Implement**

Replace `lib/auth/profile-completion.ts` entirely with:

```ts
import { db } from "@/lib/db";

export type MissingAthleteField =
  | "birthDate"
  | "cpf"
  | "phone"
  | "postalCode"
  | "street"
  | "number"
  | "neighborhood"
  | "city"
  | "state";

export async function getMissingAthleteProfileFields(userId: string): Promise<MissingAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: {
      birthDate: true,
      cpf: true,
      phone: true,
      postalCode: true,
      street: true,
      number: true,
      neighborhood: true,
      city: true,
      state: true,
    },
  });

  const missing: MissingAthleteField[] = [];
  if (!profile?.birthDate) missing.push("birthDate");
  if (!profile?.cpf) missing.push("cpf");
  if (!profile?.phone) missing.push("phone");
  if (!profile?.postalCode) missing.push("postalCode");
  if (!profile?.street) missing.push("street");
  if (!profile?.number) missing.push("number");
  if (!profile?.neighborhood) missing.push("neighborhood");
  if (!profile?.city) missing.push("city");
  if (!profile?.state) missing.push("state");
  return missing;
}

export type SuggestedAthleteField = "gender" | "preferredShirtSize";

export async function getSuggestedAthleteProfileFields(userId: string): Promise<SuggestedAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: { gender: true, preferredShirtSize: true },
  });

  const suggested: SuggestedAthleteField[] = [];
  if (!profile?.gender) suggested.push("gender");
  if (!profile?.preferredShirtSize) suggested.push("preferredShirtSize");
  return suggested;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/profile-completion.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors — the 3 files that import `MissingAthleteField`/these functions
(`app/dashboard/layout.tsx`, `app/(public)/inscricao/[slug]/page.tsx`,
`app/completar-cadastro/page.tsx`) only use the array length/redirect logic, never enumerate the
union type, so widening it is backward compatible.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/profile-completion.ts tests/profile-completion.test.ts
git commit -m "feat: gate de cadastro incompleto passa a exigir endereco completo"
```

---

### Task 4: `PUT /api/athlete/profile` — aceitar os campos de endereço

**Files:**
- Modify: `app/api/athlete/profile/route.ts`
- Test: `tests/athlete-profile-route.test.ts`

**Interfaces:**
- Consumes: `normalizeCep` (Task 2).
- Produces: the route's body accepts `postalCode`, `street`, `number`, `complement`,
  `neighborhood` (all optional strings) in addition to the fields it already accepts. Used by
  Tasks 6 and 7 (both call this same route).

- [ ] **Step 1: Write the failing tests**

Append to `tests/athlete-profile-route.test.ts`, inside the existing `describe("PUT /api/athlete/
profile", ...)` block, right before its closing `});`:

```ts
  it("aceita e normaliza postalCode ao salvar", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: "11144477735" });
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({});

    const res = await PUT(makeRequest({ cpf: "111.444.777-35", postalCode: "01310100" }));

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ postalCode: "01310-100" }),
      }),
    );
  });

  it("aceita os campos de endereço (street, number, complement, neighborhood, city, state)", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: "11144477735" });
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({});

    const res = await PUT(
      makeRequest({
        cpf: "111.444.777-35",
        street: "Avenida Paulista",
        number: "1000",
        complement: "Apto 10",
        neighborhood: "Bela Vista",
        city: "São Paulo",
        state: "SP",
      }),
    );

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          street: "Avenida Paulista",
          number: "1000",
          complement: "Apto 10",
          neighborhood: "Bela Vista",
          city: "São Paulo",
          state: "SP",
        }),
      }),
    );
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/athlete-profile-route.test.ts`
Expected: FAIL — the current zod schema rejects these fields (`safeParse` fails, or they're
silently stripped, so `upsert` is never called with them).

- [ ] **Step 3: Implement**

In `app/api/athlete/profile/route.ts`, add an import right after the existing `lib/cpf` import:

```ts
import { normalizeCep } from "@/lib/cep";
```

Replace `profileSchema` with:

```ts
const profileSchema = z.object({
  birthDate: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  street: z.string().optional().nullable(),
  number: z.string().optional().nullable(),
  complement: z.string().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  emergencyName: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  medicalNotes: z.string().optional().nullable(),
  preferredShirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).optional().nullable(),
  teamName: z.string().optional().nullable(),
});
```

In the `PUT` function, right after the existing `birthDate` normalization block
(`if (rest.birthDate !== undefined) { data.birthDate = ...; }`), add:

```ts
  if (rest.postalCode) {
    data.postalCode = normalizeCep(rest.postalCode);
  }
```

Nothing else in the file changes — `GET`, the CPF-locking logic, and the `upsert`/error handling
stay exactly as they are.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/athlete-profile-route.test.ts`
Expected: all PASS, including every pre-existing test in this file.

- [ ] **Step 5: Commit**

```bash
git add app/api/athlete/profile/route.ts tests/athlete-profile-route.test.ts
git commit -m "feat: PUT /api/athlete/profile aceita campos de endereco"
```

---

### Task 5: Cadastro inicial — endereço obrigatório pra atleta

**Files:**
- Modify: `components/auth/RegisterForm.tsx`
- Modify: `app/api/auth/register/route.ts`
- Test: `tests/register-route.test.ts`

**Interfaces:**
- Consumes: `isValidCep`, `fetchAddressByCep`, `normalizeCep` (Task 2).
- Produces: nothing consumed by later tasks — this is the last piece of the user-facing surface.

- [ ] **Step 1: Update the existing test fixture (critical — every existing athlete-role test
  depends on it)**

In `tests/register-route.test.ts`, `validAthleteBody` currently only has
`birthDate`/`cpf`/`phone`. Since address becomes ALSO required for `role: "ATHLETE"`, every
existing test that reuses this fixture (the CPF/phone rejection tests, the success test, etc.)
would break with a 400 for a completely unrelated reason unless the fixture itself carries a valid
address. Replace `validAthleteBody` with:

```ts
const validAthleteBody = {
  name: "Atleta Teste",
  email: "atleta@example.com",
  password: "12345678",
  role: "ATHLETE",
  birthDate: "1990-01-01",
  cpf: "111.444.777-35",
  phone: "11999999999",
  postalCode: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};
```

- [ ] **Step 2: Write the new failing tests**

Append these tests inside `describe("POST /api/auth/register", ...)`, right before its closing
`});`:

```ts
  it("rejeita cadastro de atleta sem CEP", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.postalCode;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita CEP com formato inválido", async () => {
    const res = await POST(makeRequest({ ...validAthleteBody, postalCode: "123" }));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem rua/logradouro", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.street;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem número", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.number;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem bairro", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.neighborhood;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem cidade", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.city;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem estado", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.state;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("aceita 'S/N' como número (endereço sem numeração)", async () => {
    const res = await POST(makeRequest({ ...validAthleteBody, number: "S/N" }));

    expect(res.status).toBe(201);
    expect(dbMock.athleteProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ number: "S/N" }) }),
    );
  });

  it("cria o perfil com o endereço completo e o CEP normalizado", async () => {
    const res = await POST(makeRequest(validAthleteBody));

    expect(res.status).toBe(201);
    expect(dbMock.athleteProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postalCode: "01310-100",
          street: "Avenida Paulista",
          number: "1000",
          neighborhood: "Bela Vista",
          city: "São Paulo",
          state: "SP",
        }),
      }),
    );
  });
```

- [ ] **Step 3: Run to verify failures**

Run: `npx vitest run tests/register-route.test.ts`
Expected: the new tests FAIL (route doesn't validate/persist address yet); the pre-existing tests
still PASS because Step 1 already fixed the fixture.

- [ ] **Step 4: Implement the backend (`app/api/auth/register/route.ts`)**

Add an import right after the existing `lib/cpf` import:

```ts
import { normalizeCep, isValidCep } from "@/lib/cep";
```

Replace `registerSchema` with:

```ts
const registerSchema = z
  .object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(["ATHLETE", "ORGANIZER"]).default("ATHLETE"),
    birthDate: z.string().optional(),
    cpf: z.string().optional(),
    phone: z.string().optional(),
    postalCode: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role !== "ATHLETE") return;

    if (!data.birthDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de nascimento é obrigatória",
        path: ["birthDate"],
      });
    }

    if (!data.cpf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF é obrigatório",
        path: ["cpf"],
      });
    } else if (!isValidCpf(data.cpf)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF inválido",
        path: ["cpf"],
      });
    }

    if (!data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Telefone é obrigatório",
        path: ["phone"],
      });
    } else if (data.phone.replace(/\D/g, "").length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Telefone inválido",
        path: ["phone"],
      });
    }

    if (!data.postalCode || !isValidCep(data.postalCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CEP é obrigatório e deve ser válido",
        path: ["postalCode"],
      });
    }

    if (!data.street) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rua/logradouro é obrigatório",
        path: ["street"],
      });
    }

    if (!data.number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Número é obrigatório",
        path: ["number"],
      });
    }

    if (!data.neighborhood) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bairro é obrigatório",
        path: ["neighborhood"],
      });
    }

    if (!data.city) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cidade é obrigatória",
        path: ["city"],
      });
    }

    if (!data.state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Estado é obrigatório",
        path: ["state"],
      });
    }
  });
```

In the `POST` handler, change the destructuring line:

```ts
    const { name, email, password, role, birthDate, cpf, phone } = parsed.data;
```

to:

```ts
    const {
      name, email, password, role, birthDate, cpf, phone,
      postalCode, street, number, complement, neighborhood, city, state,
    } = parsed.data;
```

Change the `db.athleteProfile.create` call to:

```ts
    if (role === "ATHLETE" && birthDate) {
      try {
        await db.athleteProfile.create({
          data: {
            userId: user.id,
            birthDate: new Date(birthDate),
            cpf: normalizedCpf,
            phone,
            postalCode: postalCode ? normalizeCep(postalCode) : undefined,
            street,
            number,
            complement,
            neighborhood,
            city,
            state,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
        }
        throw error;
      }
    }
```

Nothing else in this file changes.

- [ ] **Step 5: Run to verify the backend tests pass**

Run: `npx vitest run tests/register-route.test.ts`
Expected: all PASS.

- [ ] **Step 6: Implement the frontend (`components/auth/RegisterForm.tsx`)**

Add imports right after the existing `@/lib/cpf` import:

```tsx
import { isValidCep, fetchAddressByCep } from "@/lib/cep";
```

Replace the `schema` definition with:

```tsx
const schema = z
  .object({
    name: z.string().min(2, "Nome muito curto"),
    email: z.string().email("E-mail inválido"),
    password: z.string().min(8, "Mínimo 8 caracteres"),
    role: z.enum(["ATHLETE", "ORGANIZER"]),
    birthDate: z.string().optional(),
    cpf: z.string().optional(),
    phone: z.string().optional(),
    postalCode: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    noNumber: z.boolean().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role !== "ATHLETE") return;

    if (!data.birthDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe sua data de nascimento",
        path: ["birthDate"],
      });
    }

    if (!data.cpf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe seu CPF",
        path: ["cpf"],
      });
    } else if (!isValidCpf(data.cpf)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF inválido",
        path: ["cpf"],
      });
    }

    if (!data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe seu telefone",
        path: ["phone"],
      });
    } else if (data.phone.replace(/\D/g, "").length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Telefone inválido",
        path: ["phone"],
      });
    }

    if (!data.postalCode || !isValidCep(data.postalCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe um CEP válido",
        path: ["postalCode"],
      });
    }

    if (!data.street) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe a rua/logradouro",
        path: ["street"],
      });
    }

    if (!data.noNumber && !data.number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o número ou marque 'Sem número'",
        path: ["number"],
      });
    }

    if (!data.neighborhood) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o bairro",
        path: ["neighborhood"],
      });
    }

    if (!data.city) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe a cidade",
        path: ["city"],
      });
    }

    if (!data.state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o estado",
        path: ["state"],
      });
    }
  });
```

Inside the component, change the `useForm` destructure to also pull `setValue` and `watch`:

```tsx
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: "ATHLETE" },
  });
  const role = watch("role");
  const noNumber = watch("noNumber");
  const cepField = register("postalCode");
```

Replace the `onSubmit` function with:

```tsx
  async function onSubmit(data: FormData) {
    setError(null);
    const payload = { ...data, number: data.noNumber ? "S/N" : data.number };
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Erro ao criar conta");
      return;
    }

    router.push("/auth/login?registered=1");
  }
```

Inside the `{role === "ATHLETE" && (<>...</>)}` block, right after the existing "Telefone / WhatsApp
*" field's closing `</div>`, add:

```tsx
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CEP *</label>
            <input
              type="text"
              {...cepField}
              onBlur={async (e) => {
                cepField.onBlur(e);
                const address = await fetchAddressByCep(e.target.value);
                if (address) {
                  setValue("street", address.street);
                  setValue("neighborhood", address.neighborhood);
                  setValue("city", address.city);
                  setValue("state", address.state);
                }
              }}
              className="input-field"
              placeholder="00000-000"
              maxLength={9}
            />
            {errors.postalCode && <p className="text-red-500 text-xs mt-1">{errors.postalCode.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rua/Logradouro *</label>
            <input type="text" {...register("street")} className="input-field" />
            {errors.street && <p className="text-red-500 text-xs mt-1">{errors.street.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Número *</label>
            <input
              type="text"
              {...register("number")}
              disabled={noNumber}
              className="input-field disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            {errors.number && <p className="text-red-500 text-xs mt-1">{errors.number.message}</p>}
            <label className="flex items-center gap-2 mt-1 text-sm text-gray-600">
              <input type="checkbox" {...register("noNumber")} />
              Sem número
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
            <input type="text" {...register("complement")} className="input-field" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bairro *</label>
            <input type="text" {...register("neighborhood")} className="input-field" />
            {errors.neighborhood && <p className="text-red-500 text-xs mt-1">{errors.neighborhood.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cidade *</label>
            <input type="text" {...register("city")} className="input-field" />
            {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Estado (UF) *</label>
            <input type="text" maxLength={2} {...register("state")} className="input-field" />
            {errors.state && <p className="text-red-500 text-xs mt-1">{errors.state.message}</p>}
          </div>
```

No automated test for this file (project convention — no UI component tests; the shared validation
contract is already covered by the backend tests in Step 1-5, since the client schema mirrors the
server schema exactly).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Full suite**

Run: `npx vitest run`
Expected: no regressions anywhere else in the suite.

- [ ] **Step 9: Commit**

```bash
git add components/auth/RegisterForm.tsx app/api/auth/register/route.ts tests/register-route.test.ts
git commit -m "feat: cadastro inicial exige endereco completo pra atleta"
```

---

### Task 6: `/completar-cadastro` — exigir endereço dos que estão faltando

**Files:**
- Modify: `app/completar-cadastro/CompletarCadastroForm.tsx`

**Interfaces:**
- Consumes: `MissingAthleteField` (Task 3), `isValidCep`/`fetchAddressByCep` (Task 2), `PUT /api/
  athlete/profile` (Task 4).

- [ ] **Step 1: Implement**

Replace `app/completar-cadastro/CompletarCadastroForm.tsx` entirely with:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isValidCpf } from "@/lib/cpf";
import { isValidCep, fetchAddressByCep } from "@/lib/cep";
import type { MissingAthleteField } from "@/lib/auth/profile-completion";

export default function CompletarCadastroForm({
  missingFields,
  callbackUrl,
}: {
  missingFields: MissingAthleteField[];
  callbackUrl?: string;
}) {
  const router = useRouter();
  const [birthDate, setBirthDate] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [noNumber, setNoNumber] = useState(false);
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsBirthDate = missingFields.includes("birthDate");
  const needsCpf = missingFields.includes("cpf");
  const needsPhone = missingFields.includes("phone");
  const needsPostalCode = missingFields.includes("postalCode");
  const needsStreet = missingFields.includes("street");
  const needsNumber = missingFields.includes("number");
  const needsNeighborhood = missingFields.includes("neighborhood");
  const needsCity = missingFields.includes("city");
  const needsState = missingFields.includes("state");
  const needsAnyAddress =
    needsPostalCode || needsStreet || needsNumber || needsNeighborhood || needsCity || needsState;

  async function handlePostalCodeBlur() {
    const address = await fetchAddressByCep(postalCode);
    if (address) {
      setStreet(address.street);
      setNeighborhood(address.neighborhood);
      setCity(address.city);
      setState(address.state);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (needsCpf && !isValidCpf(cpf)) {
      setError("Informe um CPF válido.");
      return;
    }

    if (needsPhone && phone.replace(/\D/g, "").length < 10) {
      setError("Informe um telefone válido.");
      return;
    }

    if (needsPostalCode && !isValidCep(postalCode)) {
      setError("Informe um CEP válido.");
      return;
    }

    if (needsNumber && !noNumber && !number) {
      setError("Informe o número ou marque 'Sem número'.");
      return;
    }

    setSaving(true);
    const body: Record<string, string> = {};
    if (needsBirthDate) body.birthDate = birthDate;
    if (needsCpf) body.cpf = cpf;
    if (needsPhone) body.phone = phone;
    if (needsPostalCode) body.postalCode = postalCode;
    if (needsStreet) body.street = street;
    if (needsNumber) body.number = noNumber ? "S/N" : number;
    if (complement) body.complement = complement;
    if (needsNeighborhood) body.neighborhood = neighborhood;
    if (needsCity) body.city = city;
    if (needsState) body.state = state;

    const res = await fetch("/api/athlete/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao salvar os dados.");
      setSaving(false);
      return;
    }

    router.push(callbackUrl || "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {needsBirthDate && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Data de nascimento *
          </label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            required
            className="input-field"
          />
        </div>
      )}
      {needsCpf && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF *</label>
          <input
            type="text"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
            maxLength={14}
            required
            className="input-field"
          />
        </div>
      )}
      {needsPhone && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Telefone / WhatsApp *
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 99999-9999"
            required
            className="input-field"
          />
        </div>
      )}
      {needsPostalCode && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CEP *</label>
          <input
            type="text"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            onBlur={handlePostalCodeBlur}
            placeholder="00000-000"
            maxLength={9}
            required
            className="input-field"
          />
        </div>
      )}
      {needsStreet && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Rua/Logradouro *
          </label>
          <input
            type="text"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            required
            className="input-field"
          />
        </div>
      )}
      {needsNumber && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Número *</label>
          <input
            type="text"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={noNumber}
            className="input-field disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
          />
          <label className="flex items-center gap-2 mt-1 text-sm text-gray-600 dark:text-gray-400">
            <input type="checkbox" checked={noNumber} onChange={(e) => setNoNumber(e.target.checked)} />
            Sem número
          </label>
        </div>
      )}
      {needsAnyAddress && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Complemento</label>
          <input
            type="text"
            value={complement}
            onChange={(e) => setComplement(e.target.value)}
            className="input-field"
          />
        </div>
      )}
      {needsNeighborhood && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bairro *</label>
          <input
            type="text"
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
            required
            className="input-field"
          />
        </div>
      )}
      {needsCity && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade *</label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
            className="input-field"
          />
        </div>
      )}
      {needsState && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado (UF) *</label>
          <input
            type="text"
            maxLength={2}
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
            required
            className="input-field"
          />
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      <button type="submit" disabled={saving} className="btn-primary w-full">
        {saving ? "Salvando..." : "Salvar e continuar"}
      </button>
    </form>
  );
}
```

No automated test (project convention — no UI component tests; the underlying validation/save
contract is covered by Task 4's route tests).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/completar-cadastro/CompletarCadastroForm.tsx
git commit -m "feat: gate de cadastro incompleto pede endereco quando faltando"
```

---

### Task 7: "Meus Dados" — card de Endereço

**Files:**
- Modify: `app/dashboard/perfil/page.tsx`

**Interfaces:**
- Consumes: `fetchAddressByCep` (Task 2), `PUT /api/athlete/profile` (Task 4).

- [ ] **Step 1: Extend `ProfileData` and add local state**

Replace the `ProfileData` type with:

```tsx
type ProfileData = {
  birthDate?: string | null;
  cpf?: string | null;
  phone?: string | null;
  gender?: string | null;
  postalCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  medicalNotes?: string | null;
  preferredShirtSize?: string | null;
  teamName?: string | null;
};
```

Add an import at the top of the file:

```tsx
import { fetchAddressByCep } from "@/lib/cep";
```

Right after the existing `const [saved, setSaved] = useState(false);` line, add:

```tsx
  const [noNumber, setNoNumber] = useState(false);
```

In the `useEffect`'s `.then(({ profile }) => { ... })` callback, right after the existing
`setForm({...})` call, add:

```tsx
          setNoNumber(profile.number === "S/N");
```

- [ ] **Step 2: Add the CEP autocomplete handler**

Right after the existing `set` function (`function set(field: keyof ProfileData, value: string) {
...}`), add:

```tsx
  async function handlePostalCodeBlur() {
    if (!form.postalCode) return;
    const address = await fetchAddressByCep(form.postalCode);
    if (address) {
      setForm((prev) => ({
        ...prev,
        street: address.street,
        neighborhood: address.neighborhood,
        city: address.city,
        state: address.state,
      }));
    }
  }

  function toggleNoNumber(checked: boolean) {
    setNoNumber(checked);
    set("number", checked ? "S/N" : "");
  }
```

- [ ] **Step 3: Remove `city`/`state` from the "Dados pessoais" card**

In the "Dados pessoais" card's grid, remove these two `<div>` blocks entirely (they move to the new
"Endereço" card in the next step):

```tsx
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade</label>
              <input type="text" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado (UF)</label>
              <input type="text" maxLength={2} value={form.state ?? ""} onChange={(e) => set("state", e.target.value.toUpperCase())}
                placeholder="SP" className="input w-full" />
            </div>
```

- [ ] **Step 4: Add the new "Endereço" card**

Insert this new card right after the closing `</div>` of the "Dados pessoais" card (`</div>` at the
end of that card, before the "Contato de emergência" card starts):

```tsx
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Endereço</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CEP *</label>
              <input
                type="text"
                value={form.postalCode ?? ""}
                onChange={(e) => set("postalCode", e.target.value)}
                onBlur={handlePostalCodeBlur}
                placeholder="00000-000"
                maxLength={9}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rua/Logradouro *</label>
              <input type="text" value={form.street ?? ""} onChange={(e) => set("street", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Número *</label>
              <input
                type="text"
                value={form.number ?? ""}
                onChange={(e) => set("number", e.target.value)}
                disabled={noNumber}
                className="input w-full disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
              />
              <label className="flex items-center gap-2 mt-1 text-sm text-gray-600 dark:text-gray-400">
                <input type="checkbox" checked={noNumber} onChange={(e) => toggleNoNumber(e.target.checked)} />
                Sem número
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Complemento</label>
              <input type="text" value={form.complement ?? ""} onChange={(e) => set("complement", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bairro *</label>
              <input type="text" value={form.neighborhood ?? ""} onChange={(e) => set("neighborhood", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade *</label>
              <input type="text" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estado (UF) *</label>
              <input type="text" maxLength={2} value={form.state ?? ""} onChange={(e) => set("state", e.target.value.toUpperCase())}
                placeholder="SP" className="input w-full" />
            </div>
          </div>
        </div>
```

No automated test (project convention — no UI component tests; the underlying save contract is
covered by Task 4's route tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Full suite**

Run: `npx vitest run`
Expected: no regressions anywhere in the project.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/perfil/page.tsx
git commit -m "feat: card de Endereco em Meus Dados, com autocomplete de CEP"
```

---

## Final check (after all 7 tasks)

- [ ] Run the full suite once more: `npx vitest run`
- [ ] Run `npx tsc --noEmit`
- [ ] Confirm the deploy note: this feature needs a schema migration
  (`prisma/migrations/20260821000000_add_athlete_address`) — on the VPS, apply it manually via
  `psql` (or `prisma migrate deploy`) **before** `prisma db push` in the existing 4-step deploy
  sequence, same pattern as every other schema change in this project. Do not deploy without
  explicit user authorization.
- [ ] Manual verification recommended once there's DB access: a brand-new athlete signup asking
  for address; an existing athlete without address being redirected to `/completar-cadastro` from
  both `/dashboard` and `/inscricao/[slug]`, completing just the missing fields, and being let
  through; editing an already-complete address in "Meus Dados"; the ViaCEP autocomplete actually
  filling street/neighborhood/city/state on a real CEP.
