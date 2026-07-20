import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { buildAdReportData } from "@/lib/ads/private-ad-report";
import { generateAdReportPdf } from "@/lib/ads/generate-ad-report-pdf";
import { sendMail } from "@/lib/email";
import { sendWhatsAppDocument } from "@/lib/whatsapp";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ads/private-ad-report", () => ({ buildAdReportData: vi.fn() }));
vi.mock("@/lib/ads/generate-ad-report-pdf", () => ({ generateAdReportPdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendMail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppDocument: vi.fn() }));

import { POST } from "@/app/api/admin/ads/private/[id]/send-report/route";

const authMock = vi.mocked(auth);
const buildAdReportDataMock = vi.mocked(buildAdReportData);
const generateAdReportPdfMock = vi.mocked(generateAdReportPdf);
const sendMailMock = vi.mocked(sendMail);
const sendWhatsAppDocumentMock = vi.mocked(sendWhatsAppDocument);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/ads/private/ad-1/send-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const reportData = {
  privateAdId: "ad-1",
  companyName: "Empresa LTDA",
  contactEmail: "contato@empresa.com",
  contactPhone: "+5511999999999",
  adLabel: "Abaixo do banner",
  slotWidth: 300,
  slotHeight: 250,
  imageUrl: "https://example.com/img.png",
  targetUrl: "https://example.com",
  periodStart: new Date("2026-07-01T00:00:00.000Z"),
  periodEnd: new Date("2026-07-19T00:00:00.000Z"),
  impressions: 100,
  clicks: 5,
  estimatedRevenueMicros: 1000000n,
};

const pdfBuffer = Buffer.from("%PDF-1.4 fake");

describe("POST /api/admin/ads/private/[id]/send-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    buildAdReportDataMock.mockResolvedValue(reportData as any);
    generateAdReportPdfMock.mockResolvedValue(pdfBuffer);
  });

  it("retorna 403 para quem não é admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "ORGANIZER" } } as any);
    const res = await POST(makeRequest({ channel: "email" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(403);
    expect(buildAdReportDataMock).not.toHaveBeenCalled();
  });

  it("retorna 400 para canal inválido", async () => {
    const res = await POST(makeRequest({ channel: "sms" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(400);
    expect(buildAdReportDataMock).not.toHaveBeenCalled();
    expect(generateAdReportPdfMock).not.toHaveBeenCalled();
  });

  it("envia por e-mail com o PDF em anexo e retorna 200", async () => {
    const res = await POST(makeRequest({ channel: "email" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(200);
    expect(buildAdReportDataMock).toHaveBeenCalledWith("ad-1");
    expect(generateAdReportPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: "Empresa LTDA",
        adLabel: "Abaixo do banner",
        periodStart: reportData.periodStart,
        periodEnd: reportData.periodEnd,
        impressions: 100,
        clicks: 5,
      }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "contato@empresa.com",
        attachments: [{ filename: "relatorio.pdf", content: pdfBuffer }],
      }),
    );
    expect(sendWhatsAppDocumentMock).not.toHaveBeenCalled();
  });

  it("envia por WhatsApp com o PDF em base64 e retorna 200", async () => {
    const res = await POST(makeRequest({ channel: "whatsapp" }), { params: Promise.resolve({ id: "ad-1" }) });
    expect(res.status).toBe(200);
    expect(sendWhatsAppDocumentMock).toHaveBeenCalledWith(
      "+5511999999999",
      pdfBuffer.toString("base64"),
      "relatorio.pdf",
      expect.any(String),
    );
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
