import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildAdReportData } from "@/lib/ads/private-ad-report";
import { generateAdReportPdf } from "@/lib/ads/generate-ad-report-pdf";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
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

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="relatorio-${id}.pdf"`,
    },
  });
}
