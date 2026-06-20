import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isS3Configured, createPresignedUploadUrl } from "@/lib/s3";

const ALLOWED_PURPOSES = ["banner", "list_banner", "regulation", "kit_info"] as const;
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const schema = z.object({
  purpose: z.enum(ALLOWED_PURPOSES),
  mimeType: z.string(),
  size: z.number().max(10 * 1024 * 1024),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (!await isS3Configured()) {
    return NextResponse.json({ error: "Storage não configurado" }, { status: 503 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const extension = ALLOWED_MIME[parsed.data.mimeType];
  if (!extension) {
    return NextResponse.json({ error: "Tipo de arquivo não suportado" }, { status: 400 });
  }

  const { url, key, fileUrl } = await createPresignedUploadUrl({
    purpose: parsed.data.purpose,
    mimeType: parsed.data.mimeType,
    extension,
  });

  return NextResponse.json({ url, key, fileUrl });
}
