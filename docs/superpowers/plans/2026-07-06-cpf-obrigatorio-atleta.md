# CPF Obrigatório para Atleta + Gate de Cadastro Incompleto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar CPF obrigatório (e validado) para todo atleta, bloqueando o acesso à plataforma e ao checkout de inscrição até que CPF e data de nascimento estejam preenchidos, e marcar com asterisco os campos obrigatórios na tela de cadastro.

**Architecture:** Um helper puro de validação de CPF (`lib/cpf.ts`) é consumido por três rotas de API que gravam `AthleteProfile.cpf` (cadastro, "Meus Dados", correção pelo admin). Um segundo helper (`lib/auth/profile-completion.ts`) verifica se um atleta tem `birthDate`/`cpf` preenchidos e é chamado a partir de dois pontos de entrada existentes (`app/dashboard/layout.tsx` e a página de checkout `/inscricao/[slug]`), redirecionando para uma nova página dedicada (`/completar-cadastro`) quando faltar algo. CPF vira `@unique` no schema (nullable, para não quebrar contas com cadastro ainda incompleto).

**Tech Stack:** Next.js (App Router, Server Components), Prisma, Zod, react-hook-form, Vitest.

## Global Constraints

- CPF validado pelo algoritmo oficial (dígitos verificadores), não só presença — rejeita sequências repetidas (`111.111.111-11`).
- CPF armazenado sempre normalizado (só dígitos, 11 caracteres) no banco.
- CPF é único por conta (`AthleteProfile.cpf` com `@unique`), mas o campo continua nullable.
- Uma vez que `AthleteProfile.cpf` do próprio atleta estiver preenchido, a API de perfil do atleta (`PUT /api/athlete/profile`) **ignora silenciosamente** qualquer tentativa de alterá-lo (não retorna erro) — só o admin pode corrigir.
- Campo de CPF do checkout (`components/checkout/CheckoutForm.tsx`, seção "Dados do cartão") **não muda nesta entrega**.
- Sem testes de UI (convenção já estabelecida no projeto) — só testes de `lib/` e rotas de API.
- Seguir a convenção já existente de marcar campo obrigatório com `*` literal no texto do label (ex.: `CPF do titular *`, já usado no checkout).

---

### Task 1: Utilitário de validação de CPF

**Files:**
- Create: `lib/cpf.ts`
- Test: `tests/cpf.test.ts`

**Interfaces:**
- Produces: `normalizeCpf(raw: string): string`, `isValidCpf(raw: string): boolean` — exportados de `lib/cpf.ts`, usados por todas as tarefas seguintes que lidam com CPF (client e server).

- [ ] **Step 1: Write the failing test**

Create `tests/cpf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeCpf, isValidCpf } from "@/lib/cpf";

describe("normalizeCpf", () => {
  it("remove pontuação e mantém só os dígitos", () => {
    expect(normalizeCpf("111.444.777-35")).toBe("11144477735");
  });

  it("mantém string já só com dígitos", () => {
    expect(normalizeCpf("11144477735")).toBe("11144477735");
  });
});

describe("isValidCpf", () => {
  it("aceita um CPF válido conhecido, com ou sem máscara", () => {
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCpf("11144477735")).toBe(true);
  });

  it("rejeita CPF com dígito verificador errado", () => {
    expect(isValidCpf("111.444.777-36")).toBe(false);
  });

  it("rejeita sequências com todos os dígitos iguais", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
  });

  it("rejeita tamanho errado", () => {
    expect(isValidCpf("123456789")).toBe(false);
    expect(isValidCpf("123456789012")).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(isValidCpf("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cpf.test.ts`
Expected: FAIL — `Cannot find module '@/lib/cpf'` (o arquivo ainda não existe).

- [ ] **Step 3: Write minimal implementation**

Create `lib/cpf.ts`:

```ts
export function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, "");
}

function calculateCheckDigit(digits: number[], length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += digits[i] * (length + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function isValidCpf(raw: string): boolean {
  const cpf = normalizeCpf(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const dv1 = calculateCheckDigit(digits, 9);
  const dv2 = calculateCheckDigit(digits, 10);

  return dv1 === digits[9] && dv2 === digits[10];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cpf.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/cpf.ts tests/cpf.test.ts
git commit -m "feat: add CPF validation utility"
```

---

### Task 2: CPF único no schema (`AthleteProfile.cpf`)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260706010000_athlete_cpf_unique/migration.sql` (gitignored — não será commitado, mas mantém o histórico local consistente com `prisma migrate dev`)

