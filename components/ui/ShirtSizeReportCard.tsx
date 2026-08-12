"use client";

import { useState } from "react";

interface ShirtSizeStat {
  size: string;
  label: string;
  count: number;
}

interface ShirtSizeByBatch {
  batchId: string;
  batchName: string;
  sizes: ShirtSizeStat[];
}

export default function ShirtSizeReportCard({
  overall,
  byBatch,
  headingClassName = "font-semibold",
}: {
  overall: ShirtSizeStat[];
  byBatch: ShirtSizeByBatch[];
  headingClassName?: string;
}) {
  const [byLote, setByLote] = useState(false);
  const showToggle = byBatch.length > 1;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className={headingClassName}>Camisetas</h2>
        {showToggle && (
          <button
            type="button"
            onClick={() => setByLote((v) => !v)}
            className="text-xs text-primary-600 hover:underline"
          >
            {byLote ? "Ver total" : "Ver por lote"}
          </button>
        )}
      </div>

      {!byLote || !showToggle ? (
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {overall.map((s) => (
            <div key={s.size} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-primary-600">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5 break-words leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2 pr-3">Lote</th>
                {overall.map((s) => (
                  <th key={s.size} className="pb-2 pr-3 text-center">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byBatch.map((b) => (
                <tr key={b.batchId} className="border-b dark:border-gray-700 last:border-0">
                  <td className="py-2 pr-3 font-medium">{b.batchName}</td>
                  {b.sizes.map((s) => (
                    <td key={s.size} className="py-2 pr-3 text-center text-gray-700">{s.count}</td>
                  ))}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 pr-3">Total</td>
                {overall.map((s) => (
                  <td key={s.size} className="py-2 pr-3 text-center">{s.count}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
