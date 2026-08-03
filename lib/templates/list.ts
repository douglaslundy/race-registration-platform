import { db } from "@/lib/db";
import { ALERT_REGISTRY } from "./registry";

export async function listTemplatesForAdmin() {
  const rows = await db.messageTemplate.findMany({
    where: { scope: "GLOBAL" },
    select: {
      id: true,
      alertKey: true,
      channel: true,
      recipientRole: true,
      scope: true,
      eventId: true,
      active: true,
      updatedAt: true,
      updatedByUserId: true,
    },
  });
  const byKey = new Map(rows.map((r) => [`${r.alertKey}:${r.channel}:${r.recipientRole}`, r]));

  return Object.values(ALERT_REGISTRY).flatMap((def) =>
    def.channels.flatMap((channel) =>
      def.recipientRoles.map((recipientRole) => {
        const row = byKey.get(`${def.alertKey}:${channel}:${recipientRole}`);
        return {
          id: row?.id ?? null,
          alertKey: def.alertKey,
          description: def.description,
          channel,
          recipientRole,
          scope: row?.scope ?? "GLOBAL",
          eventId: row?.eventId ?? null,
          active: row?.active ?? true,
          updatedAt: row?.updatedAt?.toISOString() ?? null,
          updatedByUserId: row?.updatedByUserId ?? null,
        };
      }),
    ),
  );
}