**Interfaces:**
- Produces: `AthleteProfile.cpf` continua `String?` no client do Prisma, agora com índice único no banco.

- [ ] **Step 1: Editar o schema**

Em `prisma/schema.prisma`, localizar o `model AthleteProfile` (por volta da linha 160-180) e mudar a linha do campo `cpf`:

```prisma
model AthleteProfile {
  id                 String    @id @default(cuid())
  userId             String    @unique
  cpf                String?   @unique
  birthDate          DateTime?
  ...
```

- [ ] **Step 2: Criar o arquivo de migração manualmente**

Criar o diretório e o arquivo (não é possível rodar `prisma migrate dev` contra o banco de produção neste ambiente):

```bash
mkdir -p "prisma/migrations/20260706010000_athlete_cpf_unique"
```

Criar `prisma/migrations/20260706010000_athlete_cpf_unique/migration.sql`:

```sql
-- Garante que cada CPF de atleta seja usado por no máximo uma conta.
-- Postgres permite múltiplos valores NULL num índice único, então contas
-- com cadastro ainda incompleto (cpf = NULL) não são afetadas.
CREATE UNIQUE INDEX "athlete_profiles_cpf_key" ON "athlete_profiles"("cpf");
```

- [ ] **Step 3: Regenerar o Prisma Client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sem erros (não precisa de conexão com o banco).

- [ ] **Step 4: Verificar que o projeto ainda compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: make AthleteProfile.cpf unique"
```

**⚠️ Passo manual obrigatório antes de aplicar em produção** (documentar isso na entrega, não é um passo de código): antes de rodar `prisma db push` no servidor, rodar esta query para checar duplicatas existentes:

```sql
SELECT cpf, COUNT(*) FROM athlete_profiles WHERE cpf IS NOT NULL GROUP BY cpf HAVING COUNT(*) > 1;
```

Se retornar alguma linha, resolver manualmente antes do `db push` (que falharia ao criar o índice único).

---

### Task 3: Helper de cadastro incompleto

**Files:**
- Create: `lib/auth/profile-completion.ts`
- Test: `tests/profile-completion.test.ts`

**Interfaces:**
- Consumes: `db.athleteProfile.findUnique` (Prisma client já mockado em `tests/setup.ts`).
- Produces: `type MissingAthleteField = "birthDate" | "cpf"` e `getMissingAthleteProfileFields(userId: string): Promise<MissingAthleteField[]>`, exportados de `lib/auth/profile-completion.ts` — usados pelas Tasks 8, 9 e 12.

- [ ] **Step 1: Write the failing test**

Create `tests/profile-completion.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";

const dbMock = db as any;

