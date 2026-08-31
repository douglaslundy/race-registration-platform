import ExcelJS from "exceljs";
import { calculateAge, formatDate } from "@/lib/format";

export const REGISTRATION_EXPORT_HEADERS = [
  "Nome",
  "Data de Nascimento",
  "Idade",
  "Sexo",
  "Equipe",
  "Categoria",
  "Cidade",
  "Percurso",
  "Contato de Emergência",
  "Alergias",
];

export interface RegistrationExportSource {
  participantName: string;
  participantBirthDate: Date | null;
  participantGender: string | null;
  athlete: { athleteProfile: { city: string | null } | null };
  route: { name: string } | null;
  category: { name: string } | null;
  teamName: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
}

/** Linhas da exportação de inscrições (CSV/XLSX) — mesmos campos em ambos os formatos, pra nunca
 * divergirem entre si. Contato de emergência combina nome + telefone numa única coluna (pedido
 * explícito: só uma coluna "Contato de Emergência", não duas separadas). Idade é calculada na
 * DATA DO EVENTO (`eventDate`), não na data de hoje — é a idade que o atleta tem/terá no dia da
 * prova, não a idade atual de quem gera o relatório. */
export function buildRegistrationExportRows(registrations: RegistrationExportSource[], eventDate: Date): string[][] {
  return registrations.map((r) => {
    const birthDate = r.participantBirthDate;
    return [
      r.participantName,
      birthDate ? formatDate(birthDate) : "",
      birthDate ? String(calculateAge(birthDate, eventDate)) : "",
      r.participantGender ?? "",
      r.teamName ?? "",
      r.category?.name ?? "",
      r.athlete.athleteProfile?.city ?? "",
      r.route?.name ?? "",
      [r.emergencyContactName, r.emergencyContactPhone].filter(Boolean).join(" — "),
      r.medicalNotes ?? "",
    ];
  });
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
