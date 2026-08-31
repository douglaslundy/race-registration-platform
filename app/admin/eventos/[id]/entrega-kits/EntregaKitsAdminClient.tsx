"use client";

import { useState } from "react";
import KitDeliveryReportCard from "@/components/organizer/KitDeliveryReportCard";
import KitDeliveryFullList from "@/components/organizer/KitDeliveryFullList";

interface Props {
  eventId: string;
  total: number;
  delivered: number;
  pending: Array<{ id: string; athleteName: string; bibNumber: string | null; categoryName: string | null }>;
  pendingTotal: number;
}

/** Abas da tela de entrega de kits do admin (só leitura): "Progresso" (card) + "Todos os inscritos". */
export default function EntregaKitsAdminClient({ eventId, total, delivered, pending, pendingTotal }: Props) {
  const [tab, setTab] = useState<"progress" | "list">("progress");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setTab("progress")}
          className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
            tab === "progress"
              ? "border-primary-500 text-primary-600 font-medium"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          Progresso
        </button>
        <button
          type="button"
          onClick={() => setTab("list")}
          className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
            tab === "list"
              ? "border-primary-500 text-primary-600 font-medium"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          Todos os inscritos
        </button>
      </div>

      {tab === "list" ? (
        <KitDeliveryFullList eventId={eventId} />
      ) : (
        <KitDeliveryReportCard
          eventId={eventId}
          total={total}
          delivered={delivered}
          pending={pending}
          pendingTotal={pendingTotal}
        />
      )}
    </div>
  );
}
