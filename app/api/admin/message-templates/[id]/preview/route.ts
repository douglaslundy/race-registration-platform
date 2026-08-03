import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { renderTemplate, renderTemplateSubject } from "@/lib/templates/render";

const SAMPLE_VALUES: Record<string, string> = {
  nome_atleta: "Maria Exemplo", primeiro_nome_atleta: "Maria", email_atleta: "maria@exemplo.com",
  nome_organizador: "João Organizador", nome_evento: "Corrida Exemplo 5k", nome_lote: "Lote 1",
  vagas_vendidas: "95", capacidade_lote: "100", percentual_vendido: "95",
  codigo_confirmacao: "ord_exemplo123", link_evento: "https://exemplo.com/eventos/corrida-exemplo",
  link_finalizar_pagamento: "https://exemplo.com/dashboard/inscricoes",
  motivo_cancelamento: "Não poderei comparecer", nome_plataforma: "Circuito das Corridas",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const { id } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });

  const channel = template.channel as "EMAIL" | "WHATSAPP";
  return NextResponse.json({
    subject: template.subject ? renderTemplateSubject(template.subject, SAMPLE_VALUES) : undefined,
    body: renderTemplate(template.body, SAMPLE_VALUES, channel),
  });
}
