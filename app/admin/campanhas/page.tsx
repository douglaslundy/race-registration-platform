"use client";

import CampaignsManager from "@/components/campaigns/CampaignsManager";

export default function AdminPlatformCampaignsPage() {
  return (
    <CampaignsManager
      apiBase="/api/admin/campaigns"
      backHref="/admin"
      scopeLabel="pra toda a base de atletas da plataforma"
      allowManualRecipients
    />
  );
}
