import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/rbac";
import { listAdSlots } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";
import AdSlotEditForm from "@/components/admin/AdSlotEditForm";
import GoogleAdSenseClientIdForm from "@/components/admin/GoogleAdSenseClientIdForm";
import HouseAdUploadForm from "@/components/admin/HouseAdUploadForm";

export const metadata: Metadata = { title: "Anúncios — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAnunciosPage() {
  await requireAdmin();
  const [slots, clientId] = await Promise.all([
    listAdSlots(),
    getSetting("google_adsense_client_id"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Anúncios</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/anuncios/conectar-google" className="btn-secondary py-1.5 px-3">Conectar Google AdSense</Link>
          <Link href="/admin/anuncios/metricas" className="btn-secondary py-1.5 px-3">Métricas</Link>
          <Link href="/admin/anuncios/planos" className="btn-secondary py-1.5 px-3">Planos</Link>
          <Link href="/admin/anuncios/moderacao" className="btn-secondary py-1.5 px-3">Moderação</Link>
        </div>
      </div>

      <div className="card">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Client ID do Google AdSense</label>
            <GoogleAdSenseClientIdForm currentClientId={clientId ?? ""} />
          </div>
        </div>
      </div>

      <div className="card divide-y dark:divide-gray-700">
        {slots.map((slot) => (
          <div key={slot.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
            <div>
              <p className="font-medium">{slot.label}</p>
              <p className="text-xs text-gray-500">{slot.width}×{slot.height}px — {slot.key}</p>
            </div>
            <AdSlotEditForm
              id={slot.id}
              enabled={slot.enabled}
              source={slot.source}
              googleAdUnitId={slot.googleAdUnitId}
            />
            {slot.source === "HOUSE" && (
              <HouseAdUploadForm
                slotId={slot.id}
                width={slot.width}
                height={slot.height}
                initialImageUrl={slot.houseAdImageUrl}
                initialTargetUrl={slot.houseAdTargetUrl}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
