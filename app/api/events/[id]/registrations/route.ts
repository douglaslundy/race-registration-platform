import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { buildRegistrationWhere } from "@/lib/organizer/registrations";
import { buildRegistrationExportRows, buildRegistrationsCsv, buildRegistrationsXlsx } from "@/lib/registrations/export";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id: eventId } = await params;
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id: eventId } })
    : await db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  // Mesma fonte de verdade usada pela tela de inscritos (lib/organizer/registrations.ts) — a
  // exportação precisa respeitar EXATAMENTE os mesmos filtros aplicados na tela (status, busca,
  // categoria, percurso, lote, cupom, forma de pagamento, período), nunca uma versão reduzida deles.
  const where = buildRegistrationWhere(eventId, {
    status: searchParams.get("status") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    categoryId: searchParams.get("categoryId") ?? undefined,
    routeId: searchParams.get("routeId") ?? undefined,
    ticketBatchId: searchParams.get("ticketBatchId") ?? undefined,
    couponId: searchParams.get("couponId") ?? undefined,
    paymentMethod: searchParams.get("paymentMethod") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
  });

  if (format === "csv" || format === "xlsx") {
    const registrations = await db.registration.findMany({
      where,
      select: {
        athlete: {
          select: { name: true, athleteProfile: { select: { birthDate: true, gender: true, city: true } } },
        },
        route: { select: { name: true } },
        category: { select: { name: true } },
        teamName: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        medicalNotes: true,
      },
      orderBy: { athlete: { name: "asc" } },
    });
    const rows = buildRegistrationExportRows(registrations, event.startAt);

    if (format === "xlsx") {
      const buffer = await buildRegistrationsXlsx(rows);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="inscritos-${eventId}.xlsx"`,
        },
      });
    }

    return new NextResponse(buildRegistrationsCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inscritos-${eventId}.csv"`,
      },
    });
  }

  const registrations = await db.registration.findMany({
    where,
    include: {
      athlete: { select: { name: true, email: true, athleteProfile: { select: { cpf: true, phone: true } } } },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true } },
      order: { select: { totalAmount: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ registrations, total: registrations.length });
}
