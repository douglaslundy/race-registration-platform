/**
 * Auditoria da brecha C1 (bypass/replay de confirmação no /api/payments/mp-return).
 *
 * A rota mp-return confirmava um pedido chamando checkMPPaymentStatus(payment_id) com o
 * `payment_id` VINDO DA QUERY STRING (controlada pelo usuário), sem NUNCA verificar:
 *   - external_reference === orderId
 *   - transaction_amount === order.totalAmount
 *   - se aquele payment_id já pertence a outro pagamento
 *
 * Este script varre os pagamentos PAID e reconsulta cada um na API do Mercado Pago
 * (usando a access token da conta congelada no pagamento, ou a global), comparando o que
 * está no nosso banco com a verdade do gateway. Qualquer divergência = pedido confirmado
 * sem pagamento equivalente.
 *
 * Uso (na VPS, dentro do container da app ou com o .env de produção carregado):
 *   npx ts-node --compiler-options {"module":"CommonJS"} prisma/audit-mp-return-fraud.ts
 *   npx ts-node --compiler-options {"module":"CommonJS"} prisma/audit-mp-return-fraud.ts --all
 *   npx ts-node --compiler-options {"module":"CommonJS"} prisma/audit-mp-return-fraud.ts --since=2026-07-20
 * (--all inclui eventos já realizados; --since limita a data de criação do pagamento)
 *
 * Só LÊ o banco e a API do MP. Não escreve nada.
 */
import { PrismaClient } from "@prisma/client";
import { getMercadoPagoAccessToken } from "../lib/payment-settings";

const db = new PrismaClient();

const args = process.argv.slice(2);
const includeAll = args.includes("--all");
const sinceArg = args.find((a) => a.startsWith("--since="))?.split("=")[1];
// A brecha ganhou o trecho que escreve no banco no commit inicial (8a9cc11) e o
// payment_id passou a ser gravado como providerPaymentId desde então.
const since = sinceArg ? new Date(sinceArg) : new Date("2026-01-01");

interface MPPayment {
  id: number | string;
  status: string;
  external_reference?: string | null;
  transaction_amount?: number | null;
  date_approved?: string | null;
}

async function fetchMP(id: string, token: string): Promise<MPPayment | null> {
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`  ! MP respondeu ${res.status} para payment ${id}`);
      return null;
    }
    return (await res.json()) as MPPayment;
  } catch (err) {
    console.warn(`  ! erro ao consultar MP para payment ${id}:`, err);
    return null;
  }
}

async function main() {
  const globalToken = await getMercadoPagoAccessToken();

  const payments = await db.payment.findMany({
    where: {
      status: "PAID",
      provider: "mercadopago",
      providerPaymentId: { not: null },
      orderId: { not: null },
      createdAt: { gte: since },
    },
    include: {
      paymentAccount: true,
      order: {
        include: {
          event: { select: { id: true, title: true, startAt: true } },
          registrations: { select: { id: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();
  const scope = payments.filter(
    (p) => includeAll || !p.order?.event?.startAt || p.order.event.startAt >= now,
  );

  console.log(
    `\nAuditando ${scope.length} pagamento(s) PAID` +
      (includeAll ? " (todos os eventos)" : " (eventos correntes/futuros)") +
      ` desde ${since.toISOString().slice(0, 10)}\n`,
  );

  const seenProviderIds = new Map<string, string>(); // providerPaymentId -> paymentId
  const problems: string[] = [];

  for (const p of scope) {
    const order = p.order!;
    const token = p.paymentAccount?.accessToken ?? globalToken;
    const tag = `payment ${p.id} / order ${order.id} / evento "${order.event?.title ?? "?"}"`;

    // 1. providerPaymentId reutilizado entre pagamentos (replay)
    const dup = seenProviderIds.get(p.providerPaymentId!);
    if (dup) {
      problems.push(`REPLAY: ${tag} — providerPaymentId ${p.providerPaymentId} já usado no payment ${dup}`);
    }
    seenProviderIds.set(p.providerPaymentId!, p.id);

    // 2. pagamento PAID sem rawPayload = confirmado fora do webhook (mp-return ou status-poll)
    const confirmedOutsideWebhook = p.rawPayload == null;

    if (!token) {
      console.log(`- ${tag}: SEM TOKEN para reconsultar (conta ${p.paymentAccountId ?? "global"})`);
      continue;
    }

    const mp = await fetchMP(p.providerPaymentId!, token);
    if (!mp) {
      problems.push(`NAO ENCONTRADO NO MP: ${tag} — providerPaymentId ${p.providerPaymentId}`);
      continue;
    }

    const centavosMP = mp.transaction_amount != null ? Math.round(mp.transaction_amount * 100) : null;
    const extRefOk = mp.external_reference === order.id;
    const amountOk = centavosMP === order.totalAmount;
    const approvedOk = mp.status === "approved";

    if (!extRefOk || !amountOk || !approvedOk) {
      problems.push(
        `DIVERGENCIA: ${tag}\n` +
          `    banco: totalAmount=${order.totalAmount}c  providerPaymentId=${p.providerPaymentId}\n` +
          `    MP:    status=${mp.status}  external_reference=${mp.external_reference ?? "null"}  ` +
          `transaction_amount=${centavosMP ?? "null"}c\n` +
          `    -> external_reference ${extRefOk ? "OK" : "!= orderId"} | ` +
          `valor ${amountOk ? "OK" : "!= totalAmount"} | ` +
          `status ${approvedOk ? "OK" : "!= approved"}` +
          (confirmedOutsideWebhook ? "  [rawPayload nulo — confirmado fora do webhook]" : ""),
      );
    } else if (confirmedOutsideWebhook) {
      console.log(`- ${tag}: valores conferem, mas rawPayload nulo (confirmado via mp-return/status-poll) — revisar`);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  if (problems.length === 0) {
    console.log("Nenhuma divergência encontrada.");
  } else {
    console.log(`${problems.length} problema(s):\n`);
    for (const pr of problems) console.log(`* ${pr}\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
