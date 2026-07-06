import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");

  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  const event = await db.event.findFirst({
    where: { id: eventId, ...(session.user.role !== "ADMIN" ? { organizerId: organizer?.id } : {}) },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const registrations = await db.registration.findMany({
    where: { eventId },
    include: {
      athlete: { select: { name: true, email: true, athleteProfile: { select: { cpf: true } } } },
      route: { select: { name: true } },
      category: { select: { name: true } },
      ticketBatch: { select: { name: true, priceAmount: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (format === "csv") {
    const header = "Nome,Email,CPF,Percurso,Categoria,Lote,Camisa,Equipe,Contato de Emergência,Telefone de Emergência,Status,Data\n";
    const rows = registrations.map((r) =>
      [
        r.athlete.name,
        r.athlete.email,
        r.athlete.athleteProfile?.cpf ?? "",
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
