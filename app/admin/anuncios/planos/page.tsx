import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import AdPlanForm from "@/components/admin/AdPlanForm";

export const metadata: Metadata = { title: "Planos de Anúncio — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAdPlansPage() {
  await requireAdmin();
  const plans = await db.adPlan.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Planos de Anúncio</h1>

      <div className="card">
        <h2 className="text-sm font-medium mb-3">Novo plano</h2>
        <AdPlanForm />
      </div>

      <div className="card divide-y dark:divide-gray-700">
        {plans.length === 0 && (
          <p className="text-sm text-gray-500 py-4">Nenhum plano cadastrado ainda.</p>
        )}
        {plans.map((plan) => (
          <div key={plan.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
            <p className="font-medium">{plan.name}</p>
            <AdPlanForm
              id={plan.id}
              name={plan.name}
              priceAmount={plan.priceAmount}
              durationDays={plan.durationDays}
              maxSimultaneousSlots={plan.maxSimultaneousSlots}
              active={plan.active}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
