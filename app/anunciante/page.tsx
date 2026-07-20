import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { BADGE } from "@/lib/badge-colors";
import { ACTIVE_STATUSES } from "@/lib/ads/private-ads";

export const metadata: Metadata = { title: "Painel do anunciante" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: "Pendente",  cls: BADGE.yellow },
  PAID:      { label: "Pago",      cls: BADGE.green },
  EXPIRED:   { label: "Expirado",  cls: BADGE.gray },
  CANCELLED: { label: "Cancelado", cls: BADGE.red },
};

export default async function AdvertiserDashboardPage() {
  const session = await requireAuth();
  if (session.user.role !== "ADVERTISER") redirect("/acesso-negado");

  const advertiser = await db.advertiserProfile.findUnique({
    where: { userId: session.user.id },
  });

  const purchases = advertiser
    ? await db.adPurchase.findMany({
        where: { advertiserId: advertiser.id },
        include: {
          adPlan: true,
          _count: { select: { ads: { where: { status: { in: ACTIVE_STATUSES } } } } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Contagem de vagas usadas/disponíveis usa a mesma definição de "ativo" (ACTIVE_STATUSES)
  // aplicada em hasAvailableSlotInPurchase, para que os dois números nunca divirjam.
  const hasPaidPurchase = purchases.some((p) => p.status === "PAID");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Painel do anunciante</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/anunciante/planos" className="btn-secondary py-1.5 px-3">Ver planos</Link>
          {hasPaidPurchase && (
            <Link href="/anunciante/anuncios/novo" className="btn-primary py-1.5 px-3">
              Cadastrar anúncio
            </Link>
          )}
        </div>
      </div>

      {purchases.length === 0 ? (
        <div className="card text-center space-y-3">
          <p className="text-gray-600 dark:text-gray-400">Você ainda não tem nenhum plano contratado.</p>
          <Link href="/anunciante/planos" className="btn-primary inline-block">Ver planos disponíveis</Link>
        </div>
      ) : (
        <div className="card divide-y dark:divide-gray-700">
          {purchases.map((purchase) => {
            const status = STATUS[purchase.status] ?? { label: purchase.status, cls: BADGE.gray };
            const used = purchase._count.ads;
            const available = Math.max(purchase.adPlan.maxSimultaneousSlots - used, 0);
            return (
              <div key={purchase.id} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{purchase.adPlan.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Vagas: {used} usada{used === 1 ? "" : "s"} / {available} disponíve{available === 1 ? "l" : "is"}
                    {purchase.endAt && <> — válido até {formatDate(purchase.endAt)}</>}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded font-medium ${status.cls}`}>{status.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
