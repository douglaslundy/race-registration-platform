import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { randomUUID } from "crypto";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const ALLOWED_PURPOSES = new Set(["banner", "regulation", "kit_info"]);
const MAX_SIZE = 10 * 1024 * 1024;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "uploads";
  return { url, key, bucket, ready: Boolean(url && key) };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

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

  const key = `${purpose}/${randomUUID()}.${extension}`;
  const bytes = await file.arrayBuffer();

  const uploadRes = await fetch(
    `${cfg.url}/storage/v1/object/${cfg.bucket}/${key}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": file.type,
        "x-upsert": "true",
      },
      body: bytes,
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
