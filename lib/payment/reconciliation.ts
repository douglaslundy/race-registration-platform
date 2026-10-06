import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentAccountById } from "./account-resolver";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { applyGatewayStatus } from "./sync-payment-status";
import { acquireJobLease, releaseJobLease } from "@/lib/job-lease";

export interface PaymentMismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
  corrected: boolean;
}

const PAID_LOOKBACK_DAYS = 90;
const LEASE_KEY = "payment-reconciliation";
const LEASE_TTL_MS = 10 * 60 * 1000;
const CONCURRENCY = 5;
const FAILURE_RETRY_MS = 5 * 60 * 1000;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Conferência escalonada: quanto mais velho o pagamento, menos vezes ele é reconferido. Cada faixa
 * vale para idades em `(faixa anterior, maxAgeMs]`; `intervalMs` é o tempo mínimo desde `reconciledAt`.
 * Pagamentos nunca conferidos (`reconciledAt` nulo) sempre entram.
 */
interface Tier {
  maxAgeMs: number;
  intervalMs: number;
}
const PENDING_TIERS: Tier[] = [
  { maxAgeMs: HOUR, intervalMs: 5 * MIN },
  { maxAgeMs: DAY, intervalMs: HOUR },
  { maxAgeMs: Infinity, intervalMs: 12 * HOUR },
];
// Estorno/chargeback chegam por webhook; a varredura de PAID é só rede de segurança.
const PAID_TIERS: Tier[] = [
  { maxAgeMs: DAY, intervalMs: 6 * HOUR },
  { maxAgeMs: 7 * DAY, intervalMs: DAY },
  { maxAgeMs: 30 * DAY, intervalMs: 7 * DAY },
  { maxAgeMs: Infinity, intervalMs: 30 * DAY },
];
const LATE_TIERS: Tier[] = [
  { maxAgeMs: DAY, intervalMs: 30 * MIN },
  { maxAgeMs: Infinity, intervalMs: 6 * HOUR },
];
const PENDING_BATCH = 500;
const PAID_BATCH = 300;
const LATE_BATCH = 200;

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
  /** true quando outra conciliação já estava em andamento (lease ocupado) e esta execução não fez nada. */
  skipped?: boolean;
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

export async function reconcilePayments(options?: { organizerUserId?: string; force?: boolean }): Promise<ReconciliationResult> {
  // Execuções globais (cron/admin) disputam um lease; a do organizador é escopada e barata, não precisa.
  const useLease = !options?.organizerUserId;
  if (useLease && !(await acquireJobLease(LEASE_KEY, LEASE_TTL_MS))) {
    return { checked: 0, failed: 0, mismatches: [], skipped: true };
  }
  try {
    return await runReconciliation(options);
  } finally {
    if (useLease) await releaseJobLease(LEASE_KEY);
  }
}

