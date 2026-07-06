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

import { notifyOrderConfirmed } from "@/lib/notifications";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendRegistrationConfirmationEmail } from "@/lib/email";

const dbMock = db as any;

const orderFixture = {
  buyer: { name: "Atleta Teste", email: "atleta@example.com" },
  event: { title: "Corrida Teste" },
  registrations: [{ id: "reg-1" }],
};

describe("notifyOrderConfirmed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("envia o e-mail e grava confirmationEmailSentAt no pedido", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", registrationId: "reg-1" }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { confirmationEmailSentAt: expect.any(Date) },
    });
  });

  it("não grava confirmationEmailSentAt quando o SMTP não está configurado", async () => {
    vi.mocked(isSmtpReady).mockReturnValue(false);

    await notifyOrderConfirmed("order-1");

    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
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
});
