import Image from "next/image";
import { getAdSlot } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { recordImpression } from "@/lib/ads/private-ad-metrics";

export default async function AdSlotRenderer({ position }: { position: string }) {
  const slot = await getAdSlot(position);
  if (!slot) return null;
  if (!slot.enabled) return null;

  if (slot.source === "PRIVATE") {
    const ad = await db.privateAd.findFirst({ where: { adSlotId: slot.id, status: "APPROVED" } });
    if (!ad) return null;
    await recordImpression(slot.id);
    return (
      <a href={`/api/ads/click/${ad.id}`} style={{ display: "inline-block", width: slot.width, height: slot.height }}>
        <Image src={ad.imageUrl} alt="" width={slot.width} height={slot.height} style={{ objectFit: "cover" }} />
      </a>
    );
  }

  if (slot.source === "HOUSE") {
    if (!slot.houseAdImageUrl || !slot.houseAdTargetUrl) return null;
    await recordImpression(slot.id);
    return (
      <a href={`/api/ads/click/house/${slot.id}`} style={{ display: "inline-block", width: slot.width, height: slot.height }}>
        <Image src={slot.houseAdImageUrl} alt="" width={slot.width} height={slot.height} style={{ objectFit: "cover" }} />
      </a>
    );
  }

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
