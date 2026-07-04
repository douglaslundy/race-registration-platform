import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendPaymentErrorEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getPaymentErrorAlertSettings: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  claimAlert: vi.fn(),
  unclaimAlert: vi.fn(),
}));

import { notifyPaymentError } from "@/lib/alerts/payment-error";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const paymentFixture = {
  order: {
    id: "order-1",
    event: { title: "Corrida Teste", slug: "corrida-teste" },
    buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
  },
};

describe("notifyPaymentError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false });

    await notifyPaymentError("payment-1");

    expect(dbMock.payment.findUnique).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pagamento não é encontrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(null);

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
  });

  it("envia e-mail e reivindica o alerta", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(claimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "Payment", "payment-1", "EMAIL");
    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", eventSlug: "corrida-teste" }),
    );
  });

  it("não reenvia por e-mail quando outra execução já reivindicou o alerta", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
  });

  it("libera a reivindicação quando o envio de e-mail falha, para permitir nova tentativa depois", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await notifyPaymentError("payment-1");

    expect(unclaimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "payment-1", "EMAIL");
  });

  it("pula o WhatsApp sem quebrar quando o atleta não tem telefone cadastrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.payment.findUnique.mockResolvedValueOnce({
      order: { ...paymentFixture.order, buyer: { ...paymentFixture.order.buyer, athleteProfile: null } },
    });

    await notifyPaymentError("payment-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("nunca lança exceção, mesmo se o e-mail falhar", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyPaymentError("payment-1")).resolves.toBeUndefined();
  });

  it("com bypassDedupe: envia por e-mail mesmo que claimAlert diria não (nem chama claimAlert)", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1", { bypassDedupe: true });

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com" }),
    );
  });

  it("com bypassDedupe: não chama unclaimAlert se o envio falhar (nada foi reivindicado)", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await notifyPaymentError("payment-1", { bypassDedupe: true });

    expect(unclaimAlert).not.toHaveBeenCalled();
  });

  it("não reivindica o alerta de e-mail quando o SMTP não está pronto (evita travar o alerta pra sempre)", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(isSmtpReady).mockReturnValue(false);
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
  });
});
