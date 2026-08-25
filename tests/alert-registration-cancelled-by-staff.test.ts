import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendRegistrationCancelledByStaffEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/templates/resolve", () => ({ getEffectiveTemplate: vi.fn() }));

import { notifyRegistrationCancelledByStaff } from "@/lib/alerts/registration-cancelled-by-staff";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendRegistrationCancelledByStaffEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getEffectiveTemplate } from "@/lib/templates/resolve";

const dbMock = db as any;

const registrationFixture = {
  cancellationReason: "Pedido da comissão organizadora",
  athlete: {
    name: "Atleta Teste",
    email: "atleta@example.com",
    receiveEventMessages: true,
    athleteProfile: { phone: "5511999998888" },
  },
  event: { id: "event-1", title: "Corrida Teste" },
};

describe("notifyRegistrationCancelledByStaff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(getEffectiveTemplate).mockResolvedValue({ body: "Motivo: {{motivo_cancelamento}}" } as any);
  });

  it("não faz nada quando a inscrição não é encontrada", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce(null);

    await notifyRegistrationCancelledByStaff("reg-1");

    expect(sendRegistrationCancelledByStaffEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("não envia quando o atleta desativou mensagens de evento", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...registrationFixture,
      athlete: { ...registrationFixture.athlete, receiveEventMessages: false },
    });

    await notifyRegistrationCancelledByStaff("reg-1");

    expect(sendRegistrationCancelledByStaffEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("envia e-mail e WhatsApp com o motivo do cancelamento", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);

    await notifyRegistrationCancelledByStaff("reg-1");

    expect(sendRegistrationCancelledByStaffEmail).toHaveBeenCalledWith({
      to: "atleta@example.com",
      athleteName: "Atleta Teste",
      eventTitle: "Corrida Teste",
      eventId: "event-1",
      reason: "Pedido da comissão organizadora",
    });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999998888",
      expect.stringContaining("Pedido da comissão organizadora"),
      "REGISTRATION_CANCELLED_BY_STAFF",
      expect.objectContaining({ appendPreferencesFooter: true }),
    );
  });

  it("não envia WhatsApp quando o atleta não tem telefone cadastrado", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce({
      ...registrationFixture,
      athlete: { ...registrationFixture.athlete, athleteProfile: null },
    });

    await notifyRegistrationCancelledByStaff("reg-1");

    expect(sendRegistrationCancelledByStaffEmail).toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("não lança quando o e-mail falha, e ainda tenta o WhatsApp", async () => {
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);
    vi.mocked(sendRegistrationCancelledByStaffEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyRegistrationCancelledByStaff("reg-1")).resolves.toBeUndefined();
    expect(sendWhatsAppMessage).toHaveBeenCalled();
  });
});
