import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({
  getSmtpConfig: vi.fn(),
  isSmtpReady: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendDailySummaryEmail: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(),
}));
vi.mock("@/lib/alerts/dedupe", () => ({
  claimAlert: vi.fn(),
  unclaimAlert: vi.fn(),
}));
vi.mock("@/lib/alerts/daily-summary-metrics", () => ({
  getAdminDailySummary: vi.fn(),
  getOrganizerDailySummary: vi.fn(),
}));

import {
  getYesterdayBrasiliaWindow,
  sendAdminDailySummaries,
  sendOrganizerDailySummaries,
} from "@/lib/alerts/daily-summary";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendDailySummaryEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";
import { getAdminDailySummary, getOrganizerDailySummary } from "@/lib/alerts/daily-summary-metrics";
import { formatCurrency } from "@/lib/format";

const dbMock = db as any;

const dayStart = new Date("2026-07-12T03:00:00.000Z");
const dayEnd = new Date("2026-07-13T03:00:00.000Z");

const adminMetricsFixture = {
  newUsersCount: 5,
  newOrganizersCount: 1,
  eventsCreatedCount: 2,
  paidRegistrationsCount: 10,
  grossRevenue: 100000,
  platformFeeAmount: 3000,
  serviceFeeAmount: 2000,
  payoutsGeneratedCount: 1,
  payoutsGeneratedAmount: 90000,
  cancelledOrRefundedCount: 3,
};

const organizerMetricsFixture = {
  paidRegistrationsCount: 4,
  grossRevenue: 40000,
  couponsUsedCount: 2,
  cancellationsRequestedCount: 1,
  soldOutBatchesCount: 0,
};

describe("getYesterdayBrasiliaWindow", () => {
  it("calcula o dia anterior completo no horário de Brasília (UTC-3 fixo)", () => {
    const { dayStart, dayEnd } = getYesterdayBrasiliaWindow(new Date("2026-07-13T10:00:00.000Z"));
    expect(dayStart).toEqual(new Date("2026-07-12T03:00:00.000Z"));
    expect(dayEnd).toEqual(new Date("2026-07-13T03:00:00.000Z"));
  });
});

describe("sendAdminDailySummaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    vi.mocked(getAdminDailySummary).mockResolvedValue(adminMetricsFixture);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValue([]);
  });

  it("envia e-mail e whatsapp quando o admin tem os dois canais habilitados", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
      },
    ]);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "ADMIN", active: true } }));
    expect(sendDailySummaryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin1@example.com", role: "ADMIN" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("pula os dois canais quando o admin desligou ambos", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: false,
      },
    ]);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("não reenvia quando o dia já foi reivindicado por outra execução (dedupe)", async () => {
    vi.mocked(claimAlert).mockResolvedValue(false);
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
      },
    ]);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("uma falha em um admin não impede o envio para os demais", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: false },
      { id: "admin-2", email: "admin2@example.com", phone: null, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: false },
    ]);
    vi.mocked(sendDailySummaryEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  it("libera o claim de e-mail quando o envio falha, para permitir nova tentativa depois", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: false },
    ]);
    vi.mocked(sendDailySummaryEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(unclaimAlert).toHaveBeenCalledWith("DAILY_SUMMARY", "2026-07-12:admin-1", "EMAIL");
    expect(result).toEqual({ sent: 0, failed: 1 });
  });

  it("libera o claim de whatsapp quando o envio falha, para permitir nova tentativa depois", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: "5511999999999", dailySummaryEmailEnabled: false, dailySummaryWhatsappEnabled: true },
    ]);
    vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("WhatsApp API down"));

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(unclaimAlert).toHaveBeenCalledWith("DAILY_SUMMARY", "2026-07-12:admin-1", "WHATSAPP");
    expect(result).toEqual({ sent: 0, failed: 1 });
  });

  it("ainda tenta o whatsapp mesmo quando o e-mail falha para o mesmo admin", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
      },
    ]);
    vi.mocked(sendDailySummaryEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999999999", expect.any(String));
    expect(unclaimAlert).toHaveBeenCalledWith("DAILY_SUMMARY", "2026-07-12:admin-1", "EMAIL");
    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  it("envia para destinatários extras cadastrados (e-mail e whatsapp)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: false, dailySummaryWhatsappEnabled: false },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "recipient-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
      { id: "recipient-2", name: "João", type: "WHATSAPP", value: "11999999999" },
    ]);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "admin-1" } }),
    );
    expect(sendDailySummaryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "maria@example.com", role: "ADMIN" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("11999999999", expect.any(String));
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("não reenvia pra um destinatário extra quando o dia já foi reivindicado (dedupe independente)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: false, dailySummaryWhatsappEnabled: false },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "recipient-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
    ]);
    vi.mocked(claimAlert).mockResolvedValue(false);

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("falha em um destinatário extra não impede os demais nem o destinatário principal", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      { id: "admin-1", email: "admin1@example.com", phone: null, dailySummaryEmailEnabled: true, dailySummaryWhatsappEnabled: false },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "recipient-1", name: "Maria", type: "EMAIL", value: "maria@example.com" },
      { id: "recipient-2", name: "João", type: "WHATSAPP", value: "11999999999" },
    ]);
    vi.mocked(sendDailySummaryEmail)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("11999999999", expect.any(String));
    expect(unclaimAlert).toHaveBeenCalledWith("DAILY_SUMMARY", "2026-07-12:recipient:recipient-1", "EMAIL");
    expect(result).toEqual({ sent: 2, failed: 1 });
  });

  it("envia o texto exato do WhatsApp para admin (zero-regressão, sem mockar resolve/render)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: true,
      },
    ]);

    await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      `Resumo de ontem: 10 inscrições pagas, ${formatCurrency(100000)} em receita bruta, 5 novos usuários, 2 eventos criados. Veja mais em /admin.`,
    );
  });

  it("um template customizado que referencia {{data_resumo}} e {{papel_destinatario}} (antes não supridos) renderiza os dois, não em branco", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin1@example.com",
        phone: "5511999999999",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: true,
      },
    ]);
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: null,
      body: "Resumo de {{data_resumo}} para {{papel_destinatario}}: {{total_inscricoes_pagas}} inscrições.",
    });

    await sendAdminDailySummaries(dayStart, dayEnd);

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511999999999",
      "Resumo de 12/07/2026 para administrador: 10 inscrições.",
    );
  });
});

