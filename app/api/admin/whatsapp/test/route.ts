import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const schema = z.object({
  phone: z.string().min(8, "Informe um telefone válido com DDI e DDD"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe um telefone válido" }, { status: 400 });
  }

  try {
    await sendWhatsAppMessage(
      parsed.data.phone,
      "Mensagem de teste do painel administrativo. Se você recebeu isso, o WhatsApp está configurado corretamente. ✅",
    );
    return NextResponse.json({ ok: true, to: parsed.data.phone });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao enviar WhatsApp de teste";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
