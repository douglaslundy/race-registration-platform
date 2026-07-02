import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const maxDuration = 120;

type Row = Record<string, unknown>;
type TableResult = { table: string; upserted: number; errors: number; errorSamples: string[] };

// ── helpers ──────────────────────────────────────────────────────────────────

const s = (v: unknown): string => String(v ?? "");
const sn = (v: unknown): string | null => (v != null ? String(v) : null);
const n = (v: unknown): number => Number(v ?? 0);
const ni = (v: unknown): number | null => (v != null ? Number(v) : null);
const b = (v: unknown): boolean => Boolean(v);
const d = (v: unknown): Date => new Date(s(v));
const dn = (v: unknown): Date | null => (v ? new Date(s(v)) : null);

// Upserts a slice of rows for one table; returns stats.
async function upsertRows(
  tableName: string,
  rows: Row[] | undefined,
  fn: (row: Row) => Promise<unknown>,
): Promise<TableResult> {
  const result: TableResult = { table: tableName, upserted: 0, errors: 0, errorSamples: [] };
  if (!rows?.length) return result;
  for (const row of rows) {
    try {
      await fn(row);
      result.upserted++;
    } catch (err) {
      result.errors++;
      if (result.errorSamples.length < 3) {
        result.errorSamples.push(`id=${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return result;
}

// ── table handlers ────────────────────────────────────────────────────────────

function upsertUser(row: Row) {
  const base = {
    email: s(row.email),
    name: s(row.name),
    role: s(row.role) as Parameters<typeof db.user.upsert>[0]["create"]["role"],
    active: b(row.active),
    uiDensity: s(row.uiDensity) || "comfortable",
    emailVerified: dn(row.emailVerified),
    passwordHash: sn(row.passwordHash),
  };
  return db.user.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

function upsertOrganizerProfile(row: Row) {
  const base = {
    userId: s(row.userId),
    companyName: sn(row.companyName),
    cnpj: sn(row.cnpj),
    phone: sn(row.phone),
    website: sn(row.website),
    bio: sn(row.bio),
    verified: b(row.verified),
  };
  return db.organizerProfile.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

function upsertEvent(row: Row) {
  const base = {
    organizerId: s(row.organizerId),
    title: s(row.title),
    slug: s(row.slug),
    description: sn(row.description),
    modality: s(row.modality) as Parameters<typeof db.event.upsert>[0]["create"]["modality"],
    status: s(row.status) as Parameters<typeof db.event.upsert>[0]["create"]["status"],
    startAt: d(row.startAt),
    kitPickupAt: dn(row.kitPickupAt),
    venueName: sn(row.venueName),
    addressLine: sn(row.addressLine),
    city: s(row.city),
    state: s(row.state),
    country: s(row.country) || "BR",
    latitude: ni(row.latitude),
    longitude: ni(row.longitude),
    bannerUrl: sn(row.bannerUrl),
    listBannerUrl: sn(row.listBannerUrl),
    regulationUrl: sn(row.regulationUrl),
    regulationText: sn(row.regulationText),
    organizerContact: sn(row.organizerContact),
    maxParticipants: ni(row.maxParticipants),
    platformFeePercent: n(row.platformFeePercent) || 1100,
    publishedAt: dn(row.publishedAt),
  };
  return db.event.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

function upsertTicketBatch(row: Row) {
  const base = {
    eventId: s(row.eventId),
    name: s(row.name),
    description: sn(row.description),
    priceAmount: n(row.priceAmount),
    capacity: n(row.capacity),
    soldCount: n(row.soldCount),
    startAt: d(row.startAt),
    endAt: d(row.endAt),
    active: b(row.active),
    activationMode: s(row.activationMode) || "MANUAL",
  };
  return db.ticketBatch.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

function upsertEventCategory(row: Row) {
  const base = {
    eventId: s(row.eventId),
    name: s(row.name),
    description: sn(row.description),
    minAge: ni(row.minAge),
    maxAge: ni(row.maxAge),
    gender: sn(row.gender),
  };
  return db.eventCategory.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base },
    update: base,
  });
}

function upsertEventRoute(row: Row) {
  const base = {
    eventId: s(row.eventId),
    name: s(row.name),
    distanceKm: Number(row.distanceKm ?? 0),
    description: sn(row.description),
  };
  return db.eventRoute.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base },
    update: base,
  });
}

function upsertCoupon(row: Row) {
  const base = {
    eventId: sn(row.eventId),
    code: s(row.code),
    discountType: s(row.discountType) || "PERCENT",
    discountValue: n(row.discountValue),
    maxUses: ni(row.maxUses),
    usedCount: n(row.usedCount),
    expiresAt: dn(row.expiresAt),
    active: b(row.active),
    createdById: sn(row.createdById),
  };
  return db.coupon.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

function upsertOrder(row: Row) {
  const base = {
    buyerUserId: s(row.buyerUserId),
    eventId: s(row.eventId),
    subtotalAmount: n(row.subtotalAmount),
    platformFeeAmount: n(row.platformFeeAmount),
    paymentFeeAmount: n(row.paymentFeeAmount),
    totalAmount: n(row.totalAmount),
    currency: s(row.currency) || "BRL",
    couponId: sn(row.couponId),
    discountAmount: n(row.discountAmount),
    status: s(row.status) as Parameters<typeof db.order.upsert>[0]["create"]["status"],
    expiresAt: dn(row.expiresAt),
  };
  return db.order.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

function upsertRegistration(row: Row) {
  const base = {
    eventId: s(row.eventId),
    athleteUserId: s(row.athleteUserId),
    routeId: sn(row.routeId),
    categoryId: sn(row.categoryId),
    ticketBatchId: s(row.ticketBatchId),
    orderId: s(row.orderId),
    bibNumber: sn(row.bibNumber),
    shirtSize: sn(row.shirtSize) as Parameters<typeof db.registration.upsert>[0]["create"]["shirtSize"],
    teamName: sn(row.teamName),
    emergencyContactName: sn(row.emergencyContactName),
    emergencyContactPhone: sn(row.emergencyContactPhone),
    medicalNotes: sn(row.medicalNotes),
    status: s(row.status) as Parameters<typeof db.registration.upsert>[0]["create"]["status"],
    acceptedTermsAt: dn(row.acceptedTermsAt),
  };
  return db.registration.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

function upsertPayment(row: Row) {
  const base = {
    orderId: s(row.orderId),
    provider: s(row.provider),
    providerPaymentId: sn(row.providerPaymentId),
    method: s(row.method) as Parameters<typeof db.payment.upsert>[0]["create"]["method"],
    status: s(row.status) as Parameters<typeof db.payment.upsert>[0]["create"]["status"],
    amount: n(row.amount),
    pixQrCodeText: sn(row.pixQrCodeText),
    boletoUrl: sn(row.boletoUrl),
    expiresAt: dn(row.expiresAt),
    paidAt: dn(row.paidAt),
    refundedAt: dn(row.refundedAt),
    rawPayload: row.rawPayload != null ? (row.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull,
    idempotencyKey: s(row.idempotencyKey),
  };
  return db.payment.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

function upsertRefund(row: Row) {
  const base = {
    paymentId: s(row.paymentId),
    amount: n(row.amount),
    reason: sn(row.reason),
    processedAt: dn(row.processedAt),
    initiatedByUserId: s(row.initiatedByUserId),
  };
  return db.refund.upsert({
    where: { id: s(row.id) },
    create: { id: s(row.id), ...base, createdAt: d(row.createdAt) },
    update: base,
  });
}

// ── handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  let backup: Record<string, Row[]>;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
    const text = await file.text();
    backup = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Arquivo inválido ou corrompido" }, { status: 400 });
  }

  // Validate top-level keys
  const expectedKeys = ["users", "events", "registrations", "orders", "payments",
    "coupons", "organizerProfiles", "ticketBatches", "eventCategories", "eventRoutes", "refunds"];
  const fileKeys = Object.keys(backup);
  const missingKeys = expectedKeys.filter((k) => !fileKeys.includes(k));
  if (missingKeys.length === expectedKeys.length) {
    return NextResponse.json({ error: "Arquivo não parece ser um backup válido deste sistema" }, { status: 400 });
  }

  // Process in FK dependency order
  const tables: TableResult[] = [];
  tables.push(await upsertRows("users", backup.users, upsertUser));
  tables.push(await upsertRows("organizerProfiles", backup.organizerProfiles, upsertOrganizerProfile));
  tables.push(await upsertRows("events", backup.events, upsertEvent));
  tables.push(await upsertRows("ticketBatches", backup.ticketBatches, upsertTicketBatch));
  tables.push(await upsertRows("eventCategories", backup.eventCategories, upsertEventCategory));
  tables.push(await upsertRows("eventRoutes", backup.eventRoutes, upsertEventRoute));
  tables.push(await upsertRows("coupons", backup.coupons, upsertCoupon));
  tables.push(await upsertRows("orders", backup.orders, upsertOrder));
  tables.push(await upsertRows("registrations", backup.registrations, upsertRegistration));
  tables.push(await upsertRows("payments", backup.payments, upsertPayment));
  tables.push(await upsertRows("refunds", backup.refunds, upsertRefund));

  const totalUpserted = tables.reduce((s, t) => s + t.upserted, 0);
  const totalErrors = tables.reduce((s, t) => s + t.errors, 0);

  return NextResponse.json({ tables, totalUpserted, totalErrors });
}
