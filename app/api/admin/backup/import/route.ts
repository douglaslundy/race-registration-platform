import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const maxDuration = 120;

type Row = Record<string, unknown>;
type TableResult = { table: string; restored: number };

// ── helpers ──────────────────────────────────────────────────────────────────

const s = (v: unknown): string => String(v ?? "");
const sn = (v: unknown): string | null => (v != null ? String(v) : null);
const n = (v: unknown): number => Number(v ?? 0);
const ni = (v: unknown): number | null => (v != null ? Number(v) : null);
const b = (v: unknown): boolean => Boolean(v);
const d = (v: unknown): Date => new Date(s(v));
const dn = (v: unknown): Date | null => (v ? new Date(s(v)) : null);

// ── row shape builders (tabelas são apagadas antes do insert, então só "create") ──

function toUserRow(row: Row): Prisma.UserCreateManyInput {
  return {
    id: s(row.id),
    email: s(row.email),
    name: s(row.name),
    phone: sn(row.phone),
    role: s(row.role) as Prisma.UserCreateManyInput["role"],
    active: b(row.active),
    uiDensity: s(row.uiDensity) || "comfortable",
    emailVerified: dn(row.emailVerified),
    passwordHash: sn(row.passwordHash),
    createdAt: d(row.createdAt),
  };
}

function toAthleteProfileRow(row: Row): Prisma.AthleteProfileCreateManyInput {
  return {
    id: s(row.id),
    userId: s(row.userId),
    cpf: sn(row.cpf),
    birthDate: dn(row.birthDate),
    phone: sn(row.phone),
    gender: sn(row.gender),
    city: sn(row.city),
    state: sn(row.state),
    emergencyName: sn(row.emergencyName),
    emergencyPhone: sn(row.emergencyPhone),
    medicalNotes: sn(row.medicalNotes),
    preferredShirtSize: sn(row.preferredShirtSize) as Prisma.AthleteProfileCreateManyInput["preferredShirtSize"],
    teamName: sn(row.teamName),
    createdAt: d(row.createdAt),
  };
}

function toOrganizerProfileRow(row: Row): Prisma.OrganizerProfileCreateManyInput {
  return {
    id: s(row.id),
    userId: s(row.userId),
    companyName: sn(row.companyName),
    cnpj: sn(row.cnpj),
    phone: sn(row.phone),
    website: sn(row.website),
    bio: sn(row.bio),
    verified: b(row.verified),
    createdAt: d(row.createdAt),
  };
}

function toEventRow(row: Row): Prisma.EventCreateManyInput {
  return {
    id: s(row.id),
    organizerId: s(row.organizerId),
    title: s(row.title),
    slug: s(row.slug),
    description: sn(row.description),
    modality: s(row.modality) as Prisma.EventCreateManyInput["modality"],
    status: s(row.status) as Prisma.EventCreateManyInput["status"],
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
    cancellationDeadline: dn(row.cancellationDeadline),
    cancellationRequiresApproval: b(row.cancellationRequiresApproval),
    cancellationContactPhone: sn(row.cancellationContactPhone),
    cancellationContactEmail: sn(row.cancellationContactEmail),
    createdAt: d(row.createdAt),
  };
}

function toEventRouteRow(row: Row): Prisma.EventRouteCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    name: s(row.name),
    distanceKm: Number(row.distanceKm ?? 0),
    description: sn(row.description),
  };
}

function toEventCategoryRow(row: Row): Prisma.EventCategoryCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    name: s(row.name),
    description: sn(row.description),
    minAge: ni(row.minAge),
    maxAge: ni(row.maxAge),
    gender: sn(row.gender),
  };
}

function toTicketBatchRow(row: Row): Prisma.TicketBatchCreateManyInput {
  return {
    id: s(row.id),
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
    createdAt: d(row.createdAt),
  };
}

function toTransferPayoutRow(row: Row): Prisma.TransferPayoutCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    organizerId: s(row.organizerId),
    grossAmount: n(row.grossAmount),
    platformFee: n(row.platformFee),
    netAmount: n(row.netAmount),
    status: s(row.status) as Prisma.TransferPayoutCreateManyInput["status"],
    processedAt: dn(row.processedAt),
    notes: sn(row.notes),
    createdAt: d(row.createdAt),
  };
}

