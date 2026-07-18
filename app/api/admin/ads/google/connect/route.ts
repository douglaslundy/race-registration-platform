import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildGoogleAuthUrl } from "@/lib/ads/adsense-oauth";

function callbackUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `${baseUrl}/api/admin/ads/google/callback`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  return NextResponse.redirect(buildGoogleAuthUrl(callbackUrl()));
}
