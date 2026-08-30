import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/security/sensitive-action-verification", () => ({
  verifySensitiveActionCode: vi.fn(),
  requestSensitiveActionCode: vi.fn(),
}));

import { POST } from "@/app/api/admin/backup/import/route";
import { POST as REQUEST_CODE } from "@/app/api/admin/backup/import/request-code/route";
import {
  verifySensitiveActionCode,
  requestSensitiveActionCode,
} from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const verifyMock = vi.mocked(verifySensitiveActionCode);
const requestMock = vi.mocked(requestSensitiveActionCode);

function makeRequest(fields: Record<string, string> = {}, backup: Record<string, unknown[]> = { users: [] }) {
  const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
  const formData = new FormData();
  formData.append("file", file);
  for (const [k, v] of Object.entries(fields)) formData.append(k, v);
  return new Request("http://localhost/api/admin/backup/import", {
    method: "POST",
    body: formData,
  }) as any;
}

describe("2FA no /api/admin/backup/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    verifyMock.mockResolvedValue({ ok: true });
    dbMock.$transaction = vi.fn(async () => []);
  });

  it("sem verificationId/code → 400 e nada é apagado", async () => {
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Código de verificação obrigatório");
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("código inválido → 400 e nada é apagado", async () => {
    verifyMock.mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 3 });
    const res = await POST(makeRequest({ verificationId: "v-1", code: "000000" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Código incorreto.", attemptsRemaining: 3 });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("código válido → segue para a restauração", async () => {
    const res = await POST(makeRequest({ verificationId: "v-1", code: "123456" }));
    expect(res.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledWith({
      verificationId: "v-1",
      userId: "admin-1",
      actionType: "BACKUP_IMPORT",
      targetId: "backup",
      code: "123456",
    });
    expect(dbMock.$transaction).toHaveBeenCalled();
  });

  it("valida o 2FA só depois de checar que o arquivo é um backup conhecido", async () => {
    const res = await POST(makeRequest({ verificationId: "v-1", code: "123456" }, { naoConhecido: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/não parece ser um backup válido/i);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  describe("request-code", () => {
    it("admin → retorna verificationId", async () => {
      requestMock.mockResolvedValueOnce({ ok: true, verificationId: "v-42" });
      const res = await REQUEST_CODE();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ verificationId: "v-42" });
      expect(requestMock).toHaveBeenCalledWith({
        userId: "admin-1",
        actionType: "BACKUP_IMPORT",
        targetId: "backup",
      });
    });

    it("não-admin → 403", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "org-1", role: "ORGANIZER" } } as any);
      const res = await REQUEST_CODE();
      expect(res.status).toBe(403);
    });
  });
});
