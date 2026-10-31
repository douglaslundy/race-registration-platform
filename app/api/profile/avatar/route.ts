import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncRatingSafe } from "@/lib/rating";

const schema = z.object({ fileUrl: z.string().url().nullable() });

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const { fileUrl } = parsed.data;
  // Só aceita arquivos que o próprio /api/upload gravou no bucket (purpose "avatar").
  const prefix = `${process.env.SUPABASE_URL ?? ""}/storage/v1/object/public/${process.env.SUPABASE_BUCKET ?? "uploads"}/avatar/`;
  if (fileUrl && !fileUrl.startsWith(prefix)) {
    return NextResponse.json({ error: "Arquivo de foto inválido" }, { status: 400 });
  }

  await db.user.update({ where: { id: session.user.id }, data: { avatarUrl: fileUrl } });
  syncRatingSafe(session.user.id);
  return NextResponse.json({ avatarUrl: fileUrl });
}
