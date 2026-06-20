"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

interface BannerEvent {
  id: string;
  title: string;
  slug: string;
  bannerUrl: string;
  listBannerUrl?: string | null;
}

export default function EventsBanner({ intervalSeconds }: { intervalSeconds: number }) {
  const [events, setEvents] = useState<BannerEvent[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    fetch("/api/events/banners")
      .then((r) => r.json())
      .then((data: BannerEvent[]) => setEvents(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (events.length < 2) return;
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % events.length);
    }, intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [events.length, intervalSeconds]);

  if (events.length === 0) return null;

  const event = events[current];
  const bannerSrc = event.bannerUrl || event.listBannerUrl || "";

  return (
    <div className="relative w-full aspect-[16/5] rounded-2xl overflow-hidden mb-8 bg-gray-100 dark:bg-gray-800 group">
      <Link href={`/eventos/${event.slug}`} className="block w-full h-full">
        <div className="absolute inset-2">
          <Image
            src={bannerSrc}
            alt={event.title}
            fill
            sizes="100vw"
            className="object-contain transition-opacity duration-700"
            priority
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="absolute bottom-4 left-4 right-12">
          <p className="text-white font-bold text-lg drop-shadow line-clamp-1">{event.title}</p>
        </div>
      </Link>

      {events.length > 1 && (
        <div className="absolute bottom-3 right-4 flex gap-1.5">
          {events.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-2 h-2 rounded-full transition-colors ${i === current ? "bg-white" : "bg-white/40"}`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
