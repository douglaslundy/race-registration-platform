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
});
