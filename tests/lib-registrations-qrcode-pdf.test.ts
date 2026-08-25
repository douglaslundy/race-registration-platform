import { describe, expect, it } from "vitest";
import { generateKitQrCodePng } from "@/lib/kit-qr-code";
import { generateRegistrationQrCodePdf } from "@/lib/registrations/qrcode-pdf";

describe("generateRegistrationQrCodePdf", () => {
  it("gera um Buffer não vazio começando com a assinatura de arquivo PDF", async () => {
    const qrPng = await generateKitQrCodePng("reg-1");

    const buffer = await generateRegistrationQrCodePdf({
      athleteName: "Maria Exemplo",
      eventTitle: "Corrida Exemplo 5k",
      bibNumber: "1234",
      qrPngBase64: qrPng.toString("base64"),
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("gera o PDF mesmo sem número de peito (opcional)", async () => {
    const qrPng = await generateKitQrCodePng("reg-2");

    const buffer = await generateRegistrationQrCodePdf({
      athleteName: "Bruno Exemplo",
      eventTitle: "Corrida Exemplo 10k",
      bibNumber: null,
      qrPngBase64: qrPng.toString("base64"),
    });

    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
