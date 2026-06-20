"use client";

import { useState } from "react";
import { EVENT_STATUS_LABEL } from "@/lib/admin/labels";

interface EventFee {
  id: string;
  title: string;
  platformFeePercent: number;
  status: string;
}

export default function SetPlatformFeeForm({ event }: { event: EventFee }) {
  const [value, setValue] = useState(event.platformFeePercent);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/admin/events/${event.id}/fee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platformFeePercent: value }),
    });
    if (res.ok) setSaved(true);
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-4 border rounded-lg p-3 dark:border-gray-700">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{event.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{EVENT_STATUS_LABEL[event.status] ?? event.status}</p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => { setValue(Number(e.target.value)); setSaved(false); }}
          min={0}
          max={5000}
          step={100}
          className="input-field w-24 text-sm py-1"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">{(value / 100).toFixed(1)}%</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary py-1 px-3 text-sm disabled:opacity-50"
        >
          {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
