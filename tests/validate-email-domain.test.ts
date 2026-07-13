import { beforeEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns";

vi.mock("node:dns", () => ({ default: { resolveMx: vi.fn() } }));

import { hasValidMxRecord } from "@/lib/validate-email-domain";

const resolveMxMock = vi.mocked(dns.resolveMx);

describe("hasValidMxRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna false quando o e-mail não tem domínio", async () => {
    const result = await hasValidMxRecord("sem-arroba");
    expect(result).toBe(false);
    expect(resolveMxMock).not.toHaveBeenCalled();
  });

  it("retorna true quando o domínio tem registro MX", async () => {
    resolveMxMock.mockImplementationOnce((_domain: any, cb: any) => {
      cb(null, [{ exchange: "mx.example.com", priority: 10 }]);
    });

    const result = await hasValidMxRecord("user@example.com");
    expect(result).toBe(true);
  });

  it("retorna false quando o domínio não existe (ENOTFOUND)", async () => {
    resolveMxMock.mockImplementationOnce((_domain: any, cb: any) => {
      const err = Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      cb(err, undefined);
    });

    const result = await hasValidMxRecord("user@gmail.coml");
    expect(result).toBe(false);
  });

  it("retorna false quando o domínio não tem nenhum registro (ENODATA)", async () => {
    resolveMxMock.mockImplementationOnce((_domain: any, cb: any) => {
      const err = Object.assign(new Error("no data"), { code: "ENODATA" });
      cb(err, undefined);
    });

    const result = await hasValidMxRecord("user@example.com");
    expect(result).toBe(false);
  });

  it("deixa passar (true) em qualquer outro erro de DNS", async () => {
    resolveMxMock.mockImplementationOnce((_domain: any, cb: any) => {
      const err = Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
      cb(err, undefined);
    });

    const result = await hasValidMxRecord("user@example.com");
    expect(result).toBe(true);
  });

  it("deixa passar (true) quando a consulta trava além do timeout", async () => {
    vi.useFakeTimers();
    resolveMxMock.mockImplementationOnce(() => {
      // nunca chama o callback -- simula travamento
    });

    const promise = hasValidMxRecord("user@example.com");
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;

    expect(result).toBe(true);
    vi.useRealTimers();
  });
});