function toCouponRow(row: Row): Prisma.CouponCreateManyInput {
  return {
    id: s(row.id),
    eventId: sn(row.eventId),
    code: s(row.code),
    discountType: s(row.discountType) || "PERCENT",
    discountValue: n(row.discountValue),
    maxUses: ni(row.maxUses),
    usedCount: n(row.usedCount),
    expiresAt: dn(row.expiresAt),
    active: b(row.active),
    createdById: sn(row.createdById),
    createdAt: d(row.createdAt),
  };
}

function toOrderRow(row: Row): Prisma.OrderCreateManyInput {
  return {
    id: s(row.id),
    buyerUserId: s(row.buyerUserId),
    eventId: s(row.eventId),
    subtotalAmount: n(row.subtotalAmount),
    platformFeeAmount: n(row.platformFeeAmount),
    paymentFeeAmount: n(row.paymentFeeAmount),
    totalAmount: n(row.totalAmount),
    currency: s(row.currency) || "BRL",
    couponId: sn(row.couponId),
    discountAmount: n(row.discountAmount),
    status: s(row.status) as Prisma.OrderCreateManyInput["status"],
    expiresAt: dn(row.expiresAt),
    createdAt: d(row.createdAt),
  };
}

function toRegistrationRow(row: Row): Prisma.RegistrationCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    athleteUserId: s(row.athleteUserId),
    routeId: sn(row.routeId),
    categoryId: sn(row.categoryId),
    ticketBatchId: s(row.ticketBatchId),
    orderId: s(row.orderId),
    bibNumber: sn(row.bibNumber),
    shirtSize: sn(row.shirtSize) as Prisma.RegistrationCreateManyInput["shirtSize"],
    teamName: sn(row.teamName),
    emergencyContactName: sn(row.emergencyContactName),
    emergencyContactPhone: sn(row.emergencyContactPhone),
    medicalNotes: sn(row.medicalNotes),
    status: s(row.status) as Prisma.RegistrationCreateManyInput["status"],
    acceptedTermsAt: dn(row.acceptedTermsAt),
    cancellationReason: sn(row.cancellationReason),
    cancellationRequestedAt: dn(row.cancellationRequestedAt),
    createdAt: d(row.createdAt),
  };
}

