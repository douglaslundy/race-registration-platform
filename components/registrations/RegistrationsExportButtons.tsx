"use client";

export interface RegistrationExportFilters {
  status?: string;
  q?: string;
  categoryId?: string;
  routeId?: string;
  ticketBatchId?: string;
  couponId?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildExportUrl(eventId: string, format: "csv" | "xlsx", filters: RegistrationExportFilters): string {
  const params = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return `/api/events/${eventId}/registrations?${params.toString()}`;
}

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
    </>
  );
}
