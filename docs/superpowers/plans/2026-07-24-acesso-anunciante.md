# Acesso ao marketplace de anunciantes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir 2 problemas reais de acesso ao marketplace de anunciantes, achados quando o
usuário não conseguiu encontrar como anunciar: (1) `/auth/cadastro-anunciante` não está linkado em
nenhum lugar público do site — só quem já sabe a URL exata chega lá; (2) o admin não tem nenhuma
forma segura de promover um usuário existente a `ADVERTISER` — o dropdown genérico de trocar papel
propositalmente não lista essa opção, porque promover só o papel sem criar o `AdvertiserProfile`
(razão social/e-mail/telefone, campos obrigatórios) deixaria a conta quebrada na hora de comprar
um plano.

**Architecture:** Fix 1 é um link novo no rodapé público. Fix 2 é um fluxo dedicado (mesmo espírito
do já existente `createOrPromoteAssistant`): função `promoteToAdvertiser` que atualiza o papel do
usuário E cria o `AdvertiserProfile` na mesma transação, exposta por uma rota de API nova e um
botão+modal na tela de detalhe do usuário (`/admin/usuarios/[id]`) — só visível quando o usuário
tem papel `ATHLETE` (mesma restrição já usada na promoção a assistente: só promove a partir de
Atleta, nunca de Organizador/Admin/outros).

**Tech Stack:** Next.js (App Router), Prisma, Zod, Vitest.

## Global Constraints

- Nunca usar `alert()`/`confirm()`/`window.prompt()` — o novo modal segue o padrão visual de
  `components/ui/ConfirmModal.tsx` (overlay + card), só que com 3 campos de texto em vez de
  mensagem+nota — `ConfirmModal` não cobre esse caso (só tem 1 campo de nota opcional), por isso é
  um modal novo, não uma reinvenção de algo que já existe pronto.
- TDD em toda função de `lib/`/rota de API nova.
- Componentes React sem teste automatizado — convenção já estabelecida no projeto.
- Só promove usuários com papel `ATHLETE` atual — mesma restrição já usada em
  `createOrPromoteAssistant` (`lib/assistants/create-or-promote.ts`), evita promover
  Organizador/Admin/outros por engano.

---

### Task 1: Link público pro cadastro de anunciante no rodapé

**Files:**
- Modify: `components/layout/Footer.tsx`

**Interfaces:** Nenhuma nova. Sem teste automatizado (componente sem lógica, convenção do
projeto).

- [ ] **Step 1: Implementar**

Em `components/layout/Footer.tsx`, na lista "Links úteis", adicionar um item novo depois de
"Entrar":

```tsx
              <li><Link href="/eventos" className="hover:text-white transition-colors">Ver eventos</Link></li>
              <li><Link href="/auth/cadastro" className="hover:text-white transition-colors">Criar conta</Link></li>
              <li><Link href="/auth/login" className="hover:text-white transition-colors">Entrar</Link></li>
              <li><Link href="/auth/cadastro-anunciante" className="hover:text-white transition-colors">Anuncie no site</Link></li>
```

- [ ] **Step 2: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 3: Commit**

```bash
git add components/layout/Footer.tsx
git commit -m "feat: link publico pro cadastro de anunciante no rodape"
```

---

### Task 2: `lib/advertisers/promote.ts` — promover usuário a anunciante

**Files:**
- Create: `lib/advertisers/promote.ts`
- Test: `tests/lib-promote-advertiser.test.ts`

**Interfaces:**
- Produces: `promoteToAdvertiser(input: { userId: string; companyName: string; contactEmail:
  string; contactPhone: string; promotedByUserId: string }): Promise<{ ok: boolean; error?:
  string; status?: number }>` — consumido pela Task 3.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/lib-promote-advertiser.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { promoteToAdvertiser } from "@/lib/advertisers/promote";

const dbMock = db as any;

