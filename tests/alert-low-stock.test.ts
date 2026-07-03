import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendLowStockEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getLowStockAlertSettings: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  hasAlertBeenSent: vi.fn(),
  markAlertSent: vi.fn(),
}));

import { checkLowStockAlert } from "@/lib/alerts/low-stock";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendLowStockEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getLowStockAlertSettings } from "@/lib/alerts/alert-settings";
import { hasAlertBeenSent, markAlertSent } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const batchFixture = {
  id: "batch-1",
  name: "Lote 1",
  capacity: 100,
  soldCount: 95,
  event: {
    title: "Corrida Teste",
    organizer: {
      phone: "5511999999999",
      user: { name: "Organizador", email: "organizador@example.com" },
    },
  },
};

describe("checkLowStockAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(hasAlertBeenSent).mockResolvedValue(false);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, thresholdPercent: 90 });

    await checkLowStockAlert("batch-1");

    expect(dbMock.ticketBatch.findUnique).not.toHaveBeenCalled();
  });

  it("não dispara quando o percentual vendido está abaixo do limiar", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce({ ...batchFixture, soldCount: 50 });

    await checkLowStockAlert("batch-1");

    expect(sendLowStockEmail).not.toHaveBeenCalled();
  });

  it("envia e-mail e grava AlertLog quando o percentual atinge o limiar", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce(batchFixture);

    await checkLowStockAlert("batch-1");

    expect(sendLowStockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "organizador@example.com", soldCount: 95, capacity: 100 }),
    );
    expect(markAlertSent).toHaveBeenCalledWith("LOW_STOCK", "TicketBatch", "batch-1", "EMAIL");
  });

  it("não reenvia por e-mail quando já foi alertado", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    vi.mocked(hasAlertBeenSent).mockResolvedValue(true);
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce(batchFixture);

    await checkLowStockAlert("batch-1");

    expect(sendLowStockEmail).not.toHaveBeenCalled();
  });

  it("envia WhatsApp quando habilitado e o organizador tem telefone", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce(batchFixture);

    await checkLowStockAlert("batch-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    expect(markAlertSent).toHaveBeenCalledWith("LOW_STOCK", "TicketBatch", "batch-1", "WHATSAPP");
  });

  it("pula o WhatsApp sem quebrar quando o organizador não tem telefone cadastrado", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce({
      ...batchFixture,
      event: { ...batchFixture.event, organizer: { ...batchFixture.event.organizer, phone: null } },
    });

    await checkLowStockAlert("batch-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("não faz nada quando a capacidade do lote é zero", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce({ ...batchFixture, capacity: 0 });

    await checkLowStockAlert("batch-1");

    expect(sendLowStockEmail).not.toHaveBeenCalled();
  });

  it("nunca lança exceção, mesmo se o e-mail falhar", async () => {
    vi.mocked(getLowStockAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, thresholdPercent: 90 });
    dbMock.ticketBatch.findUnique.mockResolvedValueOnce(batchFixture);
    vi.mocked(sendLowStockEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(checkLowStockAlert("batch-1")).resolves.toBeUndefined();
  });
});
