import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { PUT } from "@/app/api/athlete/profile/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/athlete/profile", {
    method: "PUT",
    body: JSON.stringify(body),
  }) as any;
}

describe("PUT /api/athlete/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "athlete-1", role: "ATHLETE" } } as any);
  });

  it("retorna 401 quando não autenticado", async () => {
    authMock.mockResolvedValueOnce(null as any);
    const res = await PUT(makeRequest({ cpf: "111.444.777-35" }));
    expect(res.status).toBe(401);
  });

  it("salva um CPF válido quando ainda não há CPF salvo", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce(null);
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({ cpf: "11144477735" });

    const res = await PUT(makeRequest({ cpf: "111.444.777-35" }));

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "athlete-1" },
        update: expect.objectContaining({ cpf: "11144477735" }),
      }),
    );
  });

  it("rejeita CPF com dígito verificador inválido", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });

    const res = await PUT(makeRequest({ cpf: "111.444.777-36" }));

    expect(res.status).toBe(400);
    expect(dbMock.athleteProfile.upsert).not.toHaveBeenCalled();
  });

  it("rejeita CPF já usado por outra conta", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: null });
    dbMock.athleteProfile.findFirst.mockResolvedValueOnce({ id: "outro-perfil" });

    const res = await PUT(makeRequest({ cpf: "111.444.777-35" }));

    expect(res.status).toBe(409);
    expect(dbMock.athleteProfile.upsert).not.toHaveBeenCalled();
  });

  it("ignora tentativa de alterar CPF já salvo, sem erro, mas salva os demais campos", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: "11144477735" });
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({ cpf: "11144477735" });

    const res = await PUT(makeRequest({ cpf: "222.222.222-22", phone: "11999998888" }));

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({ cpf: expect.anything() }),
      }),
    );
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ phone: "11999998888" }),
      }),
    );
  });

  it("não sobrescreve birthDate já salvo quando o campo é omitido do corpo da requisição", async () => {
    dbMock.athleteProfile.findUnique.mockResolvedValueOnce({ cpf: "11144477735" });
    dbMock.athleteProfile.upsert.mockResolvedValueOnce({ cpf: "11144477735" });

    const res = await PUT(makeRequest({ cpf: "111.444.777-35" }));

    expect(res.status).toBe(200);
    expect(dbMock.athleteProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({ birthDate: expect.anything() }),
      }),
    );
  });
});
