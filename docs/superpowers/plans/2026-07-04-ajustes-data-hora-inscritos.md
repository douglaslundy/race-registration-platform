# Ajustes de Data/Hora: Admin/Pagamentos e Organizador/Inscritos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar hora junto da data em `/admin/pagamentos`, e reordenar as colunas de data em
`/organizador/eventos/[id]/inscritos` para "Data inscrição" vir à esquerda de "Data pag.".

**Architecture:** Duas edições diretas e independentes em páginas server-component do Next.js App
Router — sem lógica de negócio nova, sem migração de banco, sem rota de API alterada.

**Tech Stack:** Next.js App Router (server components), `date-fns` via `lib/format.ts`.

## Global Constraints

- Usar sempre `formatDate` de `lib/format.ts` para exibir datas com hora — nunca `toLocaleDateString`
  ou `toLocaleString` direto, para manter formato consistente com o resto do admin/organizador.
- Formato de data+hora: `"dd/MM/yyyy HH:mm"` (mesmo padrão já usado em
  `app/organizador/eventos/[id]/inscritos/page.tsx:188,194`).
- Nenhuma dessas páginas tem suíte de teste automatizado hoje (são server components de listagem
  sem lógica testável isoladamente) — a verificação é manual, no navegador, ao final de cada task.
- Spec completa em `docs/superpowers/specs/2026-07-04-ajustes-data-hora-inscritos-design.md`.

---

### Task 1: Hora junto da data em `/admin/pagamentos`

**Files:**
- Modify: `app/admin/pagamentos/page.tsx:3` (import) e `app/admin/pagamentos/page.tsx:249` (célula
  de data)

**Interfaces:**
- Consumes: `formatDate(date: Date | string, pattern?: string): string` de `lib/format.ts` (já
  existe, usado em outras páginas do projeto).

- [ ] **Step 1: Adicionar `formatDate` ao import existente de `lib/format`**

Em `app/admin/pagamentos/page.tsx:3`, troque:

```ts
import { formatCurrency } from "@/lib/format";
```

por:

```ts
import { formatCurrency, formatDate } from "@/lib/format";
```

- [ ] **Step 2: Trocar a célula de data para incluir a hora**

Em `app/admin/pagamentos/page.tsx:249`, troque:

```tsx
                <td className={cellPadding + " text-gray-500 text-xs whitespace-nowrap"}>{p.createdAt.toLocaleDateString("pt-BR")}</td>
```

por:

```tsx
                <td className={cellPadding + " text-gray-500 text-xs whitespace-nowrap"}>{formatDate(p.createdAt, "dd/MM/yyyy HH:mm")}</td>
```

- [ ] **Step 3: Rodar `tsc` para garantir que não quebrou tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (mudança é só troca de uma chamada de formatação por outra, ambas retornam
`string`).

- [ ] **Step 4: Verificação manual no navegador**

Suba o dev server (`npm run dev`), acesse `/admin/pagamentos` logado como admin, e confirme que a
coluna "Data" agora mostra data **e hora** (formato `dd/MM/yyyy HH:mm`) para cada pagamento listado.

- [ ] **Step 5: Commit**

```bash
git add app/admin/pagamentos/page.tsx
git commit -m "feat: exibe hora junto da data na listagem de pagamentos do admin"
```

---

### Task 2: Reordenar colunas de data em `/organizador/eventos/[id]/inscritos`

**Files:**
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx:158-163` (cabeçalho da tabela) e
  `app/organizador/eventos/[id]/inscritos/page.tsx:184-195` (células de cada linha)

**Interfaces:**
- Nenhuma nova — só reordena elementos JSX já existentes, sem mudar dado, formatação ou lógica.

- [ ] **Step 1: Reordenar o cabeçalho da tabela**

Em `app/organizador/eventos/[id]/inscritos/page.tsx`, troque o bloco de `<th>` (linhas 158-163):

```tsx
                <th className="pb-2 pr-4">Pagamento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Data pag.</th>
                <th className="pb-2 pr-4">Cód. transação</th>
                <th className="pb-2 pr-4">Data inscrição</th>
                <th className="pb-2 pr-4">Status</th>
```

por:

```tsx
                <th className="pb-2 pr-4">Pagamento</th>
                <th className="pb-2 pr-4">Valor</th>
                <th className="pb-2 pr-4">Data inscrição</th>
                <th className="pb-2 pr-4">Data pag.</th>
                <th className="pb-2 pr-4">Cód. transação</th>
                <th className="pb-2 pr-4">Status</th>
```

("Data inscrição" passa a vir antes de "Data pag."; "Cód. transação" continua logo depois de "Data
pag."; nenhum outro `<th>` muda de posição.)

- [ ] **Step 2: Reordenar as células de cada linha, na mesma posição relativa**

No mesmo arquivo, troque o bloco de `<td>` correspondente (linhas 184-195):

```tsx
                    <td className="py-2 pr-4 text-gray-700">
                      {formatCurrency(r.order.totalAmount)}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {payment?.paidAt ? formatDate(payment.paidAt, "dd/MM/yyyy HH:mm") : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 font-mono text-xs truncate max-w-[10rem]">
                      {payment?.providerPaymentId ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatDate(r.createdAt, "dd/MM/yyyy HH:mm")}
                    </td>
```

por:

```tsx
                    <td className="py-2 pr-4 text-gray-700">
                      {formatCurrency(r.order.totalAmount)}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatDate(r.createdAt, "dd/MM/yyyy HH:mm")}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {payment?.paidAt ? formatDate(payment.paidAt, "dd/MM/yyyy HH:mm") : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 font-mono text-xs truncate max-w-[10rem]">
                      {payment?.providerPaymentId ?? "—"}
                    </td>
```

(a célula de "Data inscrição" — antes por último — agora vem logo depois de "Valor"; "Data pag." e
"Cód. transação" mantêm a ordem relativa entre si, só deslocadas uma posição para a direita.)

- [ ] **Step 3: Rodar `tsc` para garantir que não quebrou tipos**

Run: `npx tsc --noEmit`
Expected: sem erros (reordenação pura de JSX, mesmas variáveis usadas).

- [ ] **Step 4: Verificação manual no navegador**

Suba o dev server (`npm run dev`), acesse `/organizador/eventos/[id]/inscritos` (qualquer evento com
inscrições) logado como organizador, e confirme visualmente a nova ordem das colunas: `..., Valor,
Data inscrição, Data pag., Cód. transação, Status, Ações`.

- [ ] **Step 5: Commit**

```bash
git add app/organizador/eventos/\[id\]/inscritos/page.tsx
git commit -m "feat: reordena colunas de data na listagem de inscritos do organizador"
```
