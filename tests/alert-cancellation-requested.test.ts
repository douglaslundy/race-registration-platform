import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendCancellationRequestedEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getCancellationAlertSettings: vi.fn() }));
vi.mock("@/lib/alerts/dedupe", () => ({ claimAlert: vi.fn(), unclaimAlert: vi.fn() }));

import { notifyCancellationRequested } from "@/lib/alerts/cancellation-requested";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendCancellationRequestedEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getCancellationAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const registrationFixture = {
  cancellationReason: "Contusão no joelho",
  athlete: { name: "Atleta Teste" },
  event: {
    title: "Corrida Teste",
    organizer: { user: { email: "org@example.com", phone: "5511999998888" } },
  },
};

describe("notifyCancellationRequested (alerts/cancellation-requested)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    dbMock.user.findMany.mockResolvedValue([{ email: "admin@example.com", phone: "5511988887777" }]);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false });

    await notifyCancellationRequested("reg-1");

    expect(dbMock.registration.findUnique).not.toHaveBeenCalled();
  });

  it("envia e-mail para todos os admins e para o organizador do evento", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);

    await notifyCancellationRequested("reg-1");

    expect(sendCancellationRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", athleteName: "Atleta Teste", reason: "Contusão no joelho" }),
    );
    expect(sendCancellationRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "org@example.com", athleteName: "Atleta Teste" }),
    );
  });

  it("envia WhatsApp para quem tem telefone cadastrado", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);

    await notifyCancellationRequested("reg-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511988887777", expect.stringContaining("Corrida Teste"));
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999998888", expect.stringContaining("Corrida Teste"));
  });

  it("não lança exceção quando o envio de e-mail falha", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);
    vi.mocked(sendCancellationRequestedEmail).mockRejectedValue(new Error("SMTP down"));

    await expect(notifyCancellationRequested("reg-1")).resolves.toBeUndefined();
    expect(unclaimAlert).toHaveBeenCalled();
  });

  it("não faz nada quando a inscrição não é encontrada", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true });
    dbMock.registration.findUnique.mockResolvedValueOnce(null);

    await notifyCancellationRequested("reg-1");

    expect(sendCancellationRequestedEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});
