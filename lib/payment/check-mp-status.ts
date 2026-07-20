import { getMercadoPagoAccessToken } from "@/lib/payment-settings";

/**
 * Consulta o status real de um pagamento diretamente na API do Mercado Pago, usando a nossa
 * própria access token (nunca confia em status vindo de query string ou corpo de requisição não
 * verificados).
 */
export async function checkMPPaymentStatus(providerPaymentId: string): Promise<"PAID" | "CANCELLED" | null> {
  const token = await getMercadoPagoAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${providerPaymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "approved") return "PAID";
    if (data.status === "cancelled" || data.status === "rejected" || data.status === "expired") return "CANCELLED";
    return null;
  } catch {
    return null;
  }
}
