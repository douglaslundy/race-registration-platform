import { db } from "@/lib/db";
import type { AssistantScope } from "@/lib/auth/rbac";

/** Verifica se o escopo efetivo (organizador/admin/assistente já resolvido por
 * resolveActingScope) tem acesso à feature de campanhas de WhatsApp. Admin sempre tem acesso;
 * organizador (e assistentes dele) só quando o admin habilitou explicitamente pra aquele
 * organizador via OrganizerProfile.campaignsEnabled. */
export async function hasCampaignsAccess(scope: AssistantScope): Promise<boolean> {
  if (scope.actingAsAdmin) return true;
  if (!scope.organizerId) return false;

  const profile = await db.organizerProfile.findUnique({
    where: { id: scope.organizerId },
    select: { campaignsEnabled: true },
  });

  return profile?.campaignsEnabled ?? false;
}
