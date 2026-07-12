import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const REQUIRED_COLUMNS = ["bib_number", "athlete_name"];

function parseCSV(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
    transform: (v) => v.trim(),
  });
  if (result.data.length === 0) throw new Error("CSV vazio ou sem dados");
  return result.data;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id: eventId } = await params;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });

  const text = await file.text();
  let rows: Record<string, string>[];
  try {
    rows = parseCSV(text);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }

  const missingCols = REQUIRED_COLUMNS.filter((c) => !Object.keys(rows[0] ?? {}).includes(c));
  if (missingCols.length > 0) {
    return NextResponse.json({ error: `Colunas obrigatórias ausentes: ${missingCols.join(", ")}` }, { status: 400 });
  }

  const organizer = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
  const event = await db.event.findFirst({
    where: { id: eventId, ...(session.user.role !== "ADMIN" ? { organizerId: organizer?.id } : {}) },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const importRecord = await db.resultImport.create({
    data: {
      eventId,
      importedBy: session.user.id,
      fileName: file.name,
      rowCount: rows.length,
    },
  });

  const results = rows.map((row) => ({
    importId: importRecord.id,
    eventId,
    bibNumber: row.bib_number,
    athleteName: row.athlete_name,
    route: row.route || null,
    category: row.category || null,
    gender: row.gender || null,
    grossTime: row.gross_time || null,
    netTime: row.net_time || null,
    placementGeneral: row.placement_general ? parseInt(row.placement_general) : null,
    placementCategory: row.placement_category ? parseInt(row.placement_category) : null,
    placementGender: row.placement_gender ? parseInt(row.placement_gender) : null,
  }));

  await db.raceResult.createMany({ data: results });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "RESULTS_IMPORTED",
      entityType: "ResultImport",
      entityId: importRecord.id,
      metadata: { rowCount: rows.length, fileName: file.name },
    },
  });

  return NextResponse.json({ importId: importRecord.id, rowCount: rows.length });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id: eventId } = await params;
  const { importId } = await req.json();

  await db.resultImport.update({
    where: { id: importId, eventId },
    data: { published: true, publishedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
