"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ToggleUserActiveButton({ userId, active }: { userId: string; active: boolean }) {
  const [isActive, setIsActive] = useState(active);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleToggle() {
    setLoading(true);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !isActive }),
    });
    setIsActive(!isActive);
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors disabled:opacity-50 ${
        isActive ? "bg-red-50 text-red-600 border-red-200 hover:bg-red-100" : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
      }`}
    >
      {loading ? "..." : isActive ? "Bloquear usuário" : "Desbloquear usuário"}
    </button>
  );
}
