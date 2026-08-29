import { it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const db: any = {
    paymentAccount: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(db))),
  };
  return { db };
});

import {
  listPaymentAccounts,
  createPaymentAccount,
  updatePaymentAccount,
  makeDefaultPaymentAccount,
  setPaymentAccountArchived,
} from "@/lib/payment/payment-accounts";

const dbMock = db as any;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://ex.com";
});

it("listPaymentAccounts nunca vaza credenciais e monta webhookUrl", async () => {
  dbMock.paymentAccount.findMany.mockResolvedValueOnce([
    {
      id: "acc_1",
      label: "Principal",
      isDefault: true,
      archivedAt: null,
      accessToken: "SECRET_TOKEN",
      webhookSecret: "SECRET_HOOK",
      publicKey: null,
      createdAt: new Date(),
    },
  ]);
  const [dto] = await listPaymentAccounts();
  expect(dbMock.paymentAccount.findMany).toHaveBeenCalledWith({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  expect(JSON.stringify(dto)).not.toContain("SECRET_TOKEN");
  expect(JSON.stringify(dto)).not.toContain("SECRET_HOOK");
  expect(dto).toMatchObject({
    hasAccessToken: true,
    hasWebhookSecret: true,
    hasPublicKey: false,
    webhookUrl: "https://ex.com/api/webhooks/payment/mp/acc_1",
  });
  expect(dto).not.toHaveProperty("accessToken");
  expect(dto).not.toHaveProperty("webhookSecret");
});

it("createPaymentAccount: primeira conta (count 0) vira default; demais não", async () => {
  dbMock.paymentAccount.create.mockResolvedValue({ id: "acc_new" });

  dbMock.paymentAccount.count.mockResolvedValueOnce(0);
  await createPaymentAccount({ label: " A ", accessToken: " tok ", webhookSecret: " hk " });
  expect(dbMock.paymentAccount.create).toHaveBeenLastCalledWith({
    data: { label: "A", accessToken: "tok", webhookSecret: "hk", publicKey: null, isDefault: true },
  });

  dbMock.paymentAccount.count.mockResolvedValueOnce(2);
  await createPaymentAccount({ label: "B", accessToken: "t2", webhookSecret: "h2", publicKey: " pk " });
  expect(dbMock.paymentAccount.create).toHaveBeenLastCalledWith({
    data: { label: "B", accessToken: "t2", webhookSecret: "h2", publicKey: "pk", isDefault: false },
  });
});

it("updatePaymentAccount: accessToken vazio não entra no data; com valor entra", async () => {
  await updatePaymentAccount("acc_1", { label: "Nova", accessToken: "   " });
  expect(dbMock.paymentAccount.update).toHaveBeenLastCalledWith({
    where: { id: "acc_1" },
    data: { label: "Nova" },
  });

  await updatePaymentAccount("acc_1", { accessToken: " novo-token " });
  expect(dbMock.paymentAccount.update).toHaveBeenLastCalledWith({
    where: { id: "acc_1" },
    data: { accessToken: "novo-token" },
  });
});

it("makeDefaultPaymentAccount: transação rebaixa antiga e promove nova", async () => {
  dbMock.paymentAccount.findUnique.mockResolvedValueOnce({ id: "acc_2", archivedAt: null });
  dbMock.paymentAccount.updateMany.mockReturnValue("op-updateMany");
  dbMock.paymentAccount.update.mockReturnValue("op-update");

  await makeDefaultPaymentAccount("acc_2");

  expect(dbMock.paymentAccount.updateMany).toHaveBeenCalledWith({
    where: { isDefault: true },
    data: { isDefault: false },
  });
  expect(dbMock.paymentAccount.update).toHaveBeenCalledWith({
    where: { id: "acc_2" },
    data: { isDefault: true },
  });
  expect(dbMock.$transaction).toHaveBeenCalledWith(["op-updateMany", "op-update"]);
});

it("makeDefaultPaymentAccount de conta arquivada → lança", async () => {
  dbMock.paymentAccount.findUnique.mockResolvedValueOnce({ id: "acc_3", archivedAt: new Date() });
  await expect(makeDefaultPaymentAccount("acc_3")).rejects.toThrow(
    "Não é possível tornar padrão uma conta arquivada",
  );
  expect(dbMock.$transaction).not.toHaveBeenCalled();
});

it("setPaymentAccountArchived(true) na conta default → lança", async () => {
  dbMock.paymentAccount.findUnique.mockResolvedValueOnce({ id: "acc_1", isDefault: true });
  await expect(setPaymentAccountArchived("acc_1", true)).rejects.toThrow(
    "Promova outra conta a padrão antes de arquivar esta",
  );
  expect(dbMock.paymentAccount.update).not.toHaveBeenCalled();
});
