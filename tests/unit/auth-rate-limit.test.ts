import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("bcryptjs", () => ({ default: { compare: vi.fn() } }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkRateLimit: vi.fn() };
});

import { authConfig } from "@/lib/auth/config";
import { checkRateLimit } from "@/lib/rate-limit";

const dbMock = db as any;
const rateLimitMock = vi.mocked(checkRateLimit);

function makeRequest(ip: string) {
  return new Request("http://localhost/api/auth/callback/credentials", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("authConfig credentials authorize — rate limiting", () => {
  // CredentialsProvider(config) do next-auth guarda a função `authorize` real dentro de
  // `.options` — o `.authorize` de nível superior do provider é sempre um stub `() => null`
  // (ver node_modules/@auth/core/providers/credentials.js), resolvido pelo NextAuth() em tempo
  // de execução. Testar direto contra o stub sempre passaria com falso positivo.
  const authorize = (authConfig.providers[0] as unknown as { options: { authorize: (c: unknown, r: Request) => Promise<unknown> } }).options.authorize;

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 9 });
  });

  it("retorna null sem consultar o banco quando o limite por IP é excedido", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const result = await authorize({ email: "atleta@example.com", password: "123456" }, makeRequest("1.2.3.4"));

    expect(result).toBeNull();
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("retorna null sem consultar o banco quando o limite por e-mail é excedido", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: true, remaining: 9 });
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const result = await authorize({ email: "atleta@example.com", password: "123456" }, makeRequest("1.2.3.4"));

    expect(result).toBeNull();
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("chaves de rate limit são escopadas por IP e por e-mail separadamente", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    await authorize({ email: "atleta@example.com", password: "123456" }, makeRequest("1.2.3.4"));

    expect(rateLimitMock).toHaveBeenCalledWith("login:ip:1.2.3.4", expect.objectContaining({ requests: 10 }));
    expect(rateLimitMock).toHaveBeenCalledWith("login:email:atleta@example.com", expect.objectContaining({ requests: 10 }));
  });

  it("consulta o banco normalmente quando dentro do limite", async () => {
    dbMock.user.findUnique.mockResolvedValueOnce(null);

    const result = await authorize({ email: "atleta@example.com", password: "123456" }, makeRequest("1.2.3.4"));

    expect(result).toBeNull();
    expect(dbMock.user.findUnique).toHaveBeenCalledWith({ where: { email: "atleta@example.com" } });
  });
});
