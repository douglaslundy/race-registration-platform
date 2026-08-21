"use client";

import { useParams } from "next/navigation";
import CampaignsManager from "@/components/campaigns/CampaignsManager";

export default function OrganizerCampaignsPage() {
  const { id } = useParams<{ id: string }>();
  return <CampaignsManager eventId={id} backHref={`/organizador/eventos/${id}`} />;
}
