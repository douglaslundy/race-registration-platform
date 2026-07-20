import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { buildAdReportData } from "@/lib/ads/private-ad-report";
import { formatDate } from "@/lib/format";
import { BADGE } from "@/lib/badge-colors";
import PrivateAdSendReportButtons from "@/components/admin/PrivateAdSendReportButtons";

export const metadata: Metadata = { title: "Detalhe do Anúncio — Admin" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: "Aguardando aprovação",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  EXPIRED: "Expirado",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING_APPROVAL: BADGE.yellow,
  APPROVED: BADGE.green,
  REJECTED: BADGE.red,
  EXPIRED: BADGE.gray,
};

function formatMicrosAsCurrency(micros: bigint): string {
  const value = Number(micros) / 1_000_000;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function AdminPrivateAdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const existing = await db.privateAd.findUnique({ where: { id }, select: { status: true } });
  if (!existing) notFound();

  const data = await buildAdReportData(id);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/anuncios/moderacao" className="text-sm text-gray-500 hover:text-primary-600">
          ← Anúncios
        </Link>
        <a
          href={`/api/admin/ads/private/${id}/report.pdf`}
          className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Baixar PDF
        </a>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{data.companyName}</h1>
          <p className="text-sm text-gray-500">
            {data.adLabel} ({data.slotWidth}×{data.slotHeight})
          </p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_COLOR[existing.status] ?? ""}`}>
          {STATUS_LABEL[existing.status] ?? existing.status}
        </span>
      </div>

      <div className="card space-y-3">
        <img
          src={data.imageUrl}
          alt={`Anúncio de ${data.companyName}`}
          className="w-full max-h-64 object-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
        />
        <a
          href={data.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline break-all"
        >
          {data.targetUrl}
        </a>
      </div>

      <div className="card space-y-2 text-sm">
        <h2 className="font-semibold">Contato do anunciante</h2>
        <div className="flex justify-between">
          <span className="text-gray-500">E-mail</span>
          <span>{data.contactEmail}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Telefone</span>
          <span>{data.contactPhone}</span>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Métricas do período</h2>
        <p className="text-xs text-gray-500">
          {formatDate(data.periodStart)} a {formatDate(data.periodEnd)}
        </p>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-primary-600">{data.impressions.toLocaleString("pt-BR")}</p>
            <p className="text-gray-500 text-xs mt-1">Impressões</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary-600">{data.clicks.toLocaleString("pt-BR")}</p>
            <p className="text-gray-500 text-xs mt-1">Cliques</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary-600">
              {formatMicrosAsCurrency(data.estimatedRevenueMicros)}
            </p>
            <p className="text-gray-500 text-xs mt-1">Receita estimada</p>
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Enviar relatório ao anunciante</h2>
        <PrivateAdSendReportButtons adId={id} />
      </div>
    </div>
  );
}
