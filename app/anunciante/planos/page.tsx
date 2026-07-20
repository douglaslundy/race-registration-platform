import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import SubscribeButton from "@/components/advertiser/SubscribeButton";

export const metadata: Metadata = { title: "Planos — Anunciante" };
export const dynamic = "force-dynamic";

export default async function AdvertiserPlansPage() {
  const session = await requireAuth();
  if (session.user.role !== "ADVERTISER") redirect("/acesso-negado");

  const plans = await db.adPlan.findMany({
    where: { active: true },
    orderBy: { priceAmount: "asc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Planos</h1>

      {plans.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">Nenhum plano disponível no momento.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="card space-y-3">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="text-2xl font-bold text-primary-700 dark:text-primary-400">
                {formatCurrency(plan.priceAmount)}
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>Duração: {plan.durationDays} dias</li>
                <li>Posições simultâneas: {plan.maxSimultaneousSlots}</li>
              </ul>
              <SubscribeButton adPlanId={plan.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
