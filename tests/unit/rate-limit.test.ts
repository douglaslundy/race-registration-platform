import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows requests within limit", () => {
    const key = `test_${Date.now()}`;
    const config = { requests: 3, windowMs: 60_000 };

    const r1 = checkRateLimit(key, config);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(key, config);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(key, config);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests over limit", () => {
    const key = `test_block_${Date.now()}`;
    const config = { requests: 2, windowMs: 60_000 };

    checkRateLimit(key, config);
    checkRateLimit(key, config);
    const r3 = checkRateLimit(key, config);

    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it("resets after window expires", async () => {
    const key = `test_reset_${Date.now()}`;
    const config = { requests: 1, windowMs: 10 };

    checkRateLimit(key, config);
    const blocked = checkRateLimit(key, config);
    expect(blocked.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 20));
    const allowed = checkRateLimit(key, config);
    expect(allowed.allowed).toBe(true);
  });
});
