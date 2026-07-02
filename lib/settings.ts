import { cache } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { db } from "./db";
import { DEFAULT_LEGAL_PRIVACY, DEFAULT_LEGAL_TERMS, LEGAL_CONTENT_UPDATED_AT } from "./legal-content";

const DEFAULT_APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Corridas App";

async function ensureTable() {
  await db.$executeRaw`
    CREATE TABLE IF NOT EXISTS "platform_settings" (
      "key" TEXT NOT NULL,
      "value" TEXT NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
    )
  `;
}

function isMissingTable(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("does not exist") || (err as { code?: string })?.code === "P2021";
}

export const getSetting = cache(async (key: string): Promise<string | null> => {
  noStore();
  try {
    const row = await db.platformSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    return null;
  }
});

export const getAppName = cache(async (): Promise<string> => {
  return (await getSetting("app_name")) ?? DEFAULT_APP_NAME;
});

export const getDefaultPlatformFee = cache(async (): Promise<number> => {
  const val = await getSetting("default_platform_fee");
  return val ? parseInt(val, 10) : 500; // padrão R$5,00
});

export const getBannerInterval = cache(async (): Promise<number> => {
  const val = await getSetting("banner_interval_seconds");
  return val ? parseInt(val, 10) : 3;
});

export const getServiceFeePercent = cache(async (): Promise<number> => {
  const val = await getSetting("service_fee_percent");
  return val ? parseInt(val, 10) : 0; // basis points, e.g. 500 = 5%
});

export const getServiceFeeMin = cache(async (): Promise<number> => {
  const val = await getSetting("service_fee_min");
  return val ? parseInt(val, 10) : 0; // centavos, e.g. 97 = R$0,97
});

export const getCancellationPolicyEnabled = cache(async (): Promise<boolean> => {
  const val = await getSetting("cancellation_policy_enabled");
  return val === "true";
});

async function readLegalSetting(key: string): Promise<string | null> {
  noStore();
  try {
    const row = await db.platformSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    return null;
  }
}

export const getLegalTerms = cache(async (): Promise<{ content: string; updatedAt: string }> => {
  const [content, updatedAt] = await Promise.all([
    readLegalSetting("legal.terms_content"),
    readLegalSetting("legal.terms_updated"),
  ]);
  return {
    content: content && content.trim() ? content : DEFAULT_LEGAL_TERMS,
    updatedAt: updatedAt && updatedAt.trim() ? updatedAt : LEGAL_CONTENT_UPDATED_AT,
  };
});

export const getLegalPrivacy = cache(async (): Promise<{ content: string; updatedAt: string }> => {
  const [content, updatedAt] = await Promise.all([
    readLegalSetting("legal.privacy_content"),
    readLegalSetting("legal.privacy_updated"),
  ]);
  return {
    content: content && content.trim() ? content : DEFAULT_LEGAL_PRIVACY,
    updatedAt: updatedAt && updatedAt.trim() ? updatedAt : LEGAL_CONTENT_UPDATED_AT,
  };
});

export async function upsertSetting(key: string, value: string) {
  try {
    await db.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    await ensureTable();
    await db.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