function toPaymentRow(row: Row): Prisma.PaymentCreateManyInput {
  return {
    id: s(row.id),
    orderId: s(row.orderId),
    provider: s(row.provider),
    providerPaymentId: sn(row.providerPaymentId),
    method: s(row.method) as Prisma.PaymentCreateManyInput["method"],
    status: s(row.status) as Prisma.PaymentCreateManyInput["status"],
    amount: n(row.amount),
    pixQrCodeText: sn(row.pixQrCodeText),
    boletoUrl: sn(row.boletoUrl),
    expiresAt: dn(row.expiresAt),
    paidAt: dn(row.paidAt),
    refundedAt: dn(row.refundedAt),
    rawPayload: row.rawPayload != null ? (row.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull,
    idempotencyKey: s(row.idempotencyKey),
    createdAt: d(row.createdAt),
  };
}

function toRefundRow(row: Row): Prisma.RefundCreateManyInput {
  return {
    id: s(row.id),
    paymentId: s(row.paymentId),
    amount: n(row.amount),
    reason: sn(row.reason),
    // Backups taken before RefundStatus existed have no `status` field — those refunds all went
    // through the (then-only) synchronous gateway success path, so "PROCESSED" is the correct backfill.
    status: (row.status ? s(row.status) : "PROCESSED") as Prisma.RefundCreateManyInput["status"],
    failureReason: sn(row.failureReason),
    resolutionNote: sn(row.resolutionNote),
    providerRefundId: sn(row.providerRefundId),
    initiatedByUserId: s(row.initiatedByUserId),
    processedAt: dn(row.processedAt),
    createdAt: d(row.createdAt),
  };
}

function toResultImportRow(row: Row): Prisma.ResultImportCreateManyInput {
  return {
    id: s(row.id),
    eventId: s(row.eventId),
    importedBy: s(row.importedBy),
    fileName: s(row.fileName),
    rowCount: n(row.rowCount),
    errorCount: n(row.errorCount),
    published: b(row.published),
    publishedAt: dn(row.publishedAt),
    createdAt: d(row.createdAt),
  };
}

function toRaceResultRow(row: Row): Prisma.RaceResultCreateManyInput {
  return {
    id: s(row.id),
    importId: s(row.importId),
    eventId: s(row.eventId),
    bibNumber: s(row.bibNumber),
    athleteName: s(row.athleteName),
    route: sn(row.route),
    category: sn(row.category),
    gender: sn(row.gender),
    grossTime: sn(row.grossTime),
    netTime: sn(row.netTime),
    placementGeneral: ni(row.placementGeneral),
    placementCategory: ni(row.placementCategory),
    placementGender: ni(row.placementGender),
  };
}

function toFileAssetRow(row: Row): Prisma.FileAssetCreateManyInput {
  return {
    id: s(row.id),
    eventId: sn(row.eventId),
    uploadedBy: s(row.uploadedBy),
    fileName: s(row.fileName),
    fileKey: s(row.fileKey),
    fileUrl: s(row.fileUrl),
    mimeType: s(row.mimeType),
    sizeBytes: n(row.sizeBytes),
    purpose: s(row.purpose),
    createdAt: d(row.createdAt),
  };
}

function toAuditLogRow(row: Row): Prisma.AuditLogCreateManyInput {
  return {
    id: s(row.id),
    userId: sn(row.userId),
    action: s(row.action),
    entityType: s(row.entityType),
    entityId: sn(row.entityId),
    metadata: row.metadata != null ? (row.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
    ipAddress: sn(row.ipAddress),
    createdAt: d(row.createdAt),
  };
}

function toPlatformSettingRow(row: Row): Prisma.PlatformSettingCreateManyInput {
  return {
    key: s(row.key),
    value: s(row.value),
  };
}

function toAlertLogRow(row: Row): Prisma.AlertLogCreateManyInput {
  return {
    id: s(row.id),
    alertType: s(row.alertType),
    entityType: s(row.entityType),
    entityId: s(row.entityId),
    channel: s(row.channel),
    sentAt: d(row.sentAt),
  };
}

// ── handler ───────────────────────────────────────────────────────────────────

const TABLE_KEYS = [
  "users", "athleteProfiles", "organizerProfiles", "events", "eventRoutes", "eventCategories",
  "ticketBatches", "transferPayouts", "coupons", "orders", "registrations", "payments", "refunds",
  "resultImports", "raceResults", "fileAssets", "auditLogs", "platformSettings", "alertLogs",
] as const;

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

  const fileKeys = Object.keys(backup);
  const hasAnyKnownKey = TABLE_KEYS.some((k) => fileKeys.includes(k));
  if (!hasAnyKnownKey) {
    return NextResponse.json({ error: "Arquivo não parece ser um backup válido deste sistema" }, { status: 400 });
  }

  const users = (backup.users ?? []).map(toUserRow);
  const athleteProfiles = (backup.athleteProfiles ?? []).map(toAthleteProfileRow);
  const organizerProfiles = (backup.organizerProfiles ?? []).map(toOrganizerProfileRow);
  const events = (backup.events ?? []).map(toEventRow);
  const eventRoutes = (backup.eventRoutes ?? []).map(toEventRouteRow);
  const eventCategories = (backup.eventCategories ?? []).map(toEventCategoryRow);
  const ticketBatches = (backup.ticketBatches ?? []).map(toTicketBatchRow);
  const transferPayouts = (backup.transferPayouts ?? []).map(toTransferPayoutRow);
  const coupons = (backup.coupons ?? []).map(toCouponRow);
  const orders = (backup.orders ?? []).map(toOrderRow);
  const registrations = (backup.registrations ?? []).map(toRegistrationRow);
  const payments = (backup.payments ?? []).map(toPaymentRow);
  const refunds = (backup.refunds ?? []).map(toRefundRow);
  const resultImports = (backup.resultImports ?? []).map(toResultImportRow);
  const raceResults = (backup.raceResults ?? []).map(toRaceResultRow);
  const fileAssets = (backup.fileAssets ?? []).map(toFileAssetRow);
  const auditLogs = (backup.auditLogs ?? []).map(toAuditLogRow);
  const platformSettings = (backup.platformSettings ?? []).map(toPlatformSettingRow);
  const alertLogs = (backup.alertLogs ?? []).map(toAlertLogRow);

  try {
    const tables: TableResult[] = await db.$transaction(
      async (tx) => {
        // Apaga filhos antes de pais, respeitando foreign keys.
        await tx.raceResult.deleteMany({});
        await tx.resultImport.deleteMany({});
        await tx.refund.deleteMany({});
        await tx.payment.deleteMany({});
        await tx.registration.deleteMany({});
        await tx.order.deleteMany({});
        await tx.fileAsset.deleteMany({});
        await tx.auditLog.deleteMany({});
        await tx.transferPayout.deleteMany({});
        await tx.coupon.deleteMany({});
        await tx.ticketBatch.deleteMany({});
        await tx.eventCategory.deleteMany({});
        await tx.eventRoute.deleteMany({});
        await tx.event.deleteMany({});
        await tx.athleteProfile.deleteMany({});
        await tx.organizerProfile.deleteMany({});
        await tx.user.deleteMany({});
        await tx.platformSetting.deleteMany({});
        await tx.alertLog.deleteMany({});

        // Insere pais antes de filhos — ordem inversa da exclusão.
        if (users.length) await tx.user.createMany({ data: users });
        if (athleteProfiles.length) await tx.athleteProfile.createMany({ data: athleteProfiles });
        if (organizerProfiles.length) await tx.organizerProfile.createMany({ data: organizerProfiles });
        if (events.length) await tx.event.createMany({ data: events });
        if (eventRoutes.length) await tx.eventRoute.createMany({ data: eventRoutes });
        if (eventCategories.length) await tx.eventCategory.createMany({ data: eventCategories });
        if (ticketBatches.length) await tx.ticketBatch.createMany({ data: ticketBatches });
        if (transferPayouts.length) await tx.transferPayout.createMany({ data: transferPayouts });
        if (coupons.length) await tx.coupon.createMany({ data: coupons });
        if (orders.length) await tx.order.createMany({ data: orders });
        if (registrations.length) await tx.registration.createMany({ data: registrations });
        if (payments.length) await tx.payment.createMany({ data: payments });
        if (refunds.length) await tx.refund.createMany({ data: refunds });
        if (resultImports.length) await tx.resultImport.createMany({ data: resultImports });
        if (raceResults.length) await tx.raceResult.createMany({ data: raceResults });
        if (fileAssets.length) await tx.fileAsset.createMany({ data: fileAssets });
        if (auditLogs.length) await tx.auditLog.createMany({ data: auditLogs });
        if (platformSettings.length) await tx.platformSetting.createMany({ data: platformSettings });
        if (alertLogs.length) await tx.alertLog.createMany({ data: alertLogs });

        return [
          { table: "users", restored: users.length },
          { table: "athleteProfiles", restored: athleteProfiles.length },
          { table: "organizerProfiles", restored: organizerProfiles.length },
          { table: "events", restored: events.length },
          { table: "eventRoutes", restored: eventRoutes.length },
          { table: "eventCategories", restored: eventCategories.length },
          { table: "ticketBatches", restored: ticketBatches.length },
          { table: "transferPayouts", restored: transferPayouts.length },
          { table: "coupons", restored: coupons.length },
          { table: "orders", restored: orders.length },
          { table: "registrations", restored: registrations.length },
          { table: "payments", restored: payments.length },
          { table: "refunds", restored: refunds.length },
          { table: "resultImports", restored: resultImports.length },
          { table: "raceResults", restored: raceResults.length },
          { table: "fileAssets", restored: fileAssets.length },
          { table: "auditLogs", restored: auditLogs.length },
          { table: "platformSettings", restored: platformSettings.length },
          { table: "alertLogs", restored: alertLogs.length },
        ];
      },
      { maxWait: 10_000, timeout: 100_000 },
    );

    const totalRestored = tables.reduce((sum, t) => sum + t.restored, 0);
    return NextResponse.json({ tables, totalRestored });
  } catch (err) {
    return NextResponse.json(
      { error: `Restauração cancelada, nenhum dado foi alterado: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
