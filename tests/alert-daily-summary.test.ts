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
import { claimAlert } from "@/lib/alerts/dedupe";
import { getAdminDailySummary, getOrganizerDailySummary } from "@/lib/alerts/daily-summary-metrics";

const dbMock = db as any;

const dayStart = new Date("2026-07-12T03:00:00.000Z");
const dayEnd = new Date("2026-07-13T03:00:00.000Z");

const adminMetricsFixture = {
  newUsersCount: 5,
  newOrganizersCount: 1,
  eventsCreatedCount: 2,
  paidRegistrationsCount: 10,
  grossRevenue: 100000,
  platformFeesRetained: 5000,
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
});

describe("sendOrganizerDailySummaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    vi.mocked(getOrganizerDailySummary).mockResolvedValue(organizerMetricsFixture);
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
});
