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
  // Twilio sempre manda application/x-www-form-urlencoded. Corpo que não parseia como form
  // não vem do Twilio — falha fechado, mesmo caminho de uma assinatura inválida.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 403 });
  }
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
    // `errorMessage` undefined é equivalente a omitir o 3º argumento nos dois updaters, então uma
    // única chamada cobre os dois casos (com e sem ErrorCode).
    try {
      await updateMessageLogStatusByProviderMessageId(sid, mapped, errorMessage);
      await updateCampaignRecipientStatusByProviderMessageId(sid, mapped, errorMessage);
    } catch (err) {
      // Um erro de banco não pode virar 5xx: o Twilio trata resposta não-2xx como callback
      // falhado e reenvia o mesmo evento em loop. Loga e segue pro 200.
      const name = err instanceof Error ? err.name : "UnknownError";
      console.error("[twilio-webhook] falha ao atualizar status sid=%s status=%s err=%s", sid, mapped, name);
    }
  }

  return NextResponse.json({ ok: true });
}
