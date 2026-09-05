import { NextRequest, NextResponse } from "next/server";
import { checkAnyApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listKitDeliveries } from "@/lib/kit-delivery";
import { generateKitDeliveryListPdf } from "@/lib/kit-delivery/list-pdf";
import {
  filterKitDeliveryItems,
  parseKitDeliveryListParams,
  sortKitDeliveryItems,
  summarizeKitDeliveryFilters,
} from "@/lib/kit-delivery/list-view";

/**
 * PDF da aba "Todos os inscritos" da entrega de kits, com os mesmos filtros/ordenação da tela
 * (status, assistente, busca, ordem) recebidos por query string. Abre inline no navegador pra
 * mandar pra impressora. Mesma autorização da rota `list`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkAnyApiPermission(["kits.view", "kits.deliver"], { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id }, select: { id: true, title: true } })
    : await db.event.findFirst({
        where: { id, organizerId: scope.organizerId ?? "__none__" },
        select: { id: true, title: true },
      });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const listParams = parseKitDeliveryListParams(new URL(req.url).searchParams);
  const all = await listKitDeliveries(id);
  const filtered = filterKitDeliveryItems(all, listParams);
  const sorted = sortKitDeliveryItems(filtered, listParams.sort);

  const pdf = await generateKitDeliveryListPdf({
    eventTitle: event.title,
    filtersLabel: summarizeKitDeliveryFilters(listParams),
    generatedAt: new Date(),
    deliveredCount: sorted.filter((i) => i.delivered).length,
    pendingCount: sorted.filter((i) => !i.delivered).length,
    items: sorted.map((i) => ({
      participantName: i.participantName,
      participantCpf: i.participantCpf,
      bibNumber: i.bibNumber,
      shirtSize: i.shirtSize,
      categoryName: i.categoryName,
      delivered: i.delivered,
      deliveredAt: i.deliveredAt,
      deliveredByName: i.deliveredByName,
      receivedByName: i.receivedByName,
    })),
  });

  const slug = event.title.toLowerCase().replace(/\s+/g, "-").slice(0, 30);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="entrega-kits-${slug}.pdf"`,
    },
  });
}
