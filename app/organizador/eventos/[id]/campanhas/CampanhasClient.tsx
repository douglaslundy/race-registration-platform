"use client";

import { useParams } from "next/navigation";
import CampaignsManager from "@/components/campaigns/CampaignsManager";

export default function OrganizerCampaignsPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <CampaignsManager
      apiBase={`/api/events/${id}/campaigns`}
      backHref={`/organizador/eventos/${id}`}
      scopeLabel="pros inscritos deste evento"
    />
  );
}
