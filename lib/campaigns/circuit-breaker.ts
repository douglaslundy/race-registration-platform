import { db } from "@/lib/db";

const SETTING_KEY = "campaign_consecutive_failures";
const TRIP_THRESHOLD = 5;

async function readCount(): Promise<number> {
  const row = await db.platformSetting.findUnique({ where: { key: SETTING_KEY } });
  return row ? parseInt(row.value, 10) || 0 : 0;
}

async function writeCount(count: number): Promise<void> {
  await db.platformSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: String(count) },
    update: { value: String(count) },
  });
}

/** Contador global (não por campanha) — todas as campanhas competem pelo mesmo número/instância de
 * WhatsApp, então uma falha sistêmica (instância caída, etc.) afeta todas igualmente. */
export async function recordCampaignSendFailure(): Promise<{ tripped: boolean; count: number }> {
  const count = (await readCount()) + 1;
  await writeCount(count);
  return { tripped: count >= TRIP_THRESHOLD, count };
}

export async function recordCampaignSendSuccess(): Promise<void> {
  await writeCount(0);
}

export async function isCircuitBreakerTripped(): Promise<boolean> {
  return (await readCount()) >= TRIP_THRESHOLD;
}

/** Chamado só pela rota de retomar campanha. Só reseta o contador se ele estiver REALMENTE
 * disparado (>= 5) — nunca zera uma contagem parcial de falhas (ex: 3 seguidas, ainda não
 * disparado) só porque uma campanha não relacionada foi retomada manualmente. */
export async function resetCircuitBreakerIfTripped(): Promise<boolean> {
  const tripped = await isCircuitBreakerTripped();
  if (tripped) await writeCount(0);
  return tripped;
}
