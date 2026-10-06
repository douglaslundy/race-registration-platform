import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getPaymentAccountById } from "./account-resolver";
import type { PaymentMismatch } from "./reconciliation";

const CURSOR_PREFIX = "reconciliation_delta_cursor:";
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Pagamento recém-criado no gateway ainda pode não ter o registro local (o checkout só grava o
// Payment depois que o gateway responde). Ignora o que mudou há menos que isso pra não acusar órfão
// falso.
const SETTLE_MS = 5 * 60 * 1000;
// Sobreposição ao retomar o cursor: tolera relógio/ordenação ligeiramente diferentes no gateway. A
// reprocessagem é idempotente.
const OVERLAP_MS = 2 * 60 * 1000;

/**
 * Conciliação por delta: em vez de consultar pagamento por pagamento, busca no gateway tudo que
 * mudou desde o último cursor (uma busca paginada por conta). Faz duas coisas, sem aplicar nenhuma
 * transição direto — a mudança de status continua passando só pelo caminho já testado
 * (`applyGatewayStatus`, via conferência individual):
 *  1. Pagamento local com status diferente do gateway → zera `reconciledAt`, o que o põe na frente
 *     da fila da conferência escalonada desta mesma execução.
 *  2. Pagamento APROVADO no gateway cujo `external_reference` é um pedido nosso mas que não existe
 *     localmente (cobrança criada no gateway cuja gravação local falhou) → divergência manual.
 */
export async function reconcileDelta(now: number): Promise<{ mismatches: PaymentMismatch[]; failed: number }> {
  const accounts = await db.paymentAccount.findMany({ where: { provider: "mercadopago" }, select: { id: true } });
  const targets: (string | null)[] = [null, ...accounts.map((a) => a.id)];

  const mismatches: PaymentMismatch[] = [];
  let failed = 0;

  for (const accountId of targets) {
    try {
      const account = accountId ? await getPaymentAccountById(accountId).catch(() => undefined) : undefined;
      if (accountId && !account) continue;
      const provider = await getPaymentProvider(account);
      if (!provider.searchUpdatedSince) continue;

      const cursorKey = `${CURSOR_PREFIX}${accountId ?? "global"}`;
      const stored = await db.platformSetting.findUnique({ where: { key: cursorKey } });
      const parsed = stored ? new Date(stored.value) : null;
      const since = parsed && !Number.isNaN(parsed.getTime()) ? new Date(parsed.getTime() - OVERLAP_MS) : new Date(now - FIRST_RUN_LOOKBACK_MS);
      const boundary = now - SETTLE_MS;

      const { payments, truncated } = await provider.searchUpdatedSince(since);

      // Só processa o que já "assentou"; se a busca foi truncada, o cursor para onde ela parou.
      const settled = payments.filter((p) => !p.updatedAt || new Date(p.updatedAt).getTime() <= boundary);
      const lastUpdated = settled.length > 0 ? settled[settled.length - 1].updatedAt : undefined;
      const nextCursor = truncated && lastUpdated ? new Date(lastUpdated) : new Date(boundary);

      if (settled.length > 0) {
        const local = await db.payment.findMany({
          where: { providerPaymentId: { in: settled.map((p) => p.providerPaymentId) } },
          select: { id: true, providerPaymentId: true, status: true },
        });
        const localByProviderId = new Map(local.map((l) => [l.providerPaymentId, l]));

        const driftIds = settled
          .filter((p) => {
            const l = localByProviderId.get(p.providerPaymentId);
            return l && p.status !== "PENDING" && p.status !== l.status;
          })
          .map((p) => localByProviderId.get(p.providerPaymentId)!.id);
        if (driftIds.length > 0) {
          // SQL cru: `updateMany` empurraria `updatedAt` (que a janela de aprovação tardia usa).
          await db.$executeRaw`UPDATE "payments" SET "reconciledAt" = NULL WHERE "id" IN (${Prisma.join(driftIds)})`;
        }

        const orphanCandidates = settled.filter(
          (p) => p.status === "PAID" && p.externalReference && !localByProviderId.has(p.providerPaymentId),
        );
        if (orphanCandidates.length > 0) {
          const orders = await db.order.findMany({
            where: { id: { in: orphanCandidates.map((p) => p.externalReference as string) } },
            select: { id: true, event: { select: { title: true } } },
          });
          const orderById = new Map(orders.map((o) => [o.id, o]));
          for (const p of orphanCandidates) {
            const order = orderById.get(p.externalReference as string);
            if (!order) continue; // external_reference que não é pedido nosso (outro uso da conta)
            mismatches.push({
              paymentId: `gateway:${p.providerPaymentId}`,
              orderId: order.id,
              eventTitle: order.event.title,
              localStatus: "SEM REGISTRO LOCAL",
              gatewayStatus: "PAID",
              corrected: false,
            });
          }
        }
      }

      await db.platformSetting.upsert({
        where: { key: cursorKey },
        create: { key: cursorKey, value: nextCursor.toISOString() },
        update: { value: nextCursor.toISOString() },
      });
    } catch (err) {
      failed++;
      console.error("[reconcileDelta] falha na busca por delta da conta", accountId ?? "global", err);
    }
  }

  return { mismatches, failed };
}
