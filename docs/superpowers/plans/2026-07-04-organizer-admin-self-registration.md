# Auto-inscrição para organizador/admin + botão "Área do atleta" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que usuários `ORGANIZER` e `ADMIN` se inscrevam em eventos (removendo os dois
bloqueios explícitos existentes) e adicionar um botão "Área do atleta" nas telas de admin e do
organizador que leva para `/eventos`.

**Architecture:** Duas remoções de bloqueio (checkout API + página de inscrição) e dois botões
novos (um em cada nav). Nenhuma mudança de schema, nenhuma lógica nova de checkout.

**Tech Stack:** Next.js (App Router), React, TypeScript, Vitest.

## Global Constraints

- Qualquer usuário autenticado (`ATHLETE`, `ORGANIZER` ou `ADMIN`) passa a poder se inscrever em
  qualquer evento — inclusive um organizador se inscrevendo em um evento que ele mesmo organiza
  (decisão explícita: sem bloqueio adicional de conflito de interesse).
- O botão "Área do atleta" aponta para `/eventos` (listagem pública de eventos), não para
  `/dashboard`.
- O botão "Área do atleta" é um elemento visual separado (estilo badge, como o badge amarelo já
  existente em `components/dashboard/DashboardNav.tsx:51-58`) — não entra na lista ordenada de
  links do `AdminNav.tsx` fixada na tarefa anterior (admin-nav-reorder).
- Nenhuma mudança em `AthleteProfile`, no formulário de checkout, ou em como `Registration`/lote de
  ingressos contam vagas — o fluxo já funciona igual para qualquer papel.

---

### Task 1: Remover bloqueio na API de checkout

**Files:**
- Modify: `app/api/checkout/route.ts:38-40`
- Test: `tests/checkout-route.test.ts`

**Interfaces:**
- Consumes: nenhuma (não depende de outras tasks deste plano).
- Produces: nenhuma (não é consumido por outras tasks deste plano — cada task deste plano é
  independente).

- [ ] **Step 1: Escrever o teste (falhando) confirmando que ORGANIZER consegue fazer checkout**

Em `tests/checkout-route.test.ts`, adicione este teste dentro do `describe("checkout api", ...)`,
depois do teste existente `"verifica o estoque baixo do lote depois de um checkout bem-sucedido"`:

```ts
  it("permite checkout para usuário ORGANIZER (auto-inscrição liberada)", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    enabledMethodsMock.mockResolvedValue(["PIX"]);
    vi.mocked(createCheckout).mockResolvedValueOnce({
      orderId: "order-1",
      registrationId: "reg-1",
      subtotalAmount: 10000,
      totalAmount: 10000,
      discountAmount: 0,
      platformFeeAmount: 0,
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Organizador", email: "org@example.com" });
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    vi.mocked(getPaymentProvider).mockResolvedValueOnce({
      createPayment: vi.fn().mockResolvedValueOnce({ providerPaymentId: "pay-1", status: "PENDING" }),
    } as any);
    dbMock.payment.create.mockResolvedValueOnce({ id: "payment-1" });

    const res = await POST(
      new Request("http://localhost/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          eventId: "event-1",
          ticketBatchId: "batch-1",
          paymentMethod: "PIX",
        }),
      }) as any,
    );

    expect(res.status).toBe(200);
    expect(dbMock.payment.create).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/checkout-route.test.ts -t "permite checkout para usuário ORGANIZER"`
Expected: FAIL com `res.status` igual a `403`, não `200` — o bloqueio atual ainda está em vigor.

- [ ] **Step 3: Remover o bloqueio**

Em `app/api/checkout/route.ts`, remova estas 3 linhas (linhas 38-40 do arquivo atual):

```ts
  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return NextResponse.json({ error: "Administradores e organizadores não podem realizar inscrições" }, { status: 403 });
  }
```

O trecho ao redor deve ficar assim (sem linha em branco extra):

```ts
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/checkout-route.test.ts`
Expected: PASS (3 testes: os 2 já existentes + o novo).

