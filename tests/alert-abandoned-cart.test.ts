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
  recordAlert: vi.fn(),
}));
vi.mock("@/lib/event-social-links", () => ({
  getSocialPromoText: vi.fn().mockResolvedValue(""),
}));

import { checkAbandonedCarts, sendAbandonedCartAlert } from "@/lib/alerts/abandoned-cart";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAbandonedCartEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getAbandonedCartAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, recordAlert, unclaimAlert } from "@/lib/alerts/dedupe";
import * as resolveModule from "@/lib/templates/resolve";

const dbMock = db as any;

const orderFixture = {
  id: "order-1",
  buyerUserId: "athlete-1",
  event: { id: "event-1", title: "Corrida Teste" },
  buyer: { name: "Atleta", email: "atleta@example.com", athleteProfile: { phone: "5511988888888" } },
};

describe("checkAbandonedCarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
  });

  it("consulta pedidos e NÃO grava auditoria quando os dois canais estão desligados (nenhum aviso real foi enviado)", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(dbMock.order.findMany).toHaveBeenCalled();
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, notified: 0 });
  });

  it("filtra por status PENDING e createdAt mais antigo que o limiar de minutos", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([]);

    await checkAbandonedCarts();

    expect(dbMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING", createdAt: { lte: expect.any(Date) } } }),
    );
  });

  it("grava auditoria e envia e-mail para um pedido pendente quando o canal está ligado", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CART_ABANDONED", entityId: "order-1" }) }),
    );
    expect(claimAlert).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "EMAIL");
    expect(sendAbandonedCartEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", orderId: "order-1", eventId: "event-1" }),
    );
    expect(result).toEqual({ checked: 1, notified: 1 });
  });

  it("não reenvia por e-mail quando outra execução já reivindicou o alerta", async () => {
    vi.mocked(getAbandonedCartAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false, minutesThreshold: 30 });
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.order.findMany.mockResolvedValueOnce([orderFixture]);

    const result = await checkAbandonedCarts();

    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
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
    expect(dbMock.auditLog.create).not.toHaveBeenCalled();
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

describe("sendAbandonedCartAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
  });

  it("com bypassDedupe, envia e-mail sem chamar claimAlert", async () => {
    const result = await sendAbandonedCartAlert(
      orderFixture,
      { emailEnabled: true, whatsappEnabled: false },
      { bypassDedupe: true },
    );

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendAbandonedCartEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta@example.com", orderId: "order-1", eventId: "event-1" }),
    );
    expect(result).toEqual({ sent: true });
  });

  it("com bypassDedupe, envia WhatsApp mesmo se um alerta automático já tiver sido enviado antes", async () => {
    const resolveSpy = vi.spyOn(resolveModule, "getEffectiveTemplate");

    const result = await sendAbandonedCartAlert(
      orderFixture,
      { emailEnabled: false, whatsappEnabled: true },
      { bypassDedupe: true },
    );

    expect(claimAlert).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).toHaveBeenCalled();
    expect(resolveSpy).toHaveBeenCalledWith("ABANDONED_CART", "WHATSAPP", "BUYER", "event-1");
    expect(result).toEqual({ sent: true });
  });

  it("com bypassDedupe, grava o alerta via recordAlert (não claimAlert) após o envio de e-mail ter sucesso", async () => {
    await sendAbandonedCartAlert(
      orderFixture,
      { emailEnabled: true, whatsappEnabled: false },
      { bypassDedupe: true },
    );

    expect(recordAlert).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "EMAIL");
    expect(claimAlert).not.toHaveBeenCalled();
  });

  it("com bypassDedupe, grava o alerta via recordAlert (não claimAlert) após o envio de WhatsApp ter sucesso", async () => {
    await sendAbandonedCartAlert(
      orderFixture,
      { emailEnabled: false, whatsappEnabled: true },
      { bypassDedupe: true },
    );

    expect(recordAlert).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "WHATSAPP");
    expect(claimAlert).not.toHaveBeenCalled();
  });

  it("sem bypassDedupe, continua respeitando claimAlert (comportamento automático inalterado)", async () => {
    vi.mocked(claimAlert).mockResolvedValue(false);

    const result = await sendAbandonedCartAlert(orderFixture, { emailEnabled: true, whatsappEnabled: false });

    expect(claimAlert).toHaveBeenCalledWith("ABANDONED_CART", "Order", "order-1", "EMAIL");
    expect(sendAbandonedCartEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: false });
  });

  it("com bypassDedupe, não chama unclaimAlert quando o envio falha (não há claim pra desfazer)", async () => {
    vi.mocked(sendAbandonedCartEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(
      sendAbandonedCartAlert(orderFixture, { emailEnabled: true, whatsappEnabled: false }, { bypassDedupe: true }),
    ).rejects.toThrow("SMTP down");
    expect(unclaimAlert).not.toHaveBeenCalled();
    expect(recordAlert).not.toHaveBeenCalled();
  });

  it("e-mail com sucesso seguido de falha no WhatsApp: ainda lança (comportamento preservado), mas grava auditoria porque um aviso real (o e-mail) foi enviado", async () => {
    // Reproduz a regressão do Fix D: o e-mail é enviado com sucesso (sentSomething = true) e,
    // em seguida, o WhatsApp lança. Antes da correção, esse throw saía da função antes de chegar
    // na linha de auditoria (movida pro fim), perdendo o registro de um envio que genuinamente
    // aconteceu. Com o try/finally, a auditoria é gravada mesmo com o throw subindo depois.
    vi.mocked(claimAlert).mockResolvedValue(true);
    vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("WhatsApp API down"));

    await expect(
      sendAbandonedCartAlert(
        { ...orderFixture, buyer: { ...orderFixture.buyer, athleteProfile: { phone: "5511988888888" } } },
        { emailEnabled: true, whatsappEnabled: true },
      ),
    ).rejects.toThrow("WhatsApp API down");

    expect(sendAbandonedCartEmail).toHaveBeenCalled();
    expect(dbMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CART_ABANDONED", entityId: "order-1" }) }),
    );
  });

  it("com o banco sem nenhum template salvo (fallback de fábrica), o texto do WhatsApp é idêntico ao hardcoded anterior", async () => {
    vi.mocked(claimAlert).mockResolvedValue(true);

    await sendAbandonedCartAlert(
      orderFixture,
      { emailEnabled: false, whatsappEnabled: true },
      { bypassDedupe: true },
    );

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Sua inscrição em "Corrida Teste" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
      "ABANDONED_CART",
    );
  });

  it("preenche link_finalizar_pagamento também no WhatsApp quando o template customizado o referencia (Finding 1: variável documentada não pode renderizar vazia)", async () => {
    vi.mocked(claimAlert).mockResolvedValue(true);
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: null,
      body: "Link: {{link_finalizar_pagamento}}",
    });

    await sendAbandonedCartAlert(
      orderFixture,
      { emailEnabled: false, whatsappEnabled: true },
      { bypassDedupe: true },
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Link: ${baseUrl}/dashboard/inscricoes`,
      "ABANDONED_CART",
    );
    // Garante que a variável não vira string vazia: o texto final não pode terminar em "Link: " puro.
    const sentText = vi.mocked(sendWhatsAppMessage).mock.calls[0][1];
    expect(sentText).not.toBe("Link: ");
    expect(sentText.length).toBeGreaterThan("Link: ".length);
  });
});
