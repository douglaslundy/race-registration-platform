import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const db: any = {
    event: {
      findUnique: vi.fn(),
    },
    paymentAccount: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  return { db };
});

import {
  resolveEventPaymentAccount,
  getDefaultPaymentAccount,
  getPaymentAccountById,
  NoPaymentAccountError,
} from "@/lib/payment/account-resolver";

const dbMock = db as any;
const ACC = { id: "acc_1", label: "Principal", accessToken: "T", webhookSecret: "S", publicKey: "P", archivedAt: null };

beforeEach(() => vi.clearAllMocks());

it("evento com override → a conta do override", async () => {
  dbMock.event.findUnique.mockResolvedValueOnce({ paymentAccountId: "acc_2", paymentAccount: { ...ACC, id: "acc_2" } });
  const r = await resolveEventPaymentAccount("ev_1");
  expect(r.id).toBe("acc_2");
});

it("evento sem override → a conta default", async () => {
  dbMock.event.findUnique.mockResolvedValueOnce({ paymentAccountId: null, paymentAccount: null });
  dbMock.paymentAccount.findFirst.mockResolvedValueOnce(ACC);
  const r = await resolveEventPaymentAccount("ev_1");
  expect(r.id).toBe("acc_1");
  expect(dbMock.paymentAccount.findFirst).toHaveBeenCalledWith({ where: { isDefault: true, archivedAt: null } });
});

it("sem conta default → NoPaymentAccountError", async () => {
  dbMock.event.findUnique.mockResolvedValueOnce({ paymentAccountId: null, paymentAccount: null });
  dbMock.paymentAccount.findFirst.mockResolvedValueOnce(null);
  await expect(resolveEventPaymentAccount("ev_1")).rejects.toBeInstanceOf(NoPaymentAccountError);
});

it("getPaymentAccountById acha conta arquivada e marca archived", async () => {
  dbMock.paymentAccount.findUnique.mockResolvedValueOnce({ ...ACC, archivedAt: new Date() });
  const r = await getPaymentAccountById("acc_1");
  expect(r.archived).toBe(true);
});

it("getPaymentAccountById inexistente → NoPaymentAccountError", async () => {
  dbMock.paymentAccount.findUnique.mockResolvedValueOnce(null);
  await expect(getPaymentAccountById("nope")).rejects.toBeInstanceOf(NoPaymentAccountError);
});
