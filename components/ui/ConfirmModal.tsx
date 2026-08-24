"use client";

import { useState } from "react";

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "default",
  loading = false,
  showNoteField = false,
  noteRequired = false,
  notePlaceholder = "",
  noteDefaultValue,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "success";
  loading?: boolean;
  showNoteField?: boolean;
  noteRequired?: boolean;
  notePlaceholder?: string;
  noteDefaultValue?: string;
  onConfirm: (note?: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(noteDefaultValue ?? "");

  if (!open) return null;

  const noteBlocksConfirm = showNoteField && noteRequired && !note.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{message}</p>
        {showNoteField && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={notePlaceholder}
            className="input-field text-sm mt-3"
            rows={3}
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(showNoteField ? note.trim() || undefined : undefined)}
            disabled={loading || noteBlocksConfirm}
            className={
              tone === "danger"
                ? "px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                : tone === "success"
                  ? "px-4 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50"
                  : "btn-primary text-sm disabled:opacity-50"
            }
          >
            {loading ? "Processando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
