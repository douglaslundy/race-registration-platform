"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";

export default function CancellationReasonModal({
  athleteName,
  reason,
  requestedAt,
}: {
  athleteName: string;
  reason: string;
  requestedAt: Date | string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary-600 hover:underline">
        Ver justificativa
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Justificativa de cancelamento</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {athleteName}
              {requestedAt ? ` · ${formatDate(requestedAt, "dd/MM/yyyy HH:mm")}` : ""}
            </p>
            <p className="mt-4 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{reason}</p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