describe("getMissingAthleteProfileFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna lista vazia quando birthDate e cpf estão preenchidos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: new Date("1990-01-01"),
      cpf: "11144477735",
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual([]);
  });

  it("retorna birthDate e cpf quando não há perfil nenhum", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce(null);

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["birthDate", "cpf"]);
  });

  it("retorna só cpf quando birthDate já está preenchido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: new Date("1990-01-01"),
      cpf: null,
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["cpf"]);
  });

  it("retorna só birthDate quando cpf já está preenchido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({
      birthDate: null,
      cpf: "11144477735",
    });

    const missing = await getMissingAthleteProfileFields("user-1");

    expect(missing).toEqual(["birthDate"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/profile-completion.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth/profile-completion'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/auth/profile-completion.ts`:

```ts
import { db } from "@/lib/db";

export type MissingAthleteField = "birthDate" | "cpf";

export async function getMissingAthleteProfileFields(userId: string): Promise<MissingAthleteField[]> {
  const profile = await db.athleteProfile.findUnique({
    where: { userId },
    select: { birthDate: true, cpf: true },
  });

  const missing: MissingAthleteField[] = [];
  if (!profile?.birthDate) missing.push("birthDate");
  if (!profile?.cpf) missing.push("cpf");
  return missing;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/profile-completion.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/profile-completion.ts tests/profile-completion.test.ts
git commit -m "feat: add helper to detect missing required athlete profile fields"
```

---

### Task 4: CPF obrigatório e validado no cadastro (API)

**Files:**
- Modify: `app/api/auth/register/route.ts`
- Modify: `tests/setup.ts` (adicionar `findFirst` ao mock de `athleteProfile`, que hoje só tem `upsert`/`findUnique`/`findMany`)
- Test: `tests/register-route.test.ts` (novo)

**Interfaces:**
- Consumes: `normalizeCpf`, `isValidCpf` de `lib/cpf.ts` (Task 1).
- Produces: `POST /api/auth/register` passa a exigir `cpf` no body quando `role === "ATHLETE"`, validado e único.

- [ ] **Step 1: Adicionar `findFirst` ao mock global de `athleteProfile`**

Em `tests/setup.ts`, linha 21, trocar:

```ts
    athleteProfile: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
```

por:

```ts
    athleteProfile: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
```

- [ ] **Step 2: Write the failing test**

Create `tests/register-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "hashed-password") },
}));

import { POST } from "@/app/api/auth/register/route";

const dbMock = db as any;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

const validAthleteBody = {
  name: "Atleta Teste",
  email: "atleta@example.com",
  password: "12345678",
  role: "ATHLETE",
  birthDate: "1990-01-01",
  cpf: "111.444.777-35",
};

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.athleteProfile.findFirst.mockResolvedValue(null);
    dbMock.user.create.mockResolvedValue({
      id: "user-1",
      name: "Atleta Teste",
      email: "atleta@example.com",
      role: "ATHLETE",
    });
  });

  it("rejeita cadastro de atleta sem CPF", async () => {
    const { cpf, ...body } = validAthleteBody;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita CPF com dígito verificador inválido", async () => {
    const res = await POST(makeRequest({ ...validAthleteBody, cpf: "111.444.777-36" }));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita CPF já cadastrado em outra conta", async () => {
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce({ id: "profile-existente" });

    const res = await POST(makeRequest(validAthleteBody));

    expect(res.status).toBe(409);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("cria o atleta e o perfil com CPF normalizado quando os dados são válidos", async () => {
    const res = await POST(makeRequest(validAthleteBody));

    expect(res.status).toBe(201);
    expect(dbMock.athleteProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          cpf: "11144477735",
        }),
      }),
    );
  });

  it("não exige CPF para cadastro de organizador", async () => {
    dbMock.user.create.mockResolvedValueOnce({
      id: "user-2",
      name: "Organizador Teste",
      email: "organizador@example.com",
      role: "ORGANIZER",
    });

    const res = await POST(
      makeRequest({
        name: "Organizador Teste",
        email: "organizador@example.com",
        password: "12345678",
        role: "ORGANIZER",
      }),
    );

    expect(res.status).toBe(201);
    expect(dbMock.athleteProfile.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/register-route.test.ts`
Expected: FAIL — os testes de rejeição de CPF ausente/inválido/duplicado falham porque a rota atual aceita o cadastro sem CPF (não há esse campo ainda).

- [ ] **Step 4: Implementar a validação na rota**

Reescrever `app/api/auth/register/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

const registerSchema = z
  .object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(["ATHLETE", "ORGANIZER"]).default("ATHLETE"),
    birthDate: z.string().optional(),
    cpf: z.string().optional(),
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
  });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { name, email, password, role, birthDate, cpf } = parsed.data;

    const exists = await db.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
    }

    let normalizedCpf: string | undefined;
    if (role === "ATHLETE" && cpf) {
      normalizedCpf = normalizeCpf(cpf);
      const cpfTaken = await db.athleteProfile.findFirst({ where: { cpf: normalizedCpf } });
      if (cpfTaken) {
        return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await db.user.create({
      data: { name, email, passwordHash, role },
      select: { id: true, name: true, email: true, role: true },
    });

    if (role === "ATHLETE" && birthDate) {
      await db.athleteProfile.create({
        data: { userId: user.id, birthDate: new Date(birthDate), cpf: normalizedCpf },
      });
    }

    await db.auditLog.create({
      data: { userId: user.id, action: "USER_REGISTERED", entityType: "User", entityId: user.id },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    console.error("[register] error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/register-route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/auth/register/route.ts tests/register-route.test.ts tests/setup.ts
git commit -m "feat: require and validate CPF for athlete registration"
```

---

### Task 5: Campo de CPF e asteriscos na tela de cadastro (UI)

**Files:**
- Modify: `components/auth/RegisterForm.tsx`

**Interfaces:**
- Consumes: `isValidCpf` de `lib/cpf.ts` (Task 1); envia `cpf` no body de `POST /api/auth/register` (Task 4).

- [ ] **Step 1: Editar o formulário**

Reescrever `components/auth/RegisterForm.tsx`:

```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isValidCpf } from "@/lib/cpf";

const schema = z
  .object({
    name: z.string().min(2, "Nome muito curto"),
    email: z.string().email("E-mail inválido"),
    password: z.string().min(8, "Mínimo 8 caracteres"),
    role: z.enum(["ATHLETE", "ORGANIZER"]),
    birthDate: z.string().optional(),
    cpf: z.string().optional(),
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
  });

type FormData = z.infer<typeof schema>;

export default function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: "ATHLETE" },
  });
  const role = watch("role");

  async function onSubmit(data: FormData) {
    setError(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(body.error || "Erro ao criar conta");
      return;
    }

    router.push("/auth/login?registered=1");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nome completo *</label>
        <input {...register("name")} className="input-field" placeholder="Seu nome" />
        {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">E-mail *</label>
        <input type="email" {...register("email")} className="input-field" placeholder="seu@email.com" />
        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Senha *</label>
        <input type="password" {...register("password")} className="input-field" placeholder="Mínimo 8 caracteres" />
        {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de conta</label>
        <select {...register("role")} className="input-field">
          <option value="ATHLETE">Atleta</option>
          <option value="ORGANIZER">Organizador de eventos</option>
        </select>
      </div>

      {role === "ATHLETE" && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data de nascimento *</label>
            <input type="date" {...register("birthDate")} className="input-field" />
            {errors.birthDate && <p className="text-red-500 text-xs mt-1">{errors.birthDate.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CPF *</label>
            <input
              type="text"
              {...register("cpf")}
              className="input-field"
              placeholder="000.000.000-00"
              maxLength={14}
            />
            {errors.cpf && <p className="text-red-500 text-xs mt-1">{errors.cpf.message}</p>}
          </div>
        </>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? "Criando conta..." : "Criar conta"}
      </button>

      <p className="text-center text-sm text-gray-600">
        Já tem conta?{" "}
        <Link href="/auth/login" className="text-primary-600 hover:underline font-medium">
          Entrar
        </Link>
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 3: Commit**

```bash
git add components/auth/RegisterForm.tsx
git commit -m "feat: add CPF field and required-field asterisks to signup form"
```

---

### Task 6: CPF em "Meus Dados" — validado e bloqueado após salvo (API)

**Files:**
- Modify: `app/api/athlete/profile/route.ts`
- Test: `tests/athlete-profile-route.test.ts` (novo)

**Interfaces:**
- Consumes: `normalizeCpf`, `isValidCpf` de `lib/cpf.ts` (Task 1).
- Produces: `PUT /api/athlete/profile` aceita `cpf` no body, valida, checa unicidade, e ignora silenciosamente a alteração se o perfil já tiver `cpf` salvo.

- [ ] **Step 1: Write the failing test**

Create `tests/athlete-profile-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/athlete/profile/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/athlete/profile", {
    method: "PUT",
    body: JSON.stringify(body),
  }) as any;
}

