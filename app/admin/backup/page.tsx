import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import type { Metadata } from "next";
import BackupDownloadButton from "@/components/admin/BackupDownloadButton";
import BackupImportButton from "@/components/admin/BackupImportButton";

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

      {/* Resumo */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Resumo do banco atual</h2>
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary-600">{s.count.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Exportar */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Exportar backup</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          O backup inclui todas as tabelas do sistema: usuários, perfis, eventos, inscrições,
          pedidos, pagamentos, cupons, lotes, categorias, percursos, repasses, resultados,
          arquivos, logs de auditoria e configurações da plataforma. Os dados são exportados em
          JSON com streaming — funciona mesmo com grandes volumes sem timeout.
        </p>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          <strong>Atenção:</strong> o arquivo de backup contém dados sensíveis (e-mails, informações pessoais,
          dados financeiros). Armazene-o em local seguro e com acesso restrito.
        </div>
        <BackupDownloadButton />
      </div>

      {/* Restaurar */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Restaurar backup</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Selecione um arquivo <code className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">.json</code> gerado
          pelo exportador acima. A restauração <strong>apaga todos os dados atuais</strong> das tabelas cobertas pelo backup
          e insere exatamente o conteúdo do arquivo — não é uma mesclagem, e IDs ou e-mails antigos não são preservados.
        </p>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-800 dark:text-red-300">
          <strong>Atenção:</strong> essa ação é destrutiva e não pode ser desfeita pelo sistema. Antes de apagar, um
          backup do estado atual é baixado automaticamente no seu navegador. Use somente em ambiente controlado e com
          certeza do que está restaurando.
        </div>
        <BackupImportButton />
      </div>
    </div>
  );
}
