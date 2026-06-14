import { db } from "./db";
import type { EventModality, EventStatus } from "@prisma/client";

export interface EventFilters {
  city?: string;
  modality?: EventModality;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listPublicEvents(filters: EventFilters = {}) {
  const { city, modality, from, to, page = 1, pageSize = 12 } = filters;

  const where = {
    status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN", "SOLD_OUT"] as EventStatus[] },
    ...(city ? { city: { contains: city, mode: "insensitive" as const } } : {}),
    ...(modality ? { modality } : {}),
    ...(from || to
      ? {
          startAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [events, total] = await Promise.all([
    db.event.findMany({
      where,
      orderBy: { startAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        slug: true,
        modality: true,
        status: true,
        startAt: true,
        city: true,
        state: true,
        bannerUrl: true,
        listBannerUrl: true,
        ticketBatches: {
          where: { active: true },
          orderBy: { priceAmount: "asc" },
          take: 1,
          select: { priceAmount: true, soldCount: true, capacity: true },
        },
      },
    }),
    db.event.count({ where }),
  ]);

  return { events, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getEventBySlug(slug: string) {
  return db.event.findUnique({
    where: { slug },
    include: {
      routes: true,
      categories: true,
      ticketBatches: {
        orderBy: { startAt: "asc" },
      },
      organizer: {
        select: {
          companyName: true,
          website: true,
          bio: true,
          user: { select: { name: true } },
        },
      },
    },
  });
}

export async function listDistinctCities() {
  const results = await db.event.findMany({
    where: { status: { in: ["PUBLISHED", "REGISTRATIONS_OPEN"] } },
    select: { city: true, state: true },
    distinct: ["city"],
    orderBy: { city: "asc" },
  });
  return results;
}
