# Taxas no Comprovante do Atleta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a taxa da plataforma e a taxa de serviço no resumo financeiro do comprovante de
inscrição do atleta (`/dashboard/inscricoes/[id]`), reaproveitando os valores já calculados no
`Order` e os rótulos já usados na tela de checkout. Também corrige uma página que ficou
desalinhada à esquerda por falta de `mx-auto`, achada numa varredura de todas as 56 páginas do
sistema em busca desse mesmo padrão de bug.

**Architecture:** Duas mudanças pequenas e independentes em Server Components existentes: (1)
buscar o campo `paymentFeeAmount` que falta no `select` do `order` e renderizar duas linhas
condicionais (`> 0`) no card "Resumo financeiro" já existente; (2) adicionar `mx-auto` ao único
container encontrado na varredura com `max-w-*` sem `mx-auto`.

**Tech Stack:** Next.js (App Router, Server Components), Prisma.

## Global Constraints

- Rótulos exatos, iguais aos já usados no checkout (`components/checkout/CheckoutForm.tsx:558,563`):
  "Taxa da plataforma" e "Taxa de serviço".
- Cada linha só aparece quando o valor correspondente é maior que zero (mesma regra do checkout).
- Sem testes de UI, seguindo a convenção já estabelecida no projeto.
- Não alterar `lib/checkout.ts` (cálculo das taxas) nem a tela de checkout — só exibição no
  comprovante do atleta.

---

### Task 1: Exibir taxa da plataforma e taxa de serviço no resumo financeiro

**Files:**
- Modify: `app/dashboard/inscricoes/[id]/page.tsx`

**Interfaces:** nenhuma — mudança isolada em um Server Component, sem exports novos.

- [ ] **Step 1: Adicionar `paymentFeeAmount` ao select do `order`**

Em `app/dashboard/inscricoes/[id]/page.tsx`, trocar (linha 42-44):

```ts
      order: {
        select: { id: true, status: true, totalAmount: true, discountAmount: true, platformFeeAmount: true },
      },
```

por:

```ts
      order: {
        select: {
          id: true,
          status: true,
          totalAmount: true,
          discountAmount: true,
          platformFeeAmount: true,
          paymentFeeAmount: true,
        },
      },
```

- [ ] **Step 2: Adicionar as duas linhas no card "Resumo financeiro"**

No mesmo arquivo, trocar o bloco do card "Resumo financeiro" (linhas 160-178):

```tsx
      <div className="card space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Resumo financeiro</h3>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Subtotal</span>
            <span>{formatCurrency(registration.ticketBatch.priceAmount)}</span>
          </div>
          {registration.order.discountAmount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Desconto</span>
              <span>- {formatCurrency(registration.order.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-900 dark:text-gray-100 pt-2 border-t dark:border-gray-700">
            <span>Total pago</span>
            <span>{formatCurrency(registration.order.totalAmount)}</span>
          </div>
        </div>
      </div>
```

por:

```tsx
      <div className="card space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Resumo financeiro</h3>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Subtotal</span>
            <span>{formatCurrency(registration.ticketBatch.priceAmount)}</span>
          </div>
          {registration.order.discountAmount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Desconto</span>
              <span>- {formatCurrency(registration.order.discountAmount)}</span>
            </div>
          )}
          {registration.order.platformFeeAmount > 0 && (
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>Taxa da plataforma</span>
              <span>+ {formatCurrency(registration.order.platformFeeAmount)}</span>
            </div>
          )}
          {registration.order.paymentFeeAmount > 0 && (
            <div className="flex justify-between text-gray-600 dark:text-gray-400">
              <span>Taxa de serviço</span>
              <span>+ {formatCurrency(registration.order.paymentFeeAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-900 dark:text-gray-100 pt-2 border-t dark:border-gray-700">
            <span>Total pago</span>
            <span>{formatCurrency(registration.order.totalAmount)}</span>
          </div>
        </div>
      </div>
```

