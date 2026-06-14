import Link from "next/link";
import Image from "next/image";
import { formatCurrency, formatDate } from "@/lib/format";
import type { EventModality, EventStatus } from "@prisma/client";

interface EventCardProps {
  event: {
    id: string;
    title: string;
    slug: string;
    modality: EventModality;
    status: EventStatus;
    startAt: Date;
    city: string;
    state: string;
    bannerUrl: string | null;
    listBannerUrl?: string | null;
    ticketBatches: { priceAmount: number; soldCount: number; capacity: number }[];
  };
}

const MODALITY_LABELS: Record<EventModality, string> = {
  ROAD_RACE: "Corrida de Rua",
  TRAIL_RUN: "Trail Run",
  MTB: "MTB",
  CYCLING: "Ciclismo",
  WALK: "Caminhada",
  TRIATHLON: "Triathlon",
  OTHER: "Outro",
};

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  REGISTRATIONS_OPEN: { label: "Inscrições abertas", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  SOLD_OUT: { label: "Esgotado", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  PUBLISHED: { label: "Em breve", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  REGISTRATIONS_CLOSED: { label: "Encerrado", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

export default function EventCard({ event }: EventCardProps) {
  const badge = STATUS_BADGE[event.status];
  const lowestBatch = event.ticketBatches[0];

  return (
    <Link href={`/eventos/${event.slug}`} className="block group">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        <div className={`relative bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/30 dark:to-primary-800/30 ${event.listBannerUrl ? "aspect-square" : "h-40"}`}>
          {(event.listBannerUrl ?? event.bannerUrl) ? (
            <Image src={event.listBannerUrl ?? event.bannerUrl!} alt={event.title} fill className="object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl">🏃</span>
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="text-xs text-primary-600 dark:text-primary-400 font-medium">
              {MODALITY_LABELS[event.modality]}
            </span>
            {badge && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                {badge.label}
              </span>
            )}
          </div>

          <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-700 dark:group-hover:text-primary-400 transition-colors line-clamp-2">
            {event.title}
          </h3>

          <div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <p>📅 {formatDate(event.startAt)}</p>
            <p>📍 {event.city}/{event.state}</p>
          </div>

          {lowestBatch && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <span className="text-primary-600 dark:text-primary-400 font-bold">
                A partir de {formatCurrency(lowestBatch.priceAmount)}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
