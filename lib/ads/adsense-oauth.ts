const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADSENSE_SCOPE = "https://www.googleapis.com/auth/adsense.readonly";

export function buildGoogleAuthUrl(redirectUri: string): string {
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: ADSENSE_SCOPE,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function requestToken(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`Google OAuth ${res.status}: ${JSON.stringify(errBody).slice(0, 300)}`);
  }
  return res.json();
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const data = await requestToken({
    code,
    client_id: process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const data = await requestToken({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
}

export async function fetchAdSensePublisherId(accessToken: string): Promise<string | null> {
  const res = await fetch("https://adsense.googleapis.com/v2/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`AdSense API ${res.status}: ${JSON.stringify(errBody).slice(0, 300)}`);
  }
  const data = await res.json();
  const first = data.accounts?.[0]?.name as string | undefined;
  if (!first) return null;
  return first.replace("accounts/", "");
}
