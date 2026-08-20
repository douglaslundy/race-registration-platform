/** Verifica se um caminho de destino pós-login é seguro para redirecionar via router.push: precisa
 * ser um path relativo começando com uma única barra, nunca um protocolo, host externo, ou o
 * truque "//host"/"/\host" que alguns navegadores tratam como protocol-relative. Proteção contra
 * open redirect no fluxo de callbackUrl (login → volta pra página de origem). */
export function isSafeRedirectPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.startsWith("/\\")) return false;
  if (path.includes("://")) return false;
  return true;
}
