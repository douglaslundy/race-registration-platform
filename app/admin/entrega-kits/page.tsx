import type { Metadata } from "next";
import { requireAnyPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import KitDeliveryEventList from "@/components/kits/KitDeliveryEventList";

export const metadata: Metadata = { title: "Entrega de kits — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminKitDeliveryPage() {
  await requireAnyPermission(["kits.view", "kits.deliver"]);

  const events = await db.event.findMany({
    where: { status: { notIn: ["CANCELLED"] } },
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
