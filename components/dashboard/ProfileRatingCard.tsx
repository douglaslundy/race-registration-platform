"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ErrorModal from "@/components/ui/ErrorModal";

type Summary = {
  points: number;
  percent: number;
  avatarUrl: string | null;
  items: { key: string; label: string; points: number; done: boolean }[];
};

export default function ProfileRatingCard({ name }: { name: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/profile/rating");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAvatar(fileUrl: string | null) {
    const res = await fetch("/api/profile/avatar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Erro ao salvar a foto");
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "avatar");
      const up = await fetch("/api/upload", { method: "POST", body: form });
      const upData = (await up.json().catch(() => ({}))) as { fileUrl?: string; error?: string };
      if (!up.ok || !upData.fileUrl) throw new Error(upData.error ?? "Erro ao enviar a foto");
      await saveAvatar(upData.fileUrl);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar a foto");
    } finally {
      setUploading(false);
    }
  }

  if (!data || data.items.length === 0) return null;
  const pending = data.items.filter((i) => !i.done);

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xl font-bold text-gray-500"
          title="Alterar foto de perfil"
        >
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatarUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-500">{uploading ? "Enviando foto…" : "Seu rating"}</p>
          <p className="text-2xl font-bold text-primary-700">{data.points} pts</p>
        </div>
        {data.avatarUrl && (
          <button
            type="button"
            className="text-xs text-gray-500 hover:underline"
            onClick={async () => {
              try {
                await saveAvatar(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Erro ao remover a foto");
              }
            }}
          >
            Remover foto
          </button>
        )}
      </div>

      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Cadastro completo</span>
          <span>{data.percent}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div className="h-full bg-primary-600" style={{ width: `${data.percent}%` }} />
        </div>
      </div>

      {pending.length > 0 && (
        <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
          {pending.map((i) => (
            <li key={i.key}>
              {i.label} <span className="font-medium text-primary-700">+{i.points}</span>
            </li>
          ))}
        </ul>
      )}
      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  );
}
