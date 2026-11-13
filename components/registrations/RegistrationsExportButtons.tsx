"use client";

import { buildExportUrl, type RegistrationExportFilters } from "@/lib/registrations/export-url";

/** Exporta CSV/Excel respeitando os MESMOS filtros aplicados na tela agora — nunca a base
 * inteira do evento. Recebe os filtros já normalizados pela própria página (mesmos nomes de
 * query param usados por buildRegistrationWhere). */
export default function RegistrationsExportButtons({
  eventId,
  filters = {},
}: {
  eventId: string;
  filters?: RegistrationExportFilters;
}) {
  return (
    <>
      <a href={buildExportUrl(eventId, "csv", filters)} className="btn-secondary text-sm">
        Exportar CSV
      </a>
      <a href={buildExportUrl(eventId, "xlsx", filters)} className="btn-secondary text-sm">
        Exportar Excel
      </a>
      <a href={buildExportUrl(eventId, "pdf", filters)} className="btn-secondary text-sm" target="_blank" rel="noreferrer">
        Exportar PDF
      </a>
    </>
  );
}
