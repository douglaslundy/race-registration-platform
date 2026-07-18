import { getAdSlot } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";

export default async function AdSlotRenderer({ position }: { position: string }) {
  const slot = await getAdSlot(position);
  if (!slot || !slot.enabled || slot.source !== "GOOGLE" || !slot.googleAdUnitId) return null;

  const clientId = await getSetting("google_adsense_client_id");
  if (!clientId) return null;

  return (
    <div style={{ width: slot.width, maxWidth: "100%" }} className="mx-auto">
      <ins
        className="adsbygoogle"
        style={{ display: "inline-block", width: slot.width, height: slot.height }}
        data-ad-client={clientId}
        data-ad-slot={slot.googleAdUnitId}
      />
      <script
        dangerouslySetInnerHTML={{ __html: "(adsbygoogle = window.adsbygoogle || []).push({});" }}
      />
    </div>
  );
}
