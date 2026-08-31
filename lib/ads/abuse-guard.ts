import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * M7 (auditoria 2026-08-31): endpoints públicos de clique/impressão de anúncio não tinham
 * rate-limit, dedupe nem tratamento de prefetch — dava pra inflar/depletar os contadores que
 * alimentam os relatórios do anunciante. Aqui ficam os guards compartilhados.
 */

const CLICK_WINDOW_MS = 30_000;
const IMPRESSION_WINDOW_MS = 60_000;

/** Requisição disparada por prefetch/preload do navegador ou crawler — não conta como interação real. */
export function isPrefetchRequest(req: Request): boolean {
  const secPurpose = req.headers.get("sec-purpose") ?? "";
  const purpose =
    req.headers.get("purpose") ?? req.headers.get("x-purpose") ?? req.headers.get("x-moz") ?? "";
  return /prefetch|prerender|preview/i.test(secPurpose) || /prefetch|preview/i.test(purpose);
}

/**
 * `true` se este clique deve ser contabilizado: não é prefetch e o par IP+anúncio não
 * registrou outro clique na janela curta (dedupe).
 */
export function shouldCountAdClick(req: Request, adKey: string): boolean {
  if (isPrefetchRequest(req)) return false;
  const ip = getClientIp(req);
  return checkRateLimit(`adclick:${ip}:${adKey}`, { requests: 1, windowMs: CLICK_WINDOW_MS }).allowed;
}

/** `true` se esta impressão deve ser contabilizada (dedupe por IP+slot numa janela curta). */
export function shouldCountAdImpression(ip: string, slotId: string): boolean {
  return checkRateLimit(`adimpr:${ip}:${slotId}`, { requests: 1, windowMs: IMPRESSION_WINDOW_MS }).allowed;
}
