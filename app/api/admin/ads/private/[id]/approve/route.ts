import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const result = await db.$transaction(async (tx) => {
    const ad = await tx.privateAd.findUnique({ where: { id } });
    if (!ad) {
      return { error: "Anúncio não encontrado", status: 404 } as const;
    }

    const conflict = await tx.privateAd.findFirst({
      where: { adSlotId: ad.adSlotId, status: "APPROVED", id: { not: id } },
    });
    if (conflict) {
      return { error: "Esta posição já possui um anúncio aprovado", status: 409 } as const;
    }

    await tx.privateAd.update({ where: { id }, data: { status: "APPROVED" } });
    return { ok: true } as const;
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
