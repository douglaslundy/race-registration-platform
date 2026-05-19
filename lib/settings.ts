import { cache } from "react";
import { db } from "./db";

export const getSetting = cache(async (key: string): Promise<string | null> => {
  const row = await db.platformSetting.findUnique({ where: { key } });
  return row?.value ?? null;
});

export const getAppName = cache(async (): Promise<string> => {
  return (await getSetting("app_name")) ?? "Corridas App";
});

export async function upsertSetting(key: string, value: string) {
  await db.platformSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