describe("promoteToAdvertiser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna erro quando o usuário não existe", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({ ok: false, error: "Usuário não encontrado", status: 404 });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("retorna erro quando o usuário não tem papel ATHLETE", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "ORGANIZER" });

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "Só é possível promover usuários com papel Atleta a Anunciante",
      status: 400,
    });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("atualiza o papel, cria o AdvertiserProfile e registra auditoria numa única transação", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "user-1", role: "ATHLETE" });
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(dbMock));

    const result = await promoteToAdvertiser({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });

    expect(result).toEqual({ ok: true });
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "ADVERTISER" },
    });
    expect(dbMock.advertiserProfile.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        companyName: "Empresa LTDA",
        contactEmail: "contato@empresa.com",
        contactPhone: "+5511999999999",
      },
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "admin-1",
        action: "USER_UPDATED",
        entityType: "User",
        entityId: "user-1",
        metadata: { role: "ADVERTISER", companyName: "Empresa LTDA" },
      },
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/lib-promote-advertiser.test.ts`
Expected: FAIL — `@/lib/advertisers/promote` não existe.

- [ ] **Step 3: Implementar**

Criar `lib/advertisers/promote.ts`:

```ts
import { db } from "@/lib/db";

export interface PromoteToAdvertiserInput {
  userId: string;
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  promotedByUserId: string;
}

export interface PromoteToAdvertiserResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/**
 * Promove um usuário existente (deve estar com papel ATHLETE) a ADVERTISER, criando o
 * AdvertiserProfile correspondente na mesma transação — nunca deixa o papel mudado sem o perfil
 * (companyName/contactEmail/contactPhone são obrigatórios em qualquer fluxo que compre um plano).
 */
export async function promoteToAdvertiser(
  input: PromoteToAdvertiserInput,
): Promise<PromoteToAdvertiserResult> {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true },
  });
  if (!user) {
    return { ok: false, error: "Usuário não encontrado", status: 404 };
  }
  if (user.role !== "ATHLETE") {
    return {
      ok: false,
      error: "Só é possível promover usuários com papel Atleta a Anunciante",
      status: 400,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { role: "ADVERTISER" } });
    await tx.advertiserProfile.create({
      data: {
        userId: input.userId,
        companyName: input.companyName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.promotedByUserId,
        action: "USER_UPDATED",
        entityType: "User",
        entityId: input.userId,
        metadata: { role: "ADVERTISER", companyName: input.companyName },
      },
    });
  });

  return { ok: true };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/lib-promote-advertiser.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add lib/advertisers/promote.ts tests/lib-promote-advertiser.test.ts
git commit -m "feat: promoteToAdvertiser promove atleta a anunciante com perfil na mesma transacao"
```

---

### Task 3: `POST /api/admin/users/[id]/promote-advertiser`

**Files:**
- Create: `app/api/admin/users/[id]/promote-advertiser/route.ts`
- Test: `tests/admin-promote-advertiser-route.test.ts`

**Interfaces:**
- Consumes: `promoteToAdvertiser` (Task 2).
- Produces: `POST /api/admin/users/:id/promote-advertiser` — body `{ companyName, contactEmail,
  contactPhone }` → `200 { ok: true }` ou erro — consumido pela Task 4.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/admin-promote-advertiser-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/advertisers/promote", () => ({ promoteToAdvertiser: vi.fn() }));

import { POST } from "@/app/api/admin/users/[id]/promote-advertiser/route";
import { promoteToAdvertiser } from "@/lib/advertisers/promote";

const authMock = vi.mocked(auth);
const promoteToAdvertiserMock = vi.mocked(promoteToAdvertiser);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/users/user-1/promote-advertiser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const VALID_BODY = {
  companyName: "Empresa LTDA",
  contactEmail: "contato@empresa.com",
  contactPhone: "+5511999999999",
};

describe("POST /api/admin/users/[id]/promote-advertiser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest(VALID_BODY), { params: Promise.resolve({ id: "user-1" }) });
    expect(res.status).toBe(403);
    expect(promoteToAdvertiserMock).not.toHaveBeenCalled();
  });

  it("retorna 400 com payload inválido", async () => {
    const res = await POST(
      makeRequest({ companyName: "A", contactEmail: "não-é-email", contactPhone: "" }),
      { params: Promise.resolve({ id: "user-1" }) },
    );
    expect(res.status).toBe(400);
    expect(promoteToAdvertiserMock).not.toHaveBeenCalled();
  });

  it("repassa o erro/status retornado por promoteToAdvertiser quando falha", async () => {
    promoteToAdvertiserMock.mockResolvedValueOnce({
      ok: false,
      error: "Só é possível promover usuários com papel Atleta a Anunciante",
      status: 400,
    });
    const res = await POST(makeRequest(VALID_BODY), { params: Promise.resolve({ id: "user-1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Só é possível promover usuários com papel Atleta a Anunciante");
  });

  it("retorna 200 e chama promoteToAdvertiser com os dados corretos no caminho de sucesso", async () => {
    promoteToAdvertiserMock.mockResolvedValueOnce({ ok: true });
    const res = await POST(makeRequest(VALID_BODY), { params: Promise.resolve({ id: "user-1" }) });
    expect(res.status).toBe(200);
    expect(promoteToAdvertiserMock).toHaveBeenCalledWith({
      userId: "user-1",
      companyName: "Empresa LTDA",
      contactEmail: "contato@empresa.com",
      contactPhone: "+5511999999999",
      promotedByUserId: "admin-1",
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/admin-promote-advertiser-route.test.ts`
Expected: FAIL — a rota não existe.

