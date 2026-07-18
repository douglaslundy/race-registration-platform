import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertSetting } from "@/lib/settings";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  await upsertSetting("google_adsense_access_token", "");
  await upsertSetting("google_adsense_refresh_token", "");

  return NextResponse.json({ ok: true });
}
