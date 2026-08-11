import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/smtp-settings", () => ({ getSmtpConfig: vi.fn(), isSmtpReady: vi.fn() }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn() };
});

import { POST } from "@/app/api/auth/forgot-password/route";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";

const dbMock = db as any;
const rateLimitMock = vi.mocked(checkRateLimit);

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 9 });
    vi.mocked(getSmtpConfig).mockResolvedValue({} as any);
    vi.mocked(isSmtpReady).mockReturnValue(true);
    dbMock.user.findUnique.mockResolvedValue({ id: "user-1", name: "Atleta" });
    dbMock.verificationToken.deleteMany.mockResolvedValue({});
    dbMock.verificationToken.create.mockResolvedValue({});
  });

  it("retorna ok:true sem enviar e-mail quando o limite por IP é excedido (não revela rate limit)", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await POST(makeRequest({ email: "atleta@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("retorna ok:true sem enviar e-mail quando o limite por e-mail é excedido", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: true, remaining: 9 });
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const res = await POST(makeRequest({ email: "atleta@example.com" }));

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("envia o e-mail normalmente quando dentro do limite", async () => {
    const res = await POST(makeRequest({ email: "atleta@example.com" }));

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });
});
