import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { escapeCsvValue } from "@/lib/admin/events";
import { formatCurrency } from "@/lib/format";

export async function GET() {
  const check = await checkApiPermission("events.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  if (!scope.organizerId) return NextResponse.json({ error: "Perfil de organizador não encontrado" }, { status: 404 });

  const events = await db.event.findMany({
    where: { organizerId: scope.organizerId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { registrations: true } },
      orders: { where: { status: "PAID" }, select: { totalAmount: true } },
    },
  });

  const header = ["Evento", "Status", "Data", "Cidade/UF", "Inscrições", "Receita paga"]
    .map(escapeCsvValue)
    .join(",") + "\n";

  const STATUS_LABEL: Record<string, string> = {
    DRAFT: "Rascunho",
    UNDER_REVIEW: "Em análise",
    PUBLISHED: "Publicado",
    REGISTRATIONS_OPEN: "Inscrições abertas",
    SOLD_OUT: "Esgotado",
    REGISTRATIONS_CLOSED: "Inscrições encerradas",
    COMPLETED: "Concluído",
    CANCELLED: "Cancelado",
  };

  const rows = events
    .map((e) => {
      const revenue = e.orders.reduce((s, o) => s + o.totalAmount, 0);
      return [
        e.title,
        STATUS_LABEL[e.status] ?? e.status,
        e.startAt.toLocaleDateString("pt-BR"),
        `${e.city}/${e.state}`,
        e._count.registrations,
        formatCurrency(revenue),
      ]
        .map(escapeCsvValue)
        .join(",");
    })
    .join("\n");

  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="meus-eventos.csv"',
    },
  });
}
