import type { Metadata } from "next";
import { requireAnyPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import BibNumbersGenerator from "@/components/organizer/BibNumbersGenerator";
import EntregaKitsClient from "./EntregaKitsClient";

export const metadata: Metadata = { title: "Entrega de kits" };
export const dynamic = "force-dynamic";

export default async function EntregaKitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Guard server-side com escopo de evento: um assistente restrito a OUTRO evento (ou sem
  // permissão de kit nenhuma) cai em /acesso-negado aqui, antes de a tela client tentar as APIs.
  await requireAnyPermission(["kits.view", "kits.deliver"], { eventId: id });
  const event = await db.event.findUnique({ where: { id }, select: { generateBibNumbers: true, status: true } });
  const canGenerateBibs =
    !!event?.generateBibNumbers && (event.status === "REGISTRATIONS_CLOSED" || event.status === "COMPLETED");
  const hasNumbers = canGenerateBibs
    ? (await db.registration.count({ where: { eventId: id, bibNumber: { not: null } } })) > 0
    : false;
  return (
    <>
      {canGenerateBibs && (
        <div className="max-w-2xl mx-auto mb-4">
          <BibNumbersGenerator eventId={id} hasNumbers={hasNumbers} />
        </div>
      )}
      <EntregaKitsClient />
    </>
  );
}