- [ ] **Step 3: Implementar**

Criar `app/api/admin/users/[id]/promote-advertiser/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { promoteToAdvertiser } from "@/lib/advertisers/promote";

const schema = z.object({
  companyName: z.string().min(2).max(150),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8).max(20),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await promoteToAdvertiser({
    userId: id,
    ...parsed.data,
    promotedByUserId: session.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/admin-promote-advertiser-route.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte completa e `tsc`**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/users/[id]/promote-advertiser/route.ts" tests/admin-promote-advertiser-route.test.ts
git commit -m "feat: rota de promocao de atleta a anunciante"
```

---

### Task 4: Botão + modal "Promover a anunciante" na tela de detalhe do usuário

**Files:**
- Create: `components/admin/PromoteToAdvertiserButton.tsx`
- Modify: `app/admin/usuarios/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/users/:id/promote-advertiser` (Task 3).

Sem teste automatizado (componente client + Server Component, convenção do projeto).

- [ ] **Step 1: Criar o componente**

Criar `components/admin/PromoteToAdvertiserButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PromoteToAdvertiserButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/promote-advertiser`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, contactEmail, contactPhone }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Erro ao promover usuário");
      setLoading(false);
      return;
    }
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-lg border font-medium border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300"
      >
        Promover a anunciante
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Promover a anunciante</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Informe os dados da empresa pra criar o perfil de anunciante junto com a mudança de papel.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Razão social *</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">E-mail de contato *</label>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone de contato *</label>
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="input-field" />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading || !companyName || !contactEmail || !contactPhone}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {loading ? "Promovendo..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire na página**

Em `app/admin/usuarios/[id]/page.tsx`, adicionar o import:

```tsx
import PromoteToAdvertiserButton from "@/components/admin/PromoteToAdvertiserButton";
```

E no bloco de botões de ação (dentro de `<div className="flex flex-col gap-2 items-end">`),
adicionar o botão logo depois de `<ChangeUserRoleButton .../>`, só quando o papel atual é
`ATHLETE`:

```tsx
            <ChangeUserRoleButton userId={user.id} currentRole={user.role} />
            {user.role === "ATHLETE" && <PromoteToAdvertiserButton userId={user.id} />}
            <ToggleUserActiveButton userId={user.id} active={user.active} />
```

- [ ] **Step 3: Rodar a suíte completa, `tsc` e build**

Run: `npx vitest run`
Expected: todos os testes passam

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npm run build`
Expected: build de produção limpo

- [ ] **Step 4: Commit**

```bash
git add components/admin/PromoteToAdvertiserButton.tsx "app/admin/usuarios/[id]/page.tsx"
git commit -m "feat: botao promover a anunciante na tela de detalhe do usuario"
```

---

## Revisão final (depois de todas as 4 tasks)

- [ ] Rodar `npx vitest run` inteiro — suíte completa passando.
- [ ] Rodar `npx tsc --noEmit` — sem erros.
- [ ] Rodar `npm run build` — build de produção limpo.
- [ ] Conferir manualmente (leitura de código) que o botão "Promover a anunciante" só aparece pra
  usuários com papel `ATHLETE` — nunca pra Organizador/Admin/Assistente/outros.
- [ ] Conferir que `ChangeUserRoleButton.tsx` e o `roleSchema` da rota genérica
  `app/api/admin/users/[id]/route.ts` continuam SEM `ADVERTISER`/`ASSISTANT` — essas duas
  permanecem fora do dropdown genérico de propósito, o caminho seguro é só o fluxo novo desta
  leva.
