"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import RequestAdvertiserForm from "@/components/advertiser/RequestAdvertiserForm";

interface AdPlanSummary {
  id: string;
  name: string;
  priceAmount: number;
  durationDays: number;
  maxSimultaneousSlots: number;
}

export default function AdvertiserPlanPicker({
  plans,
  isLoggedIn,
}: {
  plans: AdPlanSummary[];
  isLoggedIn: boolean;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0].id);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isSelected = plan.id === selectedPlanId;
          return (
            <button
              key={plan.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedPlanId(plan.id)}
              className={`card space-y-2 text-left transition-colors ${
                isSelected
                  ? "border-primary-600 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-500"
                  : "hover:border-primary-400 dark:hover:border-primary-500"
              }`}
            >
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="text-2xl font-bold text-primary-700 dark:text-primary-400">
                {formatCurrency(plan.priceAmount)}
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>Duração: {plan.durationDays} dias</li>
                <li>Posições simultâneas: {plan.maxSimultaneousSlots}</li>
              </ul>
            </button>
          );
        })}
      </div>

      <div className="card max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">Dados da solicitação</h2>
        <RequestAdvertiserForm adPlanId={selectedPlanId} isLoggedIn={isLoggedIn} />
      </div>
    </>
  );
}
