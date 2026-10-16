import type { Metadata } from "next";
import { requireAnyPermission } from "@/lib/auth/rbac";
import EntregaKitsClient from "./EntregaKitsClient";

export const metadata: Metadata = { title: "Entrega de kits" };
export const dynamic = "force-dynamic";

export default async function EntregaKitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Guard server-side com escopo de evento: um assistente restrito a OUTRO evento (ou sem
  // permissão de kit nenhuma) cai em /acesso-negado aqui, antes de a tela client tentar as APIs.
  await requireAnyPermission(["kits.view", "kits.deliver"], { eventId: id });
  return <EntregaKitsClient />;
}
