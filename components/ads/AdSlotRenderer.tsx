import Image from "next/image";
import { getAdSlot } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { recordImpression } from "@/lib/ads/private-ad-metrics";

function ClickableAd({
  href,
  imageUrl,
  imageAlt,
  width,
  height,
}: {
  href: string;
  imageUrl: string;
  imageAlt: string;
  width: number;
  height: number;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Anúncio publicitário — abre em nova aba"
      className="relative inline-block group"
      style={{ width, height }}
    >
      <Image src={imageUrl} alt={imageAlt} width={width} height={height} style={{ objectFit: "cover" }} />
      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] leading-tight text-center py-0.5 opacity-90 group-hover:opacity-100">
        Publicidade · Saiba mais
      </span>
    </a>
  );
}

export default async function AdSlotRenderer({ position }: { position: string }) {
  const slot = await getAdSlot(position);
  if (!slot) return null;
  if (!slot.enabled) return null;

  if (slot.source === "PRIVATE") {
    const ad = await db.privateAd.findFirst({ where: { adSlotId: slot.id, status: "APPROVED" } });
    if (!ad) return null;
    await recordImpression(slot.id, "PRIVATE");
    return (
      <ClickableAd
        href={`/api/ads/click/${ad.id}`}
        imageUrl={ad.imageUrl}
        imageAlt=""
        width={slot.width}
        height={slot.height}
      />
    );
  }

  if (slot.source === "HOUSE") {
    if (!slot.houseAdImageUrl) return null;
    await recordImpression(slot.id, "HOUSE");
    if (!slot.houseAdTargetUrl) {
      // Anúncio da casa sem link de destino: continua visível, sem ação de navegação — não
      // envolve em <a> nenhuma pra não ter âncora sem destino.
      return (
        <Image
          src={slot.houseAdImageUrl}
          alt=""
          width={slot.width}
          height={slot.height}
          style={{ objectFit: "cover" }}
        />
      );
    }
    return (
      <ClickableAd
        href={`/api/ads/click/house/${slot.id}`}
        imageUrl={slot.houseAdImageUrl}
        imageAlt=""
        width={slot.width}
        height={slot.height}
      />
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
