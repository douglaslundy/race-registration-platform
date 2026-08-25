import ExcelJS from "exceljs";
import { formatDate } from "@/lib/format";

export const REGISTRATION_EXPORT_HEADERS = [
  "Nome",
  "Data de Nascimento",
  "Sexo",
  "Equipe",
  "Categoria",
  "Cidade",
  "Percurso",
  "Contato de Emergência",
  "Alergias",
];

export interface RegistrationExportSource {
  athlete: {
    name: string;
    athleteProfile: { birthDate: Date | null; gender: string | null; city: string | null } | null;
  };
  route: { name: string } | null;
  category: { name: string } | null;
  teamName: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
}

/** Linhas da exportação de inscrições (CSV/XLSX) — mesmos 9 campos em ambos os formatos, pra
 * nunca divergirem entre si. Contato de emergência combina nome + telefone numa única coluna
 * (pedido explícito: só uma coluna "Contato de Emergência", não duas separadas). */
export function buildRegistrationExportRows(registrations: RegistrationExportSource[]): string[][] {
  return registrations.map((r) => [
    r.athlete.name,
    r.athlete.athleteProfile?.birthDate ? formatDate(r.athlete.athleteProfile.birthDate) : "",
    r.athlete.athleteProfile?.gender ?? "",
    r.teamName ?? "",
    r.category?.name ?? "",
    r.athlete.athleteProfile?.city ?? "",
    r.route?.name ?? "",
    [r.emergencyContactName, r.emergencyContactPhone].filter(Boolean).join(" — "),
    r.medicalNotes ?? "",
  ]);
}

/** CSV com BOM UTF-8 (`﻿`) — sem ele, Excel abre acentos corrompidos (interpreta o arquivo
 * como Latin-1/ANSI por padrão); LibreOffice e Google Sheets já detectam UTF-8 corretamente com ou
 * sem BOM, então adicioná-lo não quebra nenhum dos três. */
export function buildRegistrationsCsv(rows: string[][]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [REGISTRATION_EXPORT_HEADERS, ...rows].map((row) => row.map(escape).join(","));
  return "﻿" + lines.join("\r\n");
}

export async function buildRegistrationsXlsx(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inscritos");
  sheet.columns = REGISTRATION_EXPORT_HEADERS.map((header) => ({ header, width: 24 }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
