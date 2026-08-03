"use client";

import Link from "next/link";

interface TemplateRow {
  id: string | null;
  alertKey: string;
  description: string;
  channel: string;
  recipientRole: string;
  scope: string;
  active: boolean;
  updatedAt: string | null;
}

export default function MessageTemplateList({ templates }: { templates: TemplateRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <th className="py-2 pr-4">Alerta</th>
            <th className="py-2 pr-4">Canal</th>
            <th className="py-2 pr-4">Destinatário</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Última alteração</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr
              key={`${t.alertKey}:${t.channel}:${t.recipientRole}`}
              className="border-b border-gray-100 dark:border-gray-800"
            >
              <td className="py-2 pr-4">{t.description}</td>
              <td className="py-2 pr-4">{t.channel === "EMAIL" ? "E-mail" : "WhatsApp"}</td>
              <td className="py-2 pr-4">{t.recipientRole}</td>
              <td className="py-2 pr-4">
                <span className={t.active ? "text-green-700 dark:text-green-400" : "text-gray-400"}>
                  {t.active ? "Ativo" : "Inativo"}
                </span>
              </td>
              <td className="py-2 pr-4 text-gray-500">
                {t.updatedAt ? new Date(t.updatedAt).toLocaleString("pt-BR") : "Nunca editado"}
              </td>
              <td className="py-2">
                {t.id && (
                  <Link
                    href={`/admin/alertas/templates/${t.id}`}
                    className="text-primary-700 dark:text-primary-400 hover:underline"
                  >
                    Editar
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
