import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id: eventId } = await params;
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
    const header = "Nome,Email,CPF,Telefone,Percurso,Categoria,Lote,Camisa,Equipe,Contato de Emergência,Telefone de Emergência,Observação,Valor do Pedido,Status,Data\n";
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
}
