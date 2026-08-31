import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn(), hash: vi.fn(async () => "new-hash") } }));
vi.mock("@/lib/email", () => ({ sendPasswordChangedEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 9 })) };
});

import { POST } from "@/app/api/auth/change-password/route";
import { sendPasswordChangedEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";

const authMock = vi.mocked(auth);
const dbMock = db as any;

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as any;
}

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
  });

  it("troca a senha, bumpa passwordChangedAt e dispara o e-mail de aviso", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "u@x.com", name: "U", passwordHash: "old" });
    dbMock.user.update.mockResolvedValueOnce({});

    const res = await POST(makeRequest({ currentPassword: "atual123", newPassword: "novaSenha123" }));

    expect(res.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: "new-hash", passwordChangedAt: expect.any(Date) },
    });
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith({ to: "u@x.com", name: "U" });
  });

  it("M9 — rate-limit excedido → 429 sem tocar no banco", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await POST(makeRequest({ currentPassword: "atual123", newPassword: "novaSenha123" }));

    expect(res.status).toBe(429);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("senha atual errada → 400", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "u@x.com", name: "U", passwordHash: "old" });
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

    const res = await POST(makeRequest({ currentPassword: "errada", newPassword: "novaSenha123" }));

    expect(res.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });
});
