import { describe, expect, it } from "vitest";
import { generateKitQrCodePng } from "@/lib/kit-qr-code";

describe("generateKitQrCodePng", () => {
  it("gera um Buffer PNG não vazio a partir do id da inscrição", async () => {
    const buffer = await generateKitQrCodePng("reg-abc123");

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // Assinatura de arquivo PNG: 0x89 "PNG" \r\n \x1a \n
    expect(buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });
});