- [ ] **Step 5: Rodar a suíte inteira e o `tsc`**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tudo passa, sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/api/checkout/route.ts tests/checkout-route.test.ts
git commit -m "feat: libera checkout para organizador e admin"
```

---

### Task 2: Remover bloqueio na página de inscrição

**Files:**
- Modify: `app/(public)/inscricao/[slug]/page.tsx:46-53`

**Interfaces:**
- Consumes: nenhuma.
- Produces: nenhuma.

- [ ] **Step 1: Confirmar que o arquivo ainda bate com o esperado**

Abra `app/(public)/inscricao/[slug]/page.tsx` e confirme que as linhas 42-54 ainda são exatamente:

```tsx
export default async function InscricaoPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/inscricao/${(await params).slug}`);

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Acesso não permitido</h1>
        <p className="text-gray-600 dark:text-gray-400">Administradores e organizadores não podem realizar inscrições em eventos.</p>
      </div>
    );
  }

  const { slug } = await params;
```

Se o arquivo estiver diferente, PARE e reporte NEEDS_CONTEXT — não tente adivinhar como mesclar a
mudança.

- [ ] **Step 2: Remover o bloco de bloqueio**

Substitua o trecho acima por:

```tsx
export default async function InscricaoPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=/inscricao/${(await params).slug}`);

  const { slug } = await params;
```

Ou seja: remove inteiramente o `if (session.user.role === "ADMIN" || ...) { ... }` (o bloco de
"Acesso não permitido"), mantendo a linha de redirect de não-autenticado e a linha seguinte que já
existia (`const { slug } = await params;`) exatamente como estavam.

- [ ] **Step 3: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Rodar a suíte de testes inteira**

Run: `npx vitest run`
Expected: todos os testes continuam passando (este arquivo de página não tem teste automatizado
dedicado — não existe infraestrutura de teste de componentes/páginas React neste projeto).

- [ ] **Step 5: Conferir por leitura**

Leia o arquivo modificado e confirme que a função `InscricaoPage` agora vai direto do redirect de
não-autenticado para `const { slug } = await params;`, sem nenhum bloqueio de role no meio, e que
nada mais no arquivo (o restante da função, os outros `return` de estado do evento) foi alterado.

- [ ] **Step 6: Commit**

```bash
git add "app/(public)/inscricao/[slug]/page.tsx"
git commit -m "feat: libera pagina de inscricao para organizador e admin"
```

---

### Task 3: Botão "Área do atleta" no `AdminNav.tsx`

**Files:**
- Modify: `components/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: nenhuma.
- Produces: nenhuma.

- [ ] **Step 1: Confirmar que o arquivo ainda bate com o esperado**

Abra `components/admin/AdminNav.tsx` e confirme que as linhas 29-34 ainda são exatamente:

```tsx
        <div className="flex items-center gap-2">
          <ThemeToggle className="text-gray-400 hover:text-white hover:bg-gray-800" />
          <button onClick={() => signOut({ callbackUrl: "/" })} className="text-sm text-gray-400 hover:text-white">
            Sair
          </button>
        </div>
```

Se diferente, PARE e reporte NEEDS_CONTEXT.

- [ ] **Step 2: Adicionar o botão**

Substitua o trecho acima por:

```tsx
        <div className="flex items-center gap-2">
          <Link
            href="/eventos"
            className="text-xs bg-blue-900/40 text-blue-300 hover:bg-blue-900/60 px-2 py-1 rounded font-medium"
          >
            Área do atleta
          </Link>
          <ThemeToggle className="text-gray-400 hover:text-white hover:bg-gray-800" />
          <button onClick={() => signOut({ callbackUrl: "/" })} className="text-sm text-gray-400 hover:text-white">
            Sair
          </button>
        </div>
```

(O `import Link from "next/link";` já existe no topo do arquivo — não precisa adicionar de novo.)

- [ ] **Step 3: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Rodar a suíte de testes inteira**

Run: `npx vitest run`
Expected: todos os testes continuam passando (sem teste automatizado dedicado para este
componente).

