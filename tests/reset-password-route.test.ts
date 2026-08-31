import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed-password") } }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn() };
});

import { POST } from "@/app/api/auth/reset-password/route";
import { checkRateLimit } from "@/lib/rate-limit";

const dbMock = db as any;
const rateLimitMock = vi.mocked(checkRateLimit);

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

const validBody = { email: "atleta@example.com", token: "abc123", password: "12345678" };

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 9 });
    dbMock.verificationToken.findUnique.mockResolvedValue({
      identifier: "atleta@example.com",
      token: "abc123",
      expires: new Date(Date.now() + 60_000),
    });
    dbMock.$transaction.mockResolvedValue([{}, {}]);
  });

  it("retorna 429 e não troca a senha quando o limite de tentativas é excedido", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(429);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(dbMock.verificationToken.findUnique).not.toHaveBeenCalled();
  });

  it("troca a senha normalmente quando dentro do limite", async () => {
    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(dbMock.$transaction).toHaveBeenCalled();
  });

  it("L1 — busca o token pelo sha256, nunca pelo valor bruto do link", async () => {
    const { createHash } = await import("crypto");
    const expectedHash = createHash("sha256").update("abc123").digest("hex");

    await POST(makeRequest(validBody));

    expect(dbMock.verificationToken.findUnique).toHaveBeenCalledWith({ where: { token: expectedHash } });
    expect(expectedHash).not.toBe("abc123");
  });
});
