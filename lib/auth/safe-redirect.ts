/** Verifica se um caminho de destino pós-login é seguro para redirecionar via router.push: precisa
 * ser um path relativo começando com uma única barra, nunca um protocolo, host externo, ou o
 * truque "//host"/"/\host" que alguns navegadores tratam como protocol-relative. Proteção contra
 * open redirect no fluxo de callbackUrl (login → volta pra página de origem).
 *
 * Nota de segurança: rejeita paths contendo caracteres de controle ASCII (tab, newline, carriage
 * return), que browsers normalmente descartam antes de fazer parsing de URL — um atacante poderia
 * contornar os checks abaixo escrevendo "/\t//evil.com" que se torna "//evil.com" após limpeza do
 * browser (WHATWG URL spec). */
export function isSafeRedirectPath(path: string | null | undefined): path is string {
  if (!path) return false;
  // Strip ASCII tab, newline, carriage return — browsers discard these before URL parsing
  const stripped = path.replace(/[\t\n\r]/g, "");
  if (!stripped.startsWith("/")) return false;
  if (stripped.startsWith("//")) return false;
  if (stripped.startsWith("/\\")) return false;
  if (stripped.includes("://")) return false;
  return true;
}
