const MAX_LENGTH = 500;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isPrivateHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
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
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, error: "URL de destino não pode apontar para um endereço interno" };
  }

  return { ok: true, url: parsed.toString() };
}
