import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/payment/payment-accounts", () => ({
  listPaymentAccounts: vi.fn(),
  createPaymentAccount: vi.fn(),
  updatePaymentAccount: vi.fn(),
  makeDefaultPaymentAccount: vi.fn(),
  setPaymentAccountArchived: vi.fn(),
  maskCredential: (v: string | null | undefined) => (v ? "***" : null),
}));
vi.mock("@/lib/security/sensitive-action-verification", () => ({
  verifySensitiveActionCode: vi.fn(),
  requestSensitiveActionCode: vi.fn(),
}));

import { GET, POST } from "@/app/api/admin/payment-accounts/route";
import { PATCH } from "@/app/api/admin/payment-accounts/[id]/route";
import { POST as MAKE_DEFAULT } from "@/app/api/admin/payment-accounts/[id]/make-default/route";
import { POST as ARCHIVE } from "@/app/api/admin/payment-accounts/[id]/archive/route";
import {
  listPaymentAccounts,
  createPaymentAccount,
  updatePaymentAccount,
  makeDefaultPaymentAccount,
  setPaymentAccountArchived,
} from "@/lib/payment/payment-accounts";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

const authMock = vi.mocked(auth);
const dbMock = db as any;
const listMock = vi.mocked(listPaymentAccounts);
const createMock = vi.mocked(createPaymentAccount);
const updateMock = vi.mocked(updatePaymentAccount);
const makeDefaultMock = vi.mocked(makeDefaultPaymentAccount);
const setArchivedMock = vi.mocked(setPaymentAccountArchived);
const verifyMock = vi.mocked(verifySensitiveActionCode);

function req(body: unknown = {}, method = "POST") {
  return new Request("http://localhost/api/admin/payment-accounts", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  }) as any;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_2FA = { verificationId: "v-1", code: "123456" };

describe("/api/admin/payment-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as any);
    verifyMock.mockResolvedValue({ ok: true });
    createMock.mockResolvedValue({ id: "acc-new" } as any);
    dbMock.auditLog.create.mockResolvedValue({});
  });

  it("GET → 403 para não-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "org-1", role: "ORGANIZER" } } as any);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("GET admin → lista sem credenciais no corpo", async () => {
    listMock.mockResolvedValueOnce([
      {
        id: "acc-1",
        label: "Conta principal",
        isDefault: true,
        archivedAt: null,
        hasAccessToken: true,
        hasWebhookSecret: true,
        hasPublicKey: false,
        webhookUrl: "http://localhost/api/webhooks/payment/mp/acc-1",
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("accessToken");
    expect(text).not.toContain("webhookSecret");
  });

  it("POST sem verificationId/code → 400", async () => {
    const res = await POST(
      req({ label: "X", accessToken: "APP-tok", webhookSecret: "whsec" }),
    );
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("POST sem campos obrigatórios → 400", async () => {
    const res = await POST(req({ label: "X", ...VALID_2FA }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("POST com código inválido → 400", async () => {
    verifyMock.mockResolvedValueOnce({ ok: false, error: "Código incorreto.", attemptsRemaining: 2 });
    const res = await POST(
      req({ label: "X", accessToken: "APP-tok", webhookSecret: "whsec", ...VALID_2FA }),
    );
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("POST com código válido → cria conta e grava auditoria mascarada", async () => {
    const res = await POST(
      req({ label: "Nova", accessToken: "APP-secret-token", webhookSecret: "whsec-abc", ...VALID_2FA }),
    );
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledWith({
      label: "Nova",
      accessToken: "APP-secret-token",
      webhookSecret: "whsec-abc",
      publicKey: undefined,
    });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PAYMENT_ACCOUNT_CREATED",
        metadata: expect.objectContaining({ accessToken: "***", webhookSecret: "***" }),
      }),
    });
  });

  it("PATCH aplica o mesmo portão de 2FA", async () => {
    const noCode = await PATCH(req({ label: "Editada" }, "PATCH"), ctx("acc-1"));
    expect(noCode.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();

    verifyMock.mockResolvedValueOnce({ ok: false, error: "Código incorreto." });
    const badCode = await PATCH(req({ label: "Editada", ...VALID_2FA }, "PATCH"), ctx("acc-1"));
    expect(badCode.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();

    const ok = await PATCH(req({ label: "Editada", accessToken: "new-tok", ...VALID_2FA }, "PATCH"), ctx("acc-1"));
    expect(ok.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith("acc-1", { label: "Editada", accessToken: "new-tok" });
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PAYMENT_ACCOUNT_UPDATED",
        metadata: expect.objectContaining({ accessToken: "***" }),
      }),
    });
  });

  it("make-default exige 2FA e registra auditoria", async () => {
    const noCode = await MAKE_DEFAULT(req({}), ctx("acc-2"));
    expect(noCode.status).toBe(400);
    expect(makeDefaultMock).not.toHaveBeenCalled();

    const ok = await MAKE_DEFAULT(req(VALID_2FA), ctx("acc-2"));
    expect(ok.status).toBe(200);
    expect(makeDefaultMock).toHaveBeenCalledWith("acc-2");
    expect(dbMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "PAYMENT_ACCOUNT_DEFAULT_CHANGED" }),
    });
  });

  it("archive exige 2FA", async () => {
    const noCode = await ARCHIVE(req({ archived: true }), ctx("acc-3"));
    expect(noCode.status).toBe(400);
    expect(setArchivedMock).not.toHaveBeenCalled();
  });

  it("archive da conta padrão → 400 com a mensagem do serviço", async () => {
    setArchivedMock.mockRejectedValueOnce(new Error("Promova outra conta a padrão antes de arquivar esta"));
    const res = await ARCHIVE(req({ archived: true, ...VALID_2FA }), ctx("acc-default"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Promova outra conta a padrão antes de arquivar esta");
  });

  it("archive/unarchive ok registra auditoria correta", async () => {
    setArchivedMock.mockResolvedValue(undefined);
    const arch = await ARCHIVE(req({ archived: true, ...VALID_2FA }), ctx("acc-3"));
    expect(arch.status).toBe(200);
    expect(dbMock.auditLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ action: "PAYMENT_ACCOUNT_ARCHIVED" }),
    });

    const unarch = await ARCHIVE(req({ archived: false, ...VALID_2FA }), ctx("acc-3"));
    expect(unarch.status).toBe(200);
    expect(dbMock.auditLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ action: "PAYMENT_ACCOUNT_UNARCHIVED" }),
    });
  });
});
