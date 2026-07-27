import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAppName, getSetting } from "@/lib/settings";
import { getAiProvider } from "@/lib/ai";
import { buildSeoPrompt, truncateSeoText } from "@/lib/seo/build-seo-prompt";

const schema = z.object({ field: z.enum(["metaTitle", "metaDescription"]) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [appName, brandContext] = await Promise.all([getAppName(), getSetting("seo_brand_context")]);
  const prompt = buildSeoPrompt({ kind: "site", field: parsed.data.field, appName, brandContext });

  try {
    const provider = await getAiProvider();
    const generated = await provider.generateText(prompt);
    return NextResponse.json({ text: truncateSeoText(generated, parsed.data.field) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Falha ao gerar texto" }, { status: 502 });
  }
}
