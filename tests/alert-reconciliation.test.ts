import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendReconciliationMismatchEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getReconciliationAlertSettings: vi.fn(),
}));

import { notifyReconciliationMismatches } from "@/lib/alerts/reconciliation";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendReconciliationMismatchEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";

const dbMock = db as any;

const mismatchFixture = [
  { paymentId: "payment-1", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID" },
];

describe("notifyReconciliationMismatches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("não faz nada quando não há divergências", async () => {
    await notifyReconciliationMismatches([]);
    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 15 });

    await notifyReconciliationMismatches(mismatchFixture);

    expect(dbMock.user.findMany).not.toHaveBeenCalled();
  });

  it("envia e-mail para todo usuário com papel ADMIN", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValueOnce([
      { email: "admin1@example.com", phone: null },
      { email: "admin2@example.com", phone: "5511999999999" },
    ]);

    await notifyReconciliationMismatches(mismatchFixture);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "ADMIN" } }));
    expect(sendReconciliationMismatchEmail).toHaveBeenCalledTimes(2);
    expect(sendReconciliationMismatchEmail).toHaveBeenCalledWith({ to: "admin1@example.com", mismatches: mismatchFixture });
  });

  it("pula o WhatsApp para admins sem telefone cadastrado", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValueOnce([
      { email: "admin1@example.com", phone: null },
      { email: "admin2@example.com", phone: "5511999999999" },
    ]);

    await notifyReconciliationMismatches(mismatchFixture);

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
  });

  it("nunca lança exceção, mesmo se o e-mail falhar", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValueOnce([{ email: "admin1@example.com", phone: null }]);
    vi.mocked(sendReconciliationMismatchEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyReconciliationMismatches(mismatchFixture)).resolves.toBeUndefined();
  });
});
