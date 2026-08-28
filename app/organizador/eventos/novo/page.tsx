import type { Metadata } from "next";
import { requireAnyPermission } from "@/lib/auth/rbac";
import EventForm from "@/components/organizer/EventForm";

export const metadata: Metadata = { title: "Novo Evento" };

export default async function NovoEventoPage() {
  await requireAnyPermission(["events.create"]);
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Criar Novo Evento</h1>
      <EventForm />
    </div>
  );
}