async function runReconciliation(options?: { organizerUserId?: string; force?: boolean }): Promise<ReconciliationResult> {
  const settings = await getReconciliationAlertSettings();
  const now = Date.now();
  const cutoff = new Date(now - settings.minutesThreshold * 60 * 1000);
  const organizerFilter = options?.organizerUserId
    ? { order: { event: { organizer: { userId: options.organizerUserId } } } }
    : {};

  const providerFor = makeProviderFor();
  // Resolve já o provider global (chave `null`) — cobre pagamentos sem conta congelada e de outros
  // provedores, que são a maioria. Contas Mercado Pago específicas (inclusive arquivadas) são
  // resolvidas sob demanda dentro de `providerFor`, uma vez por conta.
  await providerFor({ provider: "", paymentAccountId: null });

  // Execução manual (`force`) ignora o escalonamento de PENDING e aprovação tardia — o usuário
  // clicou pra conferir agora. PAID continua escalonado (varredura de segurança, a mais cara).
  const scheduled = options?.force !== true;
  const pending = await checkPendingMismatches(providerFor, cutoff, organizerFilter, now, scheduled);
  const paid = await checkPaidMismatches(providerFor, organizerFilter, now);
  const lateApproval = await checkLateApprovalMismatches(providerFor, organizerFilter, now, scheduled);

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

function tierFor(ageMs: number, tiers: Tier[]): Tier {
  return tiers.find((t) => ageMs <= t.maxAgeMs) ?? tiers[tiers.length - 1];
}

/**
 * Cláusula Prisma que seleciona só o que está "vencido" para reconferência: para cada faixa de
 * idade, `reconciledAt` nulo ou mais antigo que o intervalo da faixa. `ageField` é a coluna que
 * mede a idade do pagamento (createdAt / paidAt / updatedAt).
 */
function dueClause(ageField: "createdAt" | "paidAt" | "updatedAt", tiers: Tier[], now: number) {
  let lower = 0;
  const or = tiers.map((tier) => {
    const range: { gt?: Date; lte?: Date } = {};
    if (tier.maxAgeMs !== Infinity) range.gt = new Date(now - tier.maxAgeMs);
    if (lower > 0) range.lte = new Date(now - lower);
    lower = tier.maxAgeMs;
    return {
      ...(Object.keys(range).length ? { [ageField]: range } : {}),
      OR: [{ reconciledAt: null }, { reconciledAt: { lt: new Date(now - tier.intervalMs) } }],
    };
  });
  return { OR: or };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

interface BatchPayment {
  id: string;
  updatedAt?: Date;
}

/**
 * Processa um lote com concorrência limitada e marca `reconciledAt` de cada pagamento para que a
 * próxima execução não o reconfira antes do intervalo da faixa. Em falha, agenda retry em
 * ~FAILURE_RETRY_MS (em vez de esperar o intervalo inteiro) sem deixar o pagamento monopolizar o lote.
 * `reconciledAt` é anotação interna: não pode empurrar `updatedAt` quando nada mudou (a janela de
 * aprovação tardia usa `updatedAt`), por isso o valor antigo é devolvido explicitamente.
 */
async function runBatch<P extends BatchPayment>(
  payments: P[],
  tiers: Tier[],
  ageOf: (p: P) => Date | null | undefined,
  now: number,
  handle: (p: P) => Promise<{ mismatch?: PaymentMismatch; changed: boolean }>,
): Promise<SectionResult> {
  const mismatches: PaymentMismatch[] = [];
  let failed = 0;

  await mapLimit(payments, CONCURRENCY, async (payment) => {
    const age = ageOf(payment);
    const interval = tierFor(age ? now - age.getTime() : 0, tiers).intervalMs;
    let reconciledAt = new Date(now);
    let changed = false;
    try {
      const outcome = await handle(payment);
      changed = outcome.changed;
      if (outcome.mismatch) mismatches.push(outcome.mismatch);
    } catch (err) {
      failed++;
      reconciledAt = new Date(now - Math.max(0, interval - FAILURE_RETRY_MS));
      console.error("[reconcilePayments] failed to check payment", payment.id, err);
    }
    try {
      await db.payment.update({
        where: { id: payment.id },
        data: { reconciledAt, ...(changed ? {} : { updatedAt: payment.updatedAt }) },
      });
    } catch (err) {
      console.error("[reconcilePayments] failed to mark reconciledAt", payment.id, err);
    }
  });

  return { checked: payments.length, failed, mismatches };
}

const orderSelect = {
  select: {
    id: true,
    status: true,
    event: { select: { title: true } },
    registrations: { select: { id: true, ticketBatchId: true, status: true } },
  },
} as const;

async function checkPendingMismatches(
  providerFor: ProviderFor,
  cutoff: Date,
  organizerFilter: Record<string, unknown>,
  now: number,
  scheduled: boolean,
): Promise<SectionResult> {
  const payments = await db.payment.findMany({
    where: {
      status: "PENDING",
      providerPaymentId: { not: null },
      createdAt: { lte: cutoff },
      ...(scheduled ? { AND: [dueClause("createdAt", PENDING_TIERS, now)] } : {}),
      ...organizerFilter,
    },
    orderBy: [{ reconciledAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: PENDING_BATCH,
    select: {
      id: true,
      updatedAt: true,
      createdAt: true,
      provider: true,
      paymentAccountId: true,
      providerPaymentId: true,
      status: true,
      order: orderSelect,
    },
  });

  return runBatch(payments, PENDING_TIERS, (p) => p.createdAt, now, async (payment) => {
    if (!payment.order) {
      // Reconciliação de pendentes só cobre pagamentos de Order (checkout). Se um pagamento de
      // AdPurchase aparecer aqui, cai no catch do runBatch e loga alto sem travar os demais.
      throw new Error(`Payment ${payment.id} sem order associado`);
    }
    const order = payment.order;
    const provider = await providerFor(payment);
    const { status: gatewayStatus, gatewayFeeAmount, paidAt } = await checkStatusResilient(provider, payment.providerPaymentId as string);
    if (gatewayStatus === payment.status || gatewayStatus === "PENDING") return { changed: false };

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
    return {
      changed: result.changed,
      mismatch: {
        paymentId: payment.id,
        orderId: order.id,
        eventTitle: order.event.title,
        localStatus: payment.status,
        gatewayStatus,
        corrected: result.changed,
      },
    };
  });
}

async function checkPaidMismatches(
  providerFor: ProviderFor,
  organizerFilter: Record<string, unknown>,
  now: number,
): Promise<SectionResult> {
  const cutoff = new Date(now - PAID_LOOKBACK_DAYS * DAY);
  const payments = await db.payment.findMany({
    where: {
      status: "PAID",
      providerPaymentId: { not: null },
      paidAt: { gte: cutoff },
      AND: [dueClause("paidAt", PAID_TIERS, now)],
      ...organizerFilter,
    },
    orderBy: [{ reconciledAt: { sort: "asc", nulls: "first" } }, { paidAt: "desc" }],
    take: PAID_BATCH,
    select: {
      id: true,
      updatedAt: true,
      paidAt: true,
      provider: true,
      paymentAccountId: true,
      providerPaymentId: true,
      status: true,
      orderId: true,
      order: orderSelect,
    },
  });

  return runBatch(payments, PAID_TIERS, (p) => p.paidAt, now, async (payment) => {
    if (!payment.order) {
      // Reconciliação de pagos só cobre pagamentos de Order (checkout). Se um pagamento de
      // AdPurchase aparecer aqui, cai no catch do runBatch e loga alto sem travar os demais.
      throw new Error(`Payment ${payment.id} sem order associado`);
    }
    const order = payment.order;
    const provider = await providerFor(payment);
    const { status: gatewayStatus } = await checkStatusResilient(provider, payment.providerPaymentId as string);
    if (gatewayStatus !== "REFUNDED" && gatewayStatus !== "CHARGEBACK") return { changed: false };

    const result = await db.$transaction(async (tx) => {
      return applyGatewayStatus(tx, payment, order, order.registrations, gatewayStatus, "reconciliation");
    });
    return {
      changed: result.changed,
      mismatch: {
        paymentId: payment.id,
        orderId: order.id,
        eventTitle: order.event.title,
        localStatus: payment.status,
        gatewayStatus,
        corrected: true,
      },
    };
  });
}

async function checkLateApprovalMismatches(
  providerFor: ProviderFor,
  organizerFilter: Record<string, unknown>,
  now: number,
  scheduled: boolean,
): Promise<SectionResult> {
  const cutoff = new Date(now - LATE_APPROVAL_LOOKBACK_DAYS * DAY);
  const payments = await db.payment.findMany({
    where: {
      status: { in: ["EXPIRED", "CANCELLED"] },
      providerPaymentId: { not: null },
      updatedAt: { gte: cutoff },
      ...(scheduled ? { AND: [dueClause("updatedAt", LATE_TIERS, now)] } : {}),
      ...organizerFilter,
    },
    orderBy: [{ reconciledAt: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }],
    take: LATE_BATCH,
    select: {
      id: true,
      updatedAt: true,
      provider: true,
      paymentAccountId: true,
      providerPaymentId: true,
      status: true,
      orderId: true,
      order: orderSelect,
    },
  });

  return runBatch(payments, LATE_TIERS, (p) => p.updatedAt, now, async (payment) => {
    if (!payment.order) {
      // Reconciliação de aprovações tardias só cobre pagamentos de Order (checkout). Se um
      // pagamento de AdPurchase aparecer aqui, cai no catch do runBatch e loga alto sem travar os demais.
      throw new Error(`Payment ${payment.id} sem order associado`);
    }
    const order = payment.order;
    const provider = await providerFor(payment);
    const { status: gatewayStatus, gatewayFeeAmount, paidAt } = await checkStatusResilient(provider, payment.providerPaymentId as string);
    if (gatewayStatus !== "PAID") return { changed: false };

    const result = await db.$transaction(async (tx) => {
      return applyGatewayStatus(tx, payment, order, order.registrations, gatewayStatus, "reconciliation", {
        gatewayFeeAmount,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
      });
    });
    if (result.changed) {
      void notifyOrderConfirmed(order.id);
    }
    return {
      changed: result.changed,
      mismatch: {
        paymentId: payment.id,
        orderId: order.id,
        eventTitle: order.event.title,
        localStatus: payment.status,
        gatewayStatus,
        corrected: true,
      },
    };
  });
}
