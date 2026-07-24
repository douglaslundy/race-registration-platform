import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { promoteToAdvertiser } from "@/lib/advertisers/promote";

const schema = z.object({
  companyName: z.string().min(2).max(150),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8).max(20),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await promoteToAdvertiser({
    userId: id,
    ...parsed.data,
    promotedByUserId: session.user.id,
    promotedByName: session.user.name ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json({ ok: true });
}
