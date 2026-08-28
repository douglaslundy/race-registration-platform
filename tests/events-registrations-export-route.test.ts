import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import ExcelJS from "exceljs";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { GET } from "@/app/api/events/[id]/registrations/route";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(query = "format=csv") {
  return new Request(`http://localhost/api/events/event-1/registrations?${query}`) as any;
}

const fullRegistration = {
  athlete: {
    name: "Ana Silva",
    athleteProfile: { birthDate: new Date("1990-03-15T12:00:00.000Z"), gender: "Feminino", city: "São Paulo" },
  },
  route: { name: "10km" },
  category: { name: "Adulto" },
  teamName: "Equipe Exemplo",
  emergencyContactName: "Carlos Silva",
  emergencyContactPhone: "11988887777",
  medicalNotes: "Alérgica a dipirona",
};

// Evento em 2026-09-20 -> Ana (nasc. 15/03/1990) já fez aniversário no ano, então idade = 36.
const eventFixture = { id: "event-1", startAt: new Date("2026-09-20T10:00:00.000Z") };

describe("GET /api/events/[id]/registrations (export csv/xlsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "organizer-1", role: "ORGANIZER" } } as any);
    dbMock.organizerProfile.findUnique.mockResolvedValue({ id: "org-1" });
    dbMock.event.findFirst.mockResolvedValue(eventFixture);
  });

  it("CSV: inclui as 10 colunas pedidas (com Idade calculada na data do evento), na ordem certa, com BOM UTF-8", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([fullRegistration]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    // BOM UTF-8 em bytes crus (EF BB BF) — a checagem tem que ser nos bytes da resposta, não no
    // texto decodificado por res.text()/TextDecoder, que já remove o BOM ao decodificar (é assim
    // que o próprio navegador/Excel reconhece "isto é UTF-8" e não deve reaparecer como caractere).
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await res.text();

    expect(csv.split("\r\n")[0]).toBe(
      '"Nome","Data de Nascimento","Idade","Sexo","Equipe","Categoria","Cidade","Percurso","Contato de Emergência","Alergias"',
    );
    expect(csv).toContain('"Ana Silva","15/03/1990","36","Feminino","Equipe Exemplo","Adulto","São Paulo","10km","Carlos Silva — 11988887777","Alérgica a dipirona"');
    expect(csv).not.toContain("Email");
    expect(csv).not.toContain("CPF");
  });

  it("CSV: usa string vazia quando o atleta não tem perfil/rota/categoria", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([
      {
        athlete: { name: "Bruno Costa", athleteProfile: null },
        route: null,
        category: null,
        teamName: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        medicalNotes: null,
      },
    ]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    const csv = await res.text();

    expect(csv).toContain('"Bruno Costa","","","","","","","","",""');
  });

  it("XLSX: gera um workbook válido com as mesmas 10 colunas (Idade calculada na data do evento) e o content-type correto", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([fullRegistration]);

    const res = await GET(makeRequest("format=xlsx"), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Inscritos")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Nome");
    expect(sheet.getRow(1).getCell(3).value).toBe("Idade");
    expect(sheet.getRow(2).getCell(1).value).toBe("Ana Silva");
    expect(sheet.getRow(2).getCell(3).value).toBe("36");
    expect(sheet.getRow(2).getCell(7).value).toBe("São Paulo");
  });

  it("retorna 403 sem a permissão", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "u1", role: "ATHLETE" } } as any);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });
    expect(res.status).toBe(403);
    expect(dbMock.registration.findMany).not.toHaveBeenCalled();
  });

  it("admin titular vê inscritos de qualquer evento (bypass)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } } as any);
    dbMock.event.findUnique.mockResolvedValueOnce({ id: "event-9", startAt: new Date("2026-09-20T10:00:00.000Z") });
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
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce({ id: "perm-1" });
    dbMock.user.findUnique.mockResolvedValueOnce({ createdBy: { role: "ORGANIZER", organizerProfile: { id: "org-1" } } });
    dbMock.event.findFirst.mockResolvedValueOnce(eventFixture);
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(200);
  });

  it("assistente sem a permissão é barrado com 403", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "assistant-1", role: "ASSISTANT" } } as any);
    dbMock.assistantPermission.findFirst.mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "event-1" }) });

    expect(res.status).toBe(403);
    expect(dbMock.event.findFirst).not.toHaveBeenCalled();
    expect(dbMock.event.findUnique).not.toHaveBeenCalled();
  });

  it("filtra por status quando o parâmetro status é passado", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await GET(makeRequest("format=csv&status=CONFIRMED"), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1", status: "CONFIRMED" } }),
    );
  });

  it("ignora um valor de status desconhecido (sem filtrar)", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await GET(makeRequest("format=csv&status=NAO_EXISTE"), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "event-1" } }),
    );
  });

  it("respeita percurso + categoria + busca combinados — mesma fonte de verdade da tela de inscritos", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await GET(
      makeRequest("format=csv&routeId=route-1&categoryId=cat-1&q=maria"),
      { params: Promise.resolve({ id: "event-1" }) },
    );

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventId: "event-1",
          routeId: "route-1",
          categoryId: "cat-1",
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it("XLSX também respeita os mesmos filtros que o CSV", async () => {
    dbMock.registration.findMany.mockResolvedValueOnce([]);

    await GET(makeRequest("format=xlsx&ticketBatchId=batch-1"), { params: Promise.resolve({ id: "event-1" }) });

    expect(dbMock.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ eventId: "event-1", ticketBatchId: "batch-1" }) }),
    );
  });
});
