import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";

const dbMock = db as any;

const athleteUser = {
  id: "athlete-1",
  name: "Maria Exemplo",
  email: "maria@exemplo.com",
  athleteProfile: {
    phone: "11988888888",
    cpf: "12345678900",
    birthDate: new Date("1990-03-15T00:00:00Z"),
    teamName: "Equipe Exemplo",
  },
};

describe("resolveCampaignRecipientVariables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("modo plataforma (registrationId null): só resolve Atleta + Plataforma, sem consultar Registration", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: null });

    expect(values.nome_atleta).toBe("Maria Exemplo");
    expect(values.primeiro_nome_atleta).toBe("Maria");
    expect(values.email_atleta).toBe("maria@exemplo.com");
    expect(values.telefone_atleta).toBe("11988888888");
    expect(values.equipe_atleta).toBe("Equipe Exemplo");
    expect(values.nome_plataforma).toBeTruthy();
    expect(values.nome_evento).toBeUndefined();
    expect(dbMock.registration.findUnique).not.toHaveBeenCalled();
  });

  it("modo evento (registrationId presente): resolve também Evento/Organizador/Inscrição", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      route: { name: "5km" },
      category: { name: "Elite" },
      event: {
        title: "Corrida Exemplo",
        description: "Descrição",
        startAt: new Date("2026-09-20T10:00:00Z"),
        venueName: "Parque Exemplo",
        city: "São Paulo",
        state: "SP",
        addressLine: "Av. Exemplo, 1000",
        slug: "corrida-exemplo",
        organizer: { companyName: "Organização Exemplo", phone: "1197777777", user: { name: "João Organizador", email: "joao@org.com" } },
      },
      order: { id: "order-1", totalAmount: 9000 },
    });

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "reg-1" });

    expect(values.nome_evento).toBe("Corrida Exemplo");
    expect(values.cidade_evento).toBe("São Paulo");
    expect(values.nome_modalidade).toBe("5km");
    expect(values.categoria_inscricao).toBe("Elite");
    expect(values.nome_organizador).toBe("João Organizador");
    expect(values.empresa_organizador).toBe("Organização Exemplo");
    expect(values.status_inscricao).toBe("Confirmada");
    expect(values.valor_inscricao).toContain("90,00");
    expect(values.codigo_confirmacao).toBe("order-1");
  });

  it("modo evento sem categoria (categoryId null): categoria_inscricao resolve para string vazia", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      route: { name: "5km" },
      category: null,
      event: {
        title: "Corrida Exemplo",
        description: "Descrição",
        startAt: new Date("2026-09-20T10:00:00Z"),
        venueName: "Parque Exemplo",
        city: "São Paulo",
        state: "SP",
        addressLine: "Av. Exemplo, 1000",
        slug: "corrida-exemplo",
        organizer: { companyName: "Organização Exemplo", phone: "1197777777", user: { name: "João Organizador", email: "joao@org.com" } },
      },
      order: { id: "order-1", totalAmount: 9000 },
    });

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "reg-1" });

    expect(values.categoria_inscricao).toBe("");
  });

  it("nunca resolve patrocinio/redes_sociais (excluídas de getAllowedCampaignVariableNames)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1", status: "CONFIRMED", createdAt: new Date(), route: null,
      event: { title: "E", description: null, startAt: new Date(), venueName: null, city: "C", state: "S", addressLine: null, slug: "e", organizer: { companyName: null, phone: null, user: { name: "Org", email: "o@o.com" } } },
      order: { id: "order-1", totalAmount: 100 },
    });

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "reg-1" });

    expect(values.patrocinio).toBeUndefined();
    expect(values.redes_sociais).toBeUndefined();
  });

  it("every allowed platform-mode variable name is resolvable in platform mode", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: null });
    const allowedNames = getAllowedCampaignVariableNames(null);
    for (const name of allowedNames) {
      expect(Object.prototype.hasOwnProperty.call(values, name)).toBe(true);
    }
  });

  it("every allowed event-mode variable name is resolvable in event mode", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      route: { name: "5km" },
      category: { name: "Elite" },
      event: {
        title: "Corrida Exemplo",
        description: "Descrição",
        startAt: new Date("2026-09-20T10:00:00Z"),
        venueName: "Parque Exemplo",
        city: "São Paulo",
        state: "SP",
        addressLine: "Av. Exemplo, 1000",
        slug: "corrida-exemplo",
        organizer: { companyName: "Organização Exemplo", phone: "1197777777", user: { name: "João Organizador", email: "joao@org.com" } },
      },
      order: { id: "order-1", totalAmount: 9000 },
    });

    const values = await resolveCampaignRecipientVariables({ athleteUserId: "athlete-1", registrationId: "r1" });
    const allowedNames = getAllowedCampaignVariableNames("event1");
    for (const name of allowedNames) {
      expect(Object.prototype.hasOwnProperty.call(values, name)).toBe(true);
    }
  });
});
