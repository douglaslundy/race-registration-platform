import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/whatsapp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whatsapp")>("@/lib/whatsapp");
  return {
    ...actual,
    sendWhatsAppMessage: vi.fn(),
    buildPreferencesFooterText: () => "\n\nRODAPE",
  };
});
vi.mock("@/lib/campaigns/resolve-recipient-variables", () => ({
  resolveCampaignRecipientVariables: vi.fn().mockResolvedValue({ nome_atleta: "Maria" }),
}));
vi.mock("@/lib/campaigns/circuit-breaker", () => ({
  recordCampaignSendFailure: vi.fn().mockResolvedValue({ tripped: false, count: 1 }),
  recordCampaignSendSuccess: vi.fn(),
  isCircuitBreakerTripped: vi.fn().mockResolvedValue(false),
}));

import { POST } from "@/app/api/cron/send-campaign-messages/route";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { recordCampaignSendFailure, recordCampaignSendSuccess, isCircuitBreakerTripped } from "@/lib/campaigns/circuit-breaker";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";

const dbMock = db as any;
const sendMock = vi.mocked(sendWhatsAppMessage);

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
      where: { id: "rec-1", status: "PENDING" },
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
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: false });

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "OPTED_OUT" }) }),
    );
  });

  it("campanha sem mais PENDING vira COMPLETED", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce(null);
    dbMock.campaign.findMany.mockResolvedValueOnce([{ id: "campaign-1" }]);
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    await POST(makeRequest());

    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "COMPLETED" } });
  });
});
