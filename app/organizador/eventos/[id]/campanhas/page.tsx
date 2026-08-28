import { requireAnyPermission } from "@/lib/auth/rbac";
import CampanhasClient from "./CampanhasClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAnyPermission(["campaigns.view", "campaigns.create", "campaigns.edit", "campaigns.cancel"], { eventId: id });
  return <CampanhasClient />;
}
