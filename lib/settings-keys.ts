import { validateAdDestinationUrl } from "@/lib/validate-url";

/**
 * M4 (auditoria 2026-08-31): a rota `POST /api/admin/settings` aceitava qualquer `{key,value}`.
 * Aqui está a whitelist das chaves conhecidas + validação por-chave feita no SERVIDOR
 * (as validações antes eram só nos formulários React).
 */

// Chaves com prefixo dinâmico (contas MP por id, blocos de texto legal, alertas, SEO, etc.).
const KNOWN_KEY_PREFIXES = [
  "legal.",
  "mp_",
  "alert_",
  "seo_",
  "social_",
  "ai_",
  "smtp_",
  "storage_",
  "twilio_",
  "whatsapp_",
  "pagarme_",
  "google_adsense_",
];

const KNOWN_KEYS = new Set<string>([
  "app_name",
  "support_email",
  "support_phone",
  "service_fee_percent",
  "service_fee_min",
  "default_platform_fee",
  "banner_interval_seconds",
  "pix_service_fee_discount_percent",
  "cancellation_policy_enabled",
  "ads_marketplace_enabled",
  "enabled_payment_methods",
  "payment_provider",
]);

/** Chaves numéricas: valor precisa ser inteiro dentro do range (inclusive). */
const NUMERIC_RULES: Record<string, { min: number; max: number }> = {
  service_fee_percent: { min: 0, max: 10_000 }, // basis points (10000 = 100%)
  service_fee_min: { min: 0, max: 10_000_000 }, // centavos
  default_platform_fee: { min: 0, max: 10_000_000 }, // centavos
  banner_interval_seconds: { min: 1, max: 3_600 },
  pix_service_fee_discount_percent: { min: 0, max: 100 },
  smtp_port: { min: 1, max: 65_535 },
  alert_abandoned_cart_minutes: { min: 1, max: 100_000 },
  alert_low_stock_threshold_percent: { min: 0, max: 100 },
  alert_reconciliation_minutes_threshold: { min: 1, max: 100_000 },
};

/** Chaves de URL: precisam ser https e não podem apontar para host interno/privado. */
const URL_KEYS = new Set<string>(["whatsapp_api_url", "storage_endpoint", "storage_public_url"]);

export function isKnownSettingKey(key: string): boolean {
  if (KNOWN_KEYS.has(key)) return true;
  return KNOWN_KEY_PREFIXES.some((p) => key.startsWith(p) && key.length > p.length);
}

export type SettingWriteResult = { ok: true; value: string } | { ok: false; error: string };

export function validateSettingWrite(key: string, value: string): SettingWriteResult {
  if (!isKnownSettingKey(key)) {
    return { ok: false, error: "Configuração desconhecida" };
  }

  const numeric = NUMERIC_RULES[key];
  if (numeric) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < numeric.min || n > numeric.max) {
      return {
        ok: false,
        error: `Valor de "${key}" deve ser um inteiro entre ${numeric.min} e ${numeric.max}`,
      };
    }
    return { ok: true, value: String(n) };
  }

  if (URL_KEYS.has(key) && value.trim() !== "") {
    const res = validateAdDestinationUrl(value);
    if (!res.ok) {
      return { ok: false, error: `URL inválida para "${key}": ${res.error}` };
    }
    return { ok: true, value: res.url };
  }

  return { ok: true, value };
}
