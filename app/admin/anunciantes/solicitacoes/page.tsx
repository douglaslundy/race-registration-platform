import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import AdvertiserRequestRow from "@/components/admin/AdvertiserRequestRow";

export const metadata: Metadata = { title: "Solicitações de Anunciante — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAdvertiserRequestsPage() {
  await requireAdmin();

  const purchases = await db.adPurchase.findMany({
    where: { status: "PENDING_APPROVAL" },
    orderBy: { createdAt: "asc" },
    include: { advertiser: true, adPlan: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Solicitações de Anunciante</h1>
        <p className="text-sm text-gray-500">Contas de anunciante aguardando aprovação (já pagas).</p>
      </div>

      <div className="card divide-y dark:divide-gray-700">
        {purchases.length === 0 && (
          <p className="text-sm text-gray-500 py-4">Nenhuma solicitação pendente.</p>
        )}
        {purchases.map((purchase) => (
          <AdvertiserRequestRow
            key={purchase.id}
            purchaseId={purchase.id}
            companyName={purchase.advertiser.companyName}
            document={purchase.advertiser.document}
            address={purchase.advertiser.address}
            contactEmail={purchase.advertiser.contactEmail}
            contactPhone={purchase.advertiser.contactPhone}
            instagram={purchase.advertiser.instagram}
            facebook={purchase.advertiser.facebook}
            planName={purchase.adPlan.name}
          />
        ))}
      </div>
    </div>
  );
}
