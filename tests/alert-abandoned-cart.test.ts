import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendAbandonedCartEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/alert-settings", () => ({
  getAbandonedCartAlertSettings: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  claimAlert: vi.fn(),
  unclaimAlert: vi.fn(),
}));

import { checkAbandonedCarts } from "@/lib/alerts/abandoned-cart";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const orderFixture = {
  id: "order-1",
  event: { title: "Corrida Teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

describe("checkAbandonedCarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
  });

  it("não consulta pedidos quando os dois canais estão desligados", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 30 });

    const result = await checkAbandonedCarts();

    expect(dbMock.order.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, notified: 0 });
  });

  it("filtra por status PENDING e createdAt mais antigo que o limiar de minutos", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await checkAbandonedCarts();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING", createdAt: { lte: expect.any(Date) } } }),
    );
  });

  it("envia e-mail e reivindica o alerta para um pedido pendente", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(claimAlert).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "EMAIL");
    expect(sendAbandonedCartEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", orderId: "order-1" }),
    );
    expect(result).toEqual({ checked: 1, notified: 1 });
  });

  it("não reenvia por e-mail quando outra execução já reivindicou o alerta", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("libera a reivindicação quando o envio falha, para permitir nova tentativa depois", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await checkAbandonedCarts();

    expect(unclaimAlert).toHaveBeenCalledWith("ABANDONED_CART", "order-1", "EMAIL");
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("pula o WhatsApp sem quebrar quando o atleta não tem telefone cadastrado", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, buyer: { ...orderFixture.buyer, athleteProfile: null } },
    ]);

    const result = await checkAbandonedCarts();

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("continua processando os demais pedidos quando um falha", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([
      { ...orderFixture, id: "order-1" },
      { ...orderFixture, id: "order-2" },
    ]);
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 2, notified: 1 });
  });
});
