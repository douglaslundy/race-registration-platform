import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MESSAGE_TYPE_LABEL } from "@/lib/message-logs";

export interface MessageLogRow {
  id: string;
  channel: "EMAIL" | "WHATSAPP";
  messageType: string | null;
  subject: string;
  recipientAddress: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  sentAt: Date | null;
  createdAt: Date;
  recipientUser: { name: string } | null;
}

const STATUS_ICON: Record<string, { icon: string; color: string; label: string }> = {
  SENT: { icon: "✓", color: "text-gray-400", label: "Enviado" },
  DELIVERED: { icon: "✓✓", color: "text-gray-400", label: "Entregue" },
  READ: { icon: "✓✓", color: "text-blue-500", label: "Lido" },
  FAILED: { icon: "✕", color: "text-red-500", label: "Falhou" },
};

const CHANNEL_INFO: Record<MessageLogRow["channel"], { icon: string; label: string; color: string }> = {
  EMAIL: { icon: "📧", label: "E-mail", color: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
  WHATSAPP: { icon: "💬", label: "WhatsApp", color: "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" },
};

export default function MessageLogList({ rows }: { rows: MessageLogRow[] }) {
  if (rows.length === 0) {
    return <div className="card text-center py-12 text-gray-500">Nenhuma mensagem encontrada.</div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b dark:border-gray-700 text-xs uppercase">
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Canal</th>
            <th className="pb-2 pr-4">Tipo</th>
            <th className="pb-2 pr-4">Destinatário</th>
            <th className="pb-2 pr-4">Assunto</th>
            <th className="pb-2">Quando</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const statusInfo = STATUS_ICON[row.status] ?? STATUS_ICON.SENT;
            const channelInfo = CHANNEL_INFO[row.channel];
            return (
              <tr key={row.id} className="border-b dark:border-gray-700 last:border-0 align-top">
                <td className="py-2 pr-4">
                  <span className={`font-bold ${statusInfo.color}`} title={statusInfo.label}>
                    {statusInfo.icon}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${channelInfo.color}`}>
                    {channelInfo.icon} {channelInfo.label}
                  </span>
                </td>
                <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">
                  {row.messageType ? MESSAGE_TYPE_LABEL[row.messageType] ?? row.messageType : "Desconhecido"}
                </td>
                <td className="py-2 pr-4">
                  <div>{row.recipientUser?.name ?? row.recipientAddress}</div>
                  {row.recipientUser && <div className="text-xs text-gray-400">{row.recipientAddress}</div>}
                </td>
                <td className="py-2 pr-4">
                  <details>
                    <summary className="cursor-pointer truncate max-w-md">{row.subject}</summary>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{row.subject}</p>
                  </details>
                </td>
                <td className="py-2 text-xs text-gray-500 whitespace-nowrap">
                  {formatDistanceToNowStrict(row.createdAt, { locale: ptBR, addSuffix: true })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
