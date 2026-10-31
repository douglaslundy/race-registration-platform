"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

export const PROFILE_NUDGE_DISMISS_KEY = "profile-nudge-dismissed";

/** Limpa a flag de "modal já visto nesta sessão de login" e desloga — chamado por todo botão
 * "Sair" do app, pra garantir que uma nova sessão de login sempre reavalie o nudge. */
export function signOutAndClearNudge() {
  sessionStorage.removeItem(PROFILE_NUDGE_DISMISS_KEY);
  signOut({ callbackUrl: "/" });
}

export type PendingRatingItem = { label: string; points: number };

export default function ProfileCompletionNudge({ pending }: { pending: PendingRatingItem[] }) {
  const totalPoints = pending.reduce((sum, i) => sum + i.points, 0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(PROFILE_NUDGE_DISMISS_KEY) === "1") return;
    setOpen(true);
  }, []);

  function dismiss() {
    sessionStorage.setItem(PROFILE_NUDGE_DISMISS_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Complete seu cadastro</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Complete seu perfil e ganhe até <strong>{totalPoints} pontos</strong> de rating:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {pending.map((i) => (
            <li key={i.label} className="flex justify-between">
              <span>{i.label}</span>
              <span className="font-medium text-primary-700">+{i.points}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Agora não
          </button>
          <Link href="/dashboard/perfil" onClick={dismiss} className="btn-primary text-sm">
            Completar agora
          </Link>
        </div>
      </div>
    </div>
  );
}
