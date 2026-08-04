"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

interface EventOption {
  id: string;
  title: string;
}

export default function MessageTemplateList({ templates, events }: { templates: TemplateRow[]; events: EventOption[] }) {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState<Record<string, string>>({});

  function goToEventOverride(t: TemplateRow) {
    const key = `${t.alertKey}:${t.channel}:${t.recipientRole}`;
    const eventId = selectedEvent[key];
    if (!t.id || !eventId) return;
    router.push(`/admin/alertas/templates/${t.id}/eventos/${eventId}`);
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <th className="py-2 pr-4">Alerta</th>
            <th className="py-2 pr-4">Canal</th>
            <th className="py-2 pr-4">Destinatário</th>
            <th className="py-2 pr-4">Personalização</th>
            <th className="py-2 pr-4">Última alteração</th>
            <th className="py-2 pr-4" />
            <th className="py-2">Personalizar por evento</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => {
            const key = `${t.alertKey}:${t.channel}:${t.recipientRole}`;
            return (
              <tr key={key} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 pr-4">{t.description}</td>
                <td className="py-2 pr-4">{t.channel === "EMAIL" ? "E-mail" : "WhatsApp"}</td>
                <td className="py-2 pr-4">{t.recipientRole}</td>
                <td className="py-2 pr-4">
                  {/* "Personalização" indica se o texto customizado deste alerta está em uso — não
                      se o alerta em si está ligado/desligado (isso é controlado pelos cards acima).
                      Um template "Texto padrão" ainda dispara normalmente, só que com o texto de
                      fábrica do sistema. */}
                  <span className={t.id && t.active ? "text-green-700 dark:text-green-400" : "text-gray-400"}>
                    {t.id && t.active ? "Personalizado" : "Texto padrão"}
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-500">
                  {t.updatedAt ? new Date(t.updatedAt).toLocaleString("pt-BR") : "Nunca editado"}
                </td>
                <td className="py-2 pr-4">
                  {t.id && (
                    <Link href={`/admin/alertas/templates/${t.id}`} className="text-primary-700 dark:text-primary-400 hover:underline">
                      Editar
                    </Link>
                  )}
                </td>
                <td className="py-2">
                  {t.id && (
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedEvent[key] ?? ""}
                        onChange={(e) => setSelectedEvent((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="input-field text-xs py-1"
                      >
                        <option value="">Selecione um evento…</option>
                        {events.map((ev) => (
                          <option key={ev.id} value={ev.id}>{ev.title}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => goToEventOverride(t)}
                        disabled={!selectedEvent[key]}
                        className="text-primary-700 dark:text-primary-400 hover:underline text-xs disabled:opacity-40 disabled:hover:no-underline"
                      >
                        Personalizar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
