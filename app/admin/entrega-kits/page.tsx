import type { Metadata } from "next";
import { requireAnyPermission, resolveActingScope, assistantPermittedEventIds } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import KitDeliveryEventList from "@/components/kits/KitDeliveryEventList";

const KIT_ACTIONS = ["kits.view", "kits.deliver"];

export const metadata: Metadata = { title: "Entrega de kits — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminKitDeliveryPage() {
  // launcher — lista só os eventos permitidos e delega o escopo real (ver comentário na versão do organizador)
  const session = await requireAnyPermission(KIT_ACTIONS, { anyScope: true });
  const scope = await resolveActingScope(session);

  const allowedEventIds =
    session.user.role === "ASSISTANT" && !scope.actingAsAdmin
      ? await assistantPermittedEventIds(session.user.id, KIT_ACTIONS)
      : null;

  const events = await db.event.findMany({
    where: {
      status: { notIn: ["CANCELLED"] },
      ...(allowedEventIds ? { id: { in: allowedEventIds } } : {}),
    },
    orderBy: { startAt: "desc" },
    take: 50,
    select: { id: true, title: true, startAt: true, city: true, state: true, status: true },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Entrega de kits</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Escolha o evento para buscar inscrições e confirmar a retirada de kits.
        </p>
      </div>
      <KitDeliveryEventList events={events} basePath="/admin" />
    </div>
  );
}
