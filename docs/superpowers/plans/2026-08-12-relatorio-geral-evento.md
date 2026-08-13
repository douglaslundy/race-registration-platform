# Relatório Geral por evento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela nova por evento ("Relatório Geral"), só leitura, com todas as
inscrições confirmadas numa lista só — nome, CPF, e-mail, telefone, percurso/categoria/
lote, tamanho de camiseta, contato de emergência, alergias/observações médicas, valor
pago, forma de pagamento e data de confirmação.

**Architecture:** Duas páginas novas (organizador e admin), cada uma buscando só
`status: "CONFIRMED"`, sem paginação, reaproveitando o padrão de busca em lote do último
pagamento por pedido já usado em `/inscritos`. Uma tabela nova, só-leitura, compartilhada
entre as duas páginas. O endpoint de CSV existente ganha duas colunas que faltavam
(Telefone, Valor Pago) e um filtro opcional de status, reaproveitado tanto pelo
`/inscritos` (sem filtro, como hoje) quanto pelo Relatório Geral (`status=CONFIRMED`).

**Tech Stack:** Next.js App Router (Server Components), Prisma, Vitest.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-12-relatorio-geral-evento-design.md`.
- Só `status: "CONFIRMED"` nas duas páginas novas — sem filtro de status configurável.
- Sem paginação — lista completa numa página só.
- Sem botões de ação (cancelar/reembolsar/reenviar) na tabela nova.
- O parâmetro `status` do endpoint CSV é opcional; sem ele, comportamento idêntico ao de
  hoje (usado pelo botão de exportar do `/inscritos`, que não deve mudar de
  comportamento).
- Mesma extensão nas duas páginas de evento: organizador e admin.

---

### Task 1: Endpoint CSV — Telefone, Valor Pago e filtro de status

**Files:**
- Modify: `app/api/events/[id]/registrations/route.ts`
- Test: `tests/events-registrations-export-route.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `GET /api/events/[id]/registrations?format=csv&status=CONFIRMED` (parâmetro
  `status` opcional), consumido por Task 2 e Task 3 (botão "Exportar CSV" das páginas
  novas).

- [ ] **Step 1: Atualizar os testes existentes pro novo cabeçalho do CSV**

Em `tests/events-registrations-export-route.test.ts`, o teste "inclui a coluna CPF e
Observação no cabeçalho e os valores nas linhas" (linha 24-49 atual) precisa do mock de
`athleteProfile` com `phone` e de `order` com `totalAmount`, e a asserção do cabeçalho
precisa das duas colunas novas. Substituir o mock e as asserções desse teste por:

```ts
  it("inclui a coluna CPF, Telefone e Valor Pago no cabeçalho e os valores nas linhas", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        athlete: {
          name: "Ana Silva",
          email: "ana@example.com",
          athleteProfile: { cpf: "11144477735", phone: "11988887777" },
        },
        route: { name: "10km" },
        category: null,
        ticketBatch: { name: "Lote 1" },
        order: { totalAmount: 5500 },
        shirtSize: "M",
        teamName: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: "Chegarei atrasado",
        status: "CONFIRMED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const csv = await res.text();

    expect(csv.split("\n")[0]).toBe(
      "Nome,Email,CPF,Telefone,Percurso,Categoria,Lote,Camisa,Equipe,Contato de Emergência,Telefone de Emergência,Observação,Valor Pago,Status,Data",
    );
    expect(csv).toContain('"Ana Silva","ana@example.com","11144477735","11988887777",');
    expect(csv).toContain('"Chegarei atrasado","R$ 55,00","CONFIRMED"');
  });
```

O teste "usa string vazia quando o atleta ainda não tem CPF cadastrado" (linha 51-72
atual) também precisa de `order: { totalAmount: 5000 }` no mock (senão
`r.order.totalAmount` quebra em runtime):

