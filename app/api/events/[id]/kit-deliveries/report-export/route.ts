import { NextRequest, NextResponse } from "next/server";
import { checkAnyApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getKitDeliveryProgress } from "@/lib/kit-delivery";
import { escapeCsvValue } from "@/lib/admin/events";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkAnyApiPermission(["kits.view", "kits.deliver"], { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id }, select: { id: true, title: true } })
    : await db.event.findFirst({
        where: { id, organizerId: scope.organizerId ?? "__none__" },
        select: { id: true, title: true },
      });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const { pending } = await getKitDeliveryProgress(id);

  const header = "Nome,Número de peito,Categoria,E-mail,Telefone\n";
  const rows = pending
    .map((r) =>
      [r.athleteName, r.bibNumber ?? "", r.categoryName ?? "", r.email, r.phone ?? ""]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\n");

  const eventSlug = event.title.toLowerCase().replace(/\s+/g, "-").slice(0, 30);
  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kits-pendentes-${eventSlug}.csv"`,
    },
  });
}
