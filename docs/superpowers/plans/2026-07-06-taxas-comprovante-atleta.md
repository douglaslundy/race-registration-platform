# Taxas no Comprovante do Atleta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a taxa da plataforma e a taxa de serviço no resumo financeiro do comprovante de
inscrição do atleta (`/dashboard/inscricoes/[id]`), reaproveitando os valores já calculados no
`Order` e os rótulos já usados na tela de checkout.

**Architecture:** Uma mudança em um único Server Component: buscar o campo `paymentFeeAmount` que
falta no `select` do `order`, e renderizar duas linhas condicionais (`> 0`) no card "Resumo
financeiro" já existente.

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
