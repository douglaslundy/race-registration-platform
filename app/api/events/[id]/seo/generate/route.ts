import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import { getAiProvider } from "@/lib/ai";
import { buildSeoPrompt, truncateSeoText } from "@/lib/seo/build-seo-prompt";

const schema = z.object({ field: z.enum(["metaTitle", "metaDescription"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("events.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : scope.organizerId
      ? await db.event.findFirst({ where: { id, organizerId: scope.organizerId } })
      : null;

  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const brandContext = await getSetting("seo_brand_context");
  const prompt = buildSeoPrompt({
    kind: "event",
    field: parsed.data.field,
    title: event.title,
    description: event.description,
    city: event.city,
    state: event.state,
    modality: event.modality,
    startAt: event.startAt,
    brandContext,
  });

  const NOT_CONFIGURED_MESSAGES = [
    "Chave de API do Claude não configurada",
    "Chave de API da OpenAI não configurada",
    "Chave de API do Google não configurada",
  ];

  try {
    const provider = await getAiProvider();
    const generated = await provider.generateText(prompt);
    return NextResponse.json({ text: truncateSeoText(generated, parsed.data.field) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao gerar texto";
    if (NOT_CONFIGURED_MESSAGES.includes(message)) {
      return NextResponse.json({ error: message }, { status: 502 });
    }
    console.error("Erro ao gerar texto com IA (evento):", err);
    return NextResponse.json({ error: "Falha ao gerar texto com a IA. Tente novamente." }, { status: 502 });
  }
}
