import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getPaymentProviderSetting,
  getMercadoPagoPublicKey,
  getPagarMePublicKey,
} from "@/lib/payment-settings";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const provider = await getPaymentProviderSetting();

  let publicKey: string | null = null;
  if (provider === "mercadopago") {
    publicKey = await getMercadoPagoPublicKey();
  } else if (provider === "pagarme") {
    publicKey = await getPagarMePublicKey();
  }

  return NextResponse.json({ provider, publicKey });
}
