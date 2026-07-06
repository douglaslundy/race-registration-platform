# Edição de Dados do Atleta por Admin/Organizador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que admin e organizador editem nome, e-mail, CPF, nascimento e todo o perfil do
atleta (telefone, gênero, cidade, estado, equipe, camiseta) direto no modal "Ver dados do atleta",
com organizador restrito a atletas inscritos em eventos dele. O atleta continua sem poder alterar o
próprio CPF (nenhuma mudança nessa regra).

**Architecture:** Duas rotas PATCH gravam em `User`+`AthleteProfile` via `upsert` dentro de uma
transação: `PATCH /api/admin/users/[id]` (existente, estendida) e `PATCH
/api/organizer/registrations/[id]/athlete` (nova, autorizada por posse da inscrição). O componente
compartilhado `AthleteDetailsModal` ganha um modo de edição, usado nas 3 telas onde já aparece hoje
em modo leitura.

**Tech Stack:** Next.js (App Router, Server Components), Prisma, Zod, Vitest.

## Global Constraints

- Campos editáveis por admin/organizador: nome, e-mail, CPF, nascimento, telefone, gênero, cidade,
  estado, equipe, tamanho de camiseta. Senha, papel (role) e status ativo/bloqueado **não** entram —
  continuam exclusivos de `/admin/usuarios/[id]/editar`.
- Organizador só edita atletas com pelo menos uma inscrição em evento dele (autorização por posse
  da `Registration`, não do `User`).
- CPF validado com `isValidCpf`/`normalizeCpf` de `lib/cpf.ts`; unicidade checada excluindo o
  próprio usuário. Sem trava de "CPF já salvo não pode mudar" para admin/organizador (essa trava é
  só para o próprio atleta em `PUT /api/athlete/profile`, que não é tocado neste plano).
- Sem testes de UI, seguindo a convenção já estabelecida no projeto.

---

### Task 1: Estender `PATCH /api/admin/users/[id]` com os campos de perfil restantes

**Files:**
- Modify: `app/api/admin/users/[id]/route.ts`
- Modify: `tests/admin-users-route.test.ts`

**Interfaces:**
- Consumes: `isValidCpf`, `normalizeCpf` de `lib/cpf.ts` (já importados na rota).
- Produces: `PATCH /api/admin/users/[id]` aceita agora `phone`, `gender`, `city`, `state`,
  `teamName`, `preferredShirtSize` no body (além de `cpf`/`birthDate` já existentes), gravados via
  `athleteProfile.upsert`.

- [ ] **Step 1: Write the failing test**

Em `tests/admin-users-route.test.ts`, adicionar este teste logo depois do teste
`"corrige CPF e data de nascimento de um atleta"` (por volta da linha 254):

```ts
  it("atualiza campos adicionais do perfil do atleta", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", email: "atleta@exemplo.com" });
    const txUserUpdate = vi.fn().mockResolvedValueOnce({
      id: "user-1",
      name: "Atleta",
      email: "atleta@exemplo.com",
      role: "ATHLETE",
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const txAthleteProfileUpsert = vi.fn().mockResolvedValueOnce({});
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        user: { update: txUserUpdate },
        athleteProfile: { upsert: txAthleteProfileUpsert },
        auditLog: { create: vi.fn() },
      }),
    );

    const res = await PATCH(
      new Request("http://localhost/api/admin/users/user-1", {
        method: "PATCH",
        body: JSON.stringify({
          phone: "11999998888",
          gender: "F",
          city: "São Paulo",
          state: "SP",
          teamName: "Equipe X",
          preferredShirtSize: "M",
        }),
      }) as any,
      { params: Promise.resolve({ id: "user-1" }) },
    );

    expect(res.status).toBe(200);
    expect(txAthleteProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        update: {
          phone: "11999998888",
          gender: "F",
          city: "São Paulo",
          state: "SP",
          teamName: "Equipe X",
          preferredShirtSize: "M",
        },
      }),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin-users-route.test.ts`
