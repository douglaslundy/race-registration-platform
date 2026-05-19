import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getAppName } from "@/lib/settings";
import SetPlatformFeeForm from "@/components/admin/SetPlatformFeeForm";
import AppNameForm from "@/components/admin/AppNameForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Configurações — Admin" };

export default async function ConfiguracoesPage() {
  await requireAdmin();

  const [events, appName] = await Promise.all([
    db.event.findMany({
      where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      select: { id: true, title: true, platformFeePercent: true, status: true },
      orderBy: { title: "asc" },
    }),
    getAppName(),
  ]);

  return (
    <div className="space-y-8 max-w-3xl">
      <h1 className="text-2xl font-bold dark:text-gray-100">Configurações</h1>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Nome da plataforma</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Nome exibido no cabeçalho, rodapé, e-mails e título das páginas.
        </p>
        <AppNameForm currentName={appName} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Taxa da plataforma por evento</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          A taxa é configurada por evento em pontos base (1100 = 11%). Alterar aqui afeta somente novos pedidos.
        </p>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum evento ativo.</p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <SetPlatformFeeForm key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
