"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UserDeleteButton({ userId, userName }: { userId: string; userName: string }) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Não foi possível excluir o usuário");
      setLoading(false);
      return;
    }

    router.push("/admin/usuarios");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded-lg border font-medium border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        {loading ? "Excluindo..." : "Excluir"}
      </button>

      {confirming ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-red-200 bg-white p-4 shadow-lg">
          <p className="text-sm font-semibold text-gray-900">Confirmar exclusão</p>
          <p className="mt-2 text-xs leading-5 text-gray-600">
            Excluir <strong>{userName}</strong> só funciona se ele não tiver inscrições ou pedidos vinculados.
          </p>
          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (loading) return;
                setConfirming(false);
                setError(null);
              }}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border font-medium border-red-200 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Excluindo..." : "Confirmar"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
