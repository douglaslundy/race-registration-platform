const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
}

export function renderTemplate(
  body: string,
  values: Record<string, string | undefined>,
  channel: "EMAIL" | "WHATSAPP",
): string {
  return body.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const raw = values[name] ?? "";
    return channel === "EMAIL" ? escapeHtml(raw) : stripControlChars(raw);
  });
}

export function validateTemplateVariables(
  body: string,
  allowedVariables: string[],
): { valid: boolean; unknown: string[] } {
  const found: string[] = [];
  for (const match of body.matchAll(VARIABLE_PATTERN)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  const allowedSet = new Set(allowedVariables);
  const unknown = found.filter((name) => !allowedSet.has(name));
  return { valid: unknown.length === 0, unknown };
}