Expected: FAIL — o teste novo falha porque `txAthleteProfileUpsert` nunca é chamado (a rota atual só
faz upsert quando `cpf`/`birthDate` estão presentes; os outros campos são descartados pelo Zod).

- [ ] **Step 3: Editar o schema e a lógica da rota**

Em `app/api/admin/users/[id]/route.ts`, trocar o `patchSchema` (linhas 11-19):

```ts
const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  cpf: z.string().optional(),
  birthDate: z.string().optional(),
});
```

por:

```ts
const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  cpf: z.string().optional(),
  birthDate: z.string().optional(),
  phone: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
  preferredShirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).nullable().optional(),
});
```

Trocar o bloco que monta `athleteData` e chama o upsert (linhas 77-87):

```ts
      if (normalizedCpf || parsed.data.birthDate) {
        const athleteData: Record<string, unknown> = {};
        if (normalizedCpf) athleteData.cpf = normalizedCpf;
        if (parsed.data.birthDate) athleteData.birthDate = new Date(parsed.data.birthDate);

        await tx.athleteProfile.upsert({
          where: { userId: id },
          create: { userId: id, ...athleteData },
          update: athleteData,
        });
      }
```

por:

```ts
      const athleteData: Record<string, unknown> = {};
      if (normalizedCpf) athleteData.cpf = normalizedCpf;
      if (parsed.data.birthDate) athleteData.birthDate = new Date(parsed.data.birthDate);
      if (parsed.data.phone !== undefined) athleteData.phone = parsed.data.phone;
      if (parsed.data.gender !== undefined) athleteData.gender = parsed.data.gender;
      if (parsed.data.city !== undefined) athleteData.city = parsed.data.city;
      if (parsed.data.state !== undefined) athleteData.state = parsed.data.state;
      if (parsed.data.teamName !== undefined) athleteData.teamName = parsed.data.teamName;
      if (parsed.data.preferredShirtSize !== undefined) {
        athleteData.preferredShirtSize = parsed.data.preferredShirtSize;
      }

      if (Object.keys(athleteData).length > 0) {
        await tx.athleteProfile.upsert({
          where: { userId: id },
          create: { userId: id, ...athleteData },
          update: athleteData,
        });
      }
```

Trocar o metadata do audit log (linhas 89-102) para incluir os novos campos:

```ts
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: id,
          metadata: {
            ...data,
            ...athleteData,
            passwordHash: parsed.data.password ? "[redacted]" : undefined,
          },
        },
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin-users-route.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo o novo).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/users/[id]/route.ts tests/admin-users-route.test.ts
git commit -m "feat: let admin edit full athlete profile fields, not just CPF/birthDate"
```

---

### Task 2: Nova rota `PATCH /api/organizer/registrations/[id]/athlete`

**Files:**
- Create: `app/api/organizer/registrations/[id]/athlete/route.ts`
- Test: `tests/organizer-registration-athlete-route.test.ts` (novo)

**Interfaces:**
- Consumes: `isValidCpf`, `normalizeCpf` de `lib/cpf.ts`.
- Produces: `PATCH /api/organizer/registrations/[id]/athlete` — `id` é o id da `Registration`
  (não do `User`). Aceita `name`, `email`, `cpf`, `birthDate`, `phone`, `gender`, `city`, `state`,
  `teamName`, `preferredShirtSize`. Retorna `{ user: { id, name, email } }` em caso de sucesso.

- [ ] **Step 1: Write the failing test**

