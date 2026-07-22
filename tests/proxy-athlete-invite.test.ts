import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendProxyRegistrationInviteEmail: vi.fn(),
}));

import { sendProxyRegistrationInvite } from "@/lib/proxy-athlete";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendProxyRegistrationInviteEmail } from "@/lib/email";

const dbMock = db as any;

describe("sendProxyRegistrationInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("gera um token de verificação e dispara o e-mail de convite", async () => {
    await sendProxyRegistrationInvite({
      name: "Maria Atleta",
      email: "maria@example.com",
      invitedByName: "João Comprador",
    });

    expect(dbMock.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { identifier: "maria@example.com" } });
    expect(dbMock.verificationToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ identifier: "maria@example.com" }) }),
    );
    expect(sendProxyRegistrationInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "maria@example.com", name: "Maria Atleta", invitedByName: "João Comprador" }),
    );
  });

  it("não dispara o e-mail quando o SMTP não está configurado, mas ainda assim não lança erro", async () => {
    vi.mocked(isSmtpReady).mockReturnValue(false);

    await expect(
      sendProxyRegistrationInvite({ name: "Maria", email: "maria@example.com", invitedByName: "João" }),
    ).resolves.toBeUndefined();

    expect(sendProxyRegistrationInviteEmail).not.toHaveBeenCalled();
  });

  it("nunca lança erro quando o envio do e-mail falha (best-effort)", async () => {
    vi.mocked(sendProxyRegistrationInviteEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(
      sendProxyRegistrationInvite({ name: "Maria", email: "maria@example.com", invitedByName: "João" }),
    ).resolves.toBeUndefined();
  });

  it("nunca lança erro quando a criação do token no banco falha", async () => {
    vi.mocked(dbMock.verificationToken.create).mockRejectedValueOnce(new Error("DB down"));

    await expect(
      sendProxyRegistrationInvite({ name: "Maria", email: "maria@example.com", invitedByName: "João" }),
    ).resolves.toBeUndefined();

    expect(sendProxyRegistrationInviteEmail).not.toHaveBeenCalled();
  });
});
