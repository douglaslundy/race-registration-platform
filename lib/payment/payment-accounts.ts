import type { PaymentAccount } from "@prisma/client";
import type { ResolvedPaymentAccount } from "./account-resolver";

export function toResolved(row: PaymentAccount): ResolvedPaymentAccount {
  return {
    id: row.id,
    accessToken: row.accessToken,
    webhookSecret: row.webhookSecret,
    publicKey: row.publicKey ?? null,
    label: row.label,
    archived: row.archivedAt !== null,
  };
}

export function maskCredential(v: string | null | undefined): string | null {
  return v ? "***" : null;
}