describe("PUT /api/athlete/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
  });

  it("retorna 401 quando não autenticado", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await PUT(makeRequest({ cpf: "111.444.777-35" }));
    expect(res.status).toBe(401);
  });

  it("salva um CPF válido quando ainda não há CPF salvo", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce(null);
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({ cpf: "11144477735" });

    const res = await PUT(makeRequest({ cpf: "111.444.777-35" }));

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "athlete-1" },
        update: expect.objectContaining({ cpf: "11144477735" }),
      }),
    );
  });

  it("rejeita CPF com dígito verificador inválido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });

    const res = await PUT(makeRequest({ cpf: "111.444.777-36" }));

    expect(res.status).toBe(400);
    expect(dbMock.athleteProfile.upsert).not.toHaveBeenCalled();
  });

  it("rejeita CPF já usado por outra conta", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce({ id: "outro-perfil" });

    const res = await PUT(makeRequest({ cpf: "111.444.777-35" }));

    expect(res.status).toBe(409);
    expect(dbMock.athleteProfile.upsert).not.toHaveBeenCalled();
  });

  it("ignora tentativa de alterar CPF já salvo, sem erro", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: "11144477735" });
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({ cpf: "11144477735" });

    const res = await PUT(makeRequest({ cpf: "222.222.222-22" }));

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({ cpf: expect.anything() }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/athlete-profile-route.test.ts`
Expected: FAIL — a rota atual não valida nem trata `cpf` (o campo nem está no schema Zod), e `dbMock.athleteProfile.findFirst` ainda não existe no mock (mas Task 4 já deve ter adicionado isso ao `tests/setup.ts` — se este arquivo for implementado antes da Task 4 num worker paralelo, adicionar o mesmo ajuste em `tests/setup.ts` primeiro).

- [ ] **Step 3: Implementar na rota**

Reescrever `app/api/athlete/profile/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

const profileSchema = z.object({
  birthDate: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  emergencyName: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  medicalNotes: z.string().optional().nullable(),
  preferredShirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).optional().nullable(),
  teamName: z.string().optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const profile = await db.athleteProfile.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({ profile });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { cpf: incomingCpf, ...rest } = parsed.data;

  const existing = await db.athleteProfile.findUnique({
    where: { userId: session.user.id },
    select: { cpf: true },
  });

  const data: Record<string, unknown> = {
    ...rest,
    birthDate: rest.birthDate ? new Date(rest.birthDate) : null,
  };

  if (!existing?.cpf && incomingCpf) {
    const normalized = normalizeCpf(incomingCpf);
    if (!isValidCpf(normalized)) {
      return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
    }
    const taken = await db.athleteProfile.findFirst({
      where: { cpf: normalized, userId: { not: session.user.id } },
    });
    if (taken) {
      return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
    }
    data.cpf = normalized;
  }

  const profile = await db.athleteProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  });

  return NextResponse.json({ profile });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/athlete-profile-route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/athlete/profile/route.ts tests/athlete-profile-route.test.ts