Create `tests/organizer-registration-athlete-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PATCH } from "@/app/api/organizer/registrations/[id]/athlete/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/registrations/reg-1/athlete", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("PATCH /api/organizer/registrations/[id]/athlete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        user: { update: vi.fn().mockResolvedValue({ id: "athlete-1", name: "Atleta", email: "atleta@exemplo.com" }) },
        athleteProfile: { upsert: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    );
  });

  it("retorna 403 para quem não é organizador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await PATCH(makeRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findFirst).not.toHaveBeenCalled();
  });

  it("retorna 404 quando a inscrição não pertence a evento do organizador", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "reg-1" }) });
    expect(res.status).toBe(404);
    expect(dbMock.registration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reg-1", event: { organizer: { userId: "organizer-1" } } },
      }),
    );
  });

  it("rejeita CPF inválido", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });

    const res = await PATCH(makeRequest({ cpf: "111.444.777-36" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejeita CPF já usado por outro atleta", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce({ id: "outro-perfil" });

    const res = await PATCH(makeRequest({ cpf: "111.444.777-35" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(409);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejeita e-mail já usado por outra conta", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "outro-user", email: "novo@exemplo.com" });

    const res = await PATCH(makeRequest({ email: "novo@exemplo.com" }), { params: Promise.resolve({ id: "reg-1" }) });

    expect(res.status).toBe(409);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("atualiza todos os campos do atleta e grava auditoria", async () => {
    dbMock.registration.findFirst.mockResolvedValueOnce({ athleteUserId: "athlete-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "athlete-1", email: "atleta@exemplo.com" });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce(null);

    const txUserUpdate = vi.fn().mockResolvedValueOnce({
      id: "athlete-1",
      name: "Nome Corrigido",
      email: "corrigido@exemplo.com",
    });
    const txAthleteProfileUpsert = vi.fn().mockResolvedValueOnce({});
    const txAuditLogCreate = vi.fn();
    dbMock.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        user: { update: txUserUpdate },
        athleteProfile: { upsert: txAthleteProfileUpsert },
        auditLog: { create: txAuditLogCreate },
      }),
    );

    const res = await PATCH(
      makeRequest({
        name: "Nome Corrigido",
        email: "corrigido@exemplo.com",
        cpf: "111.444.777-35",
        birthDate: "1990-01-01",
        phone: "11999998888",
        gender: "F",
        city: "São Paulo",
        state: "SP",
        teamName: "Equipe X",
        preferredShirtSize: "M",
      }),
      { params: Promise.resolve({ id: "reg-1" }) },
    );

    expect(res.status).toBe(200);
    expect(txUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "athlete-1" },
        data: { name: "Nome Corrigido", email: "corrigido@exemplo.com" },
      }),
    );
    expect(txAthleteProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "athlete-1" },
        update: expect.objectContaining({
          cpf: "11144477735",
          birthDate: new Date("1990-01-01"),
          phone: "11999998888",
          gender: "F",
          city: "São Paulo",
          state: "SP",
          teamName: "Equipe X",
          preferredShirtSize: "M",
        }),
      }),
    );
    expect(txAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "organizer-1",
          action: "USER_UPDATED",
          entityType: "User",
          entityId: "athlete-1",
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/organizer-registration-athlete-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/organizer/registrations/[id]/athlete/route'` (o
arquivo ainda não existe).

- [ ] **Step 3: Write the route**

