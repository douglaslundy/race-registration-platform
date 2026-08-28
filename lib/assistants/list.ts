/** Agrupa as permissões de um assistente por escopo de evento, pra listagem na UI.
 * `eventId = null` vira o grupo "todos os eventos". */
export interface AssistantScopeGroup {
  eventId: string | null;
  eventTitle: string | null;
  permissions: string[];
}

export function buildScopes(
  perms: { actionKey: string; eventId: string | null }[],
  titleById: Map<string, string>,
): AssistantScopeGroup[] {
  const byEvent = new Map<string | null, string[]>();
  for (const p of perms) {
    const key = p.eventId ?? null;
    const arr = byEvent.get(key) ?? [];
    arr.push(p.actionKey);
    byEvent.set(key, arr);
  }
  return Array.from(byEvent.entries())
    .map(([eventId, permissions]) => ({
      eventId,
      eventTitle: eventId === null ? null : titleById.get(eventId) ?? "(evento removido)",
      permissions,
    }))
    // "todos os eventos" primeiro, depois por título
    .sort((a, b) => {
      if (a.eventId === null) return -1;
      if (b.eventId === null) return 1;
      return (a.eventTitle ?? "").localeCompare(b.eventTitle ?? "");
    });
}
