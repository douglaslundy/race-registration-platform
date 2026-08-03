import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendRegistrationConfirmationEmail: vi.fn(),
  sendCancellationRequestedEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppConfig: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp/evolution-client", () => ({
  getConnectionState: vi.fn(),
}));
vi.mock("@/lib/proxy-athlete", () => ({
  isPlaceholderEmail: vi.fn(),
}));

import { notifyOrderConfirmed } from "@/lib/notifications";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendRegistrationConfirmationEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import { getConnectionState } from "@/lib/whatsapp/evolution-client";
import { isPlaceholderEmail } from "@/lib/proxy-athlete";

const dbMock = db as any;

const orderFixture = {
  buyerUserId: "user-1",
  buyer: { name: "Atleta Teste", email: "atleta@example.com", athleteProfile: { phone: "5511999999999" } },
  event: { id: "event-1", title: "Corrida Teste" },
  registrations: [
    {
      id: "reg-1",
      notes: "Chegarei atrasado",
      athleteUserId: "user-1",
      athlete: { name: "Atleta Teste", email: "atleta@example.com", athleteProfile: { phone: "5511999999999" } },
    },
  ],
};

describe("notifyOrderConfirmed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);
    vi.mocked(getWhatsAppConfig).mockResolvedValue({ apiUrl: "", apiKey: "", instanceName: "" });
    vi.mocked(isPlaceholderEmail).mockReturnValue(false);
  });

  it("envia o e-mail com o código do pedido e a observação, e grava confirmationEmailSentAt", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "atleta@example.com",
        registrationId: "reg-1",
        orderId: "order-1",
        eventId: "event-1",
        notes: "Chegarei atrasado",
      }),
    );
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { confirmationEmailSentAt: expect.any(Date) },
    });
  });

  it("envia notes como undefined quando a inscrição não tem observação", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...orderFixture,
      registrations: [{ ...orderFixture.registrations[0], notes: null }],
    });

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ notes: undefined }),
    );
  });

  it("não envia e-mail nem grava confirmationEmailSentAt quando o SMTP não está configurado", async () => {
    vi.mocked(isSmtpReady).mockReturnValue(false);
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("não grava confirmationEmailSentAt quando o pedido não tem inscrições", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({ ...orderFixture, registrations: [] });

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("não grava confirmationEmailSentAt quando o envio do e-mail falha", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendRegistrationConfirmationEmail).mockRejectedValueOnce(new Error("SMTP down"));

    await expect(notifyOrderConfirmed("order-1")).resolves.toBeUndefined();
    expect(dbMock.order.update).not.toHaveBeenCalled();
  });

  it("envia WhatsApp quando há conexão ativa e a inscrição tem telefone", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      expect.stringContaining("Corrida Teste"),
      { relatedEntityType: "Event", relatedEntityId: "event-1" },
    );
  });

  it("não envia WhatsApp quando não está configurado", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(getConnectionState).not.toHaveBeenCalled();
  });

  it("não envia WhatsApp quando está configurado mas a conexão não está aberta, e não reivindica a chave de dedupe", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("connecting");

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    // A reivindicação só deve acontecer depois de confirmar a conexão ativa — caso contrário, uma
    // instância de WhatsApp fora do ar queimaria a trava à toa e bloquearia uma tentativa futura
    // legítima do mesmo canal.
    expect(dbMock.alertLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "WHATSAPP" }) }),
    );
  });

  it("não envia WhatsApp quando a inscrição não tem telefone cadastrado", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce({
      ...orderFixture,
      registrations: [{ ...orderFixture.registrations[0], athlete: { athleteProfile: { phone: null } } }],
    });
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("uma falha no envio do e-mail não impede o envio do WhatsApp", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(sendRegistrationConfirmationEmail).mockRejectedValueOnce(new Error("SMTP down"));
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");

    await notifyOrderConfirmed("order-1");

    expect(sendWhatsAppMessage).toHaveBeenCalled();
  });

  it("uma falha no envio do WhatsApp não impede o envio do e-mail", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(orderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValueOnce("open");
    vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("WhatsApp API down"));

    await expect(notifyOrderConfirmed("order-1")).resolves.toBeUndefined();
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { confirmationEmailSentAt: expect.any(Date) },
    });
  });

  const proxyOrderFixture = {
    buyerUserId: "buyer-1",
    buyer: { name: "Comprador Teste", email: "comprador@example.com", athleteProfile: { phone: "5511777777777" } },
    event: { id: "event-1", title: "Corrida Teste" },
    registrations: [
      {
        id: "reg-1",
        notes: null,
        athleteUserId: "athlete-1",
        proxyAthleteDisplayName: "Nome Digitado Pelo Comprador",
        athlete: { name: "Atleta Convidado", email: "atleta-convidado@example.com", athleteProfile: { phone: "5511888888888" } },
      },
    ],
  };

  it("procuração: manda e-mail + WhatsApp pro comprador com texto avisando quem ele inscreveu", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(proxyOrderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValue("open");

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "comprador@example.com", name: "Comprador Teste" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511777777777",
      expect.stringContaining("Você inscreveu Nome Digitado Pelo Comprador"),
      expect.anything(),
    );
  });

  it("procuração: manda e-mail + WhatsApp pro atleta com texto avisando quem criou a inscrição", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(proxyOrderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValue("open");

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "atleta-convidado@example.com", name: "Atleta Convidado" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511888888888",
      expect.stringContaining("Comprador Teste criou uma inscrição pra você"),
      expect.anything(),
    );
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(2);
  });

  it("procuração: não manda e-mail pro atleta quando o e-mail é sintético, mas manda WhatsApp normalmente", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(proxyOrderFixture);
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(getConnectionState).mockResolvedValue("open");
    vi.mocked(isPlaceholderEmail).mockReturnValue(true);

    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "comprador@example.com" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511888888888", expect.any(String), expect.anything());
  });

  it("procuração: confirmationEmailSentAt é gravado só 1x, refletindo o e-mail do comprador", async () => {
    dbMock.order.findUnique.mockResolvedValueOnce(proxyOrderFixture);

    await notifyOrderConfirmed("order-1");

    expect(dbMock.order.update).toHaveBeenCalledTimes(1);
    expect(dbMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { confirmationEmailSentAt: expect.any(Date) },
    });
  });

  // Simula a constraint única do AlertLog (alertType, entityId, channel): a primeira reivindicação
  // de uma chave específica grava normalmente, qualquer reivindicação repetida da MESMA chave
  // rejeita com P2002 (como o Postgres faria de verdade), e chaves diferentes (ex.: e-mail do
  // comprador vs. WhatsApp do comprador) não colidem entre si.
  function mockPerKeyAlertLog() {
    const claimedKeys = new Set<string>();
    dbMock.alertLog.create.mockImplementation(async ({ data }: any) => {
      const key = `${data.alertType}:${data.entityId}:${data.channel}`;
      if (claimedKeys.has(key)) {
        const err: any = new Error("Unique constraint failed");
        err.code = "P2002";
        throw err;
      }
      claimedKeys.add(key);
      return { id: `log-${key}` };
    });
  }

  it("chamar duas vezes para o mesmo orderId só envia uma vez (reivindicação de idempotência via AlertLog)", async () => {
    dbMock.order.findUnique.mockResolvedValue(orderFixture);
    mockPerKeyAlertLog();

    await notifyOrderConfirmed("order-1");
    await notifyOrderConfirmed("order-1");

    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it("bypassDedupe reenvia mesmo depois de uma reivindicação anterior bem sucedida (reenvio manual/confirmação manual)", async () => {
    dbMock.order.findUnique.mockResolvedValue(orderFixture);
    mockPerKeyAlertLog();

    await notifyOrderConfirmed("order-1");
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(1);

    // Uma 2ª chamada sem bypass continuaria bloqueada pela reivindicação da 1ª chamada...
    await notifyOrderConfirmed("order-1");
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(1);

    // ...mas com bypassDedupe (usado pelas rotas de reenvio/confirmação manual) o envio acontece
    // de novo, mesmo com a reivindicação anterior ainda em pé.
    await notifyOrderConfirmed("order-1", { bypassDedupe: true });
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledTimes(2);
  });

  it("bypassDedupe grava recordAlert (upsert em AlertLog) mesmo ignorando a reivindicação", async () => {
    dbMock.order.findUnique.mockResolvedValue(orderFixture);
    mockPerKeyAlertLog();

    await notifyOrderConfirmed("order-1", { bypassDedupe: true });

    expect(dbMock.alertLog.upsert).toHaveBeenCalledWith({
      where: { alertType_entityId_channel: { alertType: "ORDER_CONFIRMED", entityId: "order-1", channel: "EMAIL" } },
      create: { alertType: "ORDER_CONFIRMED", entityType: "Order", entityId: "order-1", channel: "EMAIL" },
      update: { sentAt: expect.any(Date) },
    });
  });
});
