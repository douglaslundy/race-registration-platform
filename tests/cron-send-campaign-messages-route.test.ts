import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/whatsapp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whatsapp")>("@/lib/whatsapp");
  return {
    ...actual,
    sendWhatsAppMessage: vi.fn(),
    sendWhatsAppDocument: vi.fn(),
    buildPreferencesFooterText: () => "\n\nRODAPE",
  };
});
vi.mock("@/lib/kit-qr-code", () => ({ generateKitQrCodePng: vi.fn() }));
vi.mock("@/lib/campaigns/resolve-recipient-variables", () => ({
  resolveCampaignRecipientVariables: vi.fn().mockResolvedValue({ values: { nome_atleta: "Maria" } }),
}));
vi.mock("@/lib/campaigns/circuit-breaker", () => ({
  recordCampaignSendFailure: vi.fn().mockResolvedValue({ tripped: false, count: 1 }),
  recordCampaignSendSuccess: vi.fn(),
  isCircuitBreakerTripped: vi.fn().mockResolvedValue(false),
}));

import { POST } from "@/app/api/cron/send-campaign-messages/route";
import { sendWhatsAppMessage, sendWhatsAppDocument } from "@/lib/whatsapp";
import { generateKitQrCodePng } from "@/lib/kit-qr-code";
import { recordCampaignSendFailure, recordCampaignSendSuccess, isCircuitBreakerTripped } from "@/lib/campaigns/circuit-breaker";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";

const dbMock = db as any;
const sendMock = vi.mocked(sendWhatsAppMessage);
const sendDocumentMock = vi.mocked(sendWhatsAppDocument);
const qrMock = vi.mocked(generateKitQrCodePng);

function makeRequest() {
  return new Request("http://localhost", { method: "POST", headers: { "x-cron-secret": "test-secret" } }) as any;
}

