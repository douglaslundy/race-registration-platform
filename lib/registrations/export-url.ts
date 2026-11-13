// Módulo sem "use client": as páginas de inscritos (server components) também montam a URL.
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

export function buildExportUrl(eventId: string, format: "csv" | "xlsx" | "pdf", filters: RegistrationExportFilters): string {
  const params = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return `/api/events/${eventId}/registrations?${params.toString()}`;
}
