const RATE_LIMIT_MAP = new Map<string, { count: number; resetAt: number }>();

// I-4 (auditoria 2026-08-31): sem varredura, o Map só descartava uma entrada expirada se a
// MESMA chave fosse consultada de novo. O M7 adicionou chaves não autenticadas de alta
// cardinalidade (`adclick:<ip>:<ad>`, `adimpr:<ip>:<slot>`), então um crawler ou ataque
// distribuído fazia o Map crescer sem teto. Varremos as entradas expiradas a cada
// SWEEP_EVERY chamadas de `checkRateLimit` — barato e sem timer.
const SWEEP_EVERY = 500;
let opsSinceSweep = 0;

/** Remove do Map toda entrada cuja janela já expirou. Exportada para teste / uso em cron. */
export function sweepRateLimitMap(now: number = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of RATE_LIMIT_MAP) {
    if (entry.resetAt <= now) {
      RATE_LIMIT_MAP.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Número de entradas vivas no Map (para teste / observabilidade). */
export function rateLimitMapSize(): number {
  return RATE_LIMIT_MAP.size;
}

// A app só é alcançável via Traefik (nenhuma porta do container é exposta direto — ver
// docker-compose), então o Traefik é sempre quem escreve x-forwarded-for; não é um header
// vindo direto do cliente que precise de tratamento anti-spoofing extra aqui.
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitConfig {
  requests: number;
  windowMs: number;
}

export function checkRateLimit(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number } {
  const now = Date.now();

  if (++opsSinceSweep >= SWEEP_EVERY) {
    opsSinceSweep = 0;
    sweepRateLimitMap(now);
  }

  const entry = RATE_LIMIT_MAP.get(key);

  if (!entry || entry.resetAt < now) {
    RATE_LIMIT_MAP.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.requests - 1 };
  }

  if (entry.count >= config.requests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: config.requests - entry.count };
}

export const RATE_LIMITS = {
  AUTH: { requests: 10, windowMs: 60_000 },
  // Login é o alvo clássico de força bruta — limite mais apertado que o AUTH genérico
  // (usado também por registro / reset, que são de baixa frequência legítima).
  LOGIN: { requests: 5, windowMs: 60_000 },
  CHECKOUT: { requests: 5, windowMs: 60_000 },
  WEBHOOK: { requests: 100, windowMs: 60_000 },
  UPLOAD: { requests: 20, windowMs: 60_000 },
  SENSITIVE_ACTION_CODE: { requests: 3, windowMs: 300_000 },
} satisfies Record<string, RateLimitConfig>;
