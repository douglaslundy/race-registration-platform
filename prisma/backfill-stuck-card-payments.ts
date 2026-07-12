/**
 * Corrige pagamentos de cartão criados ANTES do fix de expiração (commits c39a97b..f4b0030):
 * ficaram PENDING com expiresAt=null, invisíveis para sempre ao cron/botões manuais de expiração.
 * Reconsulta o status real no gateway e aplica a transição correta (ou, se o gateway ainda disser
 * "pendente", só atribui um expiresAt curto pra deixar a rede de segurança normal cuidar dele daqui
 * pra frente). Só olhando o histórico do banco (payment.provider) — não usa a config atual da
 * plataforma, porque um pagamento antigo pode ter sido criado com um gateway diferente do vigente
 * hoje.
 *
 * Uso:
 *   npx ts-node --compiler-options {"module":"CommonJS"} prisma/backfill-stuck-card-payments.ts --dry-run
 *   npx ts-node --compiler-options {"module":"CommonJS"} prisma/backfill-stuck-card-payments.ts
 *
 * Rode sempre com --dry-run primeiro pra conferir o que seria feito antes de aplicar de verdade.
 */
import { PrismaClient } from "@prisma/client";
import { MercadoPagoProvider } from "../lib/payment/mercadopago";
import { PagarMeProvider } from "../lib/payment/pagarme";
import { SandboxPaymentProvider } from "../lib/payment/sandbox";
import { applyGatewayStatus, type GatewayPaymentStatus } from "../lib/payment/sync-payment-status";
import type { PaymentProvider } from "../lib/payment/types";

const db = new PrismaClient();

const MP_FALLBACK_MS = 48 * 3600 * 1000;
const PAGARME_FALLBACK_MS = 3600 * 1000;

function providerFor(key: string): PaymentProvider {
  if (key === "mercadopago") return new MercadoPagoProvider();
  if (key === "pagarme") return new PagarMeProvider();
  return new SandboxPaymentProvider();
}

function fallbackMsFor(key: string): number {
  return key === "mercadopago" ? MP_FALLBACK_MS : PAGARME_FALLBACK_MS;
}

const TERMINAL_STATUSES: GatewayPaymentStatus[] = ["PAID", "EXPIRED", "CANCELLED", "REFUNDED", "CHARGEBACK"];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "=== DRY RUN (nada será escrito no banco) ===" : "=== APLICANDO CORREÇÕES ===");

  const stuck = await db.payment.findMany({
    where: {
      method: "CREDIT_CARD",
      status: "PENDING",
      expiresAt: null,
      providerPaymentId: { not: null },
    },
    select: {
      id: true,
      status: true,
      provider: true,
      providerPaymentId: true,
      order: {
        select: {
          id: true,
          status: true,
          registrations: { select: { id: true, ticketBatchId: true, status: true } },
        },
      },
    },
  });

  console.log(`Encontrados ${stuck.length} pagamentos de cartão presos em PENDING sem expiresAt.\n`);

  let corrected = 0;
  let stillPending = 0;
  let errors = 0;

  for (const payment of stuck) {
    try {
      const provider = providerFor(payment.provider);
      const { status: gatewayStatus, gatewayFeeAmount, paidAt } = await provider.checkPaymentStatus(
        payment.providerPaymentId as string,
      );

      if (TERMINAL_STATUSES.includes(gatewayStatus as GatewayPaymentStatus)) {
        console.log(
          `[payment ${payment.id}] gateway diz "${gatewayStatus}" (era PENDING local) — ${dryRun ? "aplicaria" : "aplicando"} transição.`,
        );
        if (!dryRun) {
          await db.$transaction(async (tx) => {
            await applyGatewayStatus(
              tx,
              payment,
              payment.order,
              payment.order.registrations,
              gatewayStatus as GatewayPaymentStatus,
              "reconciliation",
              { gatewayFeeAmount, paidAt: paidAt ? new Date(paidAt) : undefined },
            );
          });
        }
        corrected++;
        continue;
      }

      // Gateway ainda diz que está em processamento/pendente de verdade — não força cancelamento,
      // só atribui um expiresAt curto pra ele passar a ser visto pela rede de segurança normal.
      const expiresAt = new Date(Date.now() + fallbackMsFor(payment.provider));
      console.log(
        `[payment ${payment.id}] gateway ainda diz "${gatewayStatus}" — ${dryRun ? "atribuiria" : "atribuindo"} expiresAt=${expiresAt.toISOString()}.`,
      );
      if (!dryRun) {
        await db.payment.update({ where: { id: payment.id }, data: { expiresAt } });
      }
      stillPending++;
    } catch (err) {
      console.error(`[payment ${payment.id}] erro ao consultar/corrigir:`, err);
      errors++;
    }
  }

  console.log("\n=== Resumo ===");
  console.log(`Total encontrado: ${stuck.length}`);
  console.log(`Corrigido (transição terminal aplicada): ${corrected}`);
  console.log(`Ainda pendente no gateway (expiresAt atribuído): ${stillPending}`);
  console.log(`Erros: ${errors}`);
  if (dryRun) console.log("\nNenhuma escrita foi feita (--dry-run). Rode sem --dry-run para aplicar.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
