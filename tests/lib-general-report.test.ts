import { describe, expect, it } from "vitest";
import { buildGeneralReportOrderBy, computeGeneralReportDashboard } from "@/lib/reports/general-report";

describe("buildGeneralReportOrderBy", () => {
  it("padrão (nome) ordena por nome do atleta", () => {
    expect(buildGeneralReportOrderBy("")).toEqual([{ participantName: "asc" }]);
  });

  it("date ordena por data de criação", () => {
    expect(buildGeneralReportOrderBy("date")).toEqual([{ createdAt: "asc" }]);
  });

  it("emergencyContact prioriza quem tem contato preenchido, com nome como desempate", () => {
    expect(buildGeneralReportOrderBy("emergencyContact")).toEqual([
      { emergencyContactName: { sort: "asc", nulls: "last" } },
      { participantName: "asc" },
    ]);
  });

  it("allergies prioriza quem tem alergia preenchida, com nome como desempate", () => {
    expect(buildGeneralReportOrderBy("allergies")).toEqual([
      { medicalNotes: { sort: "asc", nulls: "last" } },
      { participantName: "asc" },
    ]);
  });

  it("route ordena por nome do percurso, com nome do atleta como desempate", () => {
    expect(buildGeneralReportOrderBy("route")).toEqual([{ route: { name: "asc" } }, { participantName: "asc" }]);
  });
});

describe("computeGeneralReportDashboard", () => {
  const registrations = [
    { route: { name: "5km" }, shirtSize: "M" as const, order: { id: "order-1" } },
    { route: { name: "5km" }, shirtSize: "M" as const, order: { id: "order-2" } },
    { route: { name: "10km" }, shirtSize: "G" as const, order: { id: "order-3" } },
    { route: null, shirtSize: null, order: { id: "order-4" } },
  ];

  it("agrupa inscrições por percurso, incluindo 'Sem percurso' quando null", () => {
    const dashboard = computeGeneralReportDashboard(registrations, new Map());

    expect(dashboard.totalRegistrations).toBe(4);
    expect(dashboard.byRoute).toEqual(
      expect.arrayContaining([
        { name: "5km", count: 2 },
        { name: "10km", count: 1 },
        { name: "Sem percurso", count: 1 },
      ]),
    );
  });

  it("agrupa camisetas na ordem fixa PP..XGG, ignorando quem não tem tamanho", () => {
    const dashboard = computeGeneralReportDashboard(registrations, new Map());

    expect(dashboard.byShirtSize).toEqual([
      { size: "M", count: 2 },
      { size: "G", count: 1 },
    ]);
    expect(dashboard.totalShirts).toBe(3);
  });

  it("agrupa o valor pago por valor efetivo, só considerando pedidos com pagamento PAID", () => {
    const paidAmountByOrderId = new Map([
      ["order-1", 10000],
      ["order-2", 10000],
      ["order-3", 15000],
      // order-4 sem entrada — sem pagamento PAID, não deve entrar na soma nem no agrupamento
    ]);

    const dashboard = computeGeneralReportDashboard(registrations, paidAmountByOrderId);

    expect(dashboard.byAmount).toEqual([
      { amount: 15000, count: 1, subtotal: 15000 },
      { amount: 10000, count: 2, subtotal: 20000 },
    ]);
    expect(dashboard.totalPaidAmount).toBe(35000);
  });

  it("evento sem inscrições retorna dashboard vazio, sem lançar erro", () => {
    const dashboard = computeGeneralReportDashboard([], new Map());

    expect(dashboard).toEqual({
      totalRegistrations: 0,
      byRoute: [],
      totalShirts: 0,
      byShirtSize: [],
      totalPaidAmount: 0,
      byAmount: [],
    });
  });
});