describe("sendOrganizerDailySummaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    vi.mocked(getOrganizerDailySummary).mockResolvedValue(organizerMetricsFixture);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValue([]);
  });

  it("busca apenas organizadores ativos com organizerProfile existente", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([]);

    await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ORGANIZER", active: true, organizerProfile: { isNot: null } } }),
    );
  });

  it("usa o organizerProfile.id para escopar as métricas e o telefone do perfil de organizador para o whatsapp", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { id: "org-1", phone: "5511988888888" },
      },
    ]);

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(getOrganizerDailySummary).toHaveBeenCalledWith("org-1", dayStart, dayEnd);
    expect(sendDailySummaryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "organizador@example.com", role: "ORGANIZER" }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511988888888", expect.any(String));
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it("pula o whatsapp quando o perfil de organizador não tem telefone", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { id: "org-1", phone: null },
      },
    ]);

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0 });
  });

  it("libera o claim de e-mail quando o envio falha, para permitir nova tentativa depois", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: false,
        organizerProfile: { id: "org-1", phone: null },
      },
    ]);
    vi.mocked(sendDailySummaryEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(unclaimAlert).toHaveBeenCalledWith("DAILY_SUMMARY", "2026-07-12:org-user-1", "EMAIL");
    expect(result).toEqual({ sent: 0, failed: 1 });
  });

  it("libera o claim de whatsapp quando o envio falha, para permitir nova tentativa depois", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { id: "org-1", phone: "5511988888888" },
      },
    ]);
    vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error("WhatsApp API down"));

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(unclaimAlert).toHaveBeenCalledWith("DAILY_SUMMARY", "2026-07-12:org-user-1", "WHATSAPP");
    expect(result).toEqual({ sent: 0, failed: 1 });
  });

  it("ainda tenta o whatsapp mesmo quando o e-mail falha para o mesmo organizador", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: true,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { id: "org-1", phone: "5511988888888" },
      },
    ]);
    vi.mocked(sendDailySummaryEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(sendDailySummaryEmail).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511988888888", expect.any(String));
    expect(unclaimAlert).toHaveBeenCalledWith("DAILY_SUMMARY", "2026-07-12:org-user-1", "EMAIL");
    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  it("envia para destinatários extras cadastrados pelo organizador, adicionando o código do país no whatsapp", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: false,
        organizerProfile: { id: "org-1", phone: null },
      },
    ]);
    dbMock.dailySummaryRecipient.findMany.mockResolvedValueOnce([
      { id: "recipient-3", name: "Pedro", type: "WHATSAPP", value: "21988887777" },
    ]);

    const result = await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(dbMock.dailySummaryRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "org-user-1" } }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("21988887777", expect.any(String));
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it("envia o texto exato do WhatsApp para organizador (zero-regressão, sem mockar resolve/render)", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { id: "org-1", phone: "5511988888888" },
      },
    ]);

    await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      `Resumo de ontem: 4 inscrições pagas, ${formatCurrency(40000)} em receita, 2 cupons usados. Veja mais em /organizador.`,
    );
  });

  it("um template customizado que referencia {{data_resumo}} e {{papel_destinatario}} (antes não supridos) renderiza os dois, não em branco", async () => {
    dbMock.user.findMany.mockResolvedValueOnce([
      {
        id: "org-user-1",
        email: "organizador@example.com",
        dailySummaryEmailEnabled: false,
        dailySummaryWhatsappEnabled: true,
        organizerProfile: { id: "org-1", phone: "5511988888888" },
      },
    ]);
    dbMock.messageTemplate.findFirst.mockResolvedValueOnce({
      subject: null,
      body: "Resumo de {{data_resumo}} para {{papel_destinatario}}: {{total_inscricoes_pagas}} inscrições.",
    });

    await sendOrganizerDailySummaries(dayStart, dayEnd);

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      "5511988888888",
      "Resumo de 12/07/2026 para organizador: 4 inscrições.",
    );
  });
});
