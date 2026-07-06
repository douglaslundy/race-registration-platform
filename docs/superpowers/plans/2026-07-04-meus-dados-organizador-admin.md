# Página "Meus Dados" completa para organizador e admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a `ORGANIZER` e `ADMIN` uma página "Meus Dados" completa (nome, telefone, CPF, troca
de senha), reaproveitando o padrão já existente na área do atleta.

**Architecture:** Um campo novo no schema (`User.cpf`), um componente de troca de senha
compartilhado, duas rotas de API estendidas/novas (uma por papel, escopadas ao `User` — dados de
organização em `OrganizerProfile` continuam intocados), e renomeação de rótulo nos dois menus.

**Tech Stack:** Next.js (App Router), React, TypeScript, Prisma, Zod, Vitest.

## Global Constraints

- E-mail **não** é editável em nenhuma das páginas — continua só como texto (decisão explícita do
  usuário).
- CPF é opcional, sem constraint de unicidade, validado só por tamanho máximo (`max(14)`) — mesmo
  padrão já usado para CPF no schema de checkout (`app/api/checkout/route.ts`).
- A aplicação da migração de banco (rodar contra o banco real, seja dev ou produção) fica **fora**
  do escopo automatizado deste plano — só a migração de schema local (`schema.prisma` + arquivo
  SQL de migração) é criada. Aplicar a migração é uma ação de deploy que precisa de confirmação
  explícita do usuário, seguindo o padrão já estabelecido nesta sessão.
- Nenhuma mudança na página `/dashboard/perfil` do atleta — ela mantém seu formulário de senha
  embutido, sem usar o componente novo.
- `/api/organizer/profile` (dados da empresa, em `OrganizerProfile`) não é alterado por este
  plano — só a rota nova `/api/organizer/account` (dados pessoais, em `User`).

---

### Task 1: Adicionar `cpf` ao model `User`

**Files:**
- Modify: `prisma/schema.prisma` (model `User`, linhas 95-119)
- Create: `prisma/migrations/20260704000000_add_user_cpf/migration.sql`

**Interfaces:**
- Consumes: nenhuma.
- Produces: campo `cpf String?` no model `User`, usado pelas Tasks 3 e 5 (rotas de API).

- [ ] **Step 1: Adicionar o campo ao schema**

Em `prisma/schema.prisma`, no model `User` (atualmente):

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  passwordHash  String?
  name          String
  phone         String?
  role          UserRole  @default(ATHLETE)
  active        Boolean   @default(true)
  uiDensity     String    @default("comfortable")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
```

Adicione o campo `cpf` logo depois de `phone`:

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  passwordHash  String?
  name          String
  phone         String?
  cpf           String?
  role          UserRole  @default(ATHLETE)
  active        Boolean   @default(true)
  uiDensity     String    @default("comfortable")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
```

- [ ] **Step 2: Criar o arquivo de migração à mão**

Este projeto não pode depender de conexão com o banco de dados durante a implementação (o banco
de desenvolvimento é intermitente nesta sessão). Em vez de rodar `prisma migrate dev` (que exige
conexão), crie a migração manualmente, seguindo o padrão exato das migrações já existentes em
`prisma/migrations/`.

Crie a pasta `prisma/migrations/20260704000000_add_user_cpf/` com o arquivo `migration.sql`:

```sql
-- CPF do usuário (organizador/admin) - opcional, sem unicidade
ALTER TABLE "users" ADD COLUMN "cpf" TEXT;
```

- [ ] **Step 3: Rodar `prisma generate` (não precisa de conexão com o banco)**

Run: `npx prisma generate`
Expected: sucesso, sem erros — este comando só lê `schema.prisma` e gera o client TypeScript, não
precisa conectar no banco.

- [ ] **Step 4: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros (nenhum código ainda referencia `cpf`, então isso só confirma que o client
gerado continua consistente).

- [ ] **Step 5: Rodar a suíte de testes inteira**

Run: `npx vitest run`
Expected: todos os testes continuam passando (nenhum teste referencia `cpf` ainda).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260704000000_add_user_cpf
git commit -m "feat: adiciona campo cpf ao model User"
```

---

### Task 2: Componente compartilhado `ChangePasswordForm`

**Files:**
- Create: `components/profile/ChangePasswordForm.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/change-password` (rota já existente, genérica — `app/api/auth/change-password/route.ts` não muda).
- Produces: `export default function ChangePasswordForm()` — sem props, usado pelas Tasks 4 e 6
  como `<ChangePasswordForm />`.

- [ ] **Step 1: Criar o componente**

Crie `components/profile/ChangePasswordForm.tsx` — mesmo comportamento e JSX já usados em
`app/dashboard/perfil/page.tsx` (linhas 34-37 do estado, 66-92 do handler, 196-241 do formulário),
extraído para um componente `"use client"` autônomo:

```tsx
"use client";

