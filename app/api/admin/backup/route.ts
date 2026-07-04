import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const BATCH = 500;

type Fetcher = (cursor: string | undefined) => Promise<Record<string, unknown>[]>;

async function* paginateTable(name: string, fetcher: Fetcher, last: boolean, idField: string = "id") {
  yield `"${name}": [\n`;
  let cursor: string | undefined;
  let firstRow = true;
  while (true) {
    const rows = await fetcher(cursor);
    for (const row of rows) {
      yield (firstRow ? "" : ",\n") + JSON.stringify(row);
      firstRow = false;
    }
    if (rows.length < BATCH) break;
    cursor = String(rows[rows.length - 1][idField]);
  }
  yield `\n]${last ? "" : ","}\n`;
}

async function* streamTables() {
  yield "{\n";

  const tables: Array<{ name: string; fetcher: Fetcher; idField?: string }> = [
    {
      name: "users",
      fetcher: (cursor) =>
        db.user.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "events",
      fetcher: (cursor) =>
        db.event.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "registrations",
      fetcher: (cursor) =>
        db.registration.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "orders",
      fetcher: (cursor) =>
        db.order.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "payments",
      fetcher: (cursor) =>
        db.payment.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "coupons",
      fetcher: (cursor) =>
        db.coupon.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "organizerProfiles",
      fetcher: (cursor) =>
        db.organizerProfile.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "ticketBatches",
      fetcher: (cursor) =>
        db.ticketBatch.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "eventCategories",
      fetcher: (cursor) =>
        db.eventCategory.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "eventRoutes",
      fetcher: (cursor) =>
        db.eventRoute.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "refunds",
      fetcher: (cursor) =>
        db.refund.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "athleteProfiles",
      fetcher: (cursor) =>
        db.athleteProfile.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "transferPayouts",
      fetcher: (cursor) =>
        db.transferPayout.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "resultImports",
      fetcher: (cursor) =>
        db.resultImport.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "raceResults",
      fetcher: (cursor) =>
        db.raceResult.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "fileAssets",
      fetcher: (cursor) =>
        db.fileAsset.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "auditLogs",
      fetcher: (cursor) =>
        db.auditLog.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
    {
      name: "platformSettings",
      fetcher: (cursor) =>
        db.platformSetting.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { key: cursor } } : {}), orderBy: { key: "asc" } }),
      idField: "key",
    },
    {
      name: "alertLogs",
      fetcher: (cursor) =>
        db.alertLog.findMany({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" } }),
    },
  ];

  for (let i = 0; i < tables.length; i++) {
    const { name, fetcher, idField } = tables[i];
    const isLast = i === tables.length - 1;
    for await (const chunk of paginateTable(name, fetcher, isLast, idField)) {
      yield chunk;
    }
  }

  yield "}";
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const now = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const filename = `backup-${now}.json`;

  const encoder = new TextEncoder();
  const gen = streamTables();

  const readable = new ReadableStream({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(value));
      }
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
