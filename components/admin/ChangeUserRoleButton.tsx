"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";

const ROLES: UserRole[] = ["ATHLETE", "ORGANIZER", "ADMIN", "SUPPORT", "PARTNER"];
const ROLE_LABELS: Record<UserRole, string> = {
  ATHLETE: "Atleta", ORGANIZER: "Organizador", ADMIN: "Admin", SUPPORT: "Suporte", PARTNER: "Parceiro", ASSISTANT: "Assistente",
};

export default function ChangeUserRoleButton({ userId, currentRole }: { userId: string; currentRole: UserRole }) {
  const [role, setRole] = useState(currentRole);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleChange(newRole: UserRole) {
    if (newRole === role) return;
    setSaving(true);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    setRole(newRole);
    setSaving(false);
    router.refresh();
  }

  return (
    <select
      value={role}
      disabled={saving}
      onChange={(e) => handleChange(e.target.value as UserRole)}
      className="text-xs border border-gray-300 rounded px-2 py-1 disabled:opacity-50"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
      ))}
    </select>
  );
}