git commit -m "feat: validate CPF and lock it after saved in athlete profile API"
```

---

### Task 7: Campo de CPF em "Meus Dados" (UI)

**Files:**
- Modify: `app/dashboard/perfil/page.tsx`

**Interfaces:**
- Consumes: `PUT /api/athlete/profile` (Task 6, aceita/ignora `cpf` conforme regra de bloqueio).

- [ ] **Step 1: Adicionar o campo `cpf` ao tipo `ProfileData`**

Em `app/dashboard/perfil/page.tsx`, linha 14-25, trocar:

```ts
type ProfileData = {
  birthDate?: string | null;
  phone?: string | null;
  gender?: string | null;
  city?: string | null;
  state?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  medicalNotes?: string | null;
  preferredShirtSize?: string | null;
  teamName?: string | null;
};
```

por:

```ts
type ProfileData = {
  birthDate?: string | null;
  cpf?: string | null;
  phone?: string | null;
  gender?: string | null;
  city?: string | null;
  state?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  medicalNotes?: string | null;
  preferredShirtSize?: string | null;
  teamName?: string | null;
};
```

- [ ] **Step 2: Adicionar o campo no formulário, com asterisco e bloqueio após salvo**

Em `app/dashboard/perfil/page.tsx`, dentro do primeiro `<div className="grid grid-cols-2 gap-4">` (dados pessoais), logo depois do bloco de "Data de nascimento" (linhas 113-117), adicionar:

```tsx
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Data de nascimento *
              </label>
              <input type="date" value={form.birthDate ?? ""} onChange={(e) => set("birthDate", e.target.value)}
                className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                CPF {!form.cpf && "*"}
              </label>
              <input
                type="text"
                value={form.cpf ?? ""}
                onChange={(e) => set("cpf", e.target.value)}
                placeholder="000.000.000-00"
                maxLength={14}
                disabled={Boolean(form.cpf)}
                className="input w-full disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-500"
              />
              {form.cpf && (
                <p className="text-xs text-gray-500 mt-1">
                  CPF confirmado não pode ser alterado. Em caso de erro, contate o suporte.
                </p>
              )}
            </div>
```

(note que o label de "Data de nascimento" também ganhou o `*`, já que é obrigatório).

- [ ] **Step 3: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/perfil/page.tsx
git commit -m "feat: add CPF field to athlete profile page, locked after saved"
```

---

### Task 8: Ligar o gate de cadastro incompleto ao dashboard e ao checkout

**Files:**
- Modify: `app/dashboard/layout.tsx`
- Modify: `app/(public)/inscricao/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getMissingAthleteProfileFields(userId: string): Promise<MissingAthleteField[]>` (Task 3).

- [ ] **Step 1: Editar `app/dashboard/layout.tsx`**

Reescrever o arquivo inteiro:

```tsx
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";
import DashboardNav from "@/components/dashboard/DashboardNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, appName] = await Promise.all([requireAuth(), getAppName()]);

  if (session.user.role === "ATHLETE") {
    const missing = await getMissingAthleteProfileFields(session.user.id);
    if (missing.length > 0) redirect("/completar-cadastro");
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <PageViewLogger />
      <DashboardNav userName={session.user.name} userRole={session.user.role} appName={appName} />
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Editar `app/(public)/inscricao/[slug]/page.tsx`**

No início da função `InscricaoPage` (linhas 42-48), trocar:

```tsx
export default async function InscricaoPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/inscricao/${(await params).slug}`);

  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
```

por:

