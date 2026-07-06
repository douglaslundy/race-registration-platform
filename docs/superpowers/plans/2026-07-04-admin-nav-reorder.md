# Reordenar menu do topo do admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reordenar os links do menu de navegação do admin (`components/admin/AdminNav.tsx`) para
seguir a sequência exata pedida pelo usuário, sem mudar hrefs, textos, estilos ou comportamento.

**Architecture:** Mudança de uma única linha de código por link — apenas reordenar as tags `<Link>`
já existentes dentro do mesmo `<div>`. Nenhum componente novo, nenhuma lógica nova.

**Tech Stack:** Next.js (App Router), React, TypeScript.

## Global Constraints

- Ordem final exata dos links (do início ao fim do grupo esquerdo): Admin, Eventos, Usuários,
  Pagamentos, Pedidos vencidos, Cupons, Repasses, Relatório, Conciliação, Auditoria, WhatsApp,
  Alertas, Config., Legal, Backup, Perfil.
- O grupo à direita (ThemeToggle, depois "Sair") não muda — já está na posição correta.
- Nenhum href, texto visível, classe CSS ou comportamento de clique muda — só a ordem das linhas.
- Este projeto não tem infraestrutura de teste de componentes React (sem `@testing-library/react`,
  sem ambiente jsdom configurado — confirmado via grep no `package.json` e na pasta `tests/`).
  Não introduzir esse setup só para esta mudança; verificar via `tsc` e leitura visual do arquivo.

---

### Task 1: Reordenar os links em `AdminNav.tsx`

**Files:**
- Modify: `components/admin/AdminNav.tsx:9-28`

**Interfaces:**
- Consumes: nenhuma (não depende de nenhuma outra task).
- Produces: nenhuma (não é consumido por nenhuma outra task — este plano tem uma única task).

- [ ] **Step 1: Ler o arquivo atual para confirmar que não mudou desde o brainstorming**

Run: abrir `components/admin/AdminNav.tsx` e conferir que as linhas 9-28 ainda são exatamente:

```tsx
export default function AdminNav() {
  return (
    <nav className="bg-gray-900 dark:bg-gray-950 text-white px-4 py-3 border-b border-gray-800">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6 text-sm">
          <Link href="/admin" className="font-bold text-yellow-400">Admin</Link>
          <Link href="/admin/eventos" className="hover:text-gray-300">Eventos</Link>
          <Link href="/admin/usuarios" className="hover:text-gray-300">Usuários</Link>
          <Link href="/admin/pagamentos" className="hover:text-gray-300">Pagamentos</Link>
          <Link href="/admin/cupons" className="hover:text-gray-300">Cupons</Link>
          <Link href="/admin/repasses" className="hover:text-gray-300">Repasses</Link>
          <Link href="/admin/relatorio" className="hover:text-gray-300">Relatório</Link>
          <Link href="/admin/auditoria" className="hover:text-gray-300">Auditoria</Link>
          <Link href="/admin/conteudo-legal" className="hover:text-gray-300">Legal</Link>
          <Link href="/admin/configuracoes" className="hover:text-gray-300">Config.</Link>
          <Link href="/admin/backup" className="hover:text-gray-300">Backup</Link>
          <Link href="/admin/whatsapp" className="hover:text-gray-300">WhatsApp</Link>
          <Link href="/admin/alertas" className="hover:text-gray-300">Alertas</Link>
          <Link href="/admin/conciliacao" className="hover:text-gray-300">Conciliação</Link>
          <Link href="/admin/pedidos-vencidos" className="hover:text-gray-300">Pedidos vencidos</Link>
          <Link href="/admin/perfil" className="hover:text-gray-300">Perfil</Link>
        </div>
```

If the file differs from this, STOP and report NEEDS_CONTEXT — do not guess how to merge the
change; the controller needs to know what changed since the plan was written.

- [ ] **Step 2: Substituir pelo bloco reordenado**

Replace the entire `<div className="flex items-center gap-6 text-sm">...</div>` block (lines 11-28
of the current file) with:

```tsx
        <div className="flex items-center gap-6 text-sm">
          <Link href="/admin" className="font-bold text-yellow-400">Admin</Link>
          <Link href="/admin/eventos" className="hover:text-gray-300">Eventos</Link>
          <Link href="/admin/usuarios" className="hover:text-gray-300">Usuários</Link>
          <Link href="/admin/pagamentos" className="hover:text-gray-300">Pagamentos</Link>
          <Link href="/admin/pedidos-vencidos" className="hover:text-gray-300">Pedidos vencidos</Link>
          <Link href="/admin/cupons" className="hover:text-gray-300">Cupons</Link>
          <Link href="/admin/repasses" className="hover:text-gray-300">Repasses</Link>
          <Link href="/admin/relatorio" className="hover:text-gray-300">Relatório</Link>
          <Link href="/admin/conciliacao" className="hover:text-gray-300">Conciliação</Link>
          <Link href="/admin/auditoria" className="hover:text-gray-300">Auditoria</Link>
          <Link href="/admin/whatsapp" className="hover:text-gray-300">WhatsApp</Link>
          <Link href="/admin/alertas" className="hover:text-gray-300">Alertas</Link>
          <Link href="/admin/configuracoes" className="hover:text-gray-300">Config.</Link>
          <Link href="/admin/conteudo-legal" className="hover:text-gray-300">Legal</Link>
          <Link href="/admin/backup" className="hover:text-gray-300">Backup</Link>
          <Link href="/admin/perfil" className="hover:text-gray-300">Perfil</Link>
        </div>
```

Note: every `href`, class name, and label is copied verbatim from the original file — only the line
order changed. The closing `</div>` for this block, and everything after it (the right-aligned
`ThemeToggle`/"Sair" group and the rest of the component), stays untouched.

- [ ] **Step 3: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros (esta mudança é puramente de ordem de JSX, não deve afetar tipos).

- [ ] **Step 4: Rodar a suíte de testes inteira**

Run: `npx vitest run`
Expected: todos os testes continuam passando (nenhum teste existente cobre `AdminNav.tsx`, então
o número total de testes não muda).

- [ ] **Step 5: Conferir a ordem final por leitura**

Leia o arquivo modificado e confirme visualmente que a ordem dos 16 `<Link>` (do "Admin" ao
"Perfil") bate exatamente com a lista do Global Constraints, na mesma ordem, sem nenhum item
faltando ou duplicado.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AdminNav.tsx
git commit -m "fix: reordena menu do topo do admin"
```

---

## Self-Review Notes

- **Spec coverage:** o único requisito do spec (nova ordem exata dos 16 links, grupo direito
  inalterado) é coberto integralmente pela Task 1 — não há mais nada no spec para cobrir.
- **Placeholder scan:** nenhum "TBD"/"handle edge cases" — cada step tem o código completo.
- **Type consistency:** não há tipos/funções novas neste plano; N/A.