Create `app/api/organizer/registrations/[id]/athlete/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  cpf: z.string().optional(),
  birthDate: z.string().optional(),
  phone: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
  preferredShirtSize: z.enum(["PP", "P", "M", "G", "GG", "XGG"]).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: { athleteUserId: true },
  });
  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const userId = registration.athleteUserId;
  const existing = await db.user.findUnique({ where: { id: userId } });
  if (!existing) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const incomingEmail = parsed.data.email?.toLowerCase();
  if (incomingEmail && incomingEmail !== existing.email) {
    const emailExists = await db.user.findUnique({ where: { email: incomingEmail } });
    if (emailExists && emailExists.id !== userId) {
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
      where: { cpf: normalizedCpf, userId: { not: userId } },
    });
    if (cpfTaken) {
      return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
    }
  }

  if (parsed.data.birthDate && Number.isNaN(new Date(parsed.data.birthDate).getTime())) {
    return NextResponse.json({ error: "Data de nascimento inválida" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (incomingEmail) data.email = incomingEmail;

  const athleteData: Record<string, unknown> = {};
  if (normalizedCpf) athleteData.cpf = normalizedCpf;
  if (parsed.data.birthDate) athleteData.birthDate = new Date(parsed.data.birthDate);
  if (parsed.data.phone !== undefined) athleteData.phone = parsed.data.phone;
  if (parsed.data.gender !== undefined) athleteData.gender = parsed.data.gender;
  if (parsed.data.city !== undefined) athleteData.city = parsed.data.city;
  if (parsed.data.state !== undefined) athleteData.state = parsed.data.state;
  if (parsed.data.teamName !== undefined) athleteData.teamName = parsed.data.teamName;
  if (parsed.data.preferredShirtSize !== undefined) {
    athleteData.preferredShirtSize = parsed.data.preferredShirtSize;
  }

  let user;
  try {
    user = await db.$transaction(async (tx) => {
      const updatedUser =
        Object.keys(data).length > 0
          ? await tx.user.update({
              where: { id: userId },
              data,
              select: { id: true, name: true, email: true },
            })
          : { id: userId, name: existing.name, email: existing.email };

      if (Object.keys(athleteData).length > 0) {
        await tx.athleteProfile.upsert({
          where: { userId },
          create: { userId, ...athleteData },
          update: athleteData,
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: userId,
          metadata: { ...data, ...athleteData },
        },
      });

      return updatedUser;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ user });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/organizer-registration-athlete-route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/organizer/registrations/[id]/athlete/route.ts tests/organizer-registration-athlete-route.test.ts
git commit -m "feat: let organizer edit athlete data for their own event registrations"
```

---

### Task 3: Buscar `id` do atleta nas telas de Inscritos e propagar o tipo

**Files:**
- Modify: `app/admin/eventos/[id]/inscritos/page.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`
- Modify: `components/registrations/RegistrationsTable.tsx`

**Interfaces:**
- Produces: `RegistrationRow.athlete.id: string`, usado pela Task 5 para montar as URLs de edição.

- [ ] **Step 1: Adicionar `id: true` ao select do atleta em `app/admin/eventos/[id]/inscritos/page.tsx`**

Trocar (por volta da linha 64-67):

```ts
      athlete: {
        select: {
          name: true,
          email: true,
```

por:

```ts
      athlete: {
        select: {
          id: true,
          name: true,
          email: true,
```

- [ ] **Step 2: Mesma mudança em `app/organizador/eventos/[id]/inscritos/page.tsx`**

Trocar (por volta da linha 68-71):

```ts
      athlete: {
        select: {
          name: true,
          email: true,
```

por:

```ts
      athlete: {
        select: {
          id: true,
          name: true,
          email: true,
```

- [ ] **Step 3: Adicionar `id` ao tipo `RegistrationRow`**

Em `components/registrations/RegistrationsTable.tsx`, trocar (linhas 30-33):

```ts
  athlete: {
    name: string;
    email: string;
```

por:

```ts
  athlete: {
    id: string;
    name: string;
    email: string;
```

- [ ] **Step 4: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 5: Commit**

```bash
git add app/admin/eventos/'[id]'/inscritos/page.tsx app/organizador/eventos/'[id]'/inscritos/page.tsx components/registrations/RegistrationsTable.tsx
git commit -m "feat: select athlete id in registrations queries for edit action wiring"
```

---

### Task 4: Modo de edição no `AthleteDetailsModal`

**Files:**
- Modify: `components/registrations/AthleteDetailsModal.tsx`

**Interfaces:**
- Consumes: `isValidCpf`, `normalizeCpf` de `lib/cpf.ts`; `formatDate` de `lib/format.ts`.
- Produces: novo prop opcional `editEndpoint?: string` — quando presente, mostra o botão "Editar"
  que abre um formulário dentro do próprio modal e faz `PATCH` nessa URL ao salvar.

- [ ] **Step 1: Reescrever o componente**