import { useState } from "react";

export default function ChangePasswordForm() {
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pwForm.next !== pwForm.confirm) {
      setPwError("A nova senha e a confirmação não coincidem.");
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setPwSaving(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    });
    const data = await res.json();
    setPwSaving(false);
    if (!res.ok) {
      setPwError(data.error ?? "Erro ao alterar senha.");
    } else {
      setPwSuccess(true);
      setPwForm({ current: "", next: "", confirm: "" });
      setTimeout(() => setPwSuccess(false), 4000);
    }
  }

  return (
    <form onSubmit={handlePasswordChange} className="card space-y-4">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Alterar senha</h2>
      {pwError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{pwError}</div>
      )}
      {pwSuccess && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">Senha alterada com sucesso!</div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha atual</label>
        <input
          type="password"
          value={pwForm.current}
          onChange={(e) => setPwForm((p) => ({ ...p, current: e.target.value }))}
          className="input w-full"
          required
          autoComplete="current-password"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nova senha</label>
        <input
          type="password"
          value={pwForm.next}
          onChange={(e) => setPwForm((p) => ({ ...p, next: e.target.value }))}
          className="input w-full"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirmar nova senha</label>
        <input
          type="password"
          value={pwForm.confirm}
          onChange={(e) => setPwForm((p) => ({ ...p, confirm: e.target.value }))}
          className="input w-full"
          required
          autoComplete="new-password"
        />
      </div>
      <button type="submit" disabled={pwSaving} className="btn-primary w-full">
        {pwSaving ? "Alterando..." : "Alterar senha"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Rodar a suíte de testes inteira**

Run: `npx vitest run`
Expected: todos os testes continuam passando (componente novo ainda não é usado em nenhuma
página — será consumido nas Tasks 4 e 6; este projeto não tem infraestrutura de teste de
componentes React).

- [ ] **Step 4: Commit**

```bash
git add components/profile/ChangePasswordForm.tsx
git commit -m "feat: extrai componente compartilhado de troca de senha"
```

---

### Task 3: Estender `/api/admin/profile` com nome e CPF

**Files:**
- Modify: `app/api/admin/profile/route.ts`
- Test: `tests/admin-profile-route.test.ts`

**Interfaces:**
- Consumes: campo `cpf` no `User` (Task 1).
- Produces: `GET`/`PUT` de `/api/admin/profile` agora aceitam e retornam `{ name, phone, cpf }`
  (antes só `{ phone }`) — consumido pela Task 4.

- [ ] **Step 1: Escrever os testes (falhando) para os campos novos**

Em `tests/admin-profile-route.test.ts`, substitua o arquivo inteiro por:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/admin/profile/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("admin profile api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it("retorna nome, telefone e cpf do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.findUnique.mockResolvedValueOnce({ name: "Admin", phone: "5511999999999", cpf: "123.456.789-00" });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({ profile: { name: "Admin", phone: "5511999999999", cpf: "123.456.789-00" } });
    });
  });

  describe("PUT", () => {
    it("retorna 403 para quem não é admin", async () => {
      authMock.mockResolvedValue({ user: { id: "u1", role: "ATHLETE" } } as any);
      const res = await PUT(makeRequest({ name: "Admin", phone: "5511999999999" }));
      expect(res.status).toBe(403);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o nome está vazio", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      const res = await PUT(makeRequest({ name: "", phone: "5511999999999" }));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("atualiza nome, telefone e cpf do admin autenticado", async () => {
      authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
      dbMock.user.update.mockResolvedValueOnce({ name: "Admin", phone: "5511999999999", cpf: "123.456.789-00" });

      const res = await PUT(makeRequest({ name: "Admin", phone: "5511999999999", cpf: "123.456.789-00" }));
      const body = await res.json();

      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: "admin-1" },
        data: { name: "Admin", phone: "5511999999999", cpf: "123.456.789-00" },
        select: { name: true, phone: true, cpf: true },
      });
      expect(body).toEqual({ profile: { name: "Admin", phone: "5511999999999", cpf: "123.456.789-00" } });
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-profile-route.test.ts`
Expected: FAIL — a rota ainda só lida com `phone`, o `select`/`data` não bate com o esperado e não
há validação de `name` vazio.

- [ ] **Step 3: Atualizar a rota**

Substitua `app/api/admin/profile/route.ts` inteiro por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional().nullable(),
  cpf: z.string().max(14).optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, phone: true, cpf: true },
  });

  return NextResponse.json({ profile: user });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await db.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name, phone: parsed.data.phone || null, cpf: parsed.data.cpf || null },
    select: { name: true, phone: true, cpf: true },
  });

  return NextResponse.json({ profile: user });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-profile-route.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Rodar a suíte inteira e o `tsc`**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/profile/route.ts tests/admin-profile-route.test.ts
git commit -m "feat: adiciona nome e cpf a api de perfil do admin"
```

---

### Task 4: Página "Meus Dados" do admin

**Files:**
- Modify: `app/admin/perfil/page.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/admin/profile` retornando `{ name, phone, cpf }` (Task 3);
  `<ChangePasswordForm />` (Task 2).
- Produces: nenhuma (última consumidora destas duas interfaces neste plano, junto da Task 6).

- [ ] **Step 1: Substituir a página inteira**

Substitua `app/admin/perfil/page.tsx` por:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";

type ProfileData = {
  name?: string;
  phone?: string | null;
  cpf?: string | null;
};

export default function AdminPerfilPage() {
  const { data: session } = useSession();
  const [form, setForm] = useState<ProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/profile")
      .then((res) => {
        if (!res.ok) throw new Error("Erro ao carregar perfil");
        return res.json();
      })
      .then(({ profile }) => { if (profile) setForm(profile); })
      .catch(() => setError("Erro ao carregar perfil."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name?.trim() ?? "",
          phone: form.phone?.trim() || null,
          cpf: form.cpf?.trim() || null,
        }),
      });
      if (!res.ok) {
        setError("Erro ao salvar perfil.");
        setSaving(false);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  function set(field: keyof ProfileData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <div className="card">
        <p className="text-sm text-gray-600 dark:text-gray-400">{session?.user?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dados pessoais</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
          <input
            type="text"
            value={form.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone (WhatsApp)</label>
          <input
            type="tel"
            value={form.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            className="input-field w-full"
            placeholder="(11) 99999-9999"
          />
          <p className="text-xs text-gray-500 mt-1">Usado para receber alertas de conciliação de pagamentos por WhatsApp.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF</label>
          <input
            type="text"
            value={form.cpf ?? ""}
            onChange={(e) => set("cpf", e.target.value)}
            className="input-field w-full"
            placeholder="000.000.000-00"
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
        </button>
      </form>

      <ChangePasswordForm />
    </div>
  );
}
```

- [ ] **Step 2: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Rodar a suíte de testes inteira**

Run: `npx vitest run`
Expected: todos os testes continuam passando (sem teste automatizado dedicado para esta página).

- [ ] **Step 4: Verificação manual no navegador (se o banco de dev estiver acessível)**

Suba `npm run dev`, acesse `/admin/perfil` logado como admin, confirme: nome/telefone/CPF
carregam e salvam corretamente, e-mail aparece só como texto, o card "Alterar senha" aparece
abaixo e funciona (senha atual errada mostra erro; senha nova + confirmação divergentes mostra
erro local). Se o banco de desenvolvimento estiver inacessível (problema recorrente já registrado
nesta sessão), pule esta etapa e confie em `tsc` + leitura visual do arquivo.

- [ ] **Step 5: Commit**

```bash
git add app/admin/perfil/page.tsx
git commit -m "feat: pagina meus dados do admin com nome cpf e troca de senha"
```

---

### Task 5: Nova rota `/api/organizer/account`

**Files:**
- Create: `app/api/organizer/account/route.ts`
- Test: `tests/organizer-account-route.test.ts`

**Interfaces:**
- Consumes: campo `cpf` no `User` (Task 1).
- Produces: `GET`/`PUT /api/organizer/account` retornando `{ name, phone, cpf }` (dados pessoais
  em `User` — distinto de `/api/organizer/profile`, que continua só com dados da empresa em
  `OrganizerProfile`) — consumida pela Task 6.

- [ ] **Step 1: Escrever o teste (falhando)**

Crie `tests/organizer-account-route.test.ts`. Este espelha o padrão de
`/api/organizer/profile` (sem checagem de role — só exige sessão autenticada, mesmo padrão já
usado por essa rota irmã):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/organizer/account/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/organizer/account", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("organizer account api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
  });

  describe("GET", () => {
    it("retorna 401 para quem não está autenticado", async () => {
      authMock.mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it("retorna nome, telefone e cpf do organizador autenticado", async () => {
      dbMock.user.findUnique.mockResolvedValueOnce({ name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({ profile: { name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" } });
    });
  });

  describe("PUT", () => {
    it("retorna 401 para quem não está autenticado", async () => {
      authMock.mockResolvedValue(null);
      const res = await PUT(makeRequest({ name: "Organizador" }));
      expect(res.status).toBe(401);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("retorna 400 quando o nome está vazio", async () => {
      const res = await PUT(makeRequest({ name: "" }));
      expect(res.status).toBe(400);
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });

    it("atualiza nome, telefone e cpf do organizador autenticado", async () => {
      dbMock.user.update.mockResolvedValueOnce({ name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" });

      const res = await PUT(makeRequest({ name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" }));
      const body = await res.json();

      expect(dbMock.user.update).toHaveBeenCalledWith({
        where: { id: "org-1" },
        data: { name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" },
        select: { name: true, phone: true, cpf: true },
      });
      expect(body).toEqual({ profile: { name: "Organizador", phone: "5511999999999", cpf: "123.456.789-00" } });
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/organizer-account-route.test.ts`
Expected: FAIL — o módulo da rota ainda não existe.

- [ ] **Step 3: Criar a rota**

Crie `app/api/organizer/account/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  phone: z.string().optional().nullable(),
  cpf: z.string().max(14).optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, phone: true, cpf: true },
  });

  return NextResponse.json({ profile: user });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await db.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name, phone: parsed.data.phone || null, cpf: parsed.data.cpf || null },
    select: { name: true, phone: true, cpf: true },
  });

  return NextResponse.json({ profile: user });
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/organizer-account-route.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Rodar a suíte inteira e o `tsc`**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/organizer/account/route.ts tests/organizer-account-route.test.ts
git commit -m "feat: rota de dados pessoais do organizador (nome telefone cpf)"
```

---

### Task 6: Página "Meus Dados" do organizador

**Files:**
- Modify: `app/organizador/perfil/page.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/organizer/account` retornando `{ name, phone, cpf }` (Task 5);
  `<ChangePasswordForm />` (Task 2). `/api/organizer/profile` (dados da empresa) continua sendo
  usado exatamente como já era.
- Produces: nenhuma.

- [ ] **Step 1: Substituir a página inteira**

Substitua `app/organizador/perfil/page.tsx` por:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import ChangePasswordForm from "@/components/profile/ChangePasswordForm";

type OrgProfileData = {
  companyName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  website?: string | null;
  bio?: string | null;
};

type AccountData = {
  name?: string;
  phone?: string | null;
  cpf?: string | null;
};

export default function OrganizerPerfilPage() {
  const { data: session } = useSession();
  const [orgForm, setOrgForm] = useState<OrgProfileData>({});
  const [accountForm, setAccountForm] = useState<AccountData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/organizer/profile").then((r) => r.json()),
      fetch("/api/organizer/account").then((r) => r.json()),
    ])
      .then(([{ profile }, { profile: account }]) => {
        if (profile) setOrgForm(profile);
        if (account) setAccountForm(account);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/organizer/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orgForm),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAccountSaving(true);
    await fetch("/api/organizer/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: accountForm.name?.trim() ?? "",
        phone: accountForm.phone?.trim() || null,
        cpf: accountForm.cpf?.trim() || null,
      }),
    });
    setAccountSaving(false);
    setAccountSaved(true);
    setTimeout(() => setAccountSaved(false), 3000);
  }

  function set(field: keyof OrgProfileData, value: string) {
    setOrgForm((prev) => ({ ...prev, [field]: value || null }));
  }

  function setAccount(field: keyof AccountData, value: string) {
    setAccountForm((prev) => ({ ...prev, [field]: value }));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="max-w-2xl space-y-6 mx-auto">
      <h1 className="text-2xl font-bold">Meus Dados</h1>

      <form onSubmit={handleAccountSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dados pessoais</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{session?.user?.email}</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input type="text" value={accountForm.name ?? ""} onChange={(e) => setAccount("name", e.target.value)} className="input w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone pessoal</label>
            <input type="tel" value={accountForm.phone ?? ""} onChange={(e) => setAccount("phone", e.target.value)} className="input w-full" placeholder="(11) 99999-9999" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF</label>
            <input type="text" value={accountForm.cpf ?? ""} onChange={(e) => setAccount("cpf", e.target.value)} className="input w-full" placeholder="000.000.000-00" />
          </div>
        </div>
        <button type="submit" disabled={accountSaving} className="btn-primary w-full">
          {accountSaving ? "Salvando..." : accountSaved ? "Salvo!" : "Salvar dados pessoais"}
        </button>
      </form>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900">Dados da organização</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome da empresa / organização</label>
            <input type="text" value={orgForm.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
            <input type="text" value={orgForm.cnpj ?? ""} onChange={(e) => set("cnpj", e.target.value)} className="input w-full" placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone comercial</label>
            <input type="tel" value={orgForm.phone ?? ""} onChange={(e) => set("phone", e.target.value)} className="input w-full" placeholder="(11) 99999-9999" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Site</label>
            <input type="url" value={orgForm.website ?? ""} onChange={(e) => set("website", e.target.value)} className="input w-full" placeholder="https://..." />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Bio / Apresentação</label>
            <textarea rows={4} value={orgForm.bio ?? ""} onChange={(e) => set("bio", e.target.value)} className="input w-full resize-none" placeholder="Conte sobre sua organização..." />
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar perfil"}
        </button>
      </form>

      <ChangePasswordForm />
    </div>
  );
}
```

Note: o card "Dados da organização" é o formulário já existente antes desta mudança, sem nenhuma
alteração de campos/lógica — só ganhou um card novo acima ("Dados pessoais") e o
`ChangePasswordForm` abaixo.

- [ ] **Step 2: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Rodar a suíte de testes inteira**

Run: `npx vitest run`
Expected: todos os testes continuam passando (sem teste automatizado dedicado para esta página).

- [ ] **Step 4: Verificação manual no navegador (se o banco de dev estiver acessível)**

Suba `npm run dev`, acesse `/organizador/perfil` logado como organizador, confirme: o card "Dados
pessoais" carrega/salva nome, telefone pessoal e CPF independentemente do card "Dados da
organização" (que continua funcionando como antes), e-mail aparece só como texto, e o card
"Alterar senha" funciona. Se o banco estiver inacessível, pule e confie em `tsc` + leitura visual.

- [ ] **Step 5: Commit**

```bash
git add app/organizador/perfil/page.tsx
git commit -m "feat: pagina meus dados do organizador com dados pessoais e troca de senha"
```

---

### Task 7: Renomear "Perfil" para "Meus Dados" nos menus

**Files:**
- Modify: `components/admin/AdminNav.tsx`
- Modify: `components/organizer/OrganizerNav.tsx`

**Interfaces:**
- Consumes: nenhuma.
- Produces: nenhuma.

- [ ] **Step 1: Confirmar que os arquivos ainda batem com o esperado**

Em `components/admin/AdminNav.tsx`, confirme que existe exatamente:

```tsx
          <Link href="/admin/perfil" className="hover:text-gray-300">Perfil</Link>
```

Em `components/organizer/OrganizerNav.tsx`, confirme que existem exatamente estas DUAS
ocorrências (uma na versão desktop, outra na versão mobile):

```tsx
            <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
```

Se algum dos dois arquivos estiver diferente, PARE e reporte NEEDS_CONTEXT.

- [ ] **Step 2: Renomear em `AdminNav.tsx`**

Troque:

```tsx
          <Link href="/admin/perfil" className="hover:text-gray-300">Perfil</Link>
```

por:

```tsx
          <Link href="/admin/perfil" className="hover:text-gray-300">Meus Dados</Link>
```

- [ ] **Step 3: Renomear as duas ocorrências em `OrganizerNav.tsx`**

Troque AMBAS as ocorrências de:

```tsx
            <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
```

por:

```tsx
            <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Dados</Link>
```

(Uma ocorrência está no bloco desktop, outra no bloco `md:hidden` mobile — as duas precisam
mudar.)

- [ ] **Step 4: Rodar `tsc` e a suíte inteira**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sem erros, todos os testes continuam passando.

- [ ] **Step 5: Conferir por leitura**

Leia os dois arquivos modificados e confirme: só o texto visível do link mudou (`href` e classes
inalterados), nenhum outro link foi tocado.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AdminNav.tsx components/organizer/OrganizerNav.tsx
git commit -m "feat: renomeia link de perfil para meus dados nos menus"
```

---

## Self-Review Notes

- **Spec coverage:** item 1 do spec (schema `cpf`) → Task 1; item 2 (`ChangePasswordForm`) →
  Task 2; item 3 (admin) → Tasks 3-4; item 4 (organizador) → Tasks 5-6; item 5 (renomear menus) →
  Task 7. Todos os itens do spec têm task correspondente.
- **Placeholder scan:** nenhum "TBD"/"handle edge cases" — cada step tem código completo.
- **Type consistency:** `ProfileData`/`AccountData` (Tasks 4 e 6) usam os mesmos nomes de campo
  (`name`, `phone`, `cpf`) retornados pelas rotas correspondentes (Tasks 3 e 5) — confirmado
  consistente em todas as tasks.
