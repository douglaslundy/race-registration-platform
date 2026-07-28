import Link from "next/link";
import Image from "next/image";
import { formatCurrency, formatDate } from "@/lib/format";
import { getBatchStatus, type BatchForStatus } from "@/lib/batch-status";
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
    ticketBatches: (BatchForStatus & { priceAmount: number })[];
  };
}

function daysUntilEvent(startAt: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDay = new Date(startAt);
  eventDay.setHours(0, 0, 0, 0);
  return Math.round((eventDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function daysLabel(days: number): string {
  if (days === 0) return "Hoje!";
  if (days === 1) return "Falta 1 dia";
  return `Faltam ${days} dias`;
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
  COMPLETED: { label: "Realizado", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

export default function EventCard({ event }: EventCardProps) {
  const badge = STATUS_BADGE[event.status];
  const lowestBatch = event.ticketBatches[0];
  const days = daysUntilEvent(event.startAt);
  const bannerSrc = event.listBannerUrl ?? event.bannerUrl;
  const hasActiveBatch = event.ticketBatches.some(
    (b) => getBatchStatus(b, event.ticketBatches) === "ACTIVE"
  );
  const hasUpcomingBatch = event.ticketBatches.some(
    (b) => getBatchStatus(b, event.ticketBatches) === "UPCOMING"
  );
  const canRegister = event.status === "REGISTRATIONS_OPEN" && hasActiveBatch;

  return (
    <div className="relative group bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* Overlay link — makes whole card click to event page */}
      <Link href={`/eventos/${event.slug}`} className="absolute inset-0 z-0" aria-label={`Ver evento ${event.title}`} />

      <div className={`relative bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/30 dark:to-primary-800/30 ${bannerSrc ? "aspect-square" : "h-40"}`}>
        {bannerSrc ? (
          <div className="absolute inset-2">
            <Image
              src={bannerSrc}
              alt={event.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className="object-contain"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl">🏃</span>
          </div>
        )}
      </div>

      {/* Days until event */}
      <div className={`px-4 py-1.5 text-xs font-semibold text-center ${days < 0 ? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400" : "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"}`}>
        {days < 0 ? "Já realizado" : daysLabel(days)}
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

        {/* Inscreva-se button — z-10 to sit above the overlay link */}
        {event.status !== "REGISTRATIONS_CLOSED" && event.status !== "COMPLETED" && (
          <div className="relative z-10 mt-3">
            {canRegister ? (
              <Link
                href={`/inscricao/${event.slug}`}
                className="btn-primary block text-center text-sm py-2"
              >
                Inscreva-se
              </Link>
            ) : hasUpcomingBatch ? (
              <button disabled className="btn-primary w-full text-sm py-2 opacity-50 cursor-not-allowed">
                Inscrições em breve
              </button>
            ) : (
              <button disabled className="btn-primary w-full text-sm py-2 opacity-50 cursor-not-allowed">
                {event.status === "SOLD_OUT" ? "Esgotado" : "Inscrições fechadas"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
