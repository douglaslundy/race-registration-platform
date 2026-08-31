import type { Prisma, ShirtSize } from "@prisma/client";

export function buildGeneralReportOrderBy(sort: string): Prisma.RegistrationOrderByWithRelationInput[] {
  switch (sort) {
    case "emergencyContact":
      return [{ emergencyContactName: { sort: "asc", nulls: "last" } }, { participantName: "asc" }];
    case "allergies":
      return [{ medicalNotes: { sort: "asc", nulls: "last" } }, { participantName: "asc" }];
    case "route":
      return [{ route: { name: "asc" } }, { participantName: "asc" }];
    case "date":
      return [{ createdAt: "asc" }];
    default:
      return [{ participantName: "asc" }];
  }
}

export interface GeneralReportSourceRow {
  route: { name: string } | null;
  shirtSize: ShirtSize | null;
  order: { id: string };
}

export interface RouteBreakdown {
  name: string;
  count: number;
}
export interface ShirtSizeBreakdown {
  size: string;
  count: number;
}
export interface AmountBreakdown {
  amount: number;
  count: number;
  subtotal: number;
}

export interface GeneralReportDashboard {
  totalRegistrations: number;
  byRoute: RouteBreakdown[];
  totalShirts: number;
  byShirtSize: ShirtSizeBreakdown[];
  totalPaidAmount: number;
  byAmount: AmountBreakdown[];
}

// Ordem fixa de exibição (não alfabética) — PP a XGG na ordem natural de tamanho, já que o enum
// ShirtSize é fixo nesta plataforma (não configurável por organizador).
const SHIRT_SIZE_ORDER: ShirtSize[] = ["PP", "P", "M", "G", "GG", "XGG"];

/**
 * Monta os KPIs do dashboard do Relatório Geral: inscrições por percurso, camisetas por tamanho,
 * e valor pago agrupado por valor efetivo. `paidAmountByOrderId` deve conter só pedidos com
 * pagamento PAID (status "compatível com pagamento confirmado" nesta plataforma) — pendentes,
 * cancelados, recusados e estornados nunca entram aqui, então nem precisam ser filtrados de novo.
 */
export function computeGeneralReportDashboard(
  registrations: GeneralReportSourceRow[],
  paidAmountByOrderId: Map<string, number>,
): GeneralReportDashboard {
  const routeCounts = new Map<string, number>();
  for (const r of registrations) {
    const name = r.route?.name ?? "Sem percurso";
    routeCounts.set(name, (routeCounts.get(name) ?? 0) + 1);
  }
  const byRoute = [...routeCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const shirtCounts = new Map<string, number>();
  for (const r of registrations) {
    if (!r.shirtSize) continue;
    shirtCounts.set(r.shirtSize, (shirtCounts.get(r.shirtSize) ?? 0) + 1);
  }
  const byShirtSize = SHIRT_SIZE_ORDER.filter((size) => shirtCounts.has(size)).map((size) => ({
    size,
    count: shirtCounts.get(size)!,
  }));
  const totalShirts = byShirtSize.reduce((sum, s) => sum + s.count, 0);

  const amountCounts = new Map<number, number>();
  let totalPaidAmount = 0;
  for (const r of registrations) {
    const amount = paidAmountByOrderId.get(r.order.id);
    if (amount == null) continue;
    amountCounts.set(amount, (amountCounts.get(amount) ?? 0) + 1);
    totalPaidAmount += amount;
  }
  const byAmount = [...amountCounts.entries()]
    .map(([amount, count]) => ({ amount, count, subtotal: amount * count }))
    .sort((a, b) => b.amount - a.amount);

  return { totalRegistrations: registrations.length, byRoute, totalShirts, byShirtSize, totalPaidAmount, byAmount };
}
