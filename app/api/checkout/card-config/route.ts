import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getPaymentProviderSetting,
  getMercadoPagoPublicKey,
  getPagarMePublicKey,
} from "@/lib/payment-settings";
import { resolveEventPaymentAccount } from "@/lib/payment/account-resolver";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const provider = await getPaymentProviderSetting();
  const eventId = new URL(req.url).searchParams.get("eventId");

  let publicKey: string | null = null;
  if (provider === "mercadopago") {
    if (eventId) {
      try {
        publicKey = (await resolveEventPaymentAccount(eventId)).publicKey;
      } catch (e) {
        console.error("[card-config] falha ao resolver conta do evento", e);
        publicKey = null;
      }
    } else {
      publicKey = await getMercadoPagoPublicKey();
    }
  } else if (provider === "pagarme") {
    publicKey = await getPagarMePublicKey();
  }

  return NextResponse.json({ provider, publicKey });
}
