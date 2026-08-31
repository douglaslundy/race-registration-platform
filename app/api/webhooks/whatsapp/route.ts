import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";
import { updateCampaignRecipientStatusByProviderMessageId } from "@/lib/campaigns/delivery-status";

const ACK_STATUS_MAP: Record<string, "DELIVERED" | "READ"> = {
  DELIVERY_ACK: "DELIVERED",
  READ: "READ",
};

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;
  // L2: preferir o header (não vaza em log de proxy / Referer). A query string continua aceita
  // só como fallback pro período de transição até o webhook ser re-registrado com o header.
  const headerSecret = req.headers.get("x-webhook-secret");
  const querySecret = new URL(req.url).searchParams.get("secret");
  const provided = headerSecret ?? querySecret ?? "";

  if (!expected || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null) as
    | { event?: string; data?: { keyId?: string; status?: string } }
    | null;

  const keyId = payload?.data?.keyId;
  const ackStatus = payload?.data?.status;

  if (keyId && ackStatus && ACK_STATUS_MAP[ackStatus]) {
    await updateMessageLogStatusByProviderMessageId(keyId, ACK_STATUS_MAP[ackStatus]);
    await updateCampaignRecipientStatusByProviderMessageId(keyId, ACK_STATUS_MAP[ackStatus]);
  }

  return NextResponse.json({ ok: true });
}
