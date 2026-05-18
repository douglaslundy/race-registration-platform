import type { Metadata } from "next";
import EventForm from "@/components/organizer/EventForm";

export const metadata: Metadata = { title: "Novo Evento" };

export default function NovoEventoPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Criar Novo Evento</h1>
      <EventForm />
    </div>
  );
}