```tsx
export default async function InscricaoPage({ params }: Props) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/inscricao/${slug}`);

  if (session.user.role === "ATHLETE") {
    const missing = await getMissingAthleteProfileFields(session.user.id);
    if (missing.length > 0) redirect(`/completar-cadastro?callbackUrl=/inscricao/${slug}`);
  }

  const event = await getEventBySlug(slug);
  if (!event) notFound();
```

E adicionar o import no topo do arquivo, junto aos outros imports (linha 1-9):

```tsx
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";
```

- [ ] **Step 3: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/layout.tsx "app/(public)/inscricao/[slug]/page.tsx"
git commit -m "feat: redirect athletes with incomplete profile to completar-cadastro"
```

---

### Task 9: Página `/completar-cadastro`

**Files:**
- Create: `app/completar-cadastro/layout.tsx`
- Create: `app/completar-cadastro/page.tsx`
- Create: `app/completar-cadastro/CompletarCadastroForm.tsx`

**Interfaces:**
- Consumes: `requireAuth()` (`lib/auth/rbac.ts`), `getMissingAthleteProfileFields` (Task 3), `isValidCpf` (Task 1), `PUT /api/athlete/profile` (Task 6).

- [ ] **Step 1: Criar o layout mínimo**

Create `app/completar-cadastro/layout.tsx`:

```tsx
import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";

export default async function CompletarCadastroLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const appName = await getAppName();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <p className="text-center text-sm font-semibold text-primary-700 dark:text-primary-400">{appName}</p>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar a página (server component)**

Create `app/completar-cadastro/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { requireAuth } from "@/lib/auth/rbac";
import { getMissingAthleteProfileFields } from "@/lib/auth/profile-completion";
import CompletarCadastroForm from "./CompletarCadastroForm";

const ROLE_HOME: Record<UserRole, string> = {
  ATHLETE: "/dashboard",
  ORGANIZER: "/organizador",
  ADMIN: "/admin",
  SUPPORT: "/admin",
  PARTNER: "/dashboard",
};

export default async function CompletarCadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await requireAuth();
  const { callbackUrl } = await searchParams;

  if (session.user.role !== "ATHLETE") {
    redirect(ROLE_HOME[session.user.role as UserRole] ?? "/dashboard");
  }

  const missing = await getMissingAthleteProfileFields(session.user.id);
  if (missing.length === 0) {
    redirect(callbackUrl || "/dashboard");
  }

  return (
    <div className="card space-y-4">
      <h1 className="text-xl font-bold">Complete seu cadastro</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Para continuar usando a plataforma, precisamos que você complete os dados obrigatórios abaixo.
      </p>
      <CompletarCadastroForm missingFields={missing} callbackUrl={callbackUrl} />
    </div>
  );
}
```

- [ ] **Step 3: Criar o formulário (client component)**

Create `app/completar-cadastro/CompletarCadastroForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isValidCpf } from "@/lib/cpf";
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsBirthDate = missingFields.includes("birthDate");
  const needsCpf = missingFields.includes("cpf");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (needsCpf && !isValidCpf(cpf)) {
      setError("Informe um CPF válido.");
      return;
    }

    setSaving(true);
    const body: Record<string, string> = {};
    if (needsBirthDate) body.birthDate = birthDate;
    if (needsCpf) body.cpf = cpf;

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

- [ ] **Step 4: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 5: Commit**

```bash
git add app/completar-cadastro
git commit -m "feat: add completar-cadastro page for athletes with incomplete profile"
```

---

### Task 10: Campos de CPF/nascimento na edição de usuário do admin (UI)

**Files:**
- Modify: `app/admin/usuarios/[id]/editar/page.tsx`
- Modify: `components/admin/UserForm.tsx`

**Interfaces:**
- Consumes: `PATCH /api/admin/users/[id]` (Task 11, que vai aceitar `cpf`/`birthDate`).

- [ ] **Step 1: Buscar o `athleteProfile` na página de edição**

Em `app/admin/usuarios/[id]/editar/page.tsx`, trocar a consulta (linhas 14-17):

```ts
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
```

por:

```ts
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      athleteProfile: { select: { cpf: true, birthDate: true } },
    },
  });
```

- [ ] **Step 2: Estender o tipo e o estado do `UserForm`**

Em `components/admin/UserForm.tsx`, trocar o tipo `InitialUser` (linhas 19-25):

```ts
type InitialUser = {
  id?: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
};
```

por:

```ts
type InitialUser = {
  id?: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  athleteProfile?: { cpf: string | null; birthDate: Date | string | null } | null;
};
```

Adicionar, junto aos outros `useState` (depois da linha 41):

