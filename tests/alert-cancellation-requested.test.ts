import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendCancellationRequestedEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/alerts/alert-settings", () => ({ getCancellationAlertSettings: vi.fn() }));
vi.mock("@/lib/alerts/dedupe", () => ({ claimAlert: vi.fn(), unclaimAlert: vi.fn() }));

import { notifyCancellationRequested } from "@/lib/alerts/cancellation-requested";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendCancellationRequestedEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { getCancellationAlertSettings } from "@/lib/alerts/alert-settings";
import { claimAlert, unclaimAlert } from "@/lib/alerts/dedupe";

const dbMock = db as any;

const registrationFixture = {
  cancellationReason: "Contusão no joelho",
  athlete: { name: "Atleta Teste" },
  event: {
    id: "event-1",
    title: "Corrida Teste",
    organizer: { user: { email: "org@example.com", phone: "5511999998888" } },
  },
};

describe("notifyCancellationRequested (alerts/cancellation-requested)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSmtpReady).mockReturnValue(true);
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(claimAlert).mockResolvedValue(true);
    dbMock.user.findMany.mockResolvedValue([{ email: "admin@example.com", phone: "5511988887777" }]);
  });

  it("não faz nada quando os dois canais estão desligados", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: false });

    await notifyCancellationRequested("reg-1");

    expect(dbMock.registration.findUnique).not.toHaveBeenCalled();
  });

  it("envia e-mail para todos os admins e para o organizador do evento", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);

    await notifyCancellationRequested("reg-1");

    expect(sendCancellationRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        athleteName: "Atleta Teste",
        reason: "Contusão no joelho",
        eventId: "event-1",
      }),
    );
    expect(sendCancellationRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "org@example.com", athleteName: "Atleta Teste", eventId: "event-1" }),
    );
  });

  it("envia WhatsApp para quem tem telefone cadastrado", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);

    await notifyCancellationRequested("reg-1");

    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511988887777", expect.stringContaining("Corrida Teste"));
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999998888", expect.stringContaining("Corrida Teste"));
  });

  it("zero-regressão: texto de WhatsApp vem do template de fábrica de CANCELLATION_REQUESTED (sem mock de resolve/render, sem override no banco)", async () => {
    // Este teste NÃO mocka @/lib/templates/resolve nem @/lib/templates/render — só o db (via
    // tests/setup.ts, onde messageTemplate.findFirst já vem como vi.fn() sem implementação, ou
    // seja, resolve undefined e força o caminho real de fallback pro texto de fábrica do registry).
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: false, whatsappEnabled: true });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);

    await notifyCancellationRequested("reg-1");

    const expectedText =
      'Atleta Teste solicitou o cancelamento da inscrição em "Corrida Teste". Motivo: Contusão no joelho. Acesse o painel para aprovar ou rejeitar.';
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511988887777", expectedText);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("5511999998888", expectedText);

    // Prova que o eventId chega no resolver: getEffectiveTemplate não é mockado aqui (ver
    // comentário acima), então a única forma de confirmar o 4º argumento é observar que ele
    // repassa eventId pro lookup de override por evento em db.messageTemplate.findFirst.
    expect(dbMock.messageTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ eventId: "event-1", scope: "EVENT" }) }),
    );
  });

  it("não lança exceção quando o envio de e-mail falha", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    dbMock.registration.findUnique.mockResolvedValueOnce(registrationFixture);
    vi.mocked(sendCancellationRequestedEmail).mockRejectedValue(new Error("SMTP down"));

    await expect(notifyCancellationRequested("reg-1")).resolves.toBeUndefined();
    expect(unclaimAlert).toHaveBeenCalled();
  });

  it("não faz nada quando a inscrição não é encontrada", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: true });
    dbMock.registration.findUnique.mockResolvedValueOnce(null);

    await notifyCancellationRequested("reg-1");

    expect(sendCancellationRequestedEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("inclui cancellationRequestedAt na chave de dedupe, por destinatário", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    const requestedAt = new Date("2026-07-20T10:00:00.000Z");
    dbMock.registration.findUnique.mockResolvedValueOnce({ ...registrationFixture, cancellationRequestedAt: requestedAt });

    await notifyCancellationRequested("reg-1");

    expect(claimAlert).toHaveBeenCalledWith(
      "CANCELLATION_REQUESTED",
      "Registration",
      `reg-1:${requestedAt.toISOString()}:admin@example.com`,
      "EMAIL",
    );
  });

  it("uma segunda solicitação de cancelamento na mesma inscrição, com cancellationRequestedAt diferente, também é alertada (não é bloqueada pelo claim da primeira)", async () => {
    vi.mocked(getCancellationAlertSettings).mockResolvedValue({ emailEnabled: true, whatsappEnabled: false });
    // Mock com estado real de dedupe (chave -> já reivindicada?), pra provar que é a MUDANÇA de
    // chave (por causa do timestamp) que libera a 2ª solicitação — não apenas um mock sempre-true.
    // Com a chave antiga (sem timestamp), a 2ª chamada reusaria a mesma entityId da 1ª e seria
    // bloqueada, exatamente como no bug relatado.
    const claimedKeys = new Set<string>();
    vi.mocked(claimAlert).mockImplementation(async (_alertType: string, _entityType: string, entityId: string) => {
      if (claimedKeys.has(entityId)) return false;
      claimedKeys.add(entityId);
      return true;
    });

    const firstRequestedAt = new Date("2026-07-01T10:00:00.000Z");
    const secondRequestedAt = new Date("2026-07-20T10:00:00.000Z");

    // 1ª solicitação: claim concedido normalmente.
    dbMock.registration.findUnique.mockResolvedValueOnce({ ...registrationFixture, cancellationRequestedAt: firstRequestedAt });
    await notifyCancellationRequested("reg-1");

    // 2ª solicitação (admin rejeitou a 1ª, atleta pediu de novo): timestamp novo, claim novo,
    // mesmo que o claim da 1ª solicitação nunca tenha sido liberado.
    dbMock.registration.findUnique.mockResolvedValueOnce({ ...registrationFixture, cancellationRequestedAt: secondRequestedAt });
    await notifyCancellationRequested("reg-1");

    expect(sendCancellationRequestedEmail).toHaveBeenCalledTimes(4); // 2 destinatários x 2 solicitações
  });
});
