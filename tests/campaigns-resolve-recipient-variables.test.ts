import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resolveCampaignRecipientVariables } from "@/lib/campaigns/resolve-recipient-variables";
import { getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";
import { getSponsorPromoText } from "@/lib/event-sponsors";
import { getSocialPromoText } from "@/lib/event-social-links";

vi.mock("@/lib/event-sponsors", () => ({ getSponsorPromoText: vi.fn() }));
vi.mock("@/lib/event-social-links", () => ({ getSocialPromoText: vi.fn() }));

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

// Snapshot da inscrição — a fonte de verdade das variáveis de identidade em campanha de evento.
const registrationSnapshot = {
  participantName: "Snap Atleta",
  participantEmail: "snap@inscricao.com",
  participantPhone: "11970000000",
  participantCpf: "98765432100",
  participantBirthDate: new Date("1985-07-20T00:00:00Z"),
};

describe("resolveCampaignRecipientVariables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("modo plataforma (registrationId null): só resolve Atleta + Plataforma, sem consultar Registration", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);

    const { values } = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: null,
      messageBody: "Olá {{nome_atleta}}!",
    });

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
      bibNumber: "1234",
      teamName: "Equipe Teste",
      ...registrationSnapshot,
      route: { name: "5km", distanceKm: 5 },
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

    const { values } = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      messageBody: "Olá {{nome_atleta}}!",
    });

    // Identidade vem do snapshot da inscrição, não do perfil atual (athleteUser).
    expect(values.nome_atleta).toBe("Snap Atleta");
    expect(values.primeiro_nome_atleta).toBe("Snap");
    expect(values.email_atleta).toBe("snap@inscricao.com");
    expect(values.telefone_atleta).toBe("11970000000");
    expect(values.documento_atleta).toBe("98765432100");
    expect(values.equipe_atleta).toBe("Equipe Teste");
    expect(values.nome_evento).toBe("Corrida Exemplo");
    expect(values.cidade_evento).toBe("São Paulo");
    expect(values.nome_modalidade).toBe("5km");
    expect(values.categoria_inscricao).toBe("Elite");
    expect(values.nome_organizador).toBe("João Organizador");
    expect(values.empresa_organizador).toBe("Organização Exemplo");
    expect(values.status_inscricao).toBe("Confirmada");
    expect(values.valor_inscricao).toContain("90,00");
    expect(values.codigo_confirmacao).toBe("order-1");
    expect(values.numero_peito).toBe("1234");
    expect(values.equipe_inscricao).toBe("Equipe Teste");
    expect(values.distancia_percurso).toBe("5 km");
    expect(values.qrcode_inscricao).toBe("");
    expect(values.patrocinio).toBe("");
    expect(values.redes_sociais).toBe("");
  });

  it("nome_atleta/telefone_atleta/documento_atleta vêm do participant* da inscrição do recipient, não do perfil", async () => {
    // user mock traz nome/telefone/cpf DIFERENTES do snapshot — o snapshot deve vencer.
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      bibNumber: "1234",
      teamName: "Equipe Snap",
      ...registrationSnapshot,
      route: { name: "5km", distanceKm: 5 },
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

    const { values } = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      messageBody: "Olá {{nome_atleta}}!",
    });

    expect(values.nome_atleta).toBe("Snap Atleta");
    expect(values.telefone_atleta).toBe("11970000000");
    expect(values.documento_atleta).toBe("98765432100");
    expect(values.equipe_atleta).toBe("Equipe Snap");
  });

  it("telefone_atleta / documento_atleta ficam vazios quando o participant* correspondente é null", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      bibNumber: null,
      teamName: null,
      participantName: "Só Nome",
      participantEmail: "so@nome.com",
      participantPhone: null,
      participantCpf: null,
      participantBirthDate: null,
      route: null,
      category: null,
      event: {
        title: "Corrida", description: null, startAt: new Date("2026-06-01T07:00:00Z"),
        venueName: null, city: "São Paulo", state: "SP", addressLine: null, slug: "corrida",
        organizer: { companyName: null, phone: null, user: { name: "Org", email: "org@example.com" } },
      },
      order: null,
    });

    const { values } = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      messageBody: "Olá {{nome_atleta}}!",
    });

    expect(values.nome_atleta).toBe("Só Nome");
    expect(values.telefone_atleta).toBe("");
    expect(values.documento_atleta).toBe("");
    expect(values.data_nascimento_atleta).toBe("");
    expect(values.equipe_atleta).toBe("");
  });

  it("numero_peito/equipe_inscricao/distancia_percurso ficam vazios quando os campos correspondentes são nulos", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ name: "Maria", email: "maria@example.com", athleteProfile: null });
    dbMock.registration.findUnique.mockResolvedValueOnce({
      status: "CONFIRMED",
      createdAt: new Date("2026-01-01"),
      bibNumber: null,
      teamName: null,
      route: null,
      category: null,
      event: {
        title: "Corrida", description: null, startAt: new Date("2026-06-01T07:00:00Z"),
        venueName: null, city: "São Paulo", state: "SP", addressLine: null, slug: "corrida",
        organizer: { companyName: null, phone: null, user: { name: "Org", email: "org@example.com" } },
      },
      order: null,
    });

    const { values } = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      messageBody: "Olá {{nome_atleta}}!",
    });

    expect(values.numero_peito).toBe("");
    expect(values.equipe_inscricao).toBe("");
    expect(values.distancia_percurso).toBe("");
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

    const { values } = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      messageBody: "Olá {{nome_atleta}}!",
    });

    expect(values.categoria_inscricao).toBe("");
  });

  it("every allowed platform-mode variable name is resolvable in platform mode", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);

    const { values } = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: null,
      messageBody: "Olá {{nome_atleta}}!",
    });
    const allowedNames = getAllowedCampaignVariableNames(null);
    for (const name of allowedNames) {
      expect(Object.prototype.hasOwnProperty.call(values, name)).toBe(true);
    }
  });

  it("resolve patrocinio quando a mensagem usa {{patrocinio}}, sem cache, sem efeito colateral", async () => {
    vi.mocked(getSponsorPromoText).mockResolvedValueOnce("Patrocinador X");
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      bibNumber: "1234",
      teamName: "Equipe Teste",
      eventId: "event-1",
      route: { name: "5km", distanceKm: 5 },
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

    const result = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      messageBody: "Confira {{patrocinio}}!",
    });

    expect(getSponsorPromoText).toHaveBeenCalledWith("event-1");
    expect(result.values.patrocinio).toBe("Patrocinador X");
  });

  it("resolve redes_sociais fresco quando redesSociaisText não é informado, e retorna o valor pra ser persistido", async () => {
    vi.mocked(getSocialPromoText).mockResolvedValueOnce("Segue no Instagram!");
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      bibNumber: "1234",
      teamName: "Equipe Teste",
      eventId: "event-1",
      route: { name: "5km", distanceKm: 5 },
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

    const result = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      messageBody: "Segue {{redes_sociais}}!",
    });

    expect(getSocialPromoText).toHaveBeenCalledWith("event-1", "athlete-1", { bypassQuota: true });
    expect(result.values.redes_sociais).toBe("Segue no Instagram!");
    expect(result.redesSociaisText).toBe("Segue no Instagram!");
  });

  it("reaproveita redesSociaisText já cacheado, sem chamar getSocialPromoText de novo", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      bibNumber: "1234",
      teamName: "Equipe Teste",
      eventId: "event-1",
      route: { name: "5km", distanceKm: 5 },
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

    const result = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      redesSociaisText: "Texto já resolvido antes",
      messageBody: "Segue {{redes_sociais}}!",
    });

    expect(getSocialPromoText).not.toHaveBeenCalled();
    expect(result.values.redes_sociais).toBe("Texto já resolvido antes");
    expect(result.redesSociaisText).toBeUndefined();
  });

  it("NÃO resolve patrocinio/redes_sociais quando a mensagem não usa essas variáveis (evita queimar cota à toa)", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(athleteUser);
    dbMock.registration.findUnique.mockResolvedValueOnce({
      id: "reg-1",
      status: "CONFIRMED",
      createdAt: new Date("2026-08-01T00:00:00Z"),
      bibNumber: "1234",
      teamName: "Equipe Teste",
      eventId: "event-1",
      route: { name: "5km", distanceKm: 5 },
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

    const result = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "reg-1",
      messageBody: "Faltam 3 dias pro {{nome_evento}}!",
    });

    expect(getSponsorPromoText).not.toHaveBeenCalled();
    expect(getSocialPromoText).not.toHaveBeenCalled();
    expect(result.values.patrocinio).toBe("");
    expect(result.values.redes_sociais).toBe("");
    expect(result.redesSociaisText).toBeUndefined();
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

    const { values } = await resolveCampaignRecipientVariables({
      athleteUserId: "athlete-1",
      registrationId: "r1",
      messageBody: "Olá {{nome_atleta}}!",
    });
    const allowedNames = getAllowedCampaignVariableNames("event1");
    for (const name of allowedNames) {
      expect(Object.prototype.hasOwnProperty.call(values, name)).toBe(true);
    }
  });
});