- [ ] **Step 3: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/inscricoes/'[id]'/page.tsx
git commit -m "feat: show platform and service fee breakdown in athlete registration receipt"
```

---

### Task 2: Centralizar as 7 páginas com `max-w-*` sem `mx-auto`

**Files:**
- Modify: `app/organizador/eventos/[id]/resultados/page.tsx`
- Modify: `app/admin/eventos/[id]/page.tsx`
- Modify: `app/admin/usuarios/[id]/page.tsx`
- Modify: `app/admin/usuarios/[id]/editar/page.tsx`
- Modify: `app/admin/usuarios/novo/page.tsx`
- Modify: `app/admin/pagamentos/[id]/page.tsx`
- Modify: `app/dashboard/inscricoes/[id]/page.tsx`

**Interfaces:** nenhuma — mudanças isoladas de CSS, sem exports novos.

Contexto: varredura de todas as 56 páginas em `app/**/page.tsx` procurando containers com
`max-w-*` sem `mx-auto` (o mesmo padrão de bug já corrigido em `app/dashboard/perfil/page.tsx` na
Task 6 do plano `2026-07-06-edicao-atleta-admin-organizador.md`). A primeira varredura só pegava
`max-w-*` quando era a primeira classe do `className` e perdeu casos como `"space-y-6 max-w-3xl"`
(max-w no meio da string); a busca corrigida achou mais 6 páginas com o mesmo problema. Todas as 7
estão sob layouts que já centralizam (`max-w-7xl mx-auto` em admin, `max-w-5xl mx-auto` no
dashboard), então cada uma delas fica desalinhada à esquerda dentro da área já centralizada.
`admin/eventos` (lista), a home do organizador (`app/organizador/page.tsx`) e as páginas de
`app/auth/*`/`app/acesso-negado/page.tsx` foram inspecionadas e não têm esse problema — as duas
primeiras usam o container inteiro do layout sem `max-w` próprio mais estreito, e as de auth já
centralizam via `flex items-center justify-center` no wrapper pai.

- [ ] **Step 1: `app/organizador/eventos/[id]/resultados/page.tsx`**

Trocar (linha 47):

```tsx
    <div className="max-w-lg space-y-6">
```

por:

```tsx
    <div className="max-w-lg mx-auto space-y-6">
```

- [ ] **Step 2: `app/admin/eventos/[id]/page.tsx`**

Trocar (linha 33):

```tsx
    <div className="space-y-6 max-w-3xl">
```

por:

```tsx
    <div className="space-y-6 max-w-3xl mx-auto">
```

- [ ] **Step 3: `app/admin/usuarios/[id]/page.tsx`**

Trocar (linha 74):

```tsx
    <div className="space-y-6 max-w-3xl">
```

por:

```tsx
    <div className="space-y-6 max-w-3xl mx-auto">
```

- [ ] **Step 4: `app/admin/usuarios/[id]/editar/page.tsx`**

Trocar (linha 29):

```tsx
    <div className="space-y-6 max-w-3xl">
```

por:

```tsx
    <div className="space-y-6 max-w-3xl mx-auto">
```

- [ ] **Step 5: `app/admin/usuarios/novo/page.tsx`**

Trocar (linha 12):

```tsx
    <div className="space-y-6 max-w-3xl">
```

por:

```tsx
    <div className="space-y-6 max-w-3xl mx-auto">
```

- [ ] **Step 6: `app/admin/pagamentos/[id]/page.tsx`**

Trocar (linha 63):

```tsx
    <div className="space-y-6 max-w-3xl">
```

por:

```tsx
    <div className="space-y-6 max-w-3xl mx-auto">
```

- [ ] **Step 7: `app/dashboard/inscricoes/[id]/page.tsx`**

Trocar (linha 67):

```tsx
    <div className="space-y-6 max-w-2xl">
```

por:

```tsx
    <div className="space-y-6 max-w-2xl mx-auto">
```

- [ ] **Step 8: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem output (sem erros).

- [ ] **Step 9: Commit**

```bash
git add app/organizador/eventos/'[id]'/resultados/page.tsx app/admin/eventos/'[id]'/page.tsx app/admin/usuarios/'[id]'/page.tsx app/admin/usuarios/'[id]'/editar/page.tsx app/admin/usuarios/novo/page.tsx app/admin/pagamentos/'[id]'/page.tsx app/dashboard/inscricoes/'[id]'/page.tsx
git commit -m "fix: center 7 pages whose content div lacked mx-auto"
```
