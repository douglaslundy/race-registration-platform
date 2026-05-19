import { cache } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { db } from "./db";

const DEFAULT_APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Corridas App";

export const getSetting = cache(async (key: string): Promise<string | null> => {
  noStore();
  try {
    const row = await db.platformSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
});

export const getAppName = cache(async (): Promise<string> => {
  return (await getSetting("app_name")) ?? DEFAULT_APP_NAME;
});

export async function upsertSetting(key: string, value: string) {
  await db.platformSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
