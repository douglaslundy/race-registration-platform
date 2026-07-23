export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  const bucket = process.env.SUPABASE_BUCKET ?? "uploads";
  return { url, key, bucket, ready: Boolean(url && key) };
}

// Apaga um arquivo de anúncio da casa do storage. Best-effort: nunca lança — um arquivo órfão é
// bem menos grave do que quebrar a operação principal (upload de uma imagem nova, ou atualização
// da posição) por causa de uma falha de rede num delete secundário.
export async function deleteHouseAdImage(imageUrl: string): Promise<void> {
  try {
    const cfg = getSupabaseConfig();
    if (!cfg.ready) return;
    const marker = `/storage/v1/object/public/${cfg.bucket}/`;
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return;
    const key = imageUrl.slice(idx + marker.length);
    await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${key}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${cfg.key}` },
    });
  } catch (err) {
    console.error("[house-ad-storage] failed to delete house-ad image:", err);
  }
}
