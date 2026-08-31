import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { generateKitQrCodePng } from "@/lib/kit-qr-code";
import { generateRegistrationQrCodePdf } from "@/lib/registrations/qrcode-pdf";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.view");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "png";

  const scope = await resolveActingScope(session);
  const registration = await db.registration.findFirst({
    where: scope.actingAsAdmin ? { id } : { id, event: { organizerId: scope.organizerId ?? "__none__" } },
    select: {
      id: true,
      participantName: true,
      bibNumber: true,
      event: { select: { title: true } },
    },
  });
  if (!registration) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  const athleteName = registration.participantName;
  const qrPng = await generateKitQrCodePng(registration.id);

  if (format === "pdf") {
    const pdf = await generateRegistrationQrCodePdf({
      athleteName,
      eventTitle: registration.event.title,
      bibNumber: registration.bibNumber,
      qrPngBase64: qrPng.toString("base64"),
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="qrcode-${registration.id}.pdf"`,
      },
    });
  }

  return new NextResponse(new Uint8Array(qrPng), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="qrcode-${registration.id}.png"`,
    },
  });
}