```ts
  it("usa string vazia quando o atleta ainda não tem CPF cadastrado", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        athlete: { name: "Bruno Costa", email: "bruno@example.com", athleteProfile: null },
        route: null,
        category: null,
        ticketBatch: { name: "Lote 1" },
        order: { totalAmount: 5000 },
        shirtSize: null,
        teamName: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: null,
        status: "PENDING_PAYMENT",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const csv = await res.text();

    expect(csv).toContain('"Bruno Costa","bruno@example.com","","",');
  });
```

(Note a string vazia extra depois do e-mail — é a coluna Telefone, também vazia quando
`athleteProfile` é `null`.)

- [ ] **Step 2: Adicionar um teste novo pro parâmetro `status`**

Acrescentar ao final do `describe`, antes do `});` de fechamento:

```ts
  it("filtra por status quando o parâmetro status é passado", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await GET(
      new Request("http://localhost/api/events/event-1/registrations?format=csv&status=CONFIRMED") as any,
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1", status: "CONFIRMED" } }),
    );
  });

  it("ignora um valor de status desconhecido (sem filtrar)", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await GET(
      new Request("http://localhost/api/events/event-1/registrations?format=csv&status=NAO_EXISTE") as any,
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1" } }),
    );
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/events-registrations-export-route.test.ts`
Expected: FAIL — cabeçalho não bate, `status` não é aplicado ao `where`, `r.order` é
`undefined` no código atual (ainda não busca `order`).

- [ ] **Step 4: Implementar as mudanças no endpoint**

Em `app/api/events/[id]/registrations/route.ts`, acrescentar o import de
`formatCurrency` no topo:

```ts
import { formatCurrency } from "@/lib/format";
```

Substituir o corpo da função `GET` (a partir de `const { searchParams } = new
URL(req.url);` até o fim) por:

```ts
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");
  const statusParam = searchParams.get("status");
  const VALID_STATUSES = ["PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "TRANSFERRED", "WAITLISTED", "CANCELLATION_REQUESTED"];
  const statusFilter = statusParam && VALID_STATUSES.includes(statusParam) ? statusParam : undefined;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const registrations = await db.registration.findMany({
    where: { eventId, ...(statusFilter ? { status: statusFilter as never } : {}) },
    include: {
      athlete: { select: { name: true, email: true, athleteProfile: { select: { cpf: true, phone: true } } } },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: { select: { totalAmount: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (format === "csv") {
    const header = "Nome,Email,CPF,Telefone,Percurso,Categoria,Lote,Camisa,Equipe,Contato de Emergência,Telefone de Emergência,Observação,Valor Pago,Status,Data\n";
    const rows = registrations.map((r) =>
      [
        r.athlete.name,
        r.athlete.email,
        r.athlete.athleteProfile?.cpf ?? "",
        r.athlete.athleteProfile?.phone ?? "",
        r.route?.name ?? "",
        r.category?.name ?? "",
        r.ticketBatch.name,
        r.shirtSize ?? "",
        r.teamName ?? "",
        r.emergencyContactName ?? "",
        r.emergencyContactPhone ?? "",
        r.notes ?? "",
        formatCurrency(r.order.totalAmount),
        r.status,
        r.createdAt.toISOString(),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );

    return new NextResponse(header + rows.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inscritos-${eventId}.csv"`,
      },
    });
  }

  return NextResponse.json({ registrations, total: registrations.length });
```

(`ticketBatch.priceAmount` não é mais buscado — nada no arquivo o usava fora do CSV, que
agora usa `order.totalAmount` pra "Valor Pago".)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/events-registrations-export-route.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 6: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add "app/api/events/[id]/registrations/route.ts" tests/events-registrations-export-route.test.ts
git commit -m "feat: CSV de inscritos ganha telefone, valor pago e filtro de status"
```

---

### Task 2: Página "Relatório Geral" do organizador

