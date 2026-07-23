import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { PRIVATE_AD_STATUS } from "@/lib/private-ad-status";
import { BADGE } from "@/lib/badge-colors";
import { ACTIVE_STATUSES } from "@/lib/ads/private-ads";
import PrivateAdCancelButton from "@/components/advertiser/PrivateAdCancelButton";

export const metadata: Metadata = { title: "Meus Anúncios — Anunciante" };
export const dynamic = "force-dynamic";


export default async function AdvertiserAnunciosPage() {
  const session = await requireAuth();
  if (session.user.role !== "ADVERTISER") redirect("/acesso-negado");

  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });

  const ads = advertiser
    ? await db.privateAd.findMany({
        where: { adPurchase: { advertiserId: advertiser.id } },
        include: { adSlot: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Meus Anúncios</h1>

      {ads.length === 0 ? (
        <div className="card text-center text-gray-500 dark:text-gray-400">
          Você ainda não cadastrou nenhum anúncio.
        </div>
      ) : (
        <div className="card divide-y dark:divide-gray-700">
          {ads.map((ad) => {
            const status = PRIVATE_AD_STATUS[ad.status] ?? { label: ad.status, color: BADGE.gray };
            return (
              <div key={ad.id} className="py-4 first:pt-0 last:pb-0 flex flex-wrap items-center gap-4">
                <img
                  src={ad.imageUrl}
                  alt={`Anúncio — ${ad.adSlot.label}`}
                  className="w-32 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="font-medium">{ad.adSlot.label}</p>
                  <a
                    href={ad.targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline break-all"
                  >
                    {ad.targetUrl}
                  </a>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Cadastrado em {formatDate(ad.createdAt)}
                    {ad.status === "REJECTED" && ad.rejectionReason && <> — Motivo: {ad.rejectionReason}</>}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded font-medium ${status.color}`}>{status.label}</span>
                {ACTIVE_STATUSES.includes(ad.status) && <PrivateAdCancelButton id={ad.id} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
