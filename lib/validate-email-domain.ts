import dns from "node:dns";

const MX_LOOKUP_TIMEOUT_MS = 2500;

// L6 (auditoria 2026-08-31): cache simples (positivo e negativo) por domínio pra não disparar
// uma resolução de MX a cada tentativa de registro/solicitação com o mesmo domínio (amplificação
// / carga no resolver). TTLs curtos — só o suficiente pra absorver rajadas.
const POSITIVE_TTL_MS = 60 * 60 * 1000; // 1h
const NEGATIVE_TTL_MS = 10 * 60 * 1000; // 10min
const MAX_CACHE_ENTRIES = 2000;

const cache = new Map<string, { valid: boolean; expiresAt: number }>();

function cacheGet(domain: string): boolean | undefined {
  const hit = cache.get(domain);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(domain);
    return undefined;
  }
  return hit.valid;
}

function cacheSet(domain: string, valid: boolean): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(domain, {
    valid,
    expiresAt: Date.now() + (valid ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
}

/** Só para testes — limpa o cache de MX entre casos. */
export function __clearMxRecordCache(): void {
  cache.clear();
}

export async function hasValidMxRecord(email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;

  const cached = cacheGet(domain);
  if (cached !== undefined) return cached;

  const result = await new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(true);
      }
    }, MX_LOOKUP_TIMEOUT_MS);

    dns.resolveMx(domain, (err, addresses) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        resolve(err.code === "ENOTFOUND" || err.code === "ENODATA" ? false : true);
      } else {
        resolve(addresses.length > 0);
      }
    });
  });

  cacheSet(domain, result);
  return result;
}
