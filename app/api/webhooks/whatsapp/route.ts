import { NextRequest, NextResponse } from "next/server";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";

const ACK_STATUS_MAP: Record<string, "DELIVERED" | "READ"> = {
  DELIVERY_ACK: "DELIVERED",
  READ: "READ",
};

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null) as
    | { event?: string; data?: { keyId?: string; status?: string } }
    | null;

  const keyId = payload?.data?.keyId;
  const ackStatus = payload?.data?.status;

  if (keyId && ackStatus && ACK_STATUS_MAP[ackStatus]) {
    await updateMessageLogStatusByProviderMessageId(keyId, ACK_STATUS_MAP[ackStatus]);
  }

  return NextResponse.json({ ok: true });
}
