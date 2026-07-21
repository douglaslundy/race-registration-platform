"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SuggestedAthleteField } from "@/lib/auth/profile-completion";

export const PROFILE_NUDGE_DISMISS_KEY = "profile-nudge-dismissed";

const FIELD_LABELS: Record<SuggestedAthleteField, string> = {
  gender: "Gênero",
  preferredShirtSize: "Tamanho de camiseta",
  city: "Cidade/Estado",
  state: "Cidade/Estado",
};

function buildSuggestionLabel(fields: SuggestedAthleteField[]): string {
  const labels: string[] = [];
  if (fields.includes("gender")) labels.push(FIELD_LABELS.gender);
  if (fields.includes("preferredShirtSize")) labels.push(FIELD_LABELS.preferredShirtSize);
  if (fields.includes("city") || fields.includes("state")) labels.push("Cidade/Estado");
  return labels.join(", ");
}

export default function ProfileCompletionNudge({
  suggestedFields,
}: {
  suggestedFields: SuggestedAthleteField[];
}) {
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
          Faltam alguns dados no seu perfil: {buildSuggestionLabel(suggestedFields)}.
        </p>
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
