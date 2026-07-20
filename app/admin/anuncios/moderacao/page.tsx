import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import PrivateAdModerationRow from "@/components/admin/PrivateAdModerationRow";

export const metadata: Metadata = { title: "Moderação de Anúncios — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAnunciosModeracaoPage() {
  await requireAdmin();

  const ads = await db.privateAd.findMany({
    where: { status: "PENDING_APPROVAL" },
    include: { adPurchase: { include: { advertiser: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Moderação de Anúncios</h1>
        <p className="text-sm text-gray-500">Anúncios privados aguardando aprovação.</p>
      </div>

      <div className="card divide-y dark:divide-gray-700">
        {ads.length === 0 && (
          <p className="text-sm text-gray-500 py-4">Nenhum anúncio pendente de aprovação.</p>
        )}
        {ads.map((ad) => (
          <PrivateAdModerationRow
            key={ad.id}
            id={ad.id}
            imageUrl={ad.imageUrl}
            targetUrl={ad.targetUrl}
            companyName={ad.adPurchase.advertiser.companyName}
          />
        ))}
      </div>
    </div>
  );
}
