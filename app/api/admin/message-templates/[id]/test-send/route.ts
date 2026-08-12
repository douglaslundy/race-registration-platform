import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { renderTemplate, renderTemplateSubject } from "@/lib/templates/render";
import { sendMail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { ALL_VARIABLES } from "@/lib/templates/variables";

const SAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  ALL_VARIABLES.map((v) => [v.name, v.sample]),
);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  // Nunca lê destinatário do corpo da requisição — sempre o contato da própria sessão.
  const admin = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true, phone: true, name: true } });
  if (!admin) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const channel = template.channel as "EMAIL" | "WHATSAPP";
  const renderedBody = renderTemplate(template.body, SAMPLE_VALUES, channel);

  if (channel === "EMAIL") {
    const subject = template.subject ? renderTemplateSubject(template.subject, SAMPLE_VALUES) : "Teste de template";
    await sendMail({ to: admin.email, subject: `[TESTE] ${subject}`, html: renderedBody, messageType: template.alertKey });
  } else {
    if (!admin.phone) return NextResponse.json({ error: "Sua conta não tem telefone cadastrado" }, { status: 400 });
    await sendWhatsAppMessage(admin.phone, `[TESTE] ${renderedBody}`, template.alertKey);
  }

  return NextResponse.json({ ok: true });
}
