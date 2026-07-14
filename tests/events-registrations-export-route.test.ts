import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/events/[id]/registrations/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest() {
  return new Request("http://localhost/api/events/event-1/registrations?format=csv") as any;
}

describe("GET /api/events/[id]/registrations?format=csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValue({ id: "event-1" });
  });

  it("inclui a coluna CPF e Observação no cabeçalho e os valores nas linhas", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        athlete: { name: "Ana Silva", email: "ana@example.com", athleteProfile: { cpf: "11144477735" } },
        route: { name: "10km" },
        category: null,
        ticketBatch: { name: "Lote 1", priceAmount: 5000 },
        shirtSize: "M",
        teamName: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: "Chegarei atrasado",
        status: "CONFIRMED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const csv = await res.text();

    expect(csv.split("\n")[0]).toBe(
      "Nome,Email,CPF,Percurso,Categoria,Lote,Camisa,Equipe,Contato de Emergência,Telefone de Emergência,Observação,Status,Data",
    );
    expect(csv).toContain('"Ana Silva","ana@example.com","11144477735",');
    expect(csv).toContain('"Chegarei atrasado","CONFIRMED"');
  });

  it("usa string vazia quando o atleta ainda não tem CPF cadastrado", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        athlete: { name: "Bruno Costa", email: "bruno@example.com", athleteProfile: null },
        route: null,
        category: null,
        ticketBatch: { name: "Lote 1", priceAmount: 5000 },
        shirtSize: null,
        teamName: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        notes: null,
        status: "PENDING_PAYMENT",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const csv = await res.text();

    expect(csv).toContain('"Bruno Costa","bruno@example.com","",');
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
  });

  it("admin titular vê inscritos de qualquer evento (bypass)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-9" });
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    const res = await GET(
      new Request("http://localhost/api/events/event-9/registrations?format=csv") as any,
      { params: Promise.resolve({ id: "event-9" }) },
    );

    expect(dbMock.event.findUnique).toHaveBeenCalledWith({ where: { id: "event-9" } });
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("assistente de organizador com a permissão vê inscritos do evento do criador", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce({ id: "event-1" });
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findUnique.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(dbMock.event.findUnique).not.toHaveBeenCalled();
  });
});
