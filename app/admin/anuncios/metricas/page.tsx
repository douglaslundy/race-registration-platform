import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import { listAdMetricsSummary } from "@/lib/ads/ad-metrics";

export const metadata: Metadata = { title: "Métricas de Anúncios — Admin" };
export const dynamic = "force-dynamic";

function formatMicrosAsCurrency(micros: bigint): string {
  const value = Number(micros) / 1_000_000;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatSource(source: string | null): string {
  if (source === "GOOGLE") return "Google";
  if (source === "PRIVATE") return "Privado";
  return "—";
}

export default async function AdMetricasPage() {
  await requireAdmin();

  const connected = Boolean(await getSetting("google_adsense_access_token"));

  if (!connected) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Métricas de Anúncios</h1>
        <div className="card text-center py-12 text-gray-500">
          Conecte sua conta Google AdSense pra ver métricas.
        </div>
      </div>
    );
  }

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await listAdMetricsSummary(from, to);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Métricas de Anúncios — últimos 30 dias</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b dark:border-gray-700 text-xs uppercase">
              <th className="pb-2 pr-4">Posição</th>
              <th className="pb-2 pr-4">Fonte</th>
              <th className="pb-2 pr-4">Impressões</th>
              <th className="pb-2 pr-4">Cliques</th>
              <th className="pb-2">Receita estimada</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slotLabel} className="border-b dark:border-gray-700 last:border-0">
                <td className="py-2 pr-4">{row.slotLabel}</td>
                <td className="py-2 pr-4">{formatSource(row.source)}</td>
                <td className="py-2 pr-4">{row.impressions.toLocaleString("pt-BR")}</td>
                <td className="py-2 pr-4">{row.clicks.toLocaleString("pt-BR")}</td>
                <td className="py-2 font-medium">{formatMicrosAsCurrency(row.estimatedRevenueMicros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
