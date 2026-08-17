import QRCode from "qrcode";

/** Gera a imagem PNG do QR code de retirada de kit de uma inscrição — codifica só o
 * `registration.id`, mesmo valor lido pela tela de retirada. Usado pra anexar no e-mail/WhatsApp
 * de confirmação de inscrição (lib/notifications.ts). */
export async function generateKitQrCodePng(registrationId: string): Promise<Buffer> {
  return QRCode.toBuffer(registrationId, { type: "png", width: 300, margin: 2 });
}
