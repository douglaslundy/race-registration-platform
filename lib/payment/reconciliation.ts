import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentAccountById } from "./account-resolver";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { applyGatewayStatus } from "./sync-payment-status";

export interface PaymentMismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
  corrected: boolean;
}

const PAID_LOOKBACK_DAYS = 90;
const GATEWAY_TIMEOUT_MS = 15_000;
const GATEWAY_MAX_ATTEMPTS = 3;
const GATEWAY_RETRY_BASE_MS = 500;
const LATE_APPROVAL_LOOKBACK_DAYS = 7;

type Provider = Awaited<ReturnType<typeof getPaymentProvider>>;
type ProviderFor = (payment: { provider: string; paymentAccountId: string | null }) => Promise<Provider>;

/**
 * A reconciliação varre MUITOS pagamentos de uma vez, potencialmente feitos por contas Mercado
 * Pago diferentes (inclusive já arquivadas). Cada pagamento precisa ser checado na conta que ficou
 * congelada nele — então resolvemos um provider por conta e cacheamos. Pagamentos sem conta
 * (antigos) ou de outro provedor caem numa única chave `null` → provider global.
 */
function makeProviderFor(): ProviderFor {
  const cache = new Map<string | null, Provider>();
  return async (payment) => {
    const key = payment.provider === "mercadopago" ? payment.paymentAccountId : null;
    if (!cache.has(key)) {
      const account = key ? await getPaymentAccountById(key).catch(() => undefined) : undefined;
      cache.set(key, await getPaymentProvider(account));
    }
    return cache.get(key)!;
  };
}

export interface ReconciliationResult {
  /** Pagamentos selecionados para conferência (não significa que a consulta ao gateway deu certo). */
  checked: number;
  /** Pagamentos cuja consulta ao gateway ou aplicação local falhou — NÃO foram conferidos. */
  failed: number;
  mismatches: PaymentMismatch[];
}

type SectionResult = { checked: number; failed: number; mismatches: PaymentMismatch[] };

function isTransientGatewayError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; name?: string; code?: string } | null;
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number") return status === 429 || status >= 500;
  // Sem status HTTP: erro de rede/timeout (fetch failed, ECONNRESET, nossa própria TimeoutError).
  return true;
}

/**
 * Consulta o gateway com timeout e retry (backoff exponencial + jitter) só para falhas transitórias
 * (429, 5xx, rede, timeout). Erros definitivos (404, 401…) propagam de imediato.
 */
async function checkStatusResilient(provider: Provider, providerPaymentId: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GATEWAY_MAX_ATTEMPTS; attempt++) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("gateway timeout"), { name: "TimeoutError" })), GATEWAY_TIMEOUT_MS);
      });
      try {
        return await Promise.race([provider.checkPaymentStatus(providerPaymentId), timeout]);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastError = err;
      if (attempt === GATEWAY_MAX_ATTEMPTS || !isTransientGatewayError(err)) break;
      const delay = GATEWAY_RETRY_BASE_MS * 2 ** (attempt - 1) * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export async function reconcilePayments(options?: { organizerUserId?: string }): Promise<ReconciliationResult> {
  const settings = await getReconciliationAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);
  const organizerFilter = options?.organizerUserId
    ? { order: { event: { organizer: { userId: options.organizerUserId } } } }
    : {};

  const providerFor = makeProviderFor();
  // Resolve já o provider global (chave `null`) — cobre pagamentos sem conta congelada e de outros
  // provedores, que são a maioria. Contas Mercado Pago específicas (inclusive arquivadas) são
  // resolvidas sob demanda dentro de `providerFor`, uma vez por conta.
  await providerFor({ provider: "", paymentAccountId: null });

  const pending = await checkPendingMismatches(providerFor, cutoff, organizerFilter);
  const paid = await checkPaidMismatches(providerFor, organizerFilter);
  const lateApproval = await checkLateApprovalMismatches(providerFor, organizerFilter);

  const failed = pending.failed + paid.failed + lateApproval.failed;
  if (failed > 0) {
    console.error(`[reconcilePayments] ${failed} pagamento(s) NÃO foram conferidos por falha (gateway/aplicação) — conciliação parcial`);
  }

  return {
    checked: pending.checked + paid.checked + lateApproval.checked,
    failed,
    mismatches: [...pending.mismatches, ...paid.mismatches, ...lateApproval.mismatches],
  };
}

