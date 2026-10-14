import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { BibNumberError, generateBibNumbers } from "@/lib/bib-numbers";

/** Gera (ou refaz) os números de peito do evento. Ver `generateBibNumbers` para as regras. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("kits.deliver", { eventId: id });
  if (!check.allowed) return check.response;

  const scope = await resolveActingScope(check.session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id }, select: { id: true } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  try {
    return NextResponse.json(await generateBibNumbers(id));
  } catch (e) {
    if (e instanceof BibNumberError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
