# Modal de Dados do Atleta, CSV e Tela de Inscritos no Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um modal reutilizável de "dados do atleta" (perfil + dados da inscrição específica),
usado na tela de inscritos do organizador, numa nova tela equivalente no admin, e na lista
`/admin/usuarios`; CSV de inscritos ganha contato de emergência.

**Architecture:** Extrai a tabela de inscritos do organizador para um componente compartilhado
(`RegistrationsTable`), reutilizado por uma nova página de admin somente leitura. O modal em si é
um componente cliente autocontido (estado próprio de aberto/fechado), sem chamada de API — recebe
os dados já buscados pelo server component que o renderiza.

**Tech Stack:** Next.js App Router (server + client components), Prisma.

## Global Constraints

- A tela de inscritos do admin é **somente leitura** — sem botões de ação (estornar, aprovar/
  rejeitar cancelamento, confirmar manualmente). Essas rotas de admin não existem hoje para
  cancelamento/confirmação manual; criá-las está fora de escopo.
- O modal segue o padrão visual já usado em `components/ui/ConfirmDialog.tsx` (overlay
  `fixed inset-0 bg-black/40 backdrop-blur-sm`, caixa branca/`dark:bg-gray-900` centralizada,
  fecha ao clicar fora).
- Seção "Perfil do atleta" no modal: CPF, nascimento, telefone, gênero, cidade, estado, equipe,
  camiseta preferida (`AthleteProfile`) — se o perfil for `null`, mostra "Este atleta ainda não
  preencheu o perfil" em vez da seção.
- Seção "Dados desta inscrição" (só quando aplicável): contato de emergência (nome + telefone) e
  observações médicas — campos do próprio `Registration` (`emergencyContactName`,
  `emergencyContactPhone`, `medicalNotes`), **não** os do perfil (`AthleteProfile.emergencyName/
  Phone`), que são um dado diferente.
- Nenhuma página envolvida tem suíte de teste automatizado hoje (server components de
  listagem/detalhe sem lógica testável isoladamente) — verificação manual no navegador ao final de
  cada task que altera uma página.
- Spec completa em
  `docs/superpowers/specs/2026-07-04-modal-dados-atleta-inscritos-admin-design.md`.

---

### Task 1: Componente `AthleteDetailsModal`

**Files:**
- Create: `components/registrations/AthleteDetailsModal.tsx`

**Interfaces:**
- Produces: `export default function AthleteDetailsModal(props: AthleteDetailsModalProps)`, usado
  pelas Tasks 2, 4 e 5.
  ```ts
  interface AthleteProfileData {
    cpf: string | null;
    birthDate: Date | string | null;
    phone: string | null;
    gender: string | null;
    city: string | null;
    state: string | null;
    teamName: string | null;
    preferredShirtSize: string | null;
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
  }
  ```

- [ ] **Step 1: Criar o componente**

Crie `components/registrations/AthleteDetailsModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";

interface AthleteProfileData {
  cpf: string | null;
  birthDate: Date | string | null;
  phone: string | null;
  gender: string | null;
  city: string | null;
  state: string | null;
  teamName: string | null;
  preferredShirtSize: string | null;
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
}

export default function AthleteDetailsModal({
  athleteName,
  athleteEmail,
  profile,
  registrationContext,
}: AthleteDetailsModalProps) {
  const [open, setOpen] = useState(false);

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
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
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

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Rodar `tsc` para garantir que compila**

Run: `npx tsc --noEmit`
Expected: sem erros (componente novo, não referenciado por ninguém ainda).

- [ ] **Step 3: Commit**

```bash
git add components/registrations/AthleteDetailsModal.tsx
git commit -m "feat: componente de modal com dados do atleta"
```

---

### Task 2: Extrair `RegistrationsTable` e usar no organizador (com o modal)

**Files:**
- Create: `components/registrations/RegistrationsTable.tsx`
- Modify: `app/organizador/eventos/[id]/inscritos/page.tsx`

**Interfaces:**
- Consumes: `AthleteDetailsModal` da Task 1.
- Produces: `export interface RegistrationRow` e
  `export default function RegistrationsTable({ registrations, renderActions? })` — usados pela
  Task 4 (nova página do admin).

- [ ] **Step 1: Criar `components/registrations/RegistrationsTable.tsx`**

```tsx
import type { ReactNode } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import { BADGE } from "@/lib/badge-colors";
import AthleteDetailsModal from "@/components/registrations/AthleteDetailsModal";

