import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateAdDestinationUrl } from "@/lib/validate-url";

const schema = z.object({ targetUrl: z.string() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const validatedUrl = validateAdDestinationUrl(parsed.data.targetUrl);
  if (!validatedUrl.ok) {
    return NextResponse.json({ error: validatedUrl.error }, { status: 400 });
  }

  const ad = await db.privateAd.findUnique({ where: { id }, select: { id: true } });
  if (!ad) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }

  await db.privateAd.update({ where: { id }, data: { targetUrl: validatedUrl.url } });

  return NextResponse.json({ ok: true });
}
