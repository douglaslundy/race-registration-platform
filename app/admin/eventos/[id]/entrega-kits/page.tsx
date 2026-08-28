import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { requireAnyPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getKitDeliveryProgress } from "@/lib/kit-delivery";
import KitDeliveryReportCard from "@/components/organizer/KitDeliveryReportCard";

export const metadata: Metadata = { title: "Entrega de kits — Admin" };

export default async function AdminEntregaKitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAnyPermission(["kits.view", "kits.deliver"], { eventId: id });

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id }, select: { id: true, title: true } })
    : await db.event.findFirst({
        where: { id, organizerId: scope.organizerId ?? "__none__" },
        select: { id: true, title: true },
      });
  if (!event) notFound();

  const progress = await getKitDeliveryProgress(id);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href={`/admin/eventos/${id}`} className="text-sm text-gray-500 hover:text-primary-600">
          ← Voltar
        </Link>
        <h1 className="text-xl font-bold mt-1">Entrega de kits — {event.title}</h1>
        <p className="text-sm text-gray-500">Acompanhamento só leitura — a confirmação de entrega é feita pelo organizador.</p>
      </div>

      <KitDeliveryReportCard
        eventId={id}
        total={progress.total}
        delivered={progress.delivered}
        pending={progress.pending}
        pendingTotal={progress.pendingTotal}
      />
    </div>
  );
}