const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED: { label: "Confirmada", color: BADGE.green },
  CANCELLED: { label: "Cancelada", color: BADGE.red },
  TRANSFERRED: { label: "Transferida", color: BADGE.blue },
  WAITLISTED: { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
};

export interface RegistrationRow {
  id: string;
  status: string;
  shirtSize: string | null;
  createdAt: Date;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
  athlete: {
    name: string;
    email: string;
    athleteProfile: {
      cpf: string | null;
      birthDate: Date | null;
      phone: string | null;
      gender: string | null;
      city: string | null;
      state: string | null;
      teamName: string | null;
      preferredShirtSize: string | null;
    } | null;
  };
  route: { name: string } | null;
  category: { name: string } | null;
  ticketBatch: { name: string };
  order: {
    totalAmount: number;
    payments: { method: string; paidAt: Date | null; status: string; providerPaymentId: string | null }[];
  };
}

export default function RegistrationsTable({
  registrations,
  renderActions,
}: {
  registrations: RegistrationRow[];
  renderActions?: (registration: RegistrationRow) => ReactNode;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="pb-2 pr-4">Atleta</th>
            <th className="pb-2 pr-4">Percurso</th>
            <th className="pb-2 pr-4">Categoria</th>
            <th className="pb-2 pr-4">Lote</th>
            <th className="pb-2 pr-4">Camiseta</th>
            <th className="pb-2 pr-4">Pagamento</th>
            <th className="pb-2 pr-4">Valor</th>
            <th className="pb-2 pr-4">Data inscrição</th>
            <th className="pb-2 pr-4">Data pag.</th>
            <th className="pb-2 pr-4">Cód. transação</th>
            <th className="pb-2 pr-4">Status</th>
            {renderActions && <th className="pb-2">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {registrations.map((r) => {
            const payment = r.order.payments[0];
            const statusInfo = REGISTRATION_STATUS[r.status];
            return (
              <tr key={r.id} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                <td className="py-2 pr-4">
                  <p className="font-medium">{r.athlete.name}</p>
                  <p className="text-xs text-gray-500">{r.athlete.email}</p>
                  <AthleteDetailsModal
                    athleteName={r.athlete.name}
                    athleteEmail={r.athlete.email}
                    profile={r.athlete.athleteProfile}
                    registrationContext={{
                      emergencyContactName: r.emergencyContactName,
                      emergencyContactPhone: r.emergencyContactPhone,
                      medicalNotes: r.medicalNotes,
                    }}
                  />
                </td>
                <td className="py-2 pr-4 text-gray-700">{r.route?.name ?? "—"}</td>
                <td className="py-2 pr-4 text-gray-700">{r.category?.name ?? "—"}</td>
                <td className="py-2 pr-4 text-gray-700">{r.ticketBatch.name}</td>
                <td className="py-2 pr-4 text-gray-700">{r.shirtSize ?? "—"}</td>
                <td className="py-2 pr-4 text-gray-700">
                  {payment ? PAYMENT_METHOD_LABEL[payment.method] ?? payment.method : "—"}
                </td>
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
                <td className="py-2 pr-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo?.color ?? ""}`}>
                    {statusInfo?.label ?? r.status}
                  </span>
                </td>
                {renderActions && (
                  <td className="py-2">
                    <div className="flex flex-col gap-1">{renderActions(r)}</div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Atualizar a query e a renderização em `app/organizador/eventos/[id]/inscritos/page.tsx`**

Troque o import de `athlete` no `include` da query (linha `athlete: { select: { name: true, email:
true } },`) por:

```ts
      athlete: {
        select: {
          name: true,
          email: true,
          athleteProfile: {
            select: {
              cpf: true,
              birthDate: true,
              phone: true,
              gender: true,
              city: true,
              state: true,
              teamName: true,
              preferredShirtSize: true,
            },
          },
        },
      },
```

Adicione o import no topo do arquivo:

```ts
import RegistrationsTable from "@/components/registrations/RegistrationsTable";
```

Substitua todo o bloco `<div className="card overflow-x-auto"> ... </div>` (o `<table>` inteiro,
desde `<div className="card overflow-x-auto">` até o `</div>` que fecha ele, dentro do
`{registrations.length === 0 ? (...) : (...)}`) pelo uso do componente novo:

```tsx
        <RegistrationsTable
          registrations={registrations}
          renderActions={(r) => {
            const payment = r.order.payments[0];
            return (
              <>
                {payment?.status === "PAID" && <RefundRegistrationButton registrationId={r.id} />}
                {r.status === "CANCELLATION_REQUESTED" && <CancellationDecisionButtons registrationId={r.id} />}
                {r.status === "PENDING_PAYMENT" && <ManualConfirmButton registrationId={r.id} />}
              </>
            );
          }}
        />
```

(O bloco inteiro fica: `{registrations.length === 0 ? (<div className="card text-center py-12
text-gray-500">Nenhuma inscrição ainda.</div>) : (<RegistrationsTable ... />)}` — as importações de
`RefundRegistrationButton`, `CancellationDecisionButtons` e `ManualConfirmButton` já existem no
arquivo, não precisam mudar.)

- [ ] **Step 3: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros. O tipo retornado por `db.registration.findMany({ include: {...} })` já inclui
todos os campos escalares do `Registration` (`emergencyContactName`, `emergencyContactPhone`,
`medicalNotes` — não precisam ser adicionados ao `select`, `include` já os traz) mais as relações
pedidas, então deve satisfazer `RegistrationRow[]` estruturalmente sem cast.

- [ ] **Step 4: Verificação manual no navegador**

Suba `npm run dev`, acesse `/organizador/eventos/[id]/inscritos` (evento com inscrições) logado
como organizador, e confirme: a tabela renderiza igual a antes, o botão "Ver dados do atleta"
aparece abaixo do nome/e-mail de cada inscrito, e ao clicar abre o modal com as duas seções (perfil
+ dados da inscrição). Teste também um atleta sem perfil preenchido, se houver, pra confirmar a
mensagem de fallback.

- [ ] **Step 5: Commit**

```bash
git add components/registrations/RegistrationsTable.tsx app/organizador/eventos/\[id\]/inscritos/page.tsx
git commit -m "feat: extrai tabela de inscritos compartilhada e adiciona modal de dados do atleta"
```

---

### Task 3: CSV de inscritos ganha contato de emergência

**Files:**
- Modify: `app/api/events/[id]/registrations/route.ts`

**Interfaces:** Nenhuma nova — só adiciona colunas ao CSV já existente.

- [ ] **Step 1: Adicionar as duas colunas ao CSV**

Em `app/api/events/[id]/registrations/route.ts`, troque:

```ts
    const header = "Nome,Email,Percurso,Categoria,Lote,Camisa,Equipe,Status,Data\n";
    const rows = registrations.map((r) =>
      [
        r.athlete.name,
        r.athlete.email,
        r.route?.name ?? "",
        r.category?.name ?? "",
        r.ticketBatch.name,
        r.shirtSize ?? "",
        r.teamName ?? "",
        r.status,
        r.createdAt.toISOString(),
      ]
```

por:

```ts
    const header = "Nome,Email,Percurso,Categoria,Lote,Camisa,Equipe,Contato de Emergência,Telefone de Emergência,Status,Data\n";
    const rows = registrations.map((r) =>
      [
        r.athlete.name,
        r.athlete.email,
        r.route?.name ?? "",
        r.category?.name ?? "",
        r.ticketBatch.name,
        r.shirtSize ?? "",
        r.teamName ?? "",
        r.emergencyContactName ?? "",
        r.emergencyContactPhone ?? "",
        r.status,
        r.createdAt.toISOString(),
      ]
```

(`r.emergencyContactName`/`r.emergencyContactPhone` já vêm no resultado da query — são campos
escalares do próprio `Registration`, não precisam ser adicionados ao `include`.)

- [ ] **Step 2: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Verificação manual**

Suba `npm run dev`, acesse `/organizador/eventos/[id]/inscritos`, clique em "Exportar CSV", abra o
arquivo baixado e confirme as duas colunas novas com os valores corretos (ou vazias, se a inscrição
não tiver contato de emergência preenchido).

- [ ] **Step 4: Commit**

```bash
git add app/api/events/\[id\]/registrations/route.ts
git commit -m "feat: csv de inscritos inclui contato de emergencia"
```

---

### Task 4: Tela de inscritos no admin (nova)

**Files:**
- Create: `app/admin/eventos/[id]/inscritos/page.tsx`
- Modify: `app/admin/eventos/[id]/page.tsx` (link novo para a página criada)

**Interfaces:**
- Consumes: `RegistrationsTable`/`RegistrationRow` da Task 2, `buildRegistrationWhere`/
  `buildRegistrationOrderBy` de `lib/organizer/registrations.ts` (já existentes, genéricos).

- [ ] **Step 1: Criar `app/admin/eventos/[id]/inscritos/page.tsx`**

```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import ExportCsvButton from "@/components/organizer/ExportCsvButton";
import PrintButton from "@/components/ui/PrintButton";
import type { Metadata } from "next";
import { buildRegistrationOrderBy, buildRegistrationWhere } from "@/lib/organizer/registrations";
import RegistrationsTable from "@/components/registrations/RegistrationsTable";
import { BADGE } from "@/lib/badge-colors";

export const metadata: Metadata = { title: "Inscritos — Admin" };

const REGISTRATION_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando pagamento", color: BADGE.yellow },
  CONFIRMED: { label: "Confirmada", color: BADGE.green },
  CANCELLED: { label: "Cancelada", color: BADGE.red },
  TRANSFERRED: { label: "Transferida", color: BADGE.blue },
  WAITLISTED: { label: "Lista de espera", color: BADGE.gray },
  CANCELLATION_REQUESTED: { label: "Cancelamento solicitado", color: BADGE.orange },
};

interface SearchParams {
  status?: string;
  sort?: string;
  dir?: string;
}

function buildInscritosUrl(id: string, params: { status?: string; sort?: string; dir?: string }) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);
  const qs = query.toString();
  return `/admin/eventos/${id}/inscritos${qs ? `?${qs}` : ""}`;
}

export default async function AdminInscritosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const status = sp.status?.trim() ?? "";
  const sortConfig = buildRegistrationOrderBy(sp.sort?.trim() ?? "", sp.dir?.trim() ?? "");

  const event = await db.event.findFirst({
    where: { id },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const registrations = await db.registration.findMany({
    where: buildRegistrationWhere(id, status),
    include: {
      athlete: {
        select: {
          name: true,
          email: true,
          athleteProfile: {
            select: {
              cpf: true,
              birthDate: true,
              phone: true,
              gender: true,
              city: true,
              state: true,
              teamName: true,
              preferredShirtSize: true,
            },
          },
        },
      },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: {
        select: {
          totalAmount: true,
          payments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { method: true, paidAt: true, status: true, providerPaymentId: true },
          },
        },
      },
    },
    orderBy: sortConfig.orderBy,
  });

  const nameDir = sortConfig.normalizedSort === "name" && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
  const dateDir = sortConfig.normalizedSort === "date" && sortConfig.normalizedDir === "asc" ? "desc" : "asc";
  const activeButtonClass = "text-sm px-3 py-1.5 rounded-lg border border-primary-500 text-primary-600";
  const inactiveButtonClass = "text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/admin/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Inscritos — {event.title}</h1>
          <p className="text-sm text-gray-500">{registrations.length} inscrições</p>
        </div>
        <div className="flex gap-2">
          <ExportCsvButton eventId={id} />
          <PrintButton label="Imprimir PDF" />
        </div>
      </div>

      <form method="GET" className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select name="status" defaultValue={status} className="input-field text-sm py-1.5">
            <option value="">Todos</option>
            {Object.entries(REGISTRATION_STATUS).map(([value, info]) => (
              <option key={value} value={value}>{info.label}</option>
            ))}
          </select>
        </div>
        <input type="hidden" name="sort" value={sortConfig.normalizedSort} />
        <input type="hidden" name="dir" value={sortConfig.normalizedDir} />
        <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
        {status ? (
          <Link
            href={buildInscritosUrl(id, { sort: sortConfig.normalizedSort, dir: sortConfig.normalizedDir })}
            className="btn-secondary py-1.5 px-4 text-sm"
          >
            Limpar
          </Link>
        ) : null}
      </form>

      <div className="flex gap-2">
        <Link
          href={buildInscritosUrl(id, { status, sort: "name", dir: nameDir })}
          className={sortConfig.normalizedSort === "name" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem alfabética {sortConfig.normalizedSort === "name" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
        <Link
          href={buildInscritosUrl(id, { status, sort: "date", dir: dateDir })}
          className={sortConfig.normalizedSort === "date" ? activeButtonClass : inactiveButtonClass}
        >
          Ordem cronológica {sortConfig.normalizedSort === "date" ? (sortConfig.normalizedDir === "asc" ? "↑" : "↓") : ""}
        </Link>
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição ainda.</div>
      ) : (
        <RegistrationsTable registrations={registrations} />
      )}
    </div>
  );
}
```

(Note: `RegistrationsTable` é chamado sem `renderActions` — a coluna "Ações" some automaticamente,
conforme o componente da Task 2.)

- [ ] **Step 2: Adicionar link a partir de `app/admin/eventos/[id]/page.tsx`**

Troque:

```tsx
      <div className="flex gap-3">
        <Link href={`/api/events/${event.id}/registrations?format=csv`} className="btn-secondary text-sm">
          Exportar inscritos CSV
        </Link>
        <Link href={`/eventos/${event.slug}`} target="_blank" className="btn-secondary text-sm">
          Ver página pública
        </Link>
      </div>
```

por:

```tsx
      <div className="flex gap-3">
        <Link href={`/admin/eventos/${event.id}/inscritos`} className="btn-secondary text-sm">
          Ver inscritos
        </Link>
        <Link href={`/api/events/${event.id}/registrations?format=csv`} className="btn-secondary text-sm">
          Exportar inscritos CSV
        </Link>
        <Link href={`/eventos/${event.slug}`} target="_blank" className="btn-secondary text-sm">
          Ver página pública
        </Link>
      </div>
```

- [ ] **Step 3: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual no navegador**

Suba `npm run dev`, acesse `/admin/eventos/[id]` (evento com inscrições) logado como admin, clique
em "Ver inscritos", e confirme: a tabela aparece igual à do organizador (mesma ordem de colunas,
modal de dados do atleta funcionando), **sem** coluna "Ações" e sem os botões de estornar/aprovar
cancelamento/confirmar manualmente. Confirme também que o admin consegue acessar um evento de
**qualquer** organizador (não só os próprios).

- [ ] **Step 5: Commit**

```bash
git add app/admin/eventos/\[id\]/inscritos/page.tsx app/admin/eventos/\[id\]/page.tsx
git commit -m "feat: tela de inscritos no ambiente admin (somente leitura)"
```

---

### Task 5: Modal de dados do atleta em `/admin/usuarios`

**Files:**
- Modify: `app/admin/usuarios/page.tsx`

**Interfaces:**
- Consumes: `AthleteDetailsModal` da Task 1 (chamado **sem** `registrationContext`, já que a lista
  de usuários não tem uma inscrição específica em contexto).

- [ ] **Step 1: Adicionar `athleteProfile` ao `select` da query de usuários**

Troque o `select` de `db.user.findMany` (dentro do bloco que já tem `id, name, email, role, active,
createdAt, _count`):

```ts
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      _count: { select: { registrations: true, orders: true } },
    },
```

por:

```ts
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      _count: { select: { registrations: true, orders: true } },
      athleteProfile: {
        select: {
          cpf: true,
          birthDate: true,
          phone: true,
          gender: true,
          city: true,
          state: true,
          teamName: true,
          preferredShirtSize: true,
        },
      },
    },
```

- [ ] **Step 2: Adicionar o import e o botão do modal na linha da tabela**

Adicione o import no topo do arquivo:

```ts
import AthleteDetailsModal from "@/components/registrations/AthleteDetailsModal";
```

Troque:

```tsx
                      <Link href={`/admin/usuarios/${u.id}`} className="text-xs text-primary-600 hover:underline">
                        Detalhes
                      </Link>
                      <Link href={`/admin/usuarios/${u.id}/editar`} className="text-xs text-primary-600 hover:underline">
                        Editar
                      </Link>
```

por:

```tsx
                      <Link href={`/admin/usuarios/${u.id}`} className="text-xs text-primary-600 hover:underline">
                        Detalhes
                      </Link>
                      <AthleteDetailsModal
                        athleteName={u.name}
                        athleteEmail={u.email}
                        profile={u.athleteProfile}
                      />
                      <Link href={`/admin/usuarios/${u.id}/editar`} className="text-xs text-primary-600 hover:underline">
                        Editar
                      </Link>
```

(`registrationContext` fica de fora dessa chamada — sem inscrição específica em contexto nessa
tela, só a seção de perfil aparece no modal, conforme o componente da Task 1.)

- [ ] **Step 3: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual no navegador**

Suba `npm run dev`, acesse `/admin/usuarios` logado como admin, e confirme: o botão "Ver dados do
atleta" aparece ao lado de "Detalhes" pra cada usuário, "Detalhes" continua navegando pra página
separada como antes (sem mudança), e o modal abre mostrando só a seção de perfil (sem "Dados desta
inscrição"). Teste também um usuário sem perfil de atleta preenchido (ex.: um organizador ou admin).

- [ ] **Step 5: Commit**

```bash
git add app/admin/usuarios/page.tsx
git commit -m "feat: modal de dados do atleta na lista de usuarios do admin"
```