```ts
  const [cpf, setCpf] = useState(initialUser?.athleteProfile?.cpf ?? "");
  const [birthDate, setBirthDate] = useState(
    initialUser?.athleteProfile?.birthDate
      ? new Date(initialUser.athleteProfile.birthDate).toISOString().split("T")[0]
      : "",
  );
```

- [ ] **Step 3: Incluir os campos no payload de envio**

Em `handleSubmit`, logo depois do bloco `if (!isEdit || password.trim())` (linhas 59-61), adicionar:

```ts
    if (isEdit && role === "ATHLETE") {
      if (cpf.trim()) payload.cpf = cpf.trim();
      if (birthDate) payload.birthDate = birthDate;
    }
```

- [ ] **Step 4: Adicionar os campos no JSX**

Depois do bloco `<div className="grid gap-4 md:grid-cols-2">` de Perfil/Status (linhas 109-133), adicionar:

```tsx
      {isEdit && role === "ATHLETE" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">CPF</label>
            <input
              className="input-field"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              maxLength={14}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Data de nascimento</label>
            <input
              type="date"
              className="input-field"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 6: Commit**

```bash
git add app/admin/usuarios/[id]/editar/page.tsx components/admin/UserForm.tsx
git commit -m "feat: let admin correct athlete CPF and birth date from user edit screen"
```

---

### Task 11: Aceitar CPF/nascimento na rota de edição de usuário do admin

**Files:**
- Modify: `app/api/admin/users/[id]/route.ts`
- Modify: `tests/admin-users-route.test.ts`

**Interfaces:**
- Consumes: `normalizeCpf`, `isValidCpf` de `lib/cpf.ts` (Task 1).
- Produces: `PATCH /api/admin/users/[id]` aceita `cpf`/`birthDate` opcionais no body, valida e faz upsert em `AthleteProfile`.

- [ ] **Step 1: Write the failing tests**

Em `tests/admin-users-route.test.ts`, adicionar estes três testes dentro do `describe("admin users API", ...)`, depois do teste `"updates a user and can change the password"`:

```ts
  it("corrige CPF e data de nascimento de um atleta", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", email: "atleta@exemplo.com" });
    dbMock.user.update.mockResolvedValueOnce({
      id: "user-1",
      name: "Atleta",
      email: "atleta@exemplo.com",
      role: "ATHLETE",
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce(null);
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({});

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({ cpf: "111.444.777-35", birthDate: "1990-01-01" }),
      }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        update: expect.objectContaining({ cpf: "11144477735", birthDate: new Date("1990-01-01") }),
      }),
    );
  });

  it("rejeita CPF inválido na correção do admin", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", email: "atleta@exemplo.com" });

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({ cpf: "111.444.777-36" }),
      }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("rejeita CPF já usado por outro atleta na correção do admin", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", email: "atleta@exemplo.com" });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce({ id: "outro-perfil" });

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({ cpf: "111.444.777-35" }),
      }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(409);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin-users-route.test.ts`
Expected: FAIL nos 3 novos testes — a rota atual não aceita `cpf`/`birthDate` no schema Zod, então esses campos são ignorados silenciosamente e `dbMock.athleteProfile.upsert` nunca é chamado.

- [ ] **Step 3: Implementar na rota**

Reescrever `app/api/admin/users/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