describe("POST /api/cron/send-campaign-messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    dbMock.campaignRecipient.findFirst.mockResolvedValue(null);
    // Default: sweep de recuperação sem nenhum destinatário travado, e reivindicação bem-sucedida.
    // Testes que precisam simular uma corrida perdida sobrescrevem a 2ª chamada com mockResolvedValueOnce.
    dbMock.campaignRecipient.updateMany.mockResolvedValue({ count: 1 });
    dbMock.campaign.updateMany.mockResolvedValue({ count: 0 });
    dbMock.campaign.findMany.mockResolvedValue([]);
    // Default: atleta com consentimento e telefone — testes que precisam do caminho OPTED_OUT
    // sobrescrevem isto com mockResolvedValueOnce. Sem este default, qualquer teste que não mocka
    // explicitamente db.user.findUnique cairia sempre no ramo OPTED_OUT (valor undefined vira
    // falsy), nunca exercitando o envio/retry/falha que o teste alega testar.
    dbMock.user.findUnique.mockResolvedValue({ receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } });
  });

  it("401 sem o segredo correto", async () => {
    const res = await POST(new Request("http://localhost", { method: "POST" }) as any);
    expect(res.status).toBe(401);
  });

  it("promove campanhas SCHEDULED vencidas pra RUNNING", async () => {
    await POST(makeRequest());
    expect(dbMock.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "SCHEDULED" }), data: { status: "RUNNING" } }),
    );
  });

  it("varredura de recuperação: reseta destinatário PROCESSING antigo pra PENDING, antes de qualquer outra coisa", async () => {
    await POST(makeRequest());

    expect(dbMock.campaignRecipient.updateMany).toHaveBeenCalledWith({
      where: { status: "PROCESSING", updatedAt: { lt: expect.any(Date) } },
      data: { status: "PENDING" },
    });
  });

  it("não processa nada se o circuit breaker já disparou", async () => {
    // Nota: não mocka campaignRecipient.findFirst aqui de propósito — o circuit breaker corta o
    // fluxo ANTES da busca do candidato (passo 4), então um mockResolvedValueOnce nunca seria
    // consumido nesta chamada e vazaria (não-consumido) pro próximo teste, já que
    // vi.clearAllMocks() não limpa a fila de retornos "Once" pendentes.
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });
    vi.mocked(isCircuitBreakerTripped).mockResolvedValueOnce(true);

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
    // Só a chamada da varredura de recuperação deve ter acontecido — a reivindicação (2ª chamada
    // de updateMany, pra status: "PROCESSING") nunca é alcançada, porque o circuit breaker corta
    // o fluxo antes da busca do candidato.
    expect(dbMock.campaignRecipient.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PROCESSING" } }),
    );
  });

  it("corrida perdida: outro processo já reivindicou o candidato entre o findFirst e o updateMany", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1",
      athleteUserId: "athlete-1",
      registrationId: null,
      campaignId: "campaign-1",
      normalizedPhone: "5511999999999",
    });
    dbMock.campaignRecipient.updateMany
      .mockResolvedValueOnce({ count: 0 }) // varredura de recuperação — nada travado
      .mockResolvedValueOnce({ count: 0 }); // reivindicação perdida — outro processo já pegou esta linha

    const res = await POST(makeRequest());
    const data = await res.json();

    expect(data).toEqual({ processed: false, reason: "lost_claim_race" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalled();
  });

  it("corrida perdida: campanha foi pausada entre a seleção do candidato e a reivindicação", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1",
      athleteUserId: "athlete-1",
      registrationId: null,
      campaignId: "campaign-1",
      normalizedPhone: "5511999999999",
    });
    // A reivindicação agora TAMBÉM filtra por campaign.status === RUNNING — se a campanha foi
    // pausada manualmente bem nesse intervalo, o updateMany não encontra a linha (count: 0), mesmo
    // que o destinatário ainda esteja PENDING, fechando a janela onde 1 mensagem a mais podia sair
    // logo depois de um "Pausar".
    dbMock.campaignRecipient.updateMany
      .mockResolvedValueOnce({ count: 0 }) // varredura de recuperação
      .mockResolvedValueOnce({ count: 0 }); // reivindicação: campanha não é mais RUNNING

    const res = await POST(makeRequest());
    const data = await res.json();

    expect(dbMock.campaignRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: "rec-1", status: "PENDING", campaign: { status: "RUNNING" } },
      data: { status: "PROCESSING" },
    });
    expect(data).toEqual({ processed: false, reason: "lost_claim_race" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("envia com sucesso: marca SENT, grava sentAt/providerMessageId, zera contador de falhas", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1",
      athleteUserId: "athlete-1",
      registrationId: null,
      campaignId: "campaign-1",
      // Telefone capturado pela Fase B, deliberadamente DIFERENTE do telefone atual do atleta
      // (buscado logo abaixo) — prova que o envio usa o telefone FRESCO, não este snapshot stale.
      normalizedPhone: "5511888888888",
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } });
    dbMock.campaignRecipient.update.mockResolvedValueOnce({});
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: "rec-1", status: "PENDING", campaign: { status: "RUNNING" } },
      data: { status: "PROCESSING" },
    });
    // Usa o telefone recém-buscado (normaliza "11999999999" -> "5511999999999"), não o
    // normalizedPhone stale ("5511888888888") capturado quando a Fase B populou a lista.
    expect(sendMock).toHaveBeenCalledWith("5511999999999", expect.stringContaining("RODAPE"), "CAMPAIGN_MESSAGE");
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "SENT", providerMessageId: "wamid.1", failureReason: null }),
      }),
    );
    expect(recordCampaignSendSuccess).toHaveBeenCalled();
  });

  it("telefone atual do atleta ausente/inválido: recipiente vira INVALID_PHONE, sem enviar nem contar pro circuit breaker", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1",
      athleteUserId: "athlete-1",
      registrationId: null,
      campaignId: "campaign-1",
      normalizedPhone: "5511999999999",
    });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: true, athleteProfile: { phone: "" } });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "INVALID_PHONE" }) }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
  });

  it("falha com attempts < 3: volta pra PENDING, incrementa attempts e o contador de falhas", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha de rede"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "PENDING", attempts: 1 }) }),
    );
    expect(recordCampaignSendFailure).toHaveBeenCalled();
  });

  it("3ª falha: marca FAILED com failureReason", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 2,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha de novo"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "FAILED", attempts: 3 }) }),
    );
  });

  it("5ª falha consecutiva pausa TODAS as campanhas RUNNING", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha"));
    vi.mocked(recordCampaignSendFailure).mockResolvedValueOnce({ tripped: true, count: 5 });

    await POST(makeRequest());

    expect(dbMock.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "RUNNING" }, data: { status: "PAUSED" } }),
    );
  });

  it("erro na resolução de variáveis (antes do envio) não deixa o destinatário preso em PROCESSING", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    vi.mocked(resolveCampaignRecipientVariables).mockRejectedValueOnce(new Error("erro ao resolver variáveis"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1, failureReason: "erro ao resolver variáveis" }),
      }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
  });

  it("erro na re-checagem de consentimento (db.user.findUnique) não deixa o destinatário preso em PROCESSING", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.user.findUnique.mockRejectedValueOnce(new Error("erro ao re-checar consentimento"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1, failureReason: "erro ao re-checar consentimento" }),
      }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
  });

  it("re-checa receivePromotionalMessages no momento do envio — revogado vira OPTED_OUT sem enviar", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1",
    });
    // Nota: não mocka campaign.findFirst aqui de propósito — o ramo OPTED_OUT retorna logo após
    // db.user.findUnique, antes de db.campaign.findFirst ser chamado neste caminho. Um
    // mockResolvedValueOnce nunca seria consumido e vazaria (não-consumido) pro próximo teste, já
    // que vi.clearAllMocks() não limpa a fila de retornos "Once" pendentes.
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: false });

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "OPTED_OUT" }) }),
    );
  });

  it("persiste redesSociaisText no CampaignRecipient quando resolvido fresco, antes de tentar o envio", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: "reg-1", campaignId: "campaign-1", redesSociaisText: null,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    vi.mocked(resolveCampaignRecipientVariables).mockResolvedValueOnce({
      values: { nome_atleta: "Maria" },
      redesSociaisText: "Segue no Instagram!",
    });
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: { redesSociaisText: "Segue no Instagram!" },
    });
  });

  it("não persiste redesSociaisText quando o valor já veio cacheado (redesSociaisText undefined no retorno)", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: "reg-1", campaignId: "campaign-1", redesSociaisText: "já resolvido antes",
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    vi.mocked(resolveCampaignRecipientVariables).mockResolvedValueOnce({
      values: { nome_atleta: "Maria" },
    });
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ redesSociaisText: expect.anything() }) }),
    );
  });

  it("campanha sem mais PENDING vira COMPLETED", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce(null);
    dbMock.campaign.findMany.mockResolvedValueOnce([{ id: "campaign-1" }]);
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    await POST(makeRequest());

    expect(dbMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["RUNNING", "PAUSED"] } } }),
    );
    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "COMPLETED" } });
  });

  it("campanha PAUSED sem mais PENDING também vira COMPLETED sozinha", async () => {
    // Uma campanha pausada manualmente que já não tinha mais nada pendente (ou cujo último
    // destinatário terminou de processar logo antes da pausa) não deve ficar Pausada pra sempre —
    // vira Concluída no próximo tick, igual uma RUNNING que esvazia.
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce(null);
    dbMock.campaign.findMany.mockResolvedValueOnce([{ id: "campaign-2" }]);
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    await POST(makeRequest());

    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-2" }, data: { status: "COMPLETED" } });
  });

  it("mensagem com {{qrcode_inscricao}} envia como imagem (QR), não como texto", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: "reg-1", campaignId: "campaign-1",
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({
      id: "campaign-1", messageBody: "Seu QR: {{qrcode_inscricao}}",
    });
    qrMock.mockResolvedValueOnce(Buffer.from("fake-png"));
    dbMock.campaignRecipient.update.mockResolvedValueOnce({});

    await POST(makeRequest());

    expect(qrMock).toHaveBeenCalledWith("reg-1");
    expect(sendDocumentMock).toHaveBeenCalledWith(
      "5511999999999",
      Buffer.from("fake-png").toString("base64"),
      "qrcode-inscricao.png",
      expect.stringContaining("Seu QR:"),
      expect.objectContaining({ mediatype: "image", messageType: "CAMPAIGN_MESSAGE" }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "SENT" }) }),
    );
  });

  it("mensagem sem {{qrcode_inscricao}} continua enviando como texto normal", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: "reg-1", campaignId: "campaign-1",
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(sendDocumentMock).not.toHaveBeenCalled();
    expect(qrMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalled();
  });

  it("mensagem com {{qrcode_inscricao}} mas destinatário sem registrationId falha ANTES do envio, sem contar pro circuit breaker", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0,
    });
    dbMock.campaign.findFirst.mockResolvedValueOnce({
      id: "campaign-1", messageBody: "Seu QR: {{qrcode_inscricao}}",
    });

    await POST(makeRequest());

    expect(qrMock).not.toHaveBeenCalled();
    expect(sendDocumentMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1 }),
      }),
    );
  });
});
