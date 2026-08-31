/** Um evento "tem resultados" (mostra o botão / a página pública tem conteúdo) quando há
 * pelo menos um PDF de resultado cadastrado OU um import de CSV publicado. */
export function eventHasResults(input: {
  resultFilesCount: number;
  publishedImportCount: number;
}): boolean {
  return input.resultFilesCount > 0 || input.publishedImportCount > 0;
}
