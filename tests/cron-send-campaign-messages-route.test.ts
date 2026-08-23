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

  it("não processa nada se algum destinatário já está PROCESSING (guarda contra tick sobreposto)", async () => {
    // Se o guard fosse removido, este mock faria a rota achar um destinatário PENDING elegível de
    // verdade (mesmo padrão do teste "envia com sucesso") e tentar enviar — só o guard de
    // PROCESSING impede que ela chegue lá.
    dbMock.campaignRecipient.findFirst.mockImplementation(({ where }: any) =>
      where.status === "PROCESSING"
        ? Promise.resolve({ id: "stuck" })
        : Promise.resolve({
            id: "rec-1",
            athleteUserId: "athlete-1",
            registrationId: null,
            campaignId: "campaign-1",
            normalizedPhone: "5511999999999",
          }),
    );
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING" }) }),
    );
  });

  it("não processa nada se o circuit breaker já disparou", async () => {
    // Se o guard fosse removido, a rota seguiria pro passo 4 (busca de PENDING) e acharia um
    // destinatário elegível de verdade — só a checagem do circuit breaker impede que ela chegue
    // lá. Usa mockImplementation (não Once) pra não deixar valor de retorno não-consumido na fila,
    // já que a checagem de PENDING nunca é de fato alcançada com o guard no lugar.
    dbMock.campaignRecipient.findFirst.mockImplementation(({ where }: any) =>
      where.status === "PROCESSING"
        ? Promise.resolve(null)
        : Promise.resolve({
            id: "rec-1",
            athleteUserId: "athlete-1",
            registrationId: null,
            campaignId: "campaign-1",
            normalizedPhone: "5511999999999",
          }),
    );
    dbMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });
    vi.mocked(isCircuitBreakerTripped).mockResolvedValueOnce(true);

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSING" }) }),
    );
  });

  it("envia com sucesso: marca SENT, grava sentAt/providerMessageId, zera contador de falhas", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null) // guarda PROCESSING
      .mockResolvedValueOnce({
        id: "rec-1",
        athleteUserId: "athlete-1",
        registrationId: null,
        campaignId: "campaign-1",
        // Telefone capturado pela Fase B, deliberadamente DIFERENTE do telefone atual do atleta
        // (buscado logo abaixo) — prova que o envio usa o telefone FRESCO, não este snapshot stale.
        normalizedPhone: "5511888888888",
      }); // próximo PENDING
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá {{nome_atleta}}" });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: true, athleteProfile: { phone: "11999999999" } });
    dbMock.campaignRecipient.update.mockResolvedValueOnce({});
    sendMock.mockResolvedValueOnce({ providerMessageId: "wamid.1" });

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PROCESSING" }),
      }),
    );
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
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
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
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0 });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha de rede"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "PENDING", attempts: 1 }) }),
    );
    expect(recordCampaignSendFailure).toHaveBeenCalled();
  });

  it("3ª falha: marca FAILED com failureReason", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 2 });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha de novo"));

    await POST(makeRequest());

    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "FAILED", attempts: 3 }) }),
    );
  });

  it("5ª falha consecutiva pausa TODAS as campanhas RUNNING", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0 });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    sendMock.mockRejectedValueOnce(new Error("falha"));
    vi.mocked(recordCampaignSendFailure).mockResolvedValueOnce({ tripped: true, count: 5 });

    await POST(makeRequest());

    expect(dbMock.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "RUNNING" }, data: { status: "PAUSED" } }),
    );
  });

  it("erro na resolução de variáveis (antes do envio) não deixa o destinatário preso em PROCESSING", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0 });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    vi.mocked(resolveCampaignRecipientVariables).mockRejectedValueOnce(new Error("erro ao resolver variáveis"));

    await POST(makeRequest());

    // A marcação inicial como PROCESSING (guarda contra tick sobreposto) acontece normalmente,
    // mas o destinatário NÃO pode ficar preso nela: precisa haver uma atualização subsequente
    // seguindo a mesma lógica de retry (PENDING+attempts) que uma falha de envio já seguiria.
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1, failureReason: "erro ao resolver variáveis" }),
      }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    // Falha PRÉ-envio (resolução de variáveis) — não deve contar pro circuit breaker global, só uma
    // falha de envio real deve.
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
  });

  it("erro na re-checagem de consentimento (db.user.findUnique) não deixa o destinatário preso em PROCESSING", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1", attempts: 0 });
    dbMock.user.findUnique.mockRejectedValueOnce(new Error("erro ao re-checar consentimento"));

    await POST(makeRequest());

    // Mesma lógica de retry que uma falha de envio ou de resolução de variáveis já segue — a
    // consulta de consentimento agora vive dentro do try, então uma exceção aqui cai no mesmo
    // catch (PENDING+attempts / FAILED / circuit breaker), em vez de deixar o destinatário preso
    // em PROCESSING para sempre.
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rec-1" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1, failureReason: "erro ao re-checar consentimento" }),
      }),
    );
    expect(sendMock).not.toHaveBeenCalled();
    // Falha PRÉ-envio (re-checagem de consentimento) — não deve contar pro circuit breaker global.
    expect(recordCampaignSendFailure).not.toHaveBeenCalled();
  });

  it("re-checa receivePromotionalMessages no momento do envio — revogado vira OPTED_OUT sem enviar", async () => {
    dbMock.campaignRecipient.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "rec-1", athleteUserId: "athlete-1", registrationId: null, campaignId: "campaign-1" });
    dbMock.campaign.findFirst.mockResolvedValueOnce({ id: "campaign-1", messageBody: "Olá" });
    dbMock.user.findUnique.mockResolvedValueOnce({ receivePromotionalMessages: false });

    await POST(makeRequest());

    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.campaignRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rec-1" }, data: expect.objectContaining({ status: "OPTED_OUT" }) }),
    );
  });

  it("campanha sem mais PENDING vira COMPLETED", async () => {
    dbMock.campaignRecipient.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    dbMock.campaign.findMany.mockResolvedValueOnce([{ id: "campaign-1" }]);
    dbMock.campaignRecipient.count.mockResolvedValueOnce(0);

    await POST(makeRequest());

    expect(dbMock.campaign.update).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "COMPLETED" } });
  });
});
