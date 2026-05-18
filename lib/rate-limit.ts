const RATE_LIMIT_MAP = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitConfig {
  requests: number;
  windowMs: number;
}

export function checkRateLimit(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number } {
  const now = Date.now();
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
  CHECKOUT: { requests: 5, windowMs: 60_000 },
  WEBHOOK: { requests: 100, windowMs: 60_000 },
} satisfies Record<string, RateLimitConfig>;
