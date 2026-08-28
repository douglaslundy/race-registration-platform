import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getTwilioConfig } from "@/lib/whatsapp-settings";
import { twilioStatusCallbackUrl } from "@/lib/whatsapp/twilio-client";
import { updateMessageLogStatusByProviderMessageId } from "@/lib/message-logs";
import { updateCampaignRecipientStatusByProviderMessageId } from "@/lib/campaigns/delivery-status";

const STATUS_MAP: Record<string, "DELIVERED" | "READ" | "FAILED"> = {
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  undelivered: "FAILED",
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const { authToken } = await getTwilioConfig();
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = twilioStatusCallbackUrl();
  if (!authToken || !url || !twilio.validateRequest(authToken, signature, url, params)) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 403 });
  }

  const sid = params.MessageSid;
  const mapped = STATUS_MAP[params.MessageStatus];
  if (sid && mapped) {
    const errorMessage =
      (mapped === "FAILED" && params.ErrorCode) ? `Twilio ${params.ErrorCode}` : undefined;
    if (errorMessage) {
      await updateMessageLogStatusByProviderMessageId(sid, mapped, errorMessage);
      await updateCampaignRecipientStatusByProviderMessageId(sid, mapped, errorMessage);
    } else {
      await updateMessageLogStatusByProviderMessageId(sid, mapped);
      await updateCampaignRecipientStatusByProviderMessageId(sid, mapped);
    }
  }

  return NextResponse.json({ ok: true });
}
