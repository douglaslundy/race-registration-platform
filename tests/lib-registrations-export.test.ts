import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  REGISTRATION_EXPORT_HEADERS,
  buildRegistrationExportRows,
  buildRegistrationsCsv,
  buildRegistrationsXlsx,
} from "@/lib/registrations/export";

const eventDate = new Date("2026-09-20T10:00:00Z");

const fullRegistration = {
  athlete: {
    name: "Maria Exemplo",
    athleteProfile: { birthDate: new Date("1990-03-15T12:00:00Z"), gender: "Feminino", city: "São Paulo" },
  },
  route: { name: "10km" },
  category: { name: "Adulto" },
  teamName: "Equipe Exemplo",
  emergencyContactName: "João Exemplo",
  emergencyContactPhone: "11988887777",
  medicalNotes: "Alérgica a dipirona",
};

const emptyRegistration = {
  athlete: { name: "Atleta Sem Perfil", athleteProfile: null },
  route: null,
  category: null,
  teamName: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  medicalNotes: null,
};

describe("buildRegistrationExportRows", () => {
  it("monta a linha completa nas 10 colunas, na ordem certa, com idade calculada na data do evento", () => {
    const rows = buildRegistrationExportRows([fullRegistration], eventDate);

    expect(rows).toEqual([
      [
        "Maria Exemplo",
        "15/03/1990",
        "36",
        "Feminino",
        "Equipe Exemplo",
        "Adulto",
        "São Paulo",
        "10km",
        "João Exemplo — 11988887777",
        "Alérgica a dipirona",
      ],
    ]);
  });

  it("calcula a idade em relação à data do EVENTO, não à data de hoje", () => {
    // Aniversário em setembro (15/03 -> completa em março de cada ano). Um evento ANTES do
    // aniversário do ano corrente dá uma idade a menos do que se calculado "hoje" (bem depois do
    // aniversário) — prova que a referência realmente é eventDate, não Date.now().
    const eventBeforeBirthdayThisYear = new Date("2026-02-01T00:00:00Z");

    const rows = buildRegistrationExportRows([fullRegistration], eventBeforeBirthdayThisYear);

    expect(rows[0][2]).toBe("35");
  });

  it("preenche com string vazia (idade incluída) quando os campos são nulos (perfil ausente, sem rota/categoria)", () => {
    const rows = buildRegistrationExportRows([emptyRegistration], eventDate);

    expect(rows).toEqual([["Atleta Sem Perfil", "", "", "", "", "", "", "", "", ""]]);
  });

  it("combina só o nome do contato de emergência quando não há telefone", () => {
    const rows = buildRegistrationExportRows(
      [{ ...emptyRegistration, emergencyContactName: "João Exemplo", emergencyContactPhone: null }],
      eventDate,
    );

    expect(rows[0][8]).toBe("João Exemplo");
  });
});

describe("buildRegistrationsCsv", () => {
  it("começa com o BOM UTF-8 (necessário pro Excel abrir acentos corretamente)", () => {
    const csv = buildRegistrationsCsv([]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("inclui o cabeçalho (com Idade logo após Data de Nascimento) e escapa aspas internas", () => {
    const csv = buildRegistrationsCsv([["Nome \"Apelido\"", "", "", "", "", "", "", "", "", ""]]);

    expect(REGISTRATION_EXPORT_HEADERS[1]).toBe("Data de Nascimento");
    expect(REGISTRATION_EXPORT_HEADERS[2]).toBe("Idade");
    expect(csv).toContain(REGISTRATION_EXPORT_HEADERS.map((h) => `"${h}"`).join(","));
    expect(csv).toContain('"Nome ""Apelido"""');
  });

  it("preserva acentos sem corromper", () => {
    const rows = buildRegistrationExportRows([fullRegistration], eventDate);
    const csv = buildRegistrationsCsv(rows);

    expect(csv).toContain("São Paulo");
    expect(csv).toContain("Alérgica a dipirona");
  });
});

describe("buildRegistrationsXlsx", () => {
  it("gera um Buffer .xlsx válido com cabeçalho em negrito e as linhas certas (incluindo Idade)", async () => {
    const rows = buildRegistrationExportRows([fullRegistration], eventDate);
    const buffer = await buildRegistrationsXlsx(rows);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Inscritos");
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(1).getCell(1).value).toBe("Nome");
    expect(sheet!.getRow(1).getCell(3).value).toBe("Idade");
    expect(sheet!.getRow(1).font?.bold).toBe(true);
    expect(sheet!.getRow(2).getCell(1).value).toBe("Maria Exemplo");
    expect(sheet!.getRow(2).getCell(3).value).toBe("36");
    expect(sheet!.getRow(2).getCell(7).value).toBe("São Paulo");
  });
});
