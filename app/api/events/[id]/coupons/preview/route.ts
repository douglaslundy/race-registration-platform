import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

function normalizeCode(value: string | null): string {
  return value?.trim().toUpperCase() ?? "";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const code = normalizeCode(url.searchParams.get("code"));
  const ticketBatchId = url.searchParams.get("ticketBatchId");

  if (!code) {
    return NextResponse.json({ error: "Informe um cupom" }, { status: 400 });
  }
  if (!ticketBatchId) {
    return NextResponse.json({ error: "Selecione um lote" }, { status: 400 });
  }

  const [event, batch] = await Promise.all([
    db.event.findFirst({
      where: { id },
      select: { id: true },
    }),
    db.ticketBatch.findFirst({
      where: { id: ticketBatchId, eventId: id, active: true },
      select: { id: true, priceAmount: true },
    }),
  ]);

  if (!event || !batch) {
    return NextResponse.json({ error: "Evento ou lote não encontrado" }, { status: 404 });
  }

  // Busca só pelo código (sem filtrar validade/status na query) — cada condição é checada
  // depois, separadamente, pra poder informar o motivo exato de rejeição (vencido vs. esgotado
  // vs. inexistente/inativo), em vez de colapsar tudo em "Cupom inválido".
  // Cupom específico do evento tem prioridade sobre o cupom global.
  const coupon =
    (await db.coupon.findFirst({ where: { eventId: id, code } })) ??
    (await db.coupon.findFirst({ where: { eventId: null, code } }));

  if (!coupon || !coupon.active) {
    return NextResponse.json({ error: "Cupom inválido" }, { status: 404 });
  }
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return NextResponse.json({ error: "Cupom vencido" }, { status: 410 });
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return NextResponse.json({ error: "Cupom esgotado" }, { status: 409 });
  }

  const discountAmount =
    coupon.discountType === "PERCENT"
      ? Math.round((batch.priceAmount * coupon.discountValue) / 100)
      : Math.min(coupon.discountValue, batch.priceAmount);

  return NextResponse.json({
    code: coupon.code,
    discountAmount,
    subtotalAmount: batch.priceAmount - discountAmount,
  });
}
