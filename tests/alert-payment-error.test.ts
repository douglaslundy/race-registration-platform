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
  recordAlert: vi.fn(),
}));
vi.mock("@/lib/event-social-links", () => ({
  getSocialPromoText: vi.fn().mockResolvedValue(""),
}));

import { notifyPaymentError, notifyOrderCancelledWithoutPayment } from "@/lib/alerts/payment-error";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPaymentErrorEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getPaymentErrorAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert, recordAlert } from "@/lib/alerts/dedupe";
import { getSocialPromoText } from "@/lib/event-social-links";
import * as resolveModule from "@/lib/templates/resolve";

const dbMock = db as any;

const paymentFixture = {
  order: {
    id: "order-1",
    event: { id: "event-1", title: "Corrida Teste", slug: "corrida-teste" },
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
      expect.objectContaining({ to: "atleta@example.com", eventSlug: "corrida-teste", eventId: "event-1" }),
    );
  });

  it("não reenvia por e-mail quando outra execução já reivindicou o alerta", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
    // Nada foi enviado (dedupe já bloqueou) — getSocialPromoText não pode ter sido chamada, senão
    // gastaria a cota do usuário em execuções que webhooks reentregues/o poller de conciliação
    // disparam de novo pro mesmo pagamento sem que nenhuma mensagem realmente saia.
    expect(getSocialPromoText).not.toHaveBeenCalled();
  });

  it("chama getSocialPromoText no máximo 1 vez mesmo com e-mail e WhatsApp habilitados e bem sucedidos", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(sendPaymentErrorEmail).toHaveBeenCalled();
    expect(sendWhatsAppMessage).toHaveBeenCalled();
    expect(getSocialPromoText).toHaveBeenCalledTimes(1);
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

  it("com bypassDedupe: grava recordAlert depois do envio, pra rodadas automáticas futuras verem a reivindicação", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1", { bypassDedupe: true });

    expect(recordAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "Payment", "payment-1", "EMAIL");
  });

  it("não reivindica o alerta de e-mail quando o SMTP não está pronto (evita travar o alerta pra sempre)", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(isSmtpReady).mockReturnValue(false);
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
  });

  it("com o banco sem nenhum template salvo (fallback de fábrica), o texto do WhatsApp é idêntico ao hardcoded anterior", async () => {
    const resolveSpy = vi.spyOn(resolveModule, "getEffectiveTemplate");
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);

    await notifyPaymentError("payment-1");

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Sua inscrição em "Corrida Teste" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${baseUrl}/eventos/corrida-teste`,
      "PAYMENT_ERROR",
    );
    expect(resolveSpy).toHaveBeenCalledWith("PAYMENT_ERROR", "WHATSAPP", "BUYER", "event-1");
  });

  it("um template customizado que referencia {{nome_atleta}} (antes não suprido) renderiza o nome, não em branco", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.payment.findUnique.mockResolvedValueOnce(paymentFixture);
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: null,
      body: "Olá {{nome_atleta}}, sua inscrição em {{nome_evento}} foi cancelada.",
    });

    await notifyPaymentError("payment-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      "Olá Atleta, sua inscrição em Corrida Teste foi cancelada.",
      "PAYMENT_ERROR",
    );
  });
});

const orderFixture = {
  event: { id: "event-1", title: "Corrida Teste", slug: "corrida-teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

describe("notifyOrderCancelledWithoutPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false });

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
  });

  it("não faz nada quando o pedido não é encontrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(null);

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(sendPaymentErrorEmail).not.toHaveBeenCalled();
  });

  it("envia e-mail e reivindica o alerta com entityType Order", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(claimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "Order", "order-1", "EMAIL");
    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", eventSlug: "corrida-teste", eventId: "event-1" }),
    );
  });

  it("envia WhatsApp quando o atleta tem telefone cadastrado", async () => {
    const resolveSpy = vi.spyOn(resolveModule, "getEffectiveTemplate");
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(claimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "Order", "order-1", "WHATSAPP");
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      expect.stringContaining("Corrida Teste"),
      "PAYMENT_ERROR_ORDER_CANCELLED",
    );
    expect(resolveSpy).toHaveBeenCalledWith("PAYMENT_ERROR_ORDER_CANCELLED", "WHATSAPP", "BUYER", "event-1");
  });

  it("pula o WhatsApp sem quebrar quando o atleta não tem telefone cadastrado", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...orderFixture,
      buyer: { ...orderFixture.buyer, athleteProfile: null },
    });

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("libera a reivindicação quando o envio de e-mail falha", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await notifyOrderCancelledWithoutPayment("order-1");

    expect(unclaimAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "order-1", "EMAIL");
  });

  it("nunca lança exceção, mesmo se o e-mail falhar", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendPaymentErrorEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyOrderCancelledWithoutPayment("order-1")).resolves.toBeUndefined();
  });

  it("com bypassDedupe: envia mesmo que claimAlert diria não (nem chama claimAlert)", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderCancelledWithoutPayment("order-1", { bypassDedupe: true });

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendPaymentErrorEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "atleta@example.com" }));
  });

  it("com bypassDedupe: grava recordAlert com entityType Order", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderCancelledWithoutPayment("order-1", { bypassDedupe: true });

    expect(recordAlert).toHaveBeenCalledWith("PAYMENT_ERROR", "Order", "order-1", "EMAIL");
  });

  it("com o banco sem nenhum template salvo (fallback de fábrica), o texto do WhatsApp é idêntico ao hardcoded anterior", async () => {
    vi.mocked(getPaymentErrorAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderCancelledWithoutPayment("order-1");

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Sua inscrição em "Corrida Teste" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${baseUrl}/eventos/corrida-teste`,
      "PAYMENT_ERROR_ORDER_CANCELLED",
    );
  });
});
