import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// Purposes deste endpoint são todos de gestão de evento — atleta comum não sobe nada aqui.
const UPLOAD_ROLES = new Set(["ADMIN", "ORGANIZER", "ASSISTANT"]);

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const ALLOWED_PURPOSES = new Set(["banner", "list_banner", "regulation", "kit_info", "result_pdf"]);
const MAX_SIZE = 10 * 1024 * 1024;

// Confere os bytes reais do arquivo contra a assinatura do formato — o Content-Type do FormData
// é só o que o navegador declarou, então sozinho não garante nada sobre o conteúdo de verdade.
function matchesMagicBytes(bytes: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    case "image/gif":
      return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
    case "application/pdf":
      return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    default:
      return false;
  }
}

// Teto de dimensão pra artes de evento: cobre até telas retina sem carregar peso desnecessário
// (o arquivo aqui é o mesmo que o WhatsApp busca direto pra montar o preview do link — arquivos
// grandes fazem o preview demorar ou nem aparecer).
const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_QUALITY = 85;

/**
 * Reencoda no mesmo formato com teto de dimensão + qualidade ~85 (visualmente equivalente ao
 * original pra fotos). GIF é preservado sem reprocessar (evita perder animação). Se a
 * compressão falhar ou não conseguir reduzir o tamanho, devolve os bytes originais.
 */
async function compressImageIfPossible(input: Buffer, mimeType: string): Promise<Buffer> {
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
    return input;
  }

  try {
    const resized = sharp(input).rotate().resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });

    const compressed =
      mimeType === "image/png"
        ? await resized.png({ quality: IMAGE_QUALITY, compressionLevel: 9 }).toBuffer()
        : mimeType === "image/webp"
          ? await resized.webp({ quality: IMAGE_QUALITY }).toBuffer()
          : await resized.jpeg({ quality: IMAGE_QUALITY, mozjpeg: true }).toBuffer();

    return compressed.byteLength < input.byteLength ? compressed : input;
  } catch (err) {
    console.error("[upload] falha ao comprimir imagem, enviando arquivo original:", err);
    return input;
  }
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "uploads";
  return { url, key, bucket, ready: Boolean(url && key) };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!UPLOAD_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  // L3: teto de uploads por usuário — sem isso qualquer conta autenticada podia despejar
  // arquivos no bucket público (storage exhaustion / hospedagem grátis).
  const { allowed } = checkRateLimit(`upload:${session.user.id}`, RATE_LIMITS.UPLOAD);
  if (!allowed) {
    return NextResponse.json({ error: "Muitos envios em pouco tempo. Aguarde um minuto." }, { status: 429 });
  }

  const cfg = getSupabaseConfig();
  if (!cfg.ready) {
    return NextResponse.json({ error: "Storage não configurado" }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const purpose = formData.get("purpose") as string | null;

  if (!file || !purpose) {
    return NextResponse.json({ error: "Arquivo e purpose obrigatórios" }, { status: 400 });
  }
  if (!ALLOWED_PURPOSES.has(purpose)) {
    return NextResponse.json({ error: "Purpose inválido" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Arquivo muito grande (máx 10 MB)" }, { status: 400 });
  }

  const extension = ALLOWED_MIME[file.type];
  if (!extension) {
    return NextResponse.json({ error: "Tipo de arquivo não suportado" }, { status: 400 });
  }

  const rawBytes = Buffer.from(await file.arrayBuffer());
  if (!matchesMagicBytes(rawBytes, file.type)) {
    return NextResponse.json({ error: "O conteúdo do arquivo não corresponde ao tipo declarado" }, { status: 400 });
  }

  const key = `${purpose}/${randomUUID()}.${extension}`;
  const bytes = await compressImageIfPossible(rawBytes, file.type);

  const uploadRes = await fetch(
    `${cfg.url}/storage/v1/object/${cfg.bucket}/${key}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": file.type,
        "x-upsert": "true",
      },
      body: new Uint8Array(bytes),
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text().catch(() => "");
    console.error("[upload] Supabase error:", uploadRes.status, err);
    return NextResponse.json({ error: "Falha ao enviar arquivo para o storage" }, { status: 502 });
  }

  const fileUrl = `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${key}`;
  return NextResponse.json({ fileUrl });
}
