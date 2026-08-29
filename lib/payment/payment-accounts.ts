import type { PaymentAccount } from "@prisma/client";
import { db } from "@/lib/db";
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

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";

export interface PaymentAccountDto {
  id: string;
  label: string;
  isDefault: boolean;
  archivedAt: Date | null;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
  hasPublicKey: boolean;
  webhookUrl: string;
}

export async function listPaymentAccounts(): Promise<PaymentAccountDto[]> {
  const rows = await db.paymentAccount.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    isDefault: r.isDefault,
    archivedAt: r.archivedAt,
    hasAccessToken: !!r.accessToken,
    hasWebhookSecret: !!r.webhookSecret,
    hasPublicKey: !!r.publicKey,
    webhookUrl: `${APP_URL()}/api/webhooks/payment/mp/${r.id}`,
  }));
}

export async function createPaymentAccount(input: {
  label: string;
  accessToken: string;
  webhookSecret: string;
  publicKey?: string | null;
}): Promise<{ id: string }> {
  const count = await db.paymentAccount.count();
  const row = await db.paymentAccount.create({
    data: {
      label: input.label.trim(),
      accessToken: input.accessToken.trim(),
      webhookSecret: input.webhookSecret.trim(),
      publicKey: input.publicKey?.trim() || null,
      isDefault: count === 0,
    },
  });
  return { id: row.id };
}

export async function updatePaymentAccount(
  id: string,
  patch: {
    label?: string;
    accessToken?: string;
    webhookSecret?: string;
    publicKey?: string | null;
  },
): Promise<void> {
  const data: Record<string, string | null> = {};
  if (patch.label?.trim()) data.label = patch.label.trim();
  if (patch.accessToken?.trim()) data.accessToken = patch.accessToken.trim();
  if (patch.webhookSecret?.trim()) data.webhookSecret = patch.webhookSecret.trim();
  if (patch.publicKey !== undefined) data.publicKey = patch.publicKey?.trim() || null;
  await db.paymentAccount.update({ where: { id }, data });
}

export async function makeDefaultPaymentAccount(id: string): Promise<void> {
  const acc = await db.paymentAccount.findUnique({ where: { id } });
  if (!acc) throw new Error("Conta não encontrada");
  if (acc.archivedAt) throw new Error("Não é possível tornar padrão uma conta arquivada");
  await db.$transaction([
    db.paymentAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    db.paymentAccount.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export async function setPaymentAccountArchived(id: string, archived: boolean): Promise<void> {
  const acc = await db.paymentAccount.findUnique({ where: { id } });
  if (!acc) throw new Error("Conta não encontrada");
  if (archived && acc.isDefault) {
    throw new Error("Promova outra conta a padrão antes de arquivar esta");
  }
  await db.paymentAccount.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });
}
