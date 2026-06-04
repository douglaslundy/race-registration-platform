import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { escapeCsvValue } from "@/lib/admin/users";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      registrations: {
        orderBy: { createdAt: "desc" },
        include: {
          event: { select: { title: true } },
          order: { select: { totalAmount: true, status: true } },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const header = ["Usuário", "Email", "Evento", "Status", "Valor", "Cadastro"].map(escapeCsvValue).join(",") + "\n";
  const rows = user.registrations
    .map((registration) =>
      [
        user.name,
        user.email,
        registration.event.title,
        registration.status,
        registration.order.totalAmount,
        registration.createdAt.toISOString(),
      ]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\n");

  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usuario-${user.id}-inscricoes.csv"`,
    },
  });
}
