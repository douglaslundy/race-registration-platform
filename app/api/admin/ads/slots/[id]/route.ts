import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateAdSlot } from "@/lib/ad-slots";
import { z } from "zod";

const schema = z.object({
  enabled: z.boolean().optional(),
  source: z.enum(["GOOGLE", "PRIVATE", "HOUSE"]).nullable().optional(),
  googleAdUnitId: z.string().max(100).nullable().optional(),
  houseAdImageUrl: z.string().max(500).nullable().optional(),
  houseAdTargetUrl: z.string().max(500).nullable().optional(),
});

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "uploads";
  return { url, key, bucket, ready: Boolean(url && key) };
}

// Apaga o arquivo antigo do storage quando a imagem do anúncio da casa é limpa (troca de fonte).
// Best-effort: nunca lança — um arquivo órfão no storage é bem menos grave do que quebrar a
// atualização da posição por causa de uma falha de rede num delete secundário.
async function deleteOrphanedHouseAdImage(imageUrl: string): Promise<void> {
  try {
    const cfg = getSupabaseConfig();
    if (!cfg.ready) return;
    const marker = `/storage/v1/object/public/${cfg.bucket}/`;
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return;
    const key = imageUrl.slice(idx + marker.length);
    await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${key}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${cfg.key}` },
    });
  } catch (err) {
    console.error("[admin/ads/slots] failed to delete orphaned house-ad image:", err);
  }
}

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

  if (parsed.data.houseAdTargetUrl) {
    try {
      const url = new URL(parsed.data.houseAdTargetUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
    }
  }

  if (parsed.data.houseAdImageUrl === null) {
    const current = await db.adSlot.findUnique({ where: { id }, select: { houseAdImageUrl: true } });
    if (current?.houseAdImageUrl) {
      await deleteOrphanedHouseAdImage(current.houseAdImageUrl);
    }
  }

  await updateAdSlot(id, parsed.data);
  return NextResponse.json({ ok: true });
}
