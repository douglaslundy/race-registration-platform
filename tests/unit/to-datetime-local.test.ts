import { describe, expect, it } from "vitest";
import { toDatetimeLocal } from "@/components/organizer/EditEventForm";

describe("toDatetimeLocal", () => {
  it("converte um instante UTC pro horário local (Brasília, UTC-3) esperado pelo input datetime-local", () => {
    // 2026-10-18T10:00:00Z equivale a 2026-10-18 07:00 em Brasília (UTC-3, sem horário de verão).
    const result = toDatetimeLocal(new Date("2026-10-18T10:00:00.000Z"));
    expect(result).toBe("2026-10-18T07:00");
  });

  it("aceita uma string ISO como entrada (mesmo formato retornado pela API)", () => {
    const result = toDatetimeLocal("2026-10-18T10:00:00.000Z");
    expect(result).toBe("2026-10-18T07:00");
  });
});
