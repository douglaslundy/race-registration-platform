"use client";

export default function ExportCsvButton({ eventId }: { eventId: string }) {
  function handleExport() {
    window.open(`/api/events/${eventId}/registrations?format=csv`, "_blank");
  }

  return (
    <button onClick={handleExport} className="btn-secondary text-sm">
      Exportar CSV
    </button>
  );
}
