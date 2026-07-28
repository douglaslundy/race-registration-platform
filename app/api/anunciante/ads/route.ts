import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  hasAvailableSlotInPurchase,
  listAvailableSlotsForAdvertiser,
  validateImageDimensions,
} from "@/lib/ads/private-ads";
import { validateAdDestinationUrl } from "@/lib/validate-url";

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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (session.user.role !== "ADVERTISER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });
  if (!advertiser) {
    return NextResponse.json({ error: "Perfil de anunciante não encontrado" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const adPurchaseId = formData.get("adPurchaseId") as string | null;
  const adSlotId = formData.get("adSlotId") as string | null;
  const targetUrl = formData.get("targetUrl") as string | null;
  const image = formData.get("image") as File | null;

  if (!adPurchaseId || !adSlotId || !targetUrl || !image) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }

  const validatedUrl = validateAdDestinationUrl(targetUrl);
  if (!validatedUrl.ok) {
    return NextResponse.json({ error: validatedUrl.error }, { status: 400 });
  }

  // 1. A compra escolhida precisa pertencer ao anunciante autenticado e estar paga (status
  // "PAID" também filtra compras REJECTED/PENDING, que nunca deveriam liberar vaga). Resposta
  // idêntica à de "sem vaga disponível" para não permitir enumeração de adPurchaseId de terceiros.
  const ownedPurchase = await db.adPurchase.findFirst({
    where: { id: adPurchaseId, advertiserId: advertiser.id, status: "PAID" },
    select: { id: true },
  });
  if (!ownedPurchase) {
    return NextResponse.json({ error: "Esta compra não possui vaga disponível" }, { status: 400 });
  }

  // 2. A compra escolhida precisa ter vaga livre.
  const hasSlot = await hasAvailableSlotInPurchase(adPurchaseId);
  if (!hasSlot) {
    return NextResponse.json({ error: "Esta compra não possui vaga disponível" }, { status: 400 });
  }

  // 3. A posição escolhida precisa estar entre as disponíveis.
  const availableSlots = await listAvailableSlotsForAdvertiser();
  const slot = availableSlots.find((s) => s.id === adSlotId);
  if (!slot) {
    return NextResponse.json({ error: "Posição indisponível" }, { status: 400 });
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

  // 4. Dimensão da imagem precisa bater com a posição — validado ANTES do upload,
  // pra não deixar arquivo órfão no storage se a validação falhar.
  const dimensionsOk = await validateImageDimensions(buffer, slot.width, slot.height);
  if (!dimensionsOk) {
    return NextResponse.json(
      { error: `Dimensão da imagem deve ser ${slot.width}x${slot.height}px` },
      { status: 400 },
    );
  }

  // 5. Só agora sobe o arquivo pro storage.
  const cfg = getSupabaseConfig();
  if (!cfg.ready) {
    return NextResponse.json({ error: "Storage não configurado" }, { status: 503 });
  }

  const key = `private-ads/${randomUUID()}.${extension}`;
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
    console.error("[anunciante/ads] Supabase error:", uploadRes.status, err);
    return NextResponse.json({ error: "Falha ao enviar arquivo para o storage" }, { status: 502 });
  }

  const imageUrl = `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${key}`;

  // 6. Todo PrivateAd nasce PENDING_APPROVAL — sem aprovação automática nesta versão.
  const ad = await db.privateAd.create({
    data: {
      adPurchaseId,
      adSlotId,
      imageUrl,
      targetUrl: validatedUrl.url,
      status: "PENDING_APPROVAL",
    },
  });

  return NextResponse.json(ad, { status: 201 });
}
