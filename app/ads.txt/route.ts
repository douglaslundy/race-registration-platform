import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

const GOOGLE_ADSENSE_CERTIFICATION_AUTHORITY_ID = "f08c47fec0942fa0";

export async function GET() {
  const clientId = await getSetting("google_adsense_client_id");
  if (!clientId) {
    return new NextResponse(null, { status: 404 });
  }

  const publisherId = clientId.replace(/^ca-/, "");
  const body = `google.com, ${publisherId}, DIRECT, ${GOOGLE_ADSENSE_CERTIFICATION_AUTHORITY_ID}\n`;

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
