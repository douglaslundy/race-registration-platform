"use client";

import { useState } from "react";

type StorageProvider = "supabase" | "custom";

interface StorageSettingsFormProps {
  bucketConfigured: boolean;
  accessKeyConfigured: boolean;
  endpointConfigured: string | null;
}

export default function StorageSettingsForm({
  bucketConfigured,
  accessKeyConfigured,
  endpointConfigured,
}: StorageSettingsFormProps) {
  const [provider, setProvider] = useState<StorageProvider>(
    endpointConfigured?.includes("supabase.co") ? "supabase" : "custom"
  );
  const [supabaseRef, setSupabaseRef] = useState("");
  const [bucket, setBucket] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fillSupabaseDefaults(ref: string) {
    if (!ref.trim()) return;
    setEndpoint(`https://${ref}.supabase.co/storage/v1/s3`);
    setPublicUrl(`https://${ref}.supabase.co/storage/v1/object/public/uploads`);
    setBucket("uploads");
  }

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const resolvedEndpoint =
        provider === "supabase" ? `https://${supabaseRef}.supabase.co/storage/v1/s3` : endpoint;
      const resolvedPublicUrl =
        provider === "supabase"
          ? `https://${supabaseRef}.supabase.co/storage/v1/object/public/uploads`
          : publicUrl;
      const resolvedBucket = provider === "supabase" ? "uploads" : bucket;

      if (resolvedBucket) await saveSetting("storage_bucket", resolvedBucket);
      if (resolvedEndpoint) await saveSetting("storage_endpoint", resolvedEndpoint);
      if (accessKey.trim()) await saveSetting("storage_access_key", accessKey.trim());
      if (secretKey.trim()) await saveSetting("storage_secret_key", secretKey.trim());
      if (resolvedPublicUrl) await saveSetting("storage_public_url", resolvedPublicUrl);

      setAccessKey("");
      setSecretKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {saved && (
        <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
          Configuração de storage atualizada!
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <div className="p-3 rounded-lg border dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Bucket configurado</p>
          <p className={bucketConfigured ? "text-green-600 font-medium" : "text-gray-400"}>
            {bucketConfigured ? "Sim" : "Não configurado"}
          </p>
        </div>
        <div className="p-3 rounded-lg border dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Credenciais</p>
          <p className={accessKeyConfigured ? "text-green-600 font-medium" : "text-gray-400"}>
            {accessKeyConfigured ? "Configuradas" : "Não configuradas"}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provedor</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as StorageProvider)}
          className="input-field w-full"
        >
          <option value="supabase">Supabase Storage</option>
          <option value="custom">S3 / Cloudflare R2 (custom)</option>
        </select>
      </div>

      {provider === "supabase" && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Project Reference do Supabase
          </label>
          <input
            type="text"
            value={supabaseRef}
            onChange={(e) => {
              setSupabaseRef(e.target.value);
              fillSupabaseDefaults(e.target.value);
            }}
            className="input-field w-full"
            placeholder="ex: usgslzpuovvrkvvrhljt"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Encontrado em: Supabase Dashboard → Settings → General → Reference ID
          </p>
        </div>
      )}

      {provider === "custom" && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bucket</label>
              <input
                type="text"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                className="input-field w-full"
                placeholder="uploads"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Endpoint S3</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="input-field w-full"
                placeholder="https://..."
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              URL pública base dos arquivos
            </label>
            <input
              type="text"
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              className="input-field w-full"
              placeholder="https://meu-bucket.r2.dev"
            />
          </div>
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {provider === "supabase" ? "S3 Access Key ID" : "Access Key"}
          </label>
          <input
            type="password"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            className="input-field w-full"
            placeholder={
              provider === "supabase" ? "Gerada em Storage → S3 Access Keys" : "Access Key"
            }
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {provider === "supabase" ? "S3 Secret Access Key" : "Secret Key"}
          </label>
          <input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            className="input-field w-full"
            placeholder="Secret Key"
            autoComplete="off"
          />
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {provider === "supabase"
          ? "Gere as chaves em: Supabase Dashboard → Storage → S3 Access Keys → New access key. Deixe em branco para manter os valores atuais."
          : "Deixe em branco para manter os valores atuais."}
      </p>

      <button type="submit" disabled={saving} className="btn-primary px-6">
        {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar configuração de storage"}
      </button>
    </form>
  );
}
