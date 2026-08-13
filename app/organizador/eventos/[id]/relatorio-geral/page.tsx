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
