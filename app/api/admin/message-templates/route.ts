import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { ALERT_REGISTRY } from "@/lib/templates/registry";

export async function GET(req: NextRequest) {
  const check = await checkAdminOnlyApiPermission("message-templates.manage");
  if (!check.allowed) return check.response;

  const rows = await db.messageTemplate.findMany({
    where: { scope: "GLOBAL" },
    select: {
      id: true, alertKey: true, channel: true, recipientRole: true, scope: true, eventId: true,
      active: true, updatedAt: true, updatedByUserId: true,
    },
  });
  const byKey = new Map(rows.map((r) => [`${r.alertKey}:${r.channel}:${r.recipientRole}`, r]));

  const templates = Object.values(ALERT_REGISTRY).flatMap((def) =>
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
          updatedAt: row?.updatedAt ?? null,
          updatedByUserId: row?.updatedByUserId ?? null,
        };
      }),
    ),
  );

  return NextResponse.json({ templates });
}
