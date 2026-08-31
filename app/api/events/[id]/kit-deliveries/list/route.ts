import { NextRequest, NextResponse } from "next/server";
import { checkAnyApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listKitDeliveries } from "@/lib/kit-delivery";

/**
 * Lista completa das inscrições CONFIRMED do evento + status de entrega de kit — alimenta a aba
 * "Todos os inscritos" da tela de entrega de kits (organizador e admin). Só leitura; o filtro
 * entregues/pendentes e a busca por nome/CPF são feitos no cliente sobre esta lista.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkAnyApiPermission(["kits.view", "kits.deliver"], { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const items = await listKitDeliveries(id);
  return NextResponse.json({ items });
}
