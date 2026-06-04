"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Density = "comfortable" | "compact";

export default function UserDensityToggle({ currentDensity }: { currentDensity: Density }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [density, setDensity] = useState<Density>(currentDensity);
  const [saving, setSaving] = useState(false);

  async function updateDensity(nextDensity: Density) {
    if (nextDensity === density) return;
    setSaving(true);
    const res = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uiDensity: nextDensity }),
    });

    if (res.ok) {
      setDensity(nextDensity);
      const query = new URLSearchParams(searchParams.toString());
      if (nextDensity === "compact") {
        query.set("compact", "1");
      } else {
        query.delete("compact");
      }
      router.replace(`${pathname}${query.toString() ? `?${query.toString()}` : ""}`);
      router.refresh();
    }

    setSaving(false);
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-gray-300 p-1 text-xs">
      <button
        type="button"
        disabled={saving}
        onClick={() => updateDensity("comfortable")}
        className={`px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-50 ${
          density === "comfortable" ? "bg-primary-600 text-white" : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        Confortável
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => updateDensity("compact")}
        className={`px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-50 ${
          density === "compact" ? "bg-primary-600 text-white" : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        Compacto
      </button>
    </div>
  );
}
