import { describe, expect, it } from "vitest";
import { generateAdReportPdf } from "@/lib/ads/generate-ad-report-pdf";

describe("generateAdReportPdf", () => {
  it("gera um Buffer não vazio começando com a assinatura de arquivo PDF", async () => {
    const buffer = await generateAdReportPdf({
      companyName: "Empresa LTDA",
      adLabel: "Abaixo do banner — página de eventos",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-18T00:00:00.000Z"),
      impressions: 1500,
      clicks: 42,
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
