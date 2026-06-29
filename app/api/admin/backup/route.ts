import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const BATCH = 500;

type Fetcher = (cursor: string | undefined) => Promise<{ id: string }[]>;

async function* paginateTable(name: string, fetcher: Fetcher, last: boolean) {
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
    cursor = rows[rows.length - 1].id;
  }
  yield `\n]${last ? "" : ","}\n`;
}

async function* streamTables() {
  yield "{\n";

  const tables: Array<{ name: string; fetcher: Fetcher }> = [
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
  ];

  for (let i = 0; i < tables.length; i++) {
    const { name, fetcher } = tables[i];
    const isLast = i === tables.length - 1;
    for await (const chunk of paginateTable(name, fetcher, isLast)) {
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
