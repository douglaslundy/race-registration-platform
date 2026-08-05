import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { buildAdReportData } from "@/lib/ads/private-ad-report";
import { generateAdReportPdf } from "@/lib/ads/generate-ad-report-pdf";
import { sendMail } from "@/lib/email";
import { sendWhatsAppDocument } from "@/lib/whatsapp";

const schema = z.object({
  channel: z.enum(["email", "whatsapp"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  }

  const { id } = await params;
  const data = await buildAdReportData(id);
  const pdfBuffer = await generateAdReportPdf({
    companyName: data.companyName,
    adLabel: data.adLabel,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    impressions: data.impressions,
    clicks: data.clicks,
  });

  if (parsed.data.channel === "email") {
    await sendMail({
      to: data.contactEmail,
      messageType: "AD_REPORT",
      subject: "Relatório do seu anúncio",
      html: `<p>Olá,</p><p>Segue em anexo o relatório de desempenho do seu anúncio <strong>${data.adLabel}</strong>.</p>`,
      attachments: [{ filename: "relatorio.pdf", content: pdfBuffer }],
    });
  } else {
    await sendWhatsAppDocument(
      data.contactPhone,
      pdfBuffer.toString("base64"),
      "relatorio.pdf",
      "Segue o relatório do seu anúncio",
    );
  }

  return NextResponse.json({ ok: true });
}
