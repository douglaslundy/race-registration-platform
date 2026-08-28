import type { Metadata } from "next";
import { requireAnyPermission, resolveActingScope, assistantPermittedEventIds } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import KitDeliveryEventList from "@/components/kits/KitDeliveryEventList";

const KIT_ACTIONS = ["kits.view", "kits.deliver"];

export const metadata: Metadata = { title: "Entrega de kits" };
export const dynamic = "force-dynamic";

export default async function OrganizerKitDeliveryPage() {
  // anyScope: esta tela é um launcher — lista só os eventos que o assistente pode e delega o
  // escopo real. Um assistente com kits.deliver só num evento específico PRECISA entrar aqui.
  const session = await requireAnyPermission(KIT_ACTIONS, { anyScope: true });
  const scope = await resolveActingScope(session);

  // Assistente confinado a eventos específicos só enxerga esses; `null` = permissão global (todos).
  const allowedEventIds =
    session.user.role === "ASSISTANT" && !scope.actingAsAdmin
      ? await assistantPermittedEventIds(session.user.id, KIT_ACTIONS)
      : null;

  // Escopo do organizador (ou assistente dele): só os eventos do próprio organizerId. Assistente de
  // admin cai no branch actingAsAdmin e vê todos os eventos ativos/recentes.
  const events = scope.actingAsAdmin
    ? await db.event.findMany({
        where: { status: { notIn: ["CANCELLED"] } },
        orderBy: { startAt: "desc" },
        take: 50,
        select: { id: true, title: true, startAt: true, city: true, state: true, status: true },
      })
    : scope.organizerId
      ? await db.event.findMany({
          where: {
            organizerId: scope.organizerId,
            ...(allowedEventIds ? { id: { in: allowedEventIds } } : {}),
          },
          orderBy: { startAt: "desc" },
          select: { id: true, title: true, startAt: true, city: true, state: true, status: true },
        })
      : [];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Entrega de kits</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Escolha o evento para buscar inscrições e confirmar a retirada de kits.
        </p>
      </div>
      <KitDeliveryEventList events={events} basePath="/organizador" />
    </div>
  );
}
