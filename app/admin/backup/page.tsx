import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import type { Metadata } from "next";
import BackupDownloadButton from "@/components/admin/BackupDownloadButton";

export const metadata: Metadata = { title: "Backup — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminBackupPage() {
  await requireAdmin();

  const [userCount, eventCount, registrationCount, orderCount, paymentCount, couponCount] = await Promise.all([
    db.user.count(),
    db.event.count(),
    db.registration.count(),
    db.order.count(),
    db.payment.count(),
    db.coupon.count(),
  ]);

  const stats = [
    { label: "Usuários", count: userCount },
    { label: "Eventos", count: eventCount },
    { label: "Inscrições", count: registrationCount },
    { label: "Pedidos", count: orderCount },
    { label: "Pagamentos", count: paymentCount },
    { label: "Cupons", count: couponCount },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">Backup do sistema</h1>
        <p className="text-sm text-gray-500 mt-1">
          Exporta todos os dados do banco em formato JSON. O arquivo pode ser usado para recuperação ou auditoria.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Resumo do banco</h2>
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary-600">{s.count.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Gerar backup</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          O backup inclui todas as tabelas: usuários, eventos, inscrições, pedidos, pagamentos, cupons,
          lotes, categorias, percursos, repasses e estornos. Os dados são exportados em JSON com streaming
          — funciona mesmo com grandes volumes de dados sem timeout.
        </p>

        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          <strong>Atenção:</strong> o arquivo de backup contém dados sensíveis (e-mails, informações pessoais,
          dados financeiros). Armazene-o em local seguro e com acesso restrito.
        </div>

        <BackupDownloadButton />
      </div>
    </div>
  );
}
