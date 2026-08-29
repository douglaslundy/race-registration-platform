import { db } from "@/lib/db";
import { toResolved } from "./payment-accounts";

export interface ResolvedPaymentAccount {
  id: string;
  accessToken: string;
  webhookSecret: string;
  publicKey: string | null;
  label: string;
  archived: boolean;
}

export class NoPaymentAccountError extends Error {
  constructor(msg = "Nenhuma conta Mercado Pago configurada") {
    super(msg);
    this.name = "NoPaymentAccountError";
  }
}

export async function getDefaultPaymentAccount(): Promise<ResolvedPaymentAccount> {
  const row = await db.paymentAccount.findFirst({ where: { isDefault: true, archivedAt: null } });
  if (!row) throw new NoPaymentAccountError();
  return toResolved(row);
}

export async function getPaymentAccountById(id: string): Promise<ResolvedPaymentAccount> {
  const row = await db.paymentAccount.findUnique({ where: { id } });
  if (!row) throw new NoPaymentAccountError(`Conta de pagamento ${id} não encontrada`);
  return toResolved(row);
}

export async function resolveEventPaymentAccount(eventId: string): Promise<ResolvedPaymentAccount> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { paymentAccountId: true, paymentAccount: true },
  });
  if (event?.paymentAccount) return toResolved(event.paymentAccount);
  return getDefaultPaymentAccount();
}
