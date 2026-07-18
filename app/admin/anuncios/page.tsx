import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/rbac";
import { listAdSlots } from "@/lib/ad-slots";
import AdSlotEditForm from "@/components/admin/AdSlotEditForm";

export const metadata: Metadata = { title: "Anúncios — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAnunciosPage() {
  await requireAdmin();
  const slots = await listAdSlots();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Anúncios</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/anuncios/conectar-google" className="btn-secondary py-1.5 px-3">Conectar Google AdSense</Link>
          <Link href="/admin/anuncios/metricas" className="btn-secondary py-1.5 px-3">Métricas</Link>
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
          </div>
        ))}
      </div>
    </div>
  );
}
