import { db } from "@/lib/db";
import { issueAssistantInvite } from "./create-or-promote";

export type ManageAssistantResult =
  | { ok: true; mode?: "deleted" | "demoted" | "updated"; inviteResent?: boolean }
  | { ok: false; error: string; status: number };

export interface AssistantScopeInput {
  /** `null` = permissão vale pra todos os eventos do responsável. */
  eventId: string | null;
  actionKeys: string[];
}

/** Carrega o assistente e confere que é ASSISTANT e — quando `requireCreatedByUserId` é informado
 * (rota do organizador) — que foi criado por esse usuário. Admin passa `undefined` e pode agir
 * sobre qualquer ASSISTANT. */
async function loadOwnedAssistant(assistantId: string, requireCreatedByUserId?: string) {
  const target = await db.user.findUnique({
    where: { id: assistantId },
    select: { id: true, email: true, role: true, passwordHash: true, createdByUserId: true, active: true },
  });
  if (
    !target ||
    target.role !== "ASSISTANT" ||
    (requireCreatedByUserId !== undefined && target.createdByUserId !== requireCreatedByUserId)
  ) {
    return null;
  }
  return target;
}

/** Reenvia o convite de acesso — só faz sentido para assistente que ainda não definiu senha. */
export async function resendAssistantInvite(params: {
  assistantId: string;
  requireCreatedByUserId?: string;
  invitedByName?: string;
}): Promise<ManageAssistantResult> {
  const target = await loadOwnedAssistant(params.assistantId, params.requireCreatedByUserId);
  if (!target) return { ok: false, error: "Assistente não encontrado", status: 404 };
  if (target.passwordHash !== null) {
    return { ok: false, error: "Este assistente já concluiu o cadastro — não há convite para reenviar.", status: 400 };
  }

  const user = await db.user.findUnique({ where: { id: target.id }, select: { name: true } });
  await issueAssistantInvite({ email: target.email, name: user?.name ?? "", invitedByName: params.invitedByName });
  return { ok: true, inviteResent: true };
}

/**
 * "Excluir" um assistente:
 * - nunca concluiu o cadastro (passwordHash null) e não tem histórico → exclusão física
 *   (libera o e-mail, remove o usuário-fantasma);
 * - qualquer outro caso → rebaixa para ATHLETE + remove todas as permissões de assistente
 *   (preserva integridade referencial de auditoria/estornos/entregas e continua liberando o
 *   e-mail para ser re-promovido depois).
 * Sempre limpa as `AssistantPermission` e os `verificationToken` pendentes daquele e-mail.
 */
export async function deleteAssistant(params: {
  assistantId: string;
  requireCreatedByUserId?: string;
}): Promise<ManageAssistantResult> {
  const target = await loadOwnedAssistant(params.assistantId, params.requireCreatedByUserId);
  if (!target) return { ok: false, error: "Assistente não encontrado", status: 404 };

  await db.assistantPermission.deleteMany({ where: { userId: target.id } });
  await db.verificationToken.deleteMany({ where: { identifier: target.email } });

  if (target.passwordHash === null) {
    try {
      await db.user.delete({ where: { id: target.id } });
      return { ok: true, mode: "deleted" };
    } catch (err) {
      // Fallback defensivo: se houver FK inesperada (P2003), rebaixa em vez de falhar.
      console.error("[deleteAssistant] hard delete falhou, rebaixando para ATHLETE:", err);
    }
  }

  await db.user.update({
    where: { id: target.id },
    data: { role: "ATHLETE", createdByUserId: null },
  });
  return { ok: true, mode: "demoted" };
}

/**
 * Edita um assistente que JÁ existe — nome + conjunto completo de permissões, sem criar conta
 * nem disparar convite. Substitui TODAS as `AssistantPermission` do assistente pelas dos
 * `scopes` informados (deleteMany + createMany numa transação).
 *
 * Um assistente pode ter permissões em VÁRIOS eventos (cada `scope` = um `eventId` ou `null`
 * pra "todos os eventos"). Os pares `(eventId, actionKey)` são deduplicados pra respeitar o
 * `@@unique([userId, actionKey, eventId])`.
 *
 * A validação de que cada `eventId` pertence ao responsável é feita ANTES, pela rota (que tem
 * o `resolveActingScope`). `requireCreatedByUserId` (rota do organizador) garante que o
 * assistente é do próprio organizador; admin passa `undefined`.
 */
export async function updateAssistant(params: {
  assistantId: string;
  name: string;
  scopes: AssistantScopeInput[];
  requireCreatedByUserId?: string;
}): Promise<ManageAssistantResult> {
  const target = await loadOwnedAssistant(params.assistantId, params.requireCreatedByUserId);
  if (!target) return { ok: false, error: "Assistente não encontrado", status: 404 };

  const seen = new Set<string>();
  const rows: { userId: string; actionKey: string; eventId: string | null }[] = [];
  for (const scope of params.scopes) {
    for (const actionKey of scope.actionKeys) {
      const dedupeKey = `${scope.eventId ?? ""}::${actionKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({ userId: target.id, actionKey, eventId: scope.eventId });
    }
  }

  await db.$transaction([
    db.user.update({ where: { id: target.id }, data: { name: params.name } }),
    db.assistantPermission.deleteMany({ where: { userId: target.id } }),
    ...(rows.length ? [db.assistantPermission.createMany({ data: rows, skipDuplicates: true })] : []),
  ]);

  return { ok: true, mode: "updated" };
}
