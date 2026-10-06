import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Lease de job: garante que só uma instância do job rode por vez (cron + botão do admin, ou dois
 * ticks sobrepostos). `lockedUntil` expira sozinho — se o processo morrer, o job destrava após o TTL.
 * Não usamos `pg_advisory_lock`: é por sessão e o Prisma usa pool de conexões, então o lock poderia
 * ser "solto" ou nunca liberado pela conexão errada.
 */
export async function acquireJobLease(key: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);

  const taken = await db.jobLease.updateMany({
    where: { key, lockedUntil: { lt: now } },
    data: { lockedUntil },
  });
  if (taken.count > 0) return true;

  try {
    await db.jobLease.create({ data: { key, lockedUntil } });
    return true;
  } catch (err) {
    // Linha já existe e ainda está travada por outra execução.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

export async function releaseJobLease(key: string): Promise<void> {
  await db.jobLease
    .updateMany({ where: { key }, data: { lockedUntil: new Date(0) } })
    .catch((err) => console.error("[job-lease] falha ao liberar lease", key, err));
}
