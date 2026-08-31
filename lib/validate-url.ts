const MAX_LENGTH = 500;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", ""]);

/**
 * Converte um host que seja um IPv4 em qualquer forma numérica aceita pelo `inet_aton`
 * (decimal puro `2130706433`, hex `0x7f000001`, octal `0177.0.0.1`, formas de 1–4 campos)
 * para a forma pontuada canônica `a.b.c.d`. Retorna null se não for um IPv4 numérico.
 */
function normalizeIPv4(host: string): string | null {
  const parts = host.split(".");
  if (parts.length === 0 || parts.length > 4) return null;

  const vals: number[] = [];
  for (const p of parts) {
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^(0|[1-9][0-9]*)$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isInteger(n) || n < 0) return null;
    vals.push(n);
  }

  const last = vals.pop()!;
  for (const v of vals) if (v > 255) return null;
  const maxLast = Math.pow(256, 4 - vals.length) - 1;
  if (last > maxLast) return null;

  let result = last;
  for (let i = 0; i < vals.length; i++) {
    result += vals[i] * Math.pow(256, 3 - i);
  }
  result = result >>> 0;

  return [(result >>> 24) & 255, (result >>> 16) & 255, (result >>> 8) & 255, result & 255].join(".");
}

function isPrivateIPv4(dotted: string): boolean {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(dotted)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(dotted)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(dotted)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(dotted)) return true; // loopback
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(dotted)) return true; // link-local / cloud metadata
  if (/^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(dotted)) return true; // 0.0.0.0/8 ("this host")
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(dotted)) return true; // CGNAT 100.64/10
  return false;
}

function isPrivateHost(hostname: string): boolean {
  // Normaliza: tira colchetes de IPv6, ponto final de FQDN, e caixa
  const normalized = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

  if (BLOCKED_HOSTS.has(normalized)) return true;

  // IPv6
  if (normalized.includes(":")) {
    if (normalized === "::1" || normalized === "::") return true;
    // IPv4 mapeado/embutido em forma pontuada: ::ffff:169.254.169.254 , 64:ff9b::10.0.0.1
    const v4 = normalized.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (v4) {
      const dotted = normalizeIPv4(v4[1]);
      if (dotted && isPrivateIPv4(dotted)) return true;
    }
    // IPv4 mapeado em forma hex: ::ffff:7f00:1 , ::ffff:a9fe:a9fe (o parser de URL comprime o v4)
    const v4hex = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (v4hex) {
      const hi = parseInt(v4hex[1], 16);
      const lo = parseInt(v4hex[2], 16);
      const dotted = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join(".");
      if (isPrivateIPv4(dotted)) return true;
    }
    // ULA fc00::/7 (fc.. e fd..) e link-local fe80::/10
    if (/^f[cd][0-9a-f]{0,2}:/.test(normalized) || /^f[cd][0-9a-f]{0,2}$/.test(normalized)) return true;
    if (/^fe[89ab][0-9a-f]?:/.test(normalized)) return true;
    return false;
  }

  // IPv4 em qualquer forma numérica
  const dotted = normalizeIPv4(normalized);
  if (dotted) return isPrivateIPv4(dotted);

  return false;
}

/**
 * I-3 (auditoria 2026-08-31): endereços de metadata de nuvem / link-local — bloqueados
 * mesmo para URLs de infra interna. RFC1918 (10/8, 172.16/12, 192.168/16), loopback comum
 * e nomes de serviço Docker são PERMITIDOS aqui — o objetivo é impedir apontar a Evolution
 * pra `169.254.169.254`, não impedir deploy interno.
 */
function isMetadataIPv4(dotted: string): boolean {
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(dotted)) return true; // link-local / cloud metadata (AWS/GCP/Azure 169.254.169.254)
  if (dotted === "100.100.100.200") return true; // Alibaba Cloud metadata
  return false;
}

function isMetadataOrLinkLocalHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

  if (normalized === "::1") return true;

  if (normalized.includes(":")) {
    if (normalized === "fd00:ec2::254") return true; // AWS IMDS via IPv6
    if (/^fe[89ab][0-9a-f]?:/.test(normalized)) return true; // link-local fe80::/10
    // IPv4 link-local embutido em IPv6 pontuado (::ffff:169.254.169.254)
    const v4 = normalized.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (v4) {
      const dotted = normalizeIPv4(v4[1]);
      if (dotted && isMetadataIPv4(dotted)) return true;
    }
    // IPv4 link-local mapeado em hex (::ffff:a9fe:a9fe)
    const v4hex = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (v4hex) {
      const hi = parseInt(v4hex[1], 16);
      const lo = parseInt(v4hex[2], 16);
      const dotted = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join(".");
      if (isMetadataIPv4(dotted)) return true;
    }
    return false;
  }

  const dotted = normalizeIPv4(normalized);
  if (dotted) return isMetadataIPv4(dotted);
  return false;
}

/**
 * Validação frouxa para URLs de serviços internos configuráveis pelo admin
 * (`whatsapp_api_url`, `storage_endpoint`, `storage_public_url`). Exige https e sem
 * credenciais, e só bloqueia endereços de metadata de nuvem / link-local — hosts privados
 * "normais" (RFC1918, nome de serviço Docker) são permitidos. Ver I-3.
 */
export function validateInternalServiceUrl(input: string): ValidateAdUrlResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, error: "URL não pode ser vazia" };
  }
  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: `URL excede o limite de ${MAX_LENGTH} caracteres` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "URL inválida" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "URL precisa começar com https://" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URL não pode conter credenciais (usuário:senha@)" };
  }
  if (isMetadataOrLinkLocalHost(parsed.hostname)) {
    return {
      ok: false,
      error: "URL não pode apontar para um endereço de metadata de nuvem / link-local",
    };
  }

  return { ok: true, url: parsed.toString() };
}

export interface ValidateAdUrlOptions {
  allowRelative?: boolean;
}

export type ValidateAdUrlResult = { ok: true; url: string } | { ok: false; error: string };

export function validateAdDestinationUrl(
  input: string,
  options: ValidateAdUrlOptions = {},
): ValidateAdUrlResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, error: "URL de destino não pode ser vazia" };
  }
  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: `URL de destino excede o limite de ${MAX_LENGTH} caracteres` };
  }
  if (options.allowRelative && trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return { ok: true, url: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "URL de destino inválida" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "URL de destino precisa começar com https://" };
  }
  // Userinfo (`https://user:pass@host` ou `https://metadata@host`) — vetor de confusão de host
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URL de destino não pode conter credenciais (usuário:senha@)" };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, error: "URL de destino não pode apontar para um endereço interno" };
  }

  return { ok: true, url: parsed.toString() };
}