Rewrite `components/registrations/AthleteDetailsModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

const GENDERS = [
  { value: "M", label: "Masculino" },
  { value: "F", label: "Feminino" },
  { value: "NB", label: "Não-binário" },
  { value: "OTHER", label: "Prefiro não informar" },
];

const SHIRT_SIZES = ["PP", "P", "M", "G", "GG", "XGG"] as const;

interface AthleteProfileData {
  cpf: string | null;
  birthDate: Date | string | null;
  phone: string | null;
  gender: string | null;
  city: string | null;
  state: string | null;
  teamName: string | null;
  preferredShirtSize: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface RegistrationContextData {
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
}

interface AthleteDetailsModalProps {
  athleteName: string;
  athleteEmail: string;
  profile: AthleteProfileData | null;
  registrationContext?: RegistrationContextData;
  editEndpoint?: string;
}

interface EditFormState {
  name: string;
  email: string;
  cpf: string;
  birthDate: string;
  phone: string;
  gender: string;
  city: string;
  state: string;
  teamName: string;
  preferredShirtSize: string;
}

function toDateInputValue(value: Date | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().split("T")[0];
}

export default function AthleteDetailsModal({
  athleteName,
  athleteEmail,
  profile,
  registrationContext,
  editEndpoint,
}: AthleteDetailsModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setForm({
      name: athleteName,
      email: athleteEmail,
      cpf: profile?.cpf ?? "",
      birthDate: toDateInputValue(profile?.birthDate ?? null),
      phone: profile?.phone ?? "",
      gender: profile?.gender ?? "",
      city: profile?.city ?? "",
      state: profile?.state ?? "",
      teamName: profile?.teamName ?? "",
      preferredShirtSize: profile?.preferredShirtSize ?? "",
    });
    setError(null);
    setMode("edit");
  }

  function cancelEdit() {
    setMode("view");
    setError(null);
  }

  function setField(field: keyof EditFormState, value: string) {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function handleSave() {
    if (!form || !editEndpoint) return;
    setError(null);

    if (form.cpf && !isValidCpf(form.cpf)) {
      setError("CPF inválido.");
      return;
    }

    setSaving(true);
    const res = await fetch(editEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        cpf: form.cpf ? normalizeCpf(form.cpf) : undefined,
        birthDate: form.birthDate || undefined,
        phone: form.phone || null,
        gender: form.gender || null,
        city: form.city || null,
        state: form.state || null,
        teamName: form.teamName || null,
        preferredShirtSize: form.preferredShirtSize || null,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao salvar os dados.");
      return;
    }

    setMode("view");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-primary-600 hover:underline"
      >
        Ver dados do atleta
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => {
            setOpen(false);
            setMode("view");
          }}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {mode === "view" ? (
              <>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{athleteName}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{athleteEmail}</p>

                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                    Perfil do atleta
                  </h3>
                  {profile ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-gray-500">CPF</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.cpf ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Nascimento</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {profile.birthDate ? formatDate(profile.birthDate, "dd/MM/yyyy") : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Telefone</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.phone ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Gênero</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.gender ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Cidade</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.city ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Estado</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.state ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Equipe</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.teamName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Camiseta preferida</dt>
                        <dd className="text-gray-800 dark:text-gray-200">{profile.preferredShirtSize ?? "—"}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Este atleta ainda não preencheu o perfil.
                    </p>
                  )}
                </div>

                {registrationContext && (
                  <div className="mt-4">
                    <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2">
                      Dados desta inscrição
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-gray-500">Contato de emergência</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.emergencyContactName ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-500">Telefone de emergência</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.emergencyContactPhone ?? "—"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-gray-500">Observações médicas</dt>
                        <dd className="text-gray-800 dark:text-gray-200">
                          {registrationContext.medicalNotes ?? "—"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}

                {profile && (
                  <p className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
                    Cadastrado em {formatDate(profile.createdAt, "dd/MM/yyyy HH:mm")} · Última atualização em{" "}
                    {formatDate(profile.updatedAt, "dd/MM/yyyy HH:mm")}
                  </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                  {editEndpoint && (
                    <button
                      type="button"
                      onClick={startEdit}
                      className="px-4 py-2 text-sm rounded-lg border border-primary-500 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    >
                      Editar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              form && (
                <>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar dados do atleta</h2>

                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Nome</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setField("name", e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">E-mail</label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setField("email", e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">CPF</label>
                      <input
                        type="text"
                        value={form.cpf}
                        onChange={(e) => setField("cpf", e.target.value)}
                        placeholder="000.000.000-00"
                        maxLength={14}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nascimento</label>
                      <input
                        type="date"
                        value={form.birthDate}
                        onChange={(e) => setField("birthDate", e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Telefone</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setField("phone", e.target.value)}
                        placeholder="(11) 99999-9999"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Gênero</label>
                      <select
                        value={form.gender}
                        onChange={(e) => setField("gender", e.target.value)}
                        className="input-field"
                      >
                        <option value="">Selecione</option>
                        {GENDERS.map((g) => (
                          <option key={g.value} value={g.value}>{g.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Cidade</label>
                      <input
                        type="text"
                        value={form.city}
                        onChange={(e) => setField("city", e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Estado (UF)</label>
                      <input
                        type="text"
                        maxLength={2}
                        value={form.state}
                        onChange={(e) => setField("state", e.target.value.toUpperCase())}
                        placeholder="SP"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Equipe</label>
                      <input
                        type="text"
                        value={form.teamName}
                        onChange={(e) => setField("teamName", e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Camiseta</label>
                      <select
                        value={form.preferredShirtSize}
                        onChange={(e) => setField("preferredShirtSize", e.target.value)}
                        className="input-field"
                      >
                        <option value="">Selecione</option>
                        {SHIRT_SIZES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {error && (
                    <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm dark:bg-red-900/20 dark:border-red-900 dark:text-red-400">
                      {error}
                    </div>
                  )}

                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={saving}
                      className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="btn-primary text-sm"
                    >
                      {saving ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros) — `editEndpoint` é opcional, então os 3 callers que ainda não o
passam (só ligados na Task 5) continuam válidos como estão.

- [ ] **Step 3: Commit**

```bash
git add components/registrations/AthleteDetailsModal.tsx
git commit -m "feat: add edit mode to AthleteDetailsModal for admin/organizer"
```

---

### Task 5: Ligar `editEndpoint` nas 3 telas que usam o modal

**Files:**
- Modify: `app/admin/usuarios/page.tsx`
- Modify: `app/admin/eventos/[id]/inscritos/page.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`
- Modify: `components/registrations/RegistrationsTable.tsx`

**Interfaces:**
- Consumes: `RegistrationRow.athlete.id` (Task 3), `editEndpoint` prop do `AthleteDetailsModal`
  (Task 4).

- [ ] **Step 1: `RegistrationsTable` repassa um `editEndpoint` por linha**

Em `components/registrations/RegistrationsTable.tsx`, trocar a assinatura do componente (linhas
55-61):

```ts
export default function RegistrationsTable({
  registrations,
  renderActions,
}: {
  registrations: RegistrationRow[];
  renderActions?: (registration: RegistrationRow) => ReactNode;
}) {
```

por:

```ts
export default function RegistrationsTable({
  registrations,
  renderActions,
  editEndpoint,
}: {
  registrations: RegistrationRow[];
  renderActions?: (registration: RegistrationRow) => ReactNode;
  editEndpoint?: (registration: RegistrationRow) => string;
}) {
```

E no local onde `AthleteDetailsModal` é renderizado (linhas 89-97), trocar:

```tsx
                  <AthleteDetailsModal
                    athleteName={r.athlete.name}
                    athleteEmail={r.athlete.email}
                    profile={r.athlete.athleteProfile}
                    registrationContext={{
                      emergencyContactName: r.emergencyContactName,
                      emergencyContactPhone: r.emergencyContactPhone,
                      medicalNotes: r.medicalNotes,
                    }}
```

por:

```tsx
                  <AthleteDetailsModal
                    athleteName={r.athlete.name}
                    athleteEmail={r.athlete.email}
                    profile={r.athlete.athleteProfile}
                    editEndpoint={editEndpoint?.(r)}
                    registrationContext={{
                      emergencyContactName: r.emergencyContactName,
                      emergencyContactPhone: r.emergencyContactPhone,
                      medicalNotes: r.medicalNotes,
                    }}
```

- [ ] **Step 2: Admin → Inscritos passa a URL do endpoint do admin**

Em `app/admin/eventos/[id]/inscritos/page.tsx`, localizar o uso de `<RegistrationsTable` (dentro do
`return`) e adicionar o prop `editEndpoint`:

```tsx
        <RegistrationsTable
          registrations={registrations}
          editEndpoint={(r) => `/api/admin/users/${r.athlete.id}`}
          renderActions={(r) => {
```

(mantendo o resto do `renderActions` já existente sem mudanças).

- [ ] **Step 3: Organizador → Inscritos passa a URL do endpoint do organizador**

Em `app/organizador/eventos/[id]/inscritos/page.tsx`, mesma coisa:

```tsx
        <RegistrationsTable
          registrations={registrations}
          editEndpoint={(r) => `/api/organizer/registrations/${r.id}/athlete`}
          renderActions={(r) => {
```

- [ ] **Step 4: Admin → Usuários passa a URL do endpoint do admin**

Em `app/admin/usuarios/page.tsx`, trocar (linhas 317-321):

```tsx
                      <AthleteDetailsModal
                        athleteName={u.name}
                        athleteEmail={u.email}
                        profile={u.athleteProfile}
                      />
```

por:

```tsx
                      <AthleteDetailsModal
                        athleteName={u.name}
                        athleteEmail={u.email}
                        profile={u.athleteProfile}
                        editEndpoint={`/api/admin/users/${u.id}`}
                      />
```

- [ ] **Step 5: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 6: Commit**

```bash
git add app/admin/usuarios/page.tsx app/admin/eventos/'[id]'/inscritos/page.tsx app/organizador/eventos/'[id]'/inscritos/page.tsx components/registrations/RegistrationsTable.tsx
git commit -m "feat: wire edit endpoints into the 3 athlete details modal call sites"
```

---

### Task 6: Centralizar o conteúdo da página "Meus Dados"

**Files:**
- Modify: `app/dashboard/perfil/page.tsx`

- [ ] **Step 1: Adicionar `mx-auto` ao container**

Trocar (linha 102):

```tsx
    <div className="max-w-2xl space-y-6">
```

por:

```tsx
    <div className="max-w-2xl mx-auto space-y-6">
```

- [ ] **Step 2: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/perfil/page.tsx
git commit -m "fix: center 'Meus Dados' page content on wide screens"
```

---

### Task 7: Verificação final

**Files:** nenhum (só validação).

- [ ] **Step 1: Rodar toda a suíte de testes**

Run: `npx vitest run`
Expected: todos os testes passando (nenhuma regressão nos arquivos tocados nas Tasks 1-2).

- [ ] **Step 2: Rodar o type-check completo**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 3: Checklist de verificação manual (documentar resultado, não é automatizável)**

- Organizador logado edita um atleta inscrito em evento próprio pelo modal em Inscritos → salva →
  dado aparece atualizado após o `router.refresh()`.
- Chamada direta a `PATCH /api/organizer/registrations/[id]/athlete` com uma inscrição de evento de
  **outro** organizador retorna 404.
- Admin edita todos os campos (nome, e-mail, CPF, nascimento, telefone, gênero, cidade, estado,
  equipe, camiseta) pelo modal em Admin→Usuários e em Admin→Inscritos.
- Atleta logado em "Meus Dados" continua sem conseguir alterar o próprio CPF depois de salvo (sem
  mudança de comportamento nesta entrega, só confirmação).
