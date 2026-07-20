import { describe, expect, it } from "vitest";
import { parseDateInput } from "@/lib/admin/audit";

describe("parseDateInput", () => {
  it("retorna undefined quando não há valor", () => {
    expect(parseDateInput(undefined)).toBeUndefined();
  });

  it("retorna undefined para uma data inválida", () => {
    expect(parseDateInput("não-é-uma-data")).toBeUndefined();
  });

  it("interpreta o início do dia como meia-noite em Brasília (UTC-3), não em UTC", () => {
    const result = parseDateInput("2026-07-10", false);
    // Meia-noite de 10/7 em Brasília (UTC-3) é 03:00 UTC do mesmo dia.
    expect(result?.toISOString()).toBe("2026-07-10T03:00:00.000Z");
  });

  it("interpreta o fim do dia como 23:59:59.999 em Brasília (UTC-3), não em UTC", () => {
    const result = parseDateInput("2026-07-20", true);
    // 23:59:59.999 de 20/7 em Brasília (UTC-3) é 02:59:59.999 UTC do dia seguinte.
    expect(result?.toISOString()).toBe("2026-07-21T02:59:59.999Z");
  });

  it("um pedido criado às 23h30 (Brasília) do dia 9 fica FORA do filtro 'de 10/7' (bug relatado pelo usuário)", () => {
    const from = parseDateInput("2026-07-10", false)!;
    // 23:30 de 9/7 em Brasília = 02:30 UTC de 10/7.
    const orderCreatedAt = new Date("2026-07-10T02:30:00.000Z");
    expect(orderCreatedAt.getTime() >= from.getTime()).toBe(false);
  });

  it("um pedido criado às 00h00m01 (Brasília) do dia 10 fica DENTRO do filtro 'de 10/7'", () => {
    const from = parseDateInput("2026-07-10", false)!;
    // 00:00:01 de 10/7 em Brasília = 03:00:01 UTC de 10/7.
    const orderCreatedAt = new Date("2026-07-10T03:00:01.000Z");
    expect(orderCreatedAt.getTime() >= from.getTime()).toBe(true);
  });
});
