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
  { paymentId: "payment-1", orderId: "order-1", eventTitle: "Corrida Teste", localStatus: "PENDING", gatewayStatus: "PAID", corrected: false },
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

  it("na 2ª chamada com a mesma lista de divergências, não reenvia (dedupe por payment+admin+canal)", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValue([{ email: "admin1@example.com", phone: null }]);
    // 1ª chamada: claim concedido (AlertLog.create grava normalmente). 2ª chamada: a constraint
    // única já existe (P2002) — simula a mesma divergência não corrigida reaparecendo no próximo
    // ciclo do cron, que antes desta correção reenviava pra sempre.
    dbMock.alertLog.create.mockResolvedValueOnce({ id: "log-1" }).mockRejectedValueOnce({ code: "P2002" });

    await notifyReconciliationMismatches(mismatchFixture);
    await notifyReconciliationMismatches(mismatchFixture);

    expect(sendReconciliationMismatchEmail).toHaveBeenCalledTimes(1);
  });

  it("uma divergência NOVA ao lado de uma já alertada ainda é enviada (dedupe parcial por admin)", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValue([{ email: "admin1@example.com", phone: null }]);

    const newMismatch = {
      paymentId: "payment-2",
      orderId: "order-2",
      eventTitle: "Corrida Teste 2",
      localStatus: "PENDING",
      gatewayStatus: "PAID",
      corrected: false,
    };

    // 1ª execução: só a divergência 1 existe e é reivindicada com sucesso.
    dbMock.alertLog.create.mockResolvedValueOnce({ id: "log-1" });
    await notifyReconciliationMismatches(mismatchFixture);
    expect(sendReconciliationMismatchEmail).toHaveBeenCalledTimes(1);
    expect(sendReconciliationMismatchEmail).toHaveBeenCalledWith({ to: "admin1@example.com", mismatches: mismatchFixture });

    vi.mocked(sendReconciliationMismatchEmail).mockClear();

    // 2ª execução: a divergência 1 já foi reivindicada (P2002), mas a divergência 2 é nova — só
    // ela deve entrar no resumo enviado a este admin.
    dbMock.alertLog.create.mockRejectedValueOnce({ code: "P2002" }).mockResolvedValueOnce({ id: "log-2" });
    await notifyReconciliationMismatches([mismatchFixture[0], newMismatch]);

    expect(sendReconciliationMismatchEmail).toHaveBeenCalledTimes(1);
    expect(sendReconciliationMismatchEmail).toHaveBeenCalledWith({ to: "admin1@example.com", mismatches: [newMismatch] });
  });

  it("não envia nada para um admin cujas divergências já foram todas alertadas antes", async () => {
    vi.mocked(getReconciliationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 15 });
    dbMock.user.findMany.mockResolvedValue([{ email: "admin1@example.com", phone: null }]);
    dbMock.alertLog.create.mockRejectedValueOnce({ code: "P2002" });

    await notifyReconciliationMismatches(mismatchFixture);

    expect(sendReconciliationMismatchEmail).not.toHaveBeenCalled();
  });
});
