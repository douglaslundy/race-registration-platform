import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendRegistrationConfirmationEmail: vi.fn(),
  sendCancellationRequestedEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  getConnectionState: vi.fn(),
}));

import { notifyOrderConfirmed } from "@/lib/notifications";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendRegistrationConfirmationEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { getConnectionState } from "@/lib/whatsapp/evolution-client";

const dbMock = db as any;

const orderFixture = {
  buyer: { name: "Atleta Teste", email: "atleta@example.com" },
  event: { title: "Corrida Teste" },
  registrations: [
    { id: "reg-1", notes: "Chegarei atrasado", athlete: { athleteProfile: { phone: "5511999999999" } } },
  ],
};

describe("notifyOrderConfirmed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);
    vi.mocked(getWhatsAppConfig).mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
  });

  it("envia o e-mail com o código do pedido e a observação, e grava confirmationEmailSentAt", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "atleta@example.com",
        registrationId: "reg-1",
        orderId: "order-1",
        notes: "Chegarei atrasado",
      }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { confirmationEmailSentAt: expect.any(Date) },
    });
  });

  it("envia notes como undefined quando a inscrição não tem observação", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...orderFixture,
      registrations: [{ ...orderFixture.registrations[0], notes: null }],
    });

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ notes: undefined }),
    );
  });

  it("não envia e-mail nem grava confirmationEmailSentAt quando o SMTP não está configurado", async () => {
    vi.mocked(isSmtpReady).mockReturnValue(false);
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("não grava confirmationEmailSentAt quando o pedido não tem inscrições", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({ ...orderFixture, registrations: [] });

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("não grava confirmationEmailSentAt quando o envio do e-mail falha", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendRegistrationConfirmationEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyOrderConfirmed("order-1")).resolves.toBeUndefined();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("envia WhatsApp quando há conexão ativa e a inscrição tem telefone", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      expect.stringContaining("Corrida Teste"),
    );
  });

  it("não envia WhatsApp quando não está configurado", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(getConnectionState).not.toHaveBeenCalled();
  });

  it("não envia WhatsApp quando está configurado mas a conexão não está aberta", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("connecting");

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("não envia WhatsApp quando a inscrição não tem telefone cadastrado", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...orderFixture,
      registrations: [{ ...orderFixture.registrations[0], athlete: { athleteProfile: { phone: null } } }],
    });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("uma falha no envio do e-mail não impede o envio do WhatsApp", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendRegistrationConfirmationEmail).mockRejectedValueOnce(new Error("SMTP down"));
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).toHaveBeenCalled();
  });

  it("uma falha no envio do WhatsApp não impede o envio do e-mail", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");
    vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("WhatsApp API down"));

    await expect(notifyOrderConfirmed("order-1")).resolves.toBeUndefined();
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { confirmationEmailSentAt: expect.any(Date) },
    });
  });
});
