import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/alerts/alert-settings", () => ({ getAdvertiserRequestAlertSettings: vi.fn() }));
vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendAdvertiserRequestPendingEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/alerts/dedupe", () => ({ claimAlert: vi.fn(), unclaimAlert: vi.fn() }));

import { notifyAdvertiserRequestPending } from "@/lib/alerts/advertiser-request-pending";
import { getAdvertiserRequestAlertSettings } from "@/lib/alerts/alert-settings";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAdvertiserRequestPendingEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { claimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const PURCHASE = {
  id: "purchase-1",
  advertiser: { companyName: "Empresa X" },
  adPlan: { name: "Plano Básico" },
};

describe("notifyAdvertiserRequestPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdvertiserRequestAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true });
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(claimAlert).mockResolvedValue(true);
    dbMock.adPurchase.findUnique.mockResolvedValue(PURCHASE);
    dbMock.user.findMany.mockResolvedValue([{ email: "admin@example.com", phone: "5511999999999" }]);
  });

  it("não faz nada se os 2 canais estiverem desligados", async () => {
    vi.mocked(getAdvertiserRequestAlertSettings).mockResolvedValueOnce({ emailEnabled: false, whatsappEnabled: false });
    await notifyAdvertiserRequestPending("purchase-1");
    expect(sendAdvertiserRequestPendingEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("envia e-mail e whatsapp pra todos os admins", async () => {
    await notifyAdvertiserRequestPending("purchase-1");

    expect(sendAdvertiserRequestPendingEmail).toHaveBeenCalledWith({
      to: "admin@example.com",
      companyName: "Empresa X",
      planName: "Plano Básico",
    });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      expect.stringContaining("Empresa X"),
      "ADVERTISER_REQUEST_PENDING",
    );
  });

  it("nunca lança, mesmo se o envio falhar", async () => {
    vi.mocked(sendAdvertiserRequestPendingEmail).mockRejectedValueOnce(new Error("smtp down"));
    await expect(notifyAdvertiserRequestPending("purchase-1")).resolves.toBeUndefined();
  });

  it("não faz nada se a compra não existir", async () => {
    dbMock.adPurchase.findUnique.mockResolvedValueOnce(null);
    await notifyAdvertiserRequestPending("purchase-1");
    expect(sendAdvertiserRequestPendingEmail).not.toHaveBeenCalled();
  });

  it("com o banco sem template salvo, o texto do WhatsApp é idêntico ao hardcoded anterior", async () => {
    await notifyAdvertiserRequestPending("purchase-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      "Nova solicitação de anunciante: Empresa X (plano Plano Básico). Acesse o painel pra aprovar ou rejeitar.",
      "ADVERTISER_REQUEST_PENDING",
    );
  });

  it("um template customizado que referencia {{nome_plataforma}} e {{link_solicitacoes_pendentes}} (antes não supridos) renderiza os dois, não em branco", async () => {
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: null,
      body: "[{{nome_plataforma}}] Nova solicitação de {{empresa_anunciante}}. Ver: {{link_solicitacoes_pendentes}}",
    });

    await notifyAdvertiserRequestPending("purchase-1");

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const [phone, text] = vi.mocked(sendWhatsAppMessage).mock.calls[0];
    expect(phone).toBe("5511999999999");
    expect(text).toContain("Nova solicitação de Empresa X");
    expect(text).toContain(`Ver: ${baseUrl}/admin/anunciantes/solicitacoes`);
    expect(text).not.toContain("{{nome_plataforma}}");
    expect(text).not.toContain("{{link_solicitacoes_pendentes}}");
  });
});
