import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "hashed-password") },
}));
vi.mock("@/lib/validate-email-domain", () => ({ hasValidMxRecord: vi.fn() }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn() };
});

import { POST } from "@/app/api/auth/register/route";
import { hasValidMxRecord } from "@/lib/validate-email-domain";
import { checkRateLimit } from "@/lib/rate-limit";

const dbMock = db as any;
const rateLimitMock = vi.mocked(checkRateLimit);

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

const validAthleteBody = {
  name: "Atleta Teste",
  email: "atleta@example.com",
  password: "12345678",
  role: "ATHLETE",
  birthDate: "1990-01-01",
  cpf: "111.444.777-35",
  phone: "11999999999",
  postalCode: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 9 });
    vi.mocked(hasValidMxRecord).mockResolvedValue(true);
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.athleteProfile.findFirst.mockResolvedValue(null);
    dbMock.user.create.mockResolvedValue({
      id: "user-1",
      name: "Atleta Teste",
      email: "atleta@example.com",
      role: "ATHLETE",
    });
  });

  it("rejeita cadastro de atleta sem CPF", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.cpf;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem telefone", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.phone;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita telefone com menos de 10 dígitos", async () => {
    const res = await POST(makeRequest({ ...validAthleteBody, phone: "1199999" }));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita CPF com dígito verificador inválido", async () => {
    const res = await POST(makeRequest({ ...validAthleteBody, cpf: "111.444.777-36" }));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita CPF já cadastrado em outra conta", async () => {
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce({ id: "profile-existente" });

    const res = await POST(makeRequest(validAthleteBody));

    expect(res.status).toBe(409);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("cria o atleta e o perfil com CPF normalizado quando os dados são válidos", async () => {
    const res = await POST(makeRequest(validAthleteBody));

    expect(res.status).toBe(201);
    expect(dbMock.athleteProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          cpf: "11144477735",
          phone: "11999999999",
        }),
      }),
    );
  });

  it("não exige CPF para cadastro de organizador", async () => {
    dbMock.user.create.mockResolvedValueOnce({
      id: "user-2",
      name: "Organizador Teste",
      email: "organizador@example.com",
      role: "ORGANIZER",
    });

    const res = await POST(
      makeRequest({
        name: "Organizador Teste",
        email: "organizador@example.com",
        password: "12345678",
        role: "ORGANIZER",
      }),
    );

    expect(res.status).toBe(201);
    expect(dbMock.athleteProfile.create).not.toHaveBeenCalled();
  });

  it("retorna 429 e não cria o usuário quando o limite de tentativas é excedido", async () => {
    rateLimitMock.mockReturnValue({ allowed: false, remaining: 0 });

    const res = await POST(makeRequest(validAthleteBody));

    expect(res.status).toBe(429);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita e-mail cujo domínio não tem registro MX", async () => {
    vi.mocked(hasValidMxRecord).mockResolvedValueOnce(false);

    const res = await POST(makeRequest(validAthleteBody));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem CEP", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.postalCode;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita CEP com formato inválido", async () => {
    const res = await POST(makeRequest({ ...validAthleteBody, postalCode: "123" }));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem rua/logradouro", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.street;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem número", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.number;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem bairro", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.neighborhood;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem cidade", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.city;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("rejeita cadastro de atleta sem estado", async () => {
    const body: Record<string, unknown> = { ...validAthleteBody };
    delete body.state;
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    expect(dbMock.user.create).not.toHaveBeenCalled();
  });

  it("aceita 'S/N' como número (endereço sem numeração)", async () => {
    const res = await POST(makeRequest({ ...validAthleteBody, number: "S/N" }));

    expect(res.status).toBe(201);
    expect(dbMock.athleteProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ number: "S/N" }) }),
    );
  });

  it("cria o perfil com o endereço completo e o CEP normalizado", async () => {
    const res = await POST(makeRequest({
      ...validAthleteBody,
      postalCode: "01310100",
    }));

    expect(res.status).toBe(201);
    expect(dbMock.athleteProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postalCode: "01310-100",
          street: "Avenida Paulista",
          number: "1000",
          neighborhood: "Bela Vista",
          city: "São Paulo",
          state: "SP",
        }),
      }),
    );
  });
});
