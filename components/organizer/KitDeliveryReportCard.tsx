interface KitDeliveryReportCardProps {
  eventId: string;
  total: number;
  delivered: number;
  pending: Array<{ id: string; athleteName: string; bibNumber: string | null; categoryName: string | null }>;
  headingClassName?: string;
}

export default function KitDeliveryReportCard({
  eventId,
  total,
  delivered,
  pending,
  headingClassName = "font-semibold",
}: KitDeliveryReportCardProps) {
  return (
    <div className="card space-y-3">
      <h2 className={headingClassName}>Progresso de entrega</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {delivered} de {total} kits entregues
      </p>
      <a
        href={`/api/events/${eventId}/kit-deliveries/report-export`}
        className="btn-secondary text-sm inline-block"
      >
        Exportar pendentes (CSV)
      </a>
      {pending.length > 0 && (
        <ul className="text-sm divide-y dark:divide-gray-700">
          {pending.map((p) => (
            <li key={p.id} className="py-1.5">
              {p.athleteName} — {p.categoryName ?? "Sem categoria"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
