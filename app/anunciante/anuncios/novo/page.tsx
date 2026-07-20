import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { hasAvailableSlotInPurchase, listAvailableSlotsForAdvertiser } from "@/lib/ads/private-ads";
import PrivateAdForm from "@/components/advertiser/PrivateAdForm";

export const metadata: Metadata = { title: "Cadastrar anúncio — Anunciante" };
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["APPROVED", "PENDING_APPROVAL"]);

export default async function NewPrivateAdPage() {
  const session = await requireAuth();
  if (session.user.role !== "ADVERTISER") redirect("/acesso-negado");

  const advertiser = await db.advertiserProfile.findUnique({
    where: { userId: session.user.id },
  });

  const paidPurchases = advertiser
    ? await db.adPurchase.findMany({
        where: { advertiserId: advertiser.id, status: "PAID" },
        include: { adPlan: true, ads: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const purchasesWithFreeSlot = [];
  for (const purchase of paidPurchases) {
    const hasSlot = await hasAvailableSlotInPurchase(purchase.id);
    if (!hasSlot) continue;
    const activeCount = purchase.ads.filter((ad) => ACTIVE_STATUSES.has(ad.status)).length;
    purchasesWithFreeSlot.push({
      id: purchase.id,
      planName: purchase.adPlan.name,
      available: Math.max(purchase.adPlan.maxSimultaneousSlots - activeCount, 0),
    });
  }

  if (purchasesWithFreeSlot.length === 0) {
    redirect("/anunciante/planos");
  }

  const availableSlots = await listAvailableSlotsForAdvertiser();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cadastrar anúncio</h1>

      {availableSlots.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">
          Não há posições disponíveis no momento. Tente novamente mais tarde.
        </p>
      ) : (
        <PrivateAdForm
          purchases={purchasesWithFreeSlot}
          slots={availableSlots.map((slot) => ({
            id: slot.id,
            key: slot.key,
            label: slot.label,
            width: slot.width,
            height: slot.height,
          }))}
        />
      )}
    </div>
  );
}
