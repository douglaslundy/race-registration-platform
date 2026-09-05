import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Serve um PDF de resultado pelo domínio da plataforma, fazendo proxy do arquivo que está no
 * storage (Supabase). Sem isso o link na página pública de resultados apontaria direto pro
 * subdomínio de infra (`supabase.circuitodascorridas.com.br`), que não deve aparecer pro público.
 * É público (resultados são públicos) e só serve URLs do bucket público configurado.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;

  const file = await db.eventResultFile.findUnique({
    where: { id: fileId },
    select: { fileUrl: true, label: true },
  });
  if (!file) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });

  // Só faz proxy de arquivos do bucket público do storage configurado — a fileUrl vem do banco,
  // mas manter a checagem evita virar um proxy aberto se algum dia entrar lixo na coluna.
  const publicPrefix = `${(process.env.SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/`;
  if (!publicPrefix.startsWith("http") || !file.fileUrl.startsWith(publicPrefix)) {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(file.fileUrl);
  } catch {
    return NextResponse.json({ error: "Falha ao obter o arquivo" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Falha ao obter o arquivo" }, { status: 502 });
  }

  const safeName = (file.label || "resultado").replace(/[^\w.\- ]+/g, "").trim() || "resultado";
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}.pdf"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
