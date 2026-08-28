import Link from "next/link";
import { formatDate } from "@/lib/format";

export interface KitDeliveryEventRow {
  id: string;
  title: string;
  startAt: Date | string;
  city: string | null;
  state: string | null;
  status: string;
}

/** Lista de eventos com link direto pra tela de entrega de kits de cada um. `basePath` é
 * "/organizador" ou "/admin". Server component — os dados vêm da página. */
export default function KitDeliveryEventList({
  events,
  basePath,
}: {
  events: KitDeliveryEventRow[];
  basePath: "/organizador" | "/admin";
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Nenhum evento disponível para entrega de kits.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li key={e.id}>
          <Link
            href={`${basePath}/eventos/${e.id}/entrega-kits`}
            className="flex items-center justify-between gap-3 card hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
          >
            <span>
              <span className="font-semibold">{e.title}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {formatDate(e.startAt)}
                {e.city ? ` · ${e.city}${e.state ? `/${e.state}` : ""}` : ""}
              </span>
            </span>
            <span className="text-primary-600 dark:text-primary-400 text-sm shrink-0">Entregar kits →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