const roleSchema = z.enum(["ATHLETE", "ORGANIZER", "ADMIN", "SUPPORT", "PARTNER"]);

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  cpf: z.string().optional(),
  birthDate: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const incomingEmail = parsed.data.email?.toLowerCase();
  if (incomingEmail && incomingEmail !== existing.email) {
    const emailExists = await db.user.findUnique({ where: { email: incomingEmail } });
    if (emailExists && emailExists.id !== id) {
      return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
    }
  }

  let normalizedCpf: string | undefined;
  if (parsed.data.cpf) {
    normalizedCpf = normalizeCpf(parsed.data.cpf);
    if (!isValidCpf(normalizedCpf)) {
      return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
    }
    const cpfTaken = await db.athleteProfile.findFirst({
      where: { cpf: normalizedCpf, userId: { not: id } },
    });
    if (cpfTaken) {
      return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (incomingEmail) data.email = incomingEmail;
  if (parsed.data.role) data.role = parsed.data.role;
  if (typeof parsed.data.active === "boolean") data.active = parsed.data.active;
  if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 12);

  const user = await db.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });

  if (normalizedCpf || parsed.data.birthDate) {
    const athleteData: Record<string, unknown> = {};
    if (normalizedCpf) athleteData.cpf = normalizedCpf;
    if (parsed.data.birthDate) athleteData.birthDate = new Date(parsed.data.birthDate);

    await db.athleteProfile.upsert({
      where: { userId: id },
      create: { userId: id, ...athleteData },
      update: athleteData,
    });
  }

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: id,
      metadata: {
        ...data,
        ...(normalizedCpf ? { cpf: normalizedCpf } : {}),
        ...(parsed.data.birthDate ? { birthDate: parsed.data.birthDate } : {}),
        passwordHash: parsed.data.password ? "[redacted]" : undefined,
      },
    },
  });

  return NextResponse.json({ user });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  if (session.user.id === id) {
    return NextResponse.json({ error: "Você não pode excluir a sua própria conta" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const [orders, registrations] = await Promise.all([
    db.order.count({ where: { buyerUserId: id } }),
    db.registration.count({ where: { athleteUserId: id } }),
  ]);

  if (orders > 0 || registrations > 0) {
    return NextResponse.json(
      {
        error:
          "Usuários com pedidos ou inscrições vinculados não podem ser excluídos. Desative a conta em vez disso.",
      },
      { status: 409 },
    );
  }

  await db.$transaction(async (tx) => {
    await tx.auditLog.updateMany({
      where: { userId: id },
      data: { userId: null },
    });

    await tx.user.delete({ where: { id } });
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "USER_DELETED",
      entityType: "User",
      entityId: id,
      metadata: { id, email: user.email, name: user.name },
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin-users-route.test.ts`
Expected: PASS (10 tests — 7 já existentes + 3 novos).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/users/[id]/route.ts tests/admin-users-route.test.ts
git commit -m "feat: accept CPF and birth date correction in admin user edit route"
```

---

### Task 12: Verificação final

**Files:** nenhum (só execução de comandos de verificação).

- [ ] **Step 1: Rodar a suíte completa de testes**

Run: `npx vitest run`
Expected: todos os testes passando (a suíte anterior tinha 316 testes; esta feature adiciona os de `cpf.test.ts`, `profile-completion.test.ts`, `register-route.test.ts`, `athlete-profile-route.test.ts` e os 3 novos em `admin-users-route.test.ts`).

- [ ] **Step 2: Type-check completo**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 3: Lint dos arquivos alterados**

Run:
```bash
npx eslint lib/cpf.ts lib/auth/profile-completion.ts app/api/auth/register/route.ts components/auth/RegisterForm.tsx app/api/athlete/profile/route.ts app/dashboard/perfil/page.tsx app/dashboard/layout.tsx "app/(public)/inscricao/[slug]/page.tsx" app/completar-cadastro/layout.tsx app/completar-cadastro/page.tsx app/completar-cadastro/CompletarCadastroForm.tsx "app/admin/usuarios/[id]/editar/page.tsx" components/admin/UserForm.tsx app/api/admin/users/[id]/route.ts tests/cpf.test.ts tests/profile-completion.test.ts tests/register-route.test.ts tests/athlete-profile-route.test.ts tests/admin-users-route.test.ts
```
Expected: 0 erros (warnings de `no-explicit-any` nos arquivos de teste são aceitáveis, seguem o padrão já existente no projeto).

- [ ] **Step 4: Checklist de verificação manual (documentar, não é possível rodar localmente)**

Este ambiente não consegue conectar no banco de desenvolvimento (Supabase inacessível — problema pré-existente, não relacionado a esta feature). Depois do deploy, verificar manualmente:

1. Cadastrar um novo atleta sem CPF → deve ser bloqueado com mensagem de erro.
2. Cadastrar um novo atleta com CPF válido → conta criada, perfil já com CPF salvo.
3. Logar com uma conta de atleta **existente** (sem CPF) → deve redirecionar para `/completar-cadastro`.
4. Nessa tela, preencher CPF válido → deve salvar e redirecionar de volta para `/dashboard`.
5. Logar com outra conta de atleta sem CPF e ir direto para `/inscricao/<slug-de-um-evento-aberto>` → deve redirecionar para `/completar-cadastro?callbackUrl=/inscricao/<slug>` e, após salvar, voltar para a página de inscrição.
6. Em "Meus Dados", confirmar que o campo CPF fica desabilitado depois de salvo.
7. Como admin, editar o usuário desse atleta e confirmar que dá para corrigir CPF/nascimento por lá.
8. **Antes de aplicar em produção**: rodar a query de checagem de CPFs duplicados (Task 2) contra o banco de produção antes do `prisma db push`.

- [ ] **Step 5: Commit final (se houver ajustes desta etapa)**

```bash
git status
```

Se tudo já estiver commitado nas tarefas anteriores, nenhuma ação adicional é necessária aqui.
