import { requireAnyPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import PrintButton from "@/components/ui/PrintButton";
import GeneralReportTable from "@/components/registrations/GeneralReportTable";
import RegistrationsExportButtons from "@/components/registrations/RegistrationsExportButtons";
import GeneralReportDashboard from "@/components/registrations/GeneralReportDashboard";
import { buildGeneralReportOrderBy, computeGeneralReportDashboard } from "@/lib/reports/general-report";

export const metadata: Metadata = { title: "Relatório Geral" };

interface SearchParams {
  q?: string;
  categoryId?: string;
  routeId?: string;
  sort?: string;
  print?: string;
}

export default async function RelatorioGeralPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const session = await requireAnyPermission(["reports.export", "registrations.view"], { eventId: id });
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const categoryId = sp.categoryId?.trim() ?? "";
  const routeId = sp.routeId?.trim() ?? "";
  const sort = sp.sort?.trim() ?? "";
  const printMode = sp.print === "1";

  // Mesmo padrão já usado pela rota de exportação e pela tela de inscritos — sem isso, um ADMIN ou
  // um ASSISTENTE de organizador (ambos passam por requireOrganizer) recebiam 404 aqui, porque a
  // consulta antiga comparava organizer.userId diretamente com o usuário logado, que nunca é igual
  // ao dono do evento nesses dois casos.
  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({
        where: { id },
        select: { id: true, title: true, startAt: true, categories: { select: { id: true, name: true }, orderBy: { name: "asc" } }, routes: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
      })
    : await db.event.findFirst({
        where: { id, organizerId: scope.organizerId ?? "__none__" },
        select: { id: true, title: true, startAt: true, categories: { select: { id: true, name: true }, orderBy: { name: "asc" } }, routes: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
      });
  if (!event) notFound();

  const where = {
    eventId: id,
    status: "CONFIRMED" as const,
    ...(categoryId ? { categoryId } : {}),
    ...(routeId ? { routeId } : {}),
    ...(q
      ? {
          OR: [
            { athlete: { name: { contains: q, mode: "insensitive" as const } } },
            { athlete: { email: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const registrations = await db.registration.findMany({
    where,
    include: {
      athlete: {
        select: { name: true, email: true, athleteProfile: { select: { cpf: true, phone: true, birthDate: true } } },
      },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: { select: { id: true, totalAmount: true } },
    },
    orderBy: buildGeneralReportOrderBy(sort),
  });

  const orderIds = registrations.map((r) => r.order.id);
  const latestPayments = orderIds.length
    ? await db.payment.findMany({
        where: { orderId: { in: orderIds }, status: "PAID" },
        orderBy: { createdAt: "desc" },
        select: { orderId: true, method: true, paidAt: true, amount: true },
      })
    : [];
  const latestPaymentByOrder = new Map<string, { method: string; paidAt: Date | null; amount: number }>();
  for (const p of latestPayments) {
    if (p.orderId && !latestPaymentByOrder.has(p.orderId)) {
      latestPaymentByOrder.set(p.orderId, { method: p.method, paidAt: p.paidAt, amount: p.amount });
    }
  }
  const registrationsWithPayment = registrations.map((r) => ({
    ...r,
    payment: latestPaymentByOrder.get(r.order.id) ?? null,
  }));

  const paidAmountByOrderId = new Map([...latestPaymentByOrder.entries()].map(([orderId, p]) => [orderId, p.amount]));
  const dashboard = computeGeneralReportDashboard(registrations, paidAmountByOrderId);

  const sortLink = (value: string, label: string) => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}), ...(routeId ? { routeId } : {}), sort: value });
    const active = sort === value || (!sort && value === "name");
    return (
      <Link
        key={value}
        href={`/organizador/eventos/${id}/relatorio-geral?${params.toString()}`}
        className={active ? "btn-primary text-xs px-2 py-1" : "btn-secondary text-xs px-2 py-1"}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/organizador/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600 print:hidden">← Voltar ao evento</Link>
          <h1 className="text-xl font-bold mt-1">Relatório Geral — {event.title}</h1>
          <p className="text-sm text-gray-500">{registrations.length} inscrições confirmadas</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <RegistrationsExportButtons eventId={id} filters={{ status: "CONFIRMED", q, categoryId, routeId }} />
          <PrintButton label="Imprimir PDF" />
        </div>
      </div>

      {!printMode && <GeneralReportDashboard dashboard={dashboard} />}

      {!printMode && (
        <div className="card space-y-3 print:hidden">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Buscar por nome ou e-mail</label>
              <input name="q" defaultValue={q} placeholder="Buscar..." className="input text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Percurso</label>
              <select name="routeId" defaultValue={routeId} className="input text-sm">
                <option value="">Todos</option>
                {event.routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Categoria</label>
              <select name="categoryId" defaultValue={categoryId} className="input text-sm">
                <option value="">Todas</option>
                {event.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <input type="hidden" name="sort" value={sort} />
            <button type="submit" className="btn-secondary text-sm">Filtrar</button>
            {(q || categoryId || routeId) && (
              <Link href={`/organizador/eventos/${id}/relatorio-geral`} className="text-sm text-gray-500 hover:text-primary-600">Limpar</Link>
            )}
          </form>
          <div className="flex flex-wrap gap-2">
            {sortLink("name", "Ordem alfabética")}
            {sortLink("date", "Ordem de inscrição")}
            {sortLink("route", "Por percurso")}
            {sortLink("emergencyContact", "Com contato de emergência")}
            {sortLink("allergies", "Com alergias")}
          </div>
        </div>
      )}

      {registrations.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhuma inscrição confirmada encontrada.</div>
      ) : (
        <GeneralReportTable registrations={registrationsWithPayment} eventDate={event.startAt} />
      )}
    </div>
  );
}
