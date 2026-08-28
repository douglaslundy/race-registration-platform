import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const confirmSchema = z.object({
  registrationId: z.string().trim().min(1),
  receivedByName: z.string().trim().min(1),
  receivedByDocument: z.string().trim().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("kits.deliver", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const registration = await db.registration.findFirst({
    where: { id: parsed.data.registrationId, eventId: id, status: "CONFIRMED" },
  });
  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada ou não confirmada" }, { status: 404 });
  }

  try {
    const kitDelivery = await db.kitDelivery.create({
      data: {
        registrationId: parsed.data.registrationId,
        deliveredByUserId: session.user.id,
        receivedByName: parsed.data.receivedByName,
        receivedByDocument: parsed.data.receivedByDocument || null,
      },
    });
    return NextResponse.json({ kitDelivery }, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "Kit já foi entregue (por outro ponto de retirada)" }, { status: 409 });
    }
    throw err;
  }
}
