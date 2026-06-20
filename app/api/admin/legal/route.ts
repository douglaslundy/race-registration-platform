import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/rbac";
import { upsertSetting, getLegalTerms, getLegalPrivacy } from "@/lib/settings";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const schema = z.object({
  type: z.enum(["terms", "privacy"]),
  content: z.string().min(1),
  updatedAt: z.string().min(1),
});

export async function GET() {
  await requireAdmin();
  const [terms, privacy] = await Promise.all([getLegalTerms(), getLegalPrivacy()]);
  return NextResponse.json({ terms, privacy });
}

export async function PUT(req: NextRequest) {
  await requireAdmin();
  const session = await auth();

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const prefix = parsed.data.type === "terms" ? "legal.terms" : "legal.privacy";
  await Promise.all([
    upsertSetting(`${prefix}_content`, parsed.data.content),
    upsertSetting(`${prefix}_updated`, parsed.data.updatedAt),
  ]);

  await db.auditLog.create({
    data: {
      userId: session?.user?.id,
      action: "SETTING_UPDATED",
      entityType: "PlatformSetting",
      entityId: prefix,
      metadata: { type: parsed.data.type },
    },
  });

  return NextResponse.json({ ok: true });
}
