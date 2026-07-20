import { formatCurrency } from "@/lib/format";
import type { RevenueBreakdown } from "@/lib/revenue-breakdown";

interface RowProps {
  label: string;
  value: number;
  tone?: "default" | "muted" | "highlight";
}

function Row({ label, value, tone = "default" }: RowProps) {
  const valueCls =
    tone === "highlight"
      ? "font-bold text-primary-600"
      : tone === "muted"
        ? "text-gray-500 dark:text-gray-400"
        : "font-medium";
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className={tone === "highlight" ? "font-semibold" : "text-gray-600 dark:text-gray-400"}>{label}</span>
      <span className={valueCls}>{formatCurrency(value)}</span>
    </div>
  );
}

/**
 * Cascata de reconciliação de receita — mesma fonte de dados (computeRevenueBreakdown) em
 * todo lugar que mostra receita, pra nunca mais aparecer um número diferente pro mesmo período.
 *
 * variant="admin": mostra a cascata completa até a margem real da plataforma (o número que
 * deve bater com o extrato do gateway de pagamento).
 * variant="organizer": mostra só até "Receita do evento" (o repasse do organizador) + uma nota
 * explicando que a comissão do gateway não reduz esse valor (é a plataforma quem absorve).
 */
export default function RevenueBreakdownCard({
  breakdown,
  variant,
}: {
  breakdown: RevenueBreakdown;
  variant: "admin" | "organizer";
}) {
  const { grossRevenue, platformFeeAmount, serviceFeeAmount, eventRevenue, gatewayFeeAmount, platformNetMargin } = breakdown;

  return (
    <div className="card space-y-2">
      <h2 className="font-semibold mb-1">Composição da receita</h2>
      <Row label="Receita bruta (pago pelo atleta)" value={grossRevenue} />
      <Row label="− Taxa da plataforma" value={-platformFeeAmount} tone="muted" />
      {serviceFeeAmount > 0 && <Row label="− Taxa de serviço" value={-serviceFeeAmount} tone="muted" />}
      <Row
        label={variant === "organizer" ? "= Receita do evento (seu repasse)" : "= Receita do evento"}
        value={eventRevenue}
        tone="highlight"
      />

      {variant === "admin" && (
        <>
          <Row label="− Comissão do gateway" value={-gatewayFeeAmount} tone="muted" />
          <Row label="= Margem real da plataforma" value={platformNetMargin} tone="highlight" />
          <p className="text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-2 mt-2">
            "Margem real da plataforma" é o número que deve bater com o saldo movimentado na
            conta do gateway de pagamento no período.
          </p>
        </>
      )}

      {variant === "organizer" && (
        <p className="text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-2 mt-2">
          A comissão do gateway de pagamento ({formatCurrency(gatewayFeeAmount)} no período) é
          descontada da plataforma, não do seu repasse — "Receita do evento" acima é o valor
          integral a que você tem direito.
        </p>
      )}
    </div>
  );
}
