const ENTRIES: Array<[string, string]> = [
  ["Receita do evento", "Valor dos ingressos vendidos, sem nenhuma taxa — a parte que pertence ao evento/organizador antes das taxas."],
  ["Taxa da plataforma", "Comissão cobrada pela plataforma em cada inscrição."],
  ["Taxa de serviço", "Taxa de processamento repassada ao comprador no momento da compra."],
  ["Comissão do gateway", "Valor real cobrado pelo Mercado Pago para processar os pagamentos — um custo da plataforma, não incluído no total pago pelo comprador."],
  ["Receita bruta", "Total efetivamente pago pelos compradores no período (ingresso + taxa da plataforma + taxa de serviço)."],
  ["Pagamentos cancelados", "Pagamentos que ficaram com status Pago mas cujo pedido foi cancelado depois — dinheiro coletado que ainda não foi estornado."],
  ["Estornos", "Pagamentos devolvidos aos compradores dentro do período filtrado, independente de quando a venda original ocorreu."],
  ["Receita líquida", "Receita bruta menos os estornos do período (regime de caixa — mesmo critério usado por processadores de pagamento)."],
  ["Repasse líquido", "Valor líquido já repassado ao organizador, depois de descontadas as taxas."],
];

export default function ReportKpiLegend() {
  return (
    <details className="card text-sm">
      <summary className="font-semibold cursor-pointer select-none">O que significa cada KPI?</summary>
      <dl className="mt-3 space-y-2">
        {ENTRIES.map(([term, description]) => (
          <div key={term} className="flex flex-col sm:flex-row sm:gap-2">
            <dt className="font-medium text-gray-700 dark:text-gray-300 sm:w-48 shrink-0">{term}</dt>
            <dd className="text-gray-500">{description}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
