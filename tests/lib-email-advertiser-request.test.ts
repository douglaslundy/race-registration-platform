import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock, verify: vi.fn() })) },
}));
vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/message-logs", () => ({ recordMessageLog: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppName: vi.fn() }));

import { sendAdvertiserRequestApprovedEmail, sendAdvertiserRequestRejectedEmail } from "@/lib/email";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { getAppName } from "@/lib/settings";

const smtpConfig = { host: "smtp.example.com", port: 587, user: "u", pass: "p", from: "noreply@example.com", secure: false };

describe("sendAdvertiserRequestApprovedEmail / sendAdvertiserRequestRejectedEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSmtpConfig).mockResolvedValue(smtpConfig);
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getAppName).mockResolvedValue("Circuito das Corridas");
    sendMailMock.mockResolvedValue({ messageId: "msg-1" });
  });

  it("envia e-mail de aprovação com o nome do plano", async () => {
    await sendAdvertiserRequestApprovedEmail({ to: "empresa@example.com", name: "Fulano", planName: "Plano Básico" });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "empresa@example.com",
        subject: expect.stringContaining("aprovada"),
        html: expect.stringContaining("Plano Básico"),
      }),
    );
  });

  it("envia e-mail de rejeição com o motivo e menção ao reembolso quando refunded=true", async () => {
    await sendAdvertiserRequestRejectedEmail({
      to: "empresa@example.com",
      name: "Fulano",
      reason: "Dados inconsistentes",
      refunded: true,
    });

    expect(sendMailMock).toHaveBeenCalled();
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe("empresa@example.com");
    expect(call.subject).toContain("não foi aprovada");
    expect(call.html).toContain("Dados inconsistentes");
    expect(call.html).toMatch(/estorn|reembols/i);
    expect(call.html).toContain("já foi estornado automaticamente");
  });

  it("envia e-mail de rejeição sem afirmar que o estorno ocorreu quando refunded=false", async () => {
    await sendAdvertiserRequestRejectedEmail({
      to: "empresa@example.com",
      name: "Fulano",
      reason: "Dados inconsistentes",
      refunded: false,
    });

    expect(sendMailMock).toHaveBeenCalled();
    const call = sendMailMock.mock.calls[0][0];
    expect(call.html).not.toContain("já foi estornado automaticamente");
    expect(call.html).toMatch(/nossa equipe cuidará do estorno/i);
  });
});