- [ ] **Step 5: Conferir por leitura**

Leia o arquivo modificado e confirme: o botão "Área do atleta" aparece antes do `ThemeToggle`, com
`href="/eventos"`; a lista ordenada de links à esquerda (linhas 11-28) não foi tocada.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AdminNav.tsx
git commit -m "feat: adiciona botao area do atleta no menu do admin"
```

---

### Task 4: Botão "Área do atleta" no `OrganizerNav.tsx`

**Files:**
- Modify: `components/organizer/OrganizerNav.tsx`

**Interfaces:**
- Consumes: nenhuma.
- Produces: nenhuma.

- [ ] **Step 1: Confirmar que o arquivo ainda bate com o esperado**

Abra `components/organizer/OrganizerNav.tsx` e confirme que as linhas 23-29 (grupo desktop à
direita) ainda são exatamente:

```tsx
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">{userName}</span>
          <ThemeToggle />
          <button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary text-xs px-3 py-1">
            Sair
          </button>
        </div>
```

Se diferente, PARE e reporte NEEDS_CONTEXT.

- [ ] **Step 2: Adicionar o botão na versão desktop**

Substitua o trecho acima por:

```tsx
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">{userName}</span>
          <Link
            href="/eventos"
            className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-1 rounded font-medium"
          >
            Área do atleta
          </Link>
          <ThemeToggle />
          <button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary text-xs px-3 py-1">
            Sair
          </button>
        </div>
```

- [ ] **Step 3: Adicionar o botão na versão mobile**

Este arquivo duplica os links de navegação para telas pequenas em um bloco `md:hidden` separado
(linhas 31-41 do arquivo atual). Esse bloco hoje é:

```tsx
      <div className="md:hidden border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-4 text-sm">
          <Link href="/organizador" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
          <Link href="/organizador#meus-eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Eventos</Link>
          <Link href="/organizador/relatorio" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Relatório</Link>
          <Link href="/organizador/eventos/novo" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Novo Evento</Link>
          <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
          <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
          <Link href="/organizador/pedidos-vencidos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Pedidos vencidos</Link>
        </div>
      </div>
```

Substitua por (adiciona o link "Área do atleta" ao final da lista de links mobile, mesmo estilo
dos outros links dessa lista para manter consistência visual dentro do bloco mobile):

```tsx
      <div className="md:hidden border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-4 text-sm">
          <Link href="/organizador" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
          <Link href="/organizador#meus-eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Eventos</Link>
          <Link href="/organizador/relatorio" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Relatório</Link>
          <Link href="/organizador/eventos/novo" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Novo Evento</Link>
          <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Perfil</Link>
          <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
          <Link href="/organizador/pedidos-vencidos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Pedidos vencidos</Link>
          <Link href="/eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Área do atleta</Link>
        </div>
      </div>
```

- [ ] **Step 4: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Rodar a suíte de testes inteira**

Run: `npx vitest run`
Expected: todos os testes continuam passando (sem teste automatizado dedicado para este
componente).

- [ ] **Step 6: Conferir por leitura**

Leia o arquivo modificado e confirme: o badge "Área do atleta" aparece na versão desktop (ao lado
do `ThemeToggle`) e como último link na versão mobile; nenhum outro link foi removido/reordenado
em nenhuma das duas versões.

- [ ] **Step 7: Commit**

```bash
git add components/organizer/OrganizerNav.tsx
git commit -m "feat: adiciona botao area do atleta no menu do organizador"
```

---

## Self-Review Notes

- **Spec coverage:** os 2 bloqueios do spec são cobertos pelas Tasks 1 e 2; os 2 botões (admin e
  organizador) são cobertos pelas Tasks 3 e 4. Nada do spec ficou sem task.
- **Placeholder scan:** nenhum "TBD"/"handle edge cases" — cada step tem o código completo.
- **Type consistency:** nenhum tipo/função nova neste plano; as 4 tasks são independentes entre si
  (nenhuma consome interface de outra).
