import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateImageDimensions } from "@/lib/ads/private-ads";
import { updateAdSlot } from "@/lib/ad-slots";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_SIZE = 10 * 1024 * 1024;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "uploads";
  return { url, key, bucket, ready: Boolean(url && key) };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const targetUrl = formData.get("targetUrl") as string | null;
  const image = formData.get("image") as File | null;

  if (!targetUrl || !image) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }

  try {
    new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "URL de destino inválida" }, { status: 400 });
  }

  const slot = await db.adSlot.findUnique({ where: { id } });
  if (!slot) {
    return NextResponse.json({ error: "Posição não encontrada" }, { status: 404 });
  }

  if (image.size > MAX_SIZE) {
    return NextResponse.json({ error: "Arquivo muito grande (máx 10 MB)" }, { status: 400 });
  }
  const extension = ALLOWED_MIME[image.type];
  if (!extension) {
    return NextResponse.json({ error: "Tipo de arquivo não suportado" }, { status: 400 });
  }

  const bytes = await image.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Dimensão validada ANTES do upload, pra não deixar arquivo órfão no storage se falhar —
  // mesmo cuidado já usado no fluxo de cadastro de anúncio do anunciante.
  const dimensionsOk = await validateImageDimensions(buffer, slot.width, slot.height);
  if (!dimensionsOk) {
    return NextResponse.json(
      { error: `Dimensão da imagem deve ser ${slot.width}x${slot.height}px` },
      { status: 400 },
    );
  }

  const cfg = getSupabaseConfig();
  if (!cfg.ready) {
    return NextResponse.json({ error: "Storage não configurado" }, { status: 503 });
  }

  const key = `house-ads/${randomUUID()}.${extension}`;
  const uploadRes = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": image.type,
      "x-upsert": "true",
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text().catch(() => "");
    console.error("[admin/house-ad] Supabase error:", uploadRes.status, err);
    return NextResponse.json({ error: "Falha ao enviar arquivo para o storage" }, { status: 502 });
  }

  const imageUrl = `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${key}`;

  // O anúncio da casa é ativo imediatamente — sem passo de aprovação (é o próprio admin).
  await updateAdSlot(id, {
    source: "HOUSE",
    houseAdImageUrl: imageUrl,
    houseAdTargetUrl: targetUrl,
  });

  return NextResponse.json({ houseAdImageUrl: imageUrl, houseAdTargetUrl: targetUrl });
}
