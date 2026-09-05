import { describe, expect, it } from "vitest";
import { generateKitDeliveryListPdf } from "@/lib/kit-delivery/list-pdf";

describe("generateKitDeliveryListPdf", () => {
  it("gera um Buffer PDF não vazio", async () => {
    const buffer = await generateKitDeliveryListPdf({
      eventTitle: "Corrida da Cidade",
      filtersLabel: "Entregues · entregues primeiro",
      generatedAt: new Date("2026-09-05T12:00:00.000Z"),
      deliveredCount: 1,
      pendingCount: 1,
      items: [
        {
          participantName: "Ana",
          participantCpf: "11144477735",
          bibNumber: "10",
          shirtSize: "M",
          categoryName: "Geral",
          delivered: true,
          deliveredAt: new Date("2026-09-04T10:00:00.000Z"),
          deliveredByName: "Carlos",
          receivedByName: "Ana",
        },
        {
          participantName: "Bruno",
          participantCpf: null,
          bibNumber: null,
          shirtSize: null,
          categoryName: null,
          delivered: false,
          deliveredAt: null,
          deliveredByName: null,
          receivedByName: null,
        },
      ],
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("gera PDF mesmo sem nenhum item", async () => {
    const buffer = await generateKitDeliveryListPdf({
      eventTitle: "Corrida vazia",
      filtersLabel: "Todos os inscritos · entregues primeiro",
      generatedAt: new Date("2026-09-05T12:00:00.000Z"),
      deliveredCount: 0,
      pendingCount: 0,
      items: [],
    });

    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
