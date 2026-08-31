import { describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  rateLimitMapSize,
  sweepRateLimitMap,
} from "@/lib/rate-limit";

describe("rate-limit — eviction de entradas expiradas (I-4)", () => {
  it("sweepRateLimitMap remove as entradas cuja janela já expirou e mantém as vivas", () => {
    const base = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(base);

    checkRateLimit("evict:a", { requests: 5, windowMs: 1_000 });
    checkRateLimit("evict:b", { requests: 5, windowMs: 10_000 });
    const sizeBefore = rateLimitMapSize();
    expect(sizeBefore).toBeGreaterThanOrEqual(2);

    // 2s depois: a janela de "evict:a" (1s) expirou, a de "evict:b" (10s) não.
    (Date.now as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base + 2_000);
    const removed = sweepRateLimitMap();

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(rateLimitMapSize()).toBe(sizeBefore - removed);

    // "evict:b" ainda conta como uma tentativa já usada (não foi descartada).
    const b = checkRateLimit("evict:b", { requests: 5, windowMs: 10_000 });
    expect(b.remaining).toBe(3);

    vi.restoreAllMocks();
  });

  it("checkRateLimit varre o Map automaticamente após SWEEP_EVERY chamadas", () => {
    const base = 5_000_000;
    vi.spyOn(Date, "now").mockReturnValue(base);

    // cria uma entrada de vida curta que deveria sumir sozinha depois do sweep automático
    checkRateLimit("auto:stale", { requests: 5, windowMs: 100 });
    expect(rateLimitMapSize()).toBeGreaterThanOrEqual(1);

    (Date.now as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base + 1_000);
    for (let i = 0; i < 500; i++) {
      checkRateLimit(`auto:churn:${i}`, { requests: 1, windowMs: 1 });
    }

    // após o sweep automático, "auto:stale" (expirada) não está mais no Map
    (Date.now as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base + 2_000);
    const fresh = checkRateLimit("auto:stale", { requests: 5, windowMs: 100 });
    expect(fresh.remaining).toBe(4); // tratada como primeira tentativa → entrada foi evicted

    vi.restoreAllMocks();
  });
});
