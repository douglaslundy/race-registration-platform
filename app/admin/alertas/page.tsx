import { requireAdmin } from "@/lib/auth/rbac";
import AlertConfigCard from "@/components/admin/AlertConfigCard";
import {
  getLowStockAlertSettings,
  getAbandonedCartAlertSettings,
  getPaymentErrorAlertSettings,
  getReconciliationAlertSettings,
  getCancellationAlertSettings,
} from "@/lib/alerts/alert-settings";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Alertas — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAlertasPage() {
  await requireAdmin();

  const [lowStock, abandonedCart, paymentError, reconciliation, cancellation] = await Promise.all([
    getLowStockAlertSettings(),
    getAbandonedCartAlertSettings(),
    getPaymentErrorAlertSettings(),
    getReconciliationAlertSettings(),
    getCancellationAlertSettings(),
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">Alertas</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure quais alertas automáticos são enviados por e-mail e/ou WhatsApp. Todos vêm desligados por padrão.
        </p>
      </div>

      <AlertConfigCard
        title="Vagas se esgotando"
        description="Avisa o organizador do evento quando um lote de ingressos atinge o limiar de vendas configurado."
        emailKey="alert_low_stock_email_enabled"
        whatsappKey="alert_low_stock_whatsapp_enabled"
        paramKey="alert_low_stock_threshold_percent"
        paramLabel="Limiar"
        paramSuffix="% vendido"
        currentEmailEnabled={lowStock.emailEnabled}
        currentWhatsappEnabled={lowStock.whatsappEnabled}
        currentParamValue={lowStock.thresholdPercent}
      />

      <AlertConfigCard
        title="Carrinho abandonado"
        description="Avisa o atleta quando um pedido fica pendente (sem pagamento) por mais tempo do que o limite configurado. Requer uma tarefa agendada (crontab) chamando /api/cron/abandoned-carts."
        emailKey="alert_abandoned_cart_email_enabled"
        whatsappKey="alert_abandoned_cart_whatsapp_enabled"
        paramKey="alert_abandoned_cart_minutes"
        paramLabel="Após"
        paramSuffix="minutos pendente"
        currentEmailEnabled={abandonedCart.emailEnabled}
        currentWhatsappEnabled={abandonedCart.whatsappEnabled}
        currentParamValue={abandonedCart.minutesThreshold}
      />

      <AlertConfigCard
        title="Erro de pagamento"
        description="Avisa o atleta quando um pagamento é recusado ou expira."
        emailKey="alert_payment_error_email_enabled"
        whatsappKey="alert_payment_error_whatsapp_enabled"
        currentEmailEnabled={paymentError.emailEnabled}
        currentWhatsappEnabled={paymentError.whatsappEnabled}
      />

      <AlertConfigCard
        title="Divergência de conciliação"
        description="Avisa todo admin quando a conciliação encontra pagamentos pendentes há muito tempo com status diferente no gateway. Requer uma tarefa agendada (crontab) chamando /api/cron/reconciliation, ou pode ser disparada manualmente em Admin/Organizador → Conciliação."
        emailKey="alert_reconciliation_email_enabled"
        whatsappKey="alert_reconciliation_whatsapp_enabled"
        paramKey="alert_reconciliation_minutes_threshold"
        paramLabel="Após"
        paramSuffix="minutos pendente"
        currentEmailEnabled={reconciliation.emailEnabled}
        currentWhatsappEnabled={reconciliation.whatsappEnabled}
        currentParamValue={reconciliation.minutesThreshold}
      />

      <AlertConfigCard
        title="Solicitação de cancelamento"
        description="Avisa todos os admins e o organizador do evento quando um atleta solicita o cancelamento da inscrição e precisa de aprovação."
        emailKey="alert_cancellation_email_enabled"
        whatsappKey="alert_cancellation_whatsapp_enabled"
        currentEmailEnabled={cancellation.emailEnabled}
        currentWhatsappEnabled={cancellation.whatsappEnabled}
      />
    </div>
  );
}
