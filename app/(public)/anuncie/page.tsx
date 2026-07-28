import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import RequestAdvertiserForm from "@/components/advertiser/RequestAdvertiserForm";

export const metadata: Metadata = { title: "Anuncie no site" };
export const dynamic = "force-dynamic";

export default async function AnunciePage() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user) && session?.user.role !== "ADVERTISER";
  const enabled = (await getSetting("ads_marketplace_enabled")) === "true";

  const plans = enabled
    ? await db.adPlan.findMany({ where: { active: true }, orderBy: { priceAmount: "asc" } })
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Anuncie no site</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Escolha um plano, envie os dados da sua empresa e faça o pagamento. Sua conta de
          anunciante é liberada assim que aprovarmos a solicitação.
        </p>
      </div>

      {!enabled ? (
        <p className="text-gray-500 dark:text-gray-400">
          Não estamos aceitando novas solicitações de anunciante no momento.
        </p>
      ) : (
        <>
          {plans.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">Nenhum plano disponível no momento.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <div key={plan.id} className="card space-y-2">
                  <h2 className="text-lg font-semibold">{plan.name}</h2>
                  <p className="text-2xl font-bold text-primary-700 dark:text-primary-400">
                    {formatCurrency(plan.priceAmount)}
                  </p>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Duração: {plan.durationDays} dias</li>
                    <li>Posições simultâneas: {plan.maxSimultaneousSlots}</li>
                  </ul>
                </div>
              ))}
            </div>
          )}

          {plans.length > 0 && (
            <div className="card max-w-2xl">
              <h2 className="text-lg font-semibold mb-4">Dados da solicitação</h2>
              <RequestAdvertiserForm adPlanId={plans[0].id} isLoggedIn={isLoggedIn} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
