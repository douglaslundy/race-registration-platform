import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertSetting } from "@/lib/settings";
import { exchangeCodeForTokens, fetchAdSensePublisherId } from "@/lib/ads/adsense-oauth";

function callbackUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `${baseUrl}/api/admin/ads/google/callback`;
}

function redirectTo(path: string, req: Request): NextResponse {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  return NextResponse.redirect(`${baseUrl}${path}`);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return redirectTo("/admin/anuncios/conectar-google?error=1", req);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, callbackUrl());
    const publisherId = await fetchAdSensePublisherId(tokens.accessToken);

    await upsertSetting("google_adsense_access_token", tokens.accessToken);
    await upsertSetting("google_adsense_refresh_token", tokens.refreshToken);
    await upsertSetting("google_adsense_token_expires_at", tokens.expiresAt.toISOString());
    if (publisherId) await upsertSetting("google_adsense_publisher_id", publisherId);

    return redirectTo("/admin/anuncios/conectar-google", req);
  } catch {
    return redirectTo("/admin/anuncios/conectar-google?error=1", req);
  }
}