async function checkPendingMismatches(
  providerFor: ProviderFor,
  cutoff: Date,
  organizerFilter: Record<string, unknown>,
): Promise<SectionResult> {
  const payments = await db.payment.findMany({
    where: {
      status: "PENDING",
      providerPaymentId: { not: null },
      createdAt: { lte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      provider: true,
      paymentAccountId: true,
      providerPaymentId: true,
      status: true,
      order: {
        select: {
          id: true,
          status: true,
          event: { select: { title: true } },
          registrations: { select: { id: true, ticketBatchId: true, status: true } },
        },
      },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  let failed = 0;
  for (const payment of payments) {
    try {
      if (!payment.order) {
        // Reconciliação de pendentes só cobre pagamentos de Order (checkout). Se um pagamento de
        // AdPurchase aparecer aqui, cai no catch abaixo e loga alto sem travar os demais.
        throw new Error(`Payment ${payment.id} sem order associado`);
      }
      const order = payment.order;
      const provider = await providerFor(payment);
      const { status: gatewayStatus, gatewayFeeAmount, paidAt } = await checkStatusResilient(provider, payment.providerPaymentId as string);
      if (gatewayStatus === payment.status || gatewayStatus === "PENDING") continue;

      // Aplica a transição de verdade pra qualquer status terminal que o gateway reportar — não só
      // PAID. Antes, um pagamento PENDING localmente cujo gateway já dizia CANCELLED/EXPIRED/etc
      // ficava reportado como divergência (corrected:false) pra sempre, sem nunca ser corrigido:
      // a inscrição continuava presa em PENDING_PAYMENT e a vaga nunca voltava pro lote.
      const result = await db.$transaction(async (tx) => {
        return applyGatewayStatus(tx, payment, order, order.registrations, gatewayStatus, "reconciliation", {
          gatewayFeeAmount,
          ...(gatewayStatus === "PAID" ? { paidAt: paidAt ? new Date(paidAt) : new Date() } : {}),
        });
      });
      if (gatewayStatus === "PAID" && result.changed) {
        void notifyOrderConfirmed(order.id);
      }
      mismatches.push({
        paymentId: payment.id,
        orderId: order.id,
        eventTitle: order.event.title,
        localStatus: payment.status,
        gatewayStatus,
        corrected: result.changed,
      });
    } catch (err) {
      failed++;
      console.error("[reconcilePayments] failed to check pending payment", payment.id, err);
    }
  }

  return { checked: payments.length, failed, mismatches };
}

async function checkPaidMismatches(
  providerFor: ProviderFor,
  organizerFilter: Record<string, unknown>,
): Promise<SectionResult> {
  const cutoff = new Date(Date.now() - PAID_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const payments = await db.payment.findMany({
    where: {
      status: "PAID",
      providerPaymentId: { not: null },
      paidAt: { gte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      provider: true,
      paymentAccountId: true,
      providerPaymentId: true,
      status: true,
      orderId: true,
      order: {
        select: {
          id: true,
          status: true,
          event: { select: { title: true } },
          registrations: { select: { id: true, ticketBatchId: true, status: true } },
        },
      },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  let failed = 0;
  for (const payment of payments) {
    try {
      if (!payment.order) {
        // Reconciliação de pagos só cobre pagamentos de Order (checkout). Se um pagamento de
        // AdPurchase aparecer aqui, cai no catch abaixo e loga alto sem travar os demais.
        throw new Error(`Payment ${payment.id} sem order associado`);
      }
      const order = payment.order;
      const provider = await providerFor(payment);
      const { status: gatewayStatus } = await checkStatusResilient(provider, payment.providerPaymentId as string);
      if (gatewayStatus === "REFUNDED" || gatewayStatus === "CHARGEBACK") {
        await db.$transaction(async (tx) => {
          await applyGatewayStatus(tx, payment, order, order.registrations, gatewayStatus, "reconciliation");
        });
        mismatches.push({
          paymentId: payment.id,
          orderId: order.id,
          eventTitle: order.event.title,
          localStatus: payment.status,
          gatewayStatus,
          corrected: true,
        });
      }
    } catch (err) {
      failed++;
      console.error("[reconcilePayments] failed to check paid payment", payment.id, err);
    }
  }

  return { checked: payments.length, failed, mismatches };
}

async function checkLateApprovalMismatches(
  providerFor: ProviderFor,
  organizerFilter: Record<string, unknown>,
): Promise<SectionResult> {
  const cutoff = new Date(Date.now() - LATE_APPROVAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const payments = await db.payment.findMany({
    where: {
      status: { in: ["EXPIRED", "CANCELLED"] },
      providerPaymentId: { not: null },
      updatedAt: { gte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      provider: true,
      paymentAccountId: true,
      providerPaymentId: true,
      status: true,
      orderId: true,
      order: {
        select: {
          id: true,
          status: true,
          event: { select: { title: true } },
          registrations: { select: { id: true, ticketBatchId: true, status: true } },
        },
      },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  let failed = 0;
  for (const payment of payments) {
    try {
      if (!payment.order) {
        // Reconciliação de aprovações tardias só cobre pagamentos de Order (checkout). Se um
        // pagamento de AdPurchase aparecer aqui, cai no catch abaixo e loga alto sem travar os demais.
        throw new Error(`Payment ${payment.id} sem order associado`);
      }
      const order = payment.order;
      const provider = await providerFor(payment);
      const { status: gatewayStatus, gatewayFeeAmount, paidAt } = await checkStatusResilient(provider, payment.providerPaymentId as string);
      if (gatewayStatus === "PAID") {
        const result = await db.$transaction(async (tx) => {
          return applyGatewayStatus(tx, payment, order, order.registrations, gatewayStatus, "reconciliation", {
            gatewayFeeAmount,
            paidAt: paidAt ? new Date(paidAt) : new Date(),
          });
        });
        if (result.changed) {
          void notifyOrderConfirmed(order.id);
        }
        mismatches.push({
          paymentId: payment.id,
          orderId: order.id,
          eventTitle: order.event.title,
          localStatus: payment.status,
          gatewayStatus,
          corrected: true,
        });
      }
    } catch (err) {
      failed++;
      console.error("[reconcilePayments] failed to check late-approval payment", payment.id, err);
    }
  }

  return { checked: payments.length, failed, mismatches };
}