**Files:**
- Create: `components/registrations/GeneralReportTable.tsx`
- Create: `app/organizador/eventos/[id]/relatorio-geral/page.tsx`
- Modify: `app/organizador/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `?status=CONFIRMED` do endpoint CSV (Task 1).
- Produces: `GeneralReportTable`, consumido também por Task 3.

- [ ] **Step 1: Criar a tabela**

Criar `components/registrations/GeneralReportTable.tsx`:

```tsx
import { formatCurrency, formatDate } from "@/lib/format";

export interface GeneralReportRow {
  id: string;
  shirtSize: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
  athlete: {
    name: string;
    email: string;
    athleteProfile: { cpf: string | null; phone: string | null } | null;
  };
  route: { name: string } | null;
  category: { name: string } | null;
  ticketBatch: { name: string };
  order: { totalAmount: number };
  payment: { method: string; paidAt: Date | null } | null;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
};

export default function GeneralReportTable({ registrations }: { registrations: GeneralReportRow[] }) {
  return (
    <div className="card overflow-x-auto print:overflow-visible print:shadow-none print:border-0 print:p-0">
      <table className="w-full text-xs print:text-[9px]">
        <thead>
          <tr className="text-left text-gray-500 border-b dark:border-gray-700">
            <th className="pb-2 pr-3">Atleta</th>
            <th className="pb-2 pr-3">CPF</th>
            <th className="pb-2 pr-3">Telefone</th>
            <th className="pb-2 pr-3">Percurso / Categoria / Lote</th>
            <th className="pb-2 pr-3">Camiseta</th>
            <th className="pb-2 pr-3">Contato de emergência</th>
            <th className="pb-2 pr-3">Alergias / Observações médicas</th>
            <th className="pb-2 pr-3">Valor pago</th>
            <th className="pb-2 pr-3">Forma de pagamento</th>
            <th className="pb-2 pr-3">Confirmado em</th>
          </tr>
        </thead>
        <tbody>
          {registrations.map((r) => (
            <tr key={r.id} className="border-b dark:border-gray-700 last:border-0">
              <td className="py-2 pr-3">
                <p className="font-medium">{r.athlete.name}</p>
                <p className="text-gray-500">{r.athlete.email}</p>
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.athlete.athleteProfile?.cpf ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.athlete.athleteProfile?.phone ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                <p>{r.route?.name ?? "—"} {r.category ? `· ${r.category.name}` : ""}</p>
                <p className="text-gray-500">{r.ticketBatch.name}</p>
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.shirtSize ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                <p>{r.emergencyContactName ?? "—"}</p>
                <p className="text-gray-500">{r.emergencyContactPhone ?? "—"}</p>
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.medicalNotes ?? "—"}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{formatCurrency(r.order.totalAmount)}</td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                {r.payment ? PAYMENT_METHOD_LABEL[r.payment.method] ?? r.payment.method : "—"}
              </td>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                {r.payment?.paidAt ? formatDate(r.payment.paidAt, "dd/MM/yy HH:mm") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Criar a página do organizador**

Criar `app/organizador/eventos/[id]/relatorio-geral/page.tsx`, seguindo exatamente o
padrão de busca de `app/organizador/eventos/[id]/inscritos/page.tsx` (auth, busca do
evento, busca do último pagamento por pedido em lote via `IN`), mas sem filtros, sem
paginação, e só `status: "CONFIRMED"`:

```tsx
import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import PrintButton from "@/components/ui/PrintButton";
import GeneralReportTable from "@/components/registrations/GeneralReportTable";

export const metadata: Metadata = { title: "Relatório Geral" };

export default async function RelatorioGeralPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const registrations = await db.registration.findMany({
    where: { eventId: id, status: "CONFIRMED" },
    include: {
      athlete: {
        select: { name: true, email: true, athleteProfile: { select: { cpf: true, phone: true } } },
      },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: { select: { id: true, totalAmount: true } },
    },
    orderBy: { athlete: { name: "asc" } },
  });

  const orderIds = registrations.map((r) => r.order.id);
  const latestPayments = orderIds.length
    ? await db.payment.findMany({
        where: { orderId: { in: orderIds }, status: "PAID" },
        orderBy: { createdAt: "desc" },
        select: { orderId: true, method: true, paidAt: true },
      })
    : [];
  const latestPaymentByOrder = new Map<string, { method: string; paidAt: Date | null }>();
  for (const p of latestPayments) {
    if (p.orderId && !latestPaymentByOrder.has(p.orderId)) {
      latestPaymentByOrder.set(p.orderId, { method: p.method, paidAt: p.paidAt });
    }
  }
  const registrationsWithPayment = registrations.map((r) => ({
    ...r,
    payment: latestPaymentByOrder.get(r.order.id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600 print:hidden">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Relatório Geral — {event.title}</h1>
          <p className="text-sm text-gray-500">{registrations.length} inscrições confirmadas</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <a
            href={`/api/events/${id}/registrations?format=csv&status=CONFIRMED`}
            className="btn-secondary text-sm"
          >
            Exportar CSV
          </a>
          <PrintButton label="Imprimir PDF" />
        </div>
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição confirmada ainda.</div>
      ) : (
        <GeneralReportTable registrations={registrationsWithPayment} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Acrescentar o link na página do evento**

Em `app/organizador/eventos/[id]/page.tsx`, no bloco "Ações" (linhas ~410-418 atuais):

```tsx
      {/* Ações */}
      <div className="flex gap-3">
        <Link href={`/organizador/eventos/${id}/inscritos`} className="btn-secondary flex-1 text-center">
          Ver inscritos
        </Link>
        <Link href={`/organizador/eventos/${id}/relatorio-geral`} className="btn-secondary flex-1 text-center">
          Relatório Geral
        </Link>
        <Link href={`/organizador/eventos/${id}/resultados`} className="btn-secondary flex-1 text-center">
          Importar resultados
        </Link>
      </div>
```

- [ ] **Step 4: Rodar typecheck e a suíte de testes**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 5: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/organizador/eventos/<id>/relatorio-geral` de um evento com
inscrições confirmadas com alergias/contato de emergência preenchidos. Confirmar:
- Só aparecem inscrições confirmadas.
- Todas as colunas pedidas aparecem preenchidas corretamente.
- "Exportar CSV" baixa um CSV só com confirmados, com Telefone e Valor Pago.
- "Imprimir PDF" mostra só a tabela, sem nav/chrome (a correção de impressão já cobre
  isso globalmente).
- O link "Relatório Geral" aparece na página do evento e leva pra essa tela.

- [ ] **Step 6: Commit**

```bash
git add components/registrations/GeneralReportTable.tsx "app/organizador/eventos/[id]/relatorio-geral/page.tsx" "app/organizador/eventos/[id]/page.tsx"
git commit -m "feat: relatorio geral do evento (organizador) com dados completos dos confirmados"
```

---

### Task 3: Página "Relatório Geral" do admin

**Files:**
- Create: `app/admin/eventos/[id]/relatorio-geral/page.tsx`
- Modify: `app/admin/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `GeneralReportTable` (Task 2), endpoint CSV com `status=CONFIRMED` (Task 1).
- Produces: nada.

- [ ] **Step 1: Criar a página do admin**

Criar `app/admin/eventos/[id]/relatorio-geral/page.tsx`, idêntica à página do
organizador (Task 2, Step 2), com as diferenças de auth/escopo já usadas em
`app/admin/eventos/[id]/inscritos/page.tsx` (sem restrição por `organizerId` na busca do
evento) e nos links (`/admin/eventos/${id}` em vez de `/organizador/eventos/${id}`):

```tsx
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import PrintButton from "@/components/ui/PrintButton";
import GeneralReportTable from "@/components/registrations/GeneralReportTable";

export const metadata: Metadata = { title: "Relatório Geral — Admin" };

export default async function AdminRelatorioGeralPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const registrations = await db.registration.findMany({
    where: { eventId: id, status: "CONFIRMED" },
    include: {
      athlete: {
        select: { name: true, email: true, athleteProfile: { select: { cpf: true, phone: true } } },
      },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: { select: { id: true, totalAmount: true } },
    },
    orderBy: { athlete: { name: "asc" } },
  });

  const orderIds = registrations.map((r) => r.order.id);
  const latestPayments = orderIds.length
    ? await db.payment.findMany({
        where: { orderId: { in: orderIds }, status: "PAID" },
        orderBy: { createdAt: "desc" },
        select: { orderId: true, method: true, paidAt: true },
      })
    : [];
  const latestPaymentByOrder = new Map<string, { method: string; paidAt: Date | null }>();
  for (const p of latestPayments) {
    if (p.orderId && !latestPaymentByOrder.has(p.orderId)) {
      latestPaymentByOrder.set(p.orderId, { method: p.method, paidAt: p.paidAt });
    }
  }
  const registrationsWithPayment = registrations.map((r) => ({
    ...r,
    payment: latestPaymentByOrder.get(r.order.id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/admin/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600 print:hidden">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Relatório Geral — {event.title}</h1>
          <p className="text-sm text-gray-500">{registrations.length} inscrições confirmadas</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <a
            href={`/api/events/${id}/registrations?format=csv&status=CONFIRMED`}
            className="btn-secondary text-sm"
          >
            Exportar CSV
          </a>
          <PrintButton label="Imprimir PDF" />
        </div>
      </div>

      {registrations.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição confirmada ainda.</div>
      ) : (
        <GeneralReportTable registrations={registrationsWithPayment} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Acrescentar o link na página do evento**

Em `app/admin/eventos/[id]/page.tsx`, no bloco de ações (linhas ~298-308 atuais):

```tsx
      <div className="flex gap-3">
        <Link href={`/admin/eventos/${event.id}/inscritos`} className="btn-secondary text-sm">
          Ver inscritos
        </Link>
        <Link href={`/admin/eventos/${event.id}/relatorio-geral`} className="btn-secondary text-sm">
          Relatório Geral
        </Link>
        <Link href={`/api/events/${event.id}/registrations?format=csv`} className="btn-secondary text-sm">
          Exportar inscritos CSV
        </Link>
        <Link href={`/eventos/${event.slug}`} target="_blank" className="btn-secondary text-sm">
          Ver página pública
        </Link>
      </div>
```

- [ ] **Step 3: Rodar typecheck e a suíte de testes**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `npm test`
Expected: PASS em todos os arquivos.

- [ ] **Step 4: Conferir visualmente no navegador**

Com `npm run dev` já rodando, abrir `/admin/eventos/<id>/relatorio-geral` do mesmo
evento usado na Task 2. Confirmar que os dados batem com os vistos na página do
organizador.

- [ ] **Step 5: Commit**

```bash
git add "app/admin/eventos/[id]/relatorio-geral/page.tsx" "app/admin/eventos/[id]/page.tsx"
git commit -m "feat: relatorio geral do evento (admin) com dados completos dos confirmados"
```

---

## Self-Review Notes

- **Spec coverage:** só confirmados, sem paginação, sem ações (Task 2+3) ✓; todas as
  colunas pedidas (nome, CPF, e-mail, telefone, percurso/categoria/lote, camiseta,
  contato de emergência, alergias, valor pago, forma de pagamento, data de confirmação)
  presentes em `GeneralReportTable` ✓; CSV estendido com Telefone/Valor Pago +
  `status` opcional, sem quebrar o uso existente em `/inscritos` (Task 1) ✓; mesma
  extensão nas duas páginas (Task 2 + Task 3) ✓.
- **Placeholder scan:** nenhum "TBD"/"similar to Task N" — cada task tem o código
  completo, inclusive os testes atualizados.
- **Type consistency:** `GeneralReportRow` (Task 2) usado de forma idêntica nas duas
  páginas (Task 2 e Task 3) — mesmo `select`/`include` na query, mesmo mapeamento de
  `payment` a partir do `latestPaymentByOrder`.
